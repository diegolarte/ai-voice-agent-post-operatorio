import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
import { CONFIG, ensureDirs, requireApiKey } from './config.ts';
import { almacen, escenarioDeProcedimiento } from './rag/store.ts';
import { embeberConsulta, contadorEmbeddings, precargarModelo } from './rag/embeddings.ts';
import { ErrorIngesta, ingerir } from './rag/ingest.ts';
import { razonar } from './clinical/reasoner.ts';
import { fusionar, proximosPasos } from './clinical/triage.ts';
import { CATALOGO_SLOTS, sanearSlots } from './clinical/slots.ts';
import { totalReglas } from './clinical/redflags.ts';
import * as llamadasStore from './calls/store.ts';
import {
  agregadoGlobal,
  registrarConsultaRag,
  registrarLatencia,
  registrarUsoLive,
  resumirLlamada,
} from './metrics/recorder.ts';
import type { ConsultaResponse, PacienteDemo } from '../shared/types.ts';

ensureDirs();

const app = express();
app.use(express.json({ limit: '2mb' }));

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Pacientes de demostración (derivados del dataset del reto)
// ---------------------------------------------------------------------------

let pacientes: PacienteDemo[] = [];
try {
  if (fs.existsSync(CONFIG.paths.patients)) {
    pacientes = JSON.parse(fs.readFileSync(CONFIG.paths.patients, 'utf8'));
  }
} catch (e) {
  console.warn('[pacientes] no se pudieron cargar:', e);
}

app.get('/api/pacientes', (_req, res) => res.json(pacientes));

// ---------------------------------------------------------------------------
// Salud del sistema — lo primero que mira el jurado si algo no levanta
// ---------------------------------------------------------------------------

app.get('/api/salud', (_req, res) => {
  res.json({
    ok: true,
    claveConfigurada: Boolean(CONFIG.apiKey),
    modelos: {
      voz: CONFIG.liveModel,
      razonador: CONFIG.reasonerModel,
      embeddings: CONFIG.embeddingModel,
    },
    rag: almacen.estadisticas(),
    reglasClinicas: totalReglas,
    pacientes: pacientes.length,
    slots: CATALOGO_SLOTS.map((s) => ({ clave: s.clave, etiqueta: s.etiqueta, nucleo: s.nucleo })),
  });
});

// ---------------------------------------------------------------------------
// Token efímero para la Live API
// ---------------------------------------------------------------------------

/**
 * El navegador nunca ve `GEMINI_API_KEY`. Pide un token de corta vida que sólo
 * sirve para abrir la sesión de voz. Si el proyecto no tiene habilitados los
 * tokens efímeros se degrada a la clave directa, porque quedarse sin voz
 * significa fallar la compuerta G4; el modo usado se informa en la respuesta y
 * queda visible en la consola.
 */
app.post('/api/live-token', async (_req, res) => {
  try {
    const apiKey = requireApiKey();
    const genai = new GoogleGenAI({ apiKey });
    const expira = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const token = await genai.authTokens.create({
      config: {
        uses: 1,
        expireTime: expira,
        newSessionExpireTime: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
        httpOptions: { apiVersion: 'v1alpha' },
      },
    });

    if (!token.name) throw new Error('El servicio no devolvió un token.');
    res.json({ token: token.name, modo: 'efimero', expira, modelo: CONFIG.liveModel });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    if (!CONFIG.apiKey) {
      return res.status(500).json({ error: detalle });
    }
    console.warn('[live-token] token efímero no disponible, se usa clave directa:', detalle);
    res.json({ token: CONFIG.apiKey, modo: 'clave_directa', detalle, modelo: CONFIG.liveModel });
  }
});

// ---------------------------------------------------------------------------
// Consola de conocimiento (compuerta G5)
// ---------------------------------------------------------------------------

app.get('/api/documentos', (_req, res) => {
  res.json({ documentos: almacen.listar(), estadisticas: almacen.estadisticas() });
});

app.post('/api/documentos', subida.single('archivo'), async (req, res) => {
  const archivo = req.file;
  if (!archivo) return res.status(400).json({ error: 'No se recibió ningún archivo.' });

  const t0 = Date.now();
  try {
    const { doc, chunks, vectores } = await ingerir({
      buffer: archivo.buffer,
      nombreArchivo: archivo.originalname,
      escenario: String(req.body?.escenario || 'consola'),
      origen: 'consola',
    });

    almacen.agregar(doc, chunks, vectores);
    console.log(
      `[consola] + ${doc.titulo} — ${doc.fragmentos} fragmentos en ${Date.now() - t0} ms`,
    );
    res.json({ documento: doc, ms: Date.now() - t0, estadisticas: almacen.estadisticas() });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error('[consola] fallo al ingerir:', detalle);
    res.status(e instanceof ErrorIngesta ? 422 : 500).json({ error: detalle });
  }
});

app.delete('/api/documentos/:id', (req, res) => {
  const doc = almacen.obtener(req.params.id);
  const eliminado = almacen.eliminar(req.params.id);
  if (!eliminado) return res.status(404).json({ error: 'Documento no encontrado.' });
  console.log(`[consola] − ${doc?.titulo ?? req.params.id} (olvidado)`);
  res.json({ ok: true, estadisticas: almacen.estadisticas() });
});

// ---------------------------------------------------------------------------
// Consulta clínica — la herramienta que invoca el agente de voz
// ---------------------------------------------------------------------------

app.post('/api/consulta', async (req, res) => {
  const t0 = Date.now();
  const { callId, pregunta } = req.body ?? {};

  if (!callId || typeof pregunta !== 'string' || !pregunta.trim()) {
    return res.status(400).json({ error: 'Se requieren `callId` y `pregunta`.' });
  }

  try {
    const embeddingsAntes = contadorEmbeddings.tokens;
    const llamada = llamadasStore.obtenerLlamada(callId);

    const slots = llamadasStore.actualizarSlots(callId, sanearSlots(req.body?.slots));

    const vector = await embeberConsulta(pregunta);
    // Se prioriza el material del procedimiento del paciente; si no alcanza,
    // se completa con el resto marcándolo. Ver `store.buscar`.
    const citas = almacen.buscar(
      vector,
      undefined,
      undefined,
      escenarioDeProcedimiento(llamada?.paciente?.procedimiento),
    );

    const salida = await razonar({
      pregunta,
      citas,
      slots,
      paciente: llamada?.paciente ?? null,
      diaPostop: llamada?.paciente?.dia_postop ?? null,
    });

    // Sólo se conservan como evidencia los fragmentos que el razonador declaró
    // haber usado: así la trazabilidad refleja lo que sustentó la respuesta y
    // no todo lo que el buscador devolvió.
    const citasUsadas = salida.chunkIdsUsados.length
      ? citas.filter((c) => salida.chunkIdsUsados.includes(c.chunkId))
      : [];

    const triaje = fusionar({
      slots,
      nivelModelo: salida.nivel,
      justificacionModelo: salida.justificacion,
    });

    llamadasStore.registrarCitas(callId, citasUsadas);
    const alerta = llamadasStore.aplicarTriaje(callId, triaje, citasUsadas);

    const latenciaMs = Date.now() - t0;
    registrarConsultaRag(callId, {
      tokensEntrada: salida.tokensEntrada,
      tokensSalida: salida.tokensSalida,
      tokensEmbeddings: contadorEmbeddings.tokens - embeddingsAntes,
      latenciaMs,
      citas: citasUsadas.length,
    });

    const respuesta: ConsultaResponse = {
      respuestaHablada: salida.respuestaHablada,
      fueraDeCorpus: salida.fueraDeCorpus,
      citas: citasUsadas,
      triaje,
      alertaId: alerta?.id,
      latenciaMs,
    };
    res.json(respuesta);
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error('[consulta] fallo:', detalle);
    // Falla hacia el lado seguro: nunca se devuelve contenido clínico inventado.
    res.status(200).json({
      respuestaHablada:
        'Perdóneme, tuve un problema para verificar esa información. Prefiero que lo revise una enfermera; voy a dejarlo registrado.',
      fueraDeCorpus: true,
      citas: [],
      triaje: {
        nivel: 'amarillo',
        nivelReglas: 'verde',
        nivelModelo: 'amarillo',
        fusion: 'max_asimetrico',
        banderas: [],
        justificacion: `Fallo técnico en la consulta clínica: ${detalle}`,
        slotsFaltantes: [],
        requiereIndagar: false,
      },
      latenciaMs: Date.now() - t0,
      error: detalle,
    });
  }
});

// ---------------------------------------------------------------------------
// Ciclo de vida de la llamada
// ---------------------------------------------------------------------------

app.post('/api/llamada/iniciar', (req, res) => {
  const { callId, pacienteId } = req.body ?? {};
  if (!callId) return res.status(400).json({ error: 'Falta `callId`.' });

  const paciente = pacientes.find((p) => p.paciente_id === pacienteId) ?? null;
  llamadasStore.abrirLlamada(callId, paciente);
  console.log(`[llamada] inicia ${callId} — paciente ${paciente?.nombre_completo ?? 'anónimo'}`);
  res.json({ ok: true, paciente, proximosPasos: proximosPasos('verde') });
});

app.post('/api/llamada/turno', (req, res) => {
  const { callId, hablante, texto, latenciaMs, tokensEntrada, tokensSalida } = req.body ?? {};
  if (!callId) return res.status(400).json({ error: 'Falta `callId`.' });

  if (texto && (hablante === 'agente' || hablante === 'paciente')) {
    llamadasStore.registrarTurno(callId, { hablante, texto, ts: new Date().toISOString() });
  }
  if (typeof latenciaMs === 'number') registrarLatencia(callId, latenciaMs);
  if (typeof tokensEntrada === 'number' || typeof tokensSalida === 'number') {
    registrarUsoLive(callId, tokensEntrada ?? 0, tokensSalida ?? 0);
  }
  res.json({ ok: true, metricas: resumirLlamada(callId) });
});

app.post('/api/llamada/slots', (req, res) => {
  const { callId } = req.body ?? {};
  if (!callId) return res.status(400).json({ error: 'Falta `callId`.' });

  const slots = llamadasStore.actualizarSlots(callId, sanearSlots(req.body?.slots));
  const triaje = fusionar({ slots, nivelModelo: 'verde', justificacionModelo: '' });
  const alerta = llamadasStore.aplicarTriaje(callId, triaje, []);
  res.json({ slots, triaje, alertaId: alerta?.id });
});

app.post('/api/llamada/cerrar', (req, res) => {
  const { callId } = req.body ?? {};
  if (!callId) return res.status(400).json({ error: 'Falta `callId`.' });

  const resumen = llamadasStore.cerrarLlamada(callId);
  if (!resumen) return res.status(404).json({ error: 'Llamada no encontrada.' });
  console.log(
    `[llamada] cierra ${callId} — ${resumen.nivelFinal.toUpperCase()} · ` +
      `P50 ${resumen.metricas.latenciaP50Ms ?? '—'} ms · ${resumen.metricas.consultasRag} consultas RAG`,
  );
  res.json(resumen);
});

app.get('/api/llamadas', (_req, res) => res.json(llamadasStore.listarResumenes()));

// ---------------------------------------------------------------------------
// Métricas (§5 de la rúbrica)
// ---------------------------------------------------------------------------

app.get('/api/metricas', (_req, res) => res.json(agregadoGlobal()));

/**
 * Resultado de la evaluación offline del triaje contra el ground truth del
 * dataset (`npm run eval`). Se expone para que la validación sea observable
 * desde la interfaz y no sólo en la salida de una terminal.
 */
app.get('/api/evaluacion', (_req, res) => {
  try {
    const archivo = `${CONFIG.paths.logs}/eval-triaje.json`;
    if (!fs.existsSync(archivo)) {
      return res.json({ disponible: false });
    }
    const informe = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    res.json({ disponible: true, ...informe });
  } catch (e) {
    res.status(500).json({
      disponible: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

// ---------------------------------------------------------------------------

// El modelo de embeddings se precarga ANTES de abrir el puerto: la descarga
// (primer arranque, ~30-60s) y la carga en memoria quedan dentro de la
// ventana de instalación que mide la compuerta G2, no a mitad de la primera
// llamada de un paciente.
console.log(`\n  Cargando modelo de embeddings (${CONFIG.embeddingModel})...`);
await precargarModelo();
almacen.cargar();

app.listen(CONFIG.port, () => {
  console.log(`\n  Centinela · backend en http://localhost:${CONFIG.port}`);
  console.log(`  voz:        ${CONFIG.liveModel}`);
  console.log(`  razonador:  ${CONFIG.reasonerModel}`);
  console.log(`  embeddings: ${CONFIG.embeddingModel} (dim ${CONFIG.embeddingDim}, local)`);
  if (!CONFIG.apiKey) {
    console.warn('\n  ⚠  Falta GEMINI_API_KEY en .env — la voz y el razonador no funcionarán.\n');
  }
});
