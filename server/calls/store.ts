import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';
import type {
  Alerta,
  Cita,
  NivelTriaje,
  PacienteDemo,
  ResumenLlamada,
  SlotsSintomas,
  Triaje,
  TurnoTranscrito,
} from '../../shared/types.ts';
import { describirSlots } from '../clinical/slots.ts';
import { decisionLegible, proximosPasos } from '../clinical/triage.ts';
import { resumirLlamada } from '../metrics/recorder.ts';
import { ordenTriaje } from '../clinical/redflags.ts';

interface Llamada {
  callId: string;
  paciente: PacienteDemo | null;
  iniciadaEn: string;
  finalizadaEn?: string;
  slots: SlotsSintomas;
  triaje: Triaje | null;
  alertas: Alerta[];
  citas: Map<string, Cita>;
  transcripcion: TurnoTranscrito[];
}

const llamadas = new Map<string, Llamada>();

export function abrirLlamada(callId: string, paciente: PacienteDemo | null): Llamada {
  const existente = llamadas.get(callId);
  if (existente) return existente;

  const nueva: Llamada = {
    callId,
    paciente,
    iniciadaEn: new Date().toISOString(),
    slots: {},
    triaje: null,
    alertas: [],
    citas: new Map(),
    transcripcion: [],
  };
  llamadas.set(callId, nueva);
  return nueva;
}

export function obtenerLlamada(callId: string): Llamada | undefined {
  return llamadas.get(callId);
}

export function actualizarSlots(callId: string, parciales: SlotsSintomas): SlotsSintomas {
  const ll = abrirLlamada(callId, null);
  ll.slots = { ...ll.slots, ...parciales };
  return ll.slots;
}

export function registrarCitas(callId: string, citas: Cita[]): void {
  const ll = abrirLlamada(callId, null);
  for (const c of citas) ll.citas.set(c.chunkId, c);
}

export function registrarTurno(callId: string, turno: TurnoTranscrito): void {
  const ll = abrirLlamada(callId, null);
  const ultimo = ll.transcripcion.at(-1);
  // La Live API entrega la transcripción en trozos; se fusionan los
  // consecutivos del mismo hablante para que el resumen sea legible.
  if (ultimo && ultimo.hablante === turno.hablante) {
    ultimo.texto = `${ultimo.texto} ${turno.texto}`.replace(/\s+/g, ' ').trim();
    ultimo.ts = turno.ts;
    return;
  }
  ll.transcripcion.push(turno);
}

export function aplicarTriaje(callId: string, triaje: Triaje, citas: Cita[]): Alerta | null {
  const ll = abrirLlamada(callId, null);

  // Se conserva el peor triaje de la llamada: que el paciente diga al final
  // "ya me siento mejor" no borra un signo de alarma reportado antes.
  if (!ll.triaje || ordenTriaje[triaje.nivel] >= ordenTriaje[ll.triaje.nivel]) {
    ll.triaje = triaje;
  }

  if (triaje.nivel === 'verde') return null;

  // Una alerta por nivel: no se inunda al personal con duplicados del mismo
  // hallazgo repetido en varios turnos.
  const yaExiste = ll.alertas.some((a) => a.nivel === triaje.nivel);
  if (yaExiste) return null;

  const alerta: Alerta = {
    id: `alt_${callId}_${ll.alertas.length + 1}`,
    callId,
    nivel: triaje.nivel,
    creadaEn: new Date().toISOString(),
    motivo: triaje.justificacion,
    banderas: triaje.banderas,
    citas,
    slots: { ...ll.slots },
  };
  ll.alertas.push(alerta);
  persistirAlerta(alerta);
  return alerta;
}

export function cerrarLlamada(callId: string): ResumenLlamada | null {
  const ll = llamadas.get(callId);
  if (!ll) return null;

  ll.finalizadaEn = new Date().toISOString();
  const nivelFinal: NivelTriaje = ll.triaje?.nivel ?? 'verde';
  const duracionSeg = Math.round(
    (new Date(ll.finalizadaEn).getTime() - new Date(ll.iniciadaEn).getTime()) / 1000,
  );

  const resumen: ResumenLlamada = {
    callId,
    paciente: ll.paciente,
    iniciadaEn: ll.iniciadaEn,
    finalizadaEn: ll.finalizadaEn,
    duracionSeg,
    nivelFinal,
    slots: ll.slots,
    sintomasReportados: describirSlots(ll.slots),
    decision: ll.triaje
      ? decisionLegible(ll.triaje)
      : 'SIN DATOS — la llamada terminó antes de recoger información clínica.',
    proximosPasos: proximosPasos(nivelFinal),
    alertas: ll.alertas,
    citasUsadas: [...ll.citas.values()].sort((a, b) => b.score - a.score),
    transcripcion: ll.transcripcion,
    metricas: resumirLlamada(callId),
  };

  persistirResumen(resumen);
  return resumen;
}

export function listarResumenes(): ResumenLlamada[] {
  try {
    if (!fs.existsSync(CONFIG.paths.calls)) return [];
    return fs
      .readdirSync(CONFIG.paths.calls)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(CONFIG.paths.calls, f), 'utf8')))
      .sort((a, b) => (a.iniciadaEn < b.iniciadaEn ? 1 : -1));
  } catch {
    return [];
  }
}

function persistirResumen(resumen: ResumenLlamada): void {
  try {
    fs.mkdirSync(CONFIG.paths.calls, { recursive: true });
    fs.writeFileSync(
      path.join(CONFIG.paths.calls, `${resumen.callId}.json`),
      JSON.stringify(resumen, null, 2),
    );
  } catch (e) {
    console.warn('[llamadas] no se pudo persistir el resumen:', e);
  }
}

function persistirAlerta(alerta: Alerta): void {
  try {
    fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
    fs.appendFileSync(
      path.join(CONFIG.paths.logs, 'alertas.jsonl'),
      JSON.stringify(alerta) + '\n',
    );
    console.log(`[ALERTA ${alerta.nivel.toUpperCase()}] ${alerta.callId} — ${alerta.motivo.slice(0, 120)}`);
  } catch (e) {
    console.warn('[alertas] no se pudo persistir:', e);
  }
}
