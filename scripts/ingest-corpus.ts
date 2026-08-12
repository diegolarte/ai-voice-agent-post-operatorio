/**
 * Construye el índice vectorial a partir del corpus clínico del reto.
 *
 *   npm run ingest -- [ruta/a/dataset/textos]
 *
 * El repositorio ya incluye el índice precomputado en `data/index/`, así que
 * el jurado NO necesita ejecutar esto para levantar la solución (compuerta G2).
 * Este script existe para poder reconstruirlo y para dejar auditable cómo se
 * construyó.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDirs } from '../server/config.ts';
import { almacen } from '../server/rag/store.ts';
import { ingerir, ErrorIngesta } from '../server/rag/ingest.ts';
import { contadorEmbeddings } from '../server/rag/embeddings.ts';
import type { Chunk, KnowledgeDocument } from '../shared/types.ts';

const ARGS = process.argv.slice(2);
/** `--dry` extrae y trocea sin vectorizar: valida el corpus sin gastar cuota. */
const DRY = ARGS.includes('--dry');
/** `--reset` descarta el índice existente y reconstruye desde cero. */
const RESET = ARGS.includes('--reset');

const CORPUS =
  ARGS.find((a) => !a.startsWith('--')) ??
  process.env.CORPUS_DIR ??
  path.resolve(process.cwd(), '..', 'kit', 'dataset', 'textos');

/** Nombres de carpeta → escenario clínico legible. */
const ESCENARIOS: Record<string, string> = {
  Appendicitis: 'Apendicitis / apendicectomía',
  breast_cancer: 'Oncología mama y cuello uterino',
  cholecystitis: 'Colecistitis / colecistectomía',
  'colorectal cancer': 'Cáncer colorrectal',
  'total joint replacement': 'Reemplazo articular total',
};

function listarArchivos(dir: string): { ruta: string; escenario: string }[] {
  const salida: { ruta: string; escenario: string }[] = [];
  for (const carpeta of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!carpeta.isDirectory()) continue;
    const escenario = ESCENARIOS[carpeta.name] ?? carpeta.name;
    const sub = path.join(dir, carpeta.name);
    for (const archivo of fs.readdirSync(sub)) {
      if (/\.(pdf|txt|md)$/i.test(archivo)) {
        salida.push({ ruta: path.join(sub, archivo), escenario });
      }
    }
  }
  return salida.sort((a, b) => a.ruta.localeCompare(b.ruta));
}

async function main() {
  ensureDirs();

  if (!fs.existsSync(CORPUS)) {
    console.error(`\n✗ No existe el corpus en: ${CORPUS}`);
    console.error('  Clona https://github.com/TechSphere2026/ParticipantArtifacts y pasa la ruta:');
    console.error('  npm run ingest -- ../ParticipantArtifacts/dataset/textos\n');
    process.exit(1);
  }

  const archivos = listarArchivos(CORPUS);
  console.log(`\nCorpus: ${CORPUS}`);
  console.log(
    DRY
      ? `${archivos.length} archivos · SIMULACIÓN (--dry): se extrae y trocea, no se vectoriza ni se escribe el índice\n`
      : `${archivos.length} archivos · modelo ${CONFIG.embeddingModel} · dim ${CONFIG.embeddingDim}\n`,
  );

  const documentos: KnowledgeDocument[] = [];
  const chunks: Chunk[] = [];
  const vectores: Float32Array[] = [];
  const omitidos: { archivo: string; razon: string }[] = [];
  const vistos = new Set<string>();

  // Reanudación: la ingesta completa tarda más de una hora contra el límite de
  // 100 peticiones/minuto del nivel gratuito. Perder ese progreso por un corte
  // de red es inaceptable, así que cada documento se persiste al terminar y una
  // segunda ejecución salta lo ya indexado.
  if (RESET && !DRY) {
    for (const f of ['manifest.json', 'chunks.json', 'vectors.bin']) {
      fs.rmSync(path.join(CONFIG.paths.index, f), { force: true });
    }
    console.log('Índice anterior descartado (--reset).\n');
  }
  if (!DRY) {
    for (const doc of almacen.listar()) vistos.add(doc.sha256);
    if (vistos.size) console.log(`Reanudando: ${vistos.size} documentos ya indexados se saltarán.\n`);
  }

  const t0 = Date.now();
  for (const [i, { ruta, escenario }] of archivos.entries()) {
    const nombre = path.basename(ruta);
    const etiqueta = `[${String(i + 1).padStart(3)}/${archivos.length}] ${nombre.slice(0, 62)}`;
    const buffer = fs.readFileSync(ruta);

    // El sha se calcula antes de vectorizar: saltar un duplicado o un documento
    // ya indexado no debe costar ni una petición de cuota.
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    if (vistos.has(sha)) {
      console.log(`${etiqueta} — ya indexado, se salta`);
      continue;
    }

    try {
      const resultado = await ingerir({
        buffer,
        nombreArchivo: nombre,
        escenario,
        origen: 'corpus',
        sinVectores: DRY,
      });

      vistos.add(resultado.doc.sha256);

      documentos.push(resultado.doc);
      chunks.push(...resultado.chunks);
      vectores.push(...resultado.vectores);
      if (!DRY) almacen.agregar(resultado.doc, resultado.chunks, resultado.vectores);
      console.log(`${etiqueta} — ${resultado.chunks.length} fragmentos`);
    } catch (e) {
      const razon = e instanceof Error ? e.message : String(e);
      omitidos.push({ archivo: nombre, razon });
      console.warn(`${etiqueta} — OMITIDO: ${razon.slice(0, 80)}`);
      if (!(e instanceof ErrorIngesta)) {
        // Un fallo de red/cuota no debe pasar como "documento sin texto".
        console.warn('   (fallo no atribuible al documento; revisa cuota o conectividad)');
      }
    }
  }

  // El índice ya se fue persistiendo documento a documento durante el bucle.

  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  const mb = (chunks.length * CONFIG.embeddingDim * 4) / 1024 / 1024;

  console.log(`\n${'─'.repeat(62)}`);
  console.log(`  Documentos indexados : ${documentos.length}`);
  console.log(`  Fragmentos           : ${chunks.length}`);
  console.log(`  Índice               : ${mb.toFixed(1)} MB`);
  console.log(`  Volumen procesado    : ~${contadorEmbeddings.tokens.toLocaleString('es')} tokens (estimado)`);
  console.log(`  Costo                : $0 — BGE-M3 corre localmente, sin API`);
  console.log(`  Tiempo               : ${seg}s`);
  console.log(`  Omitidos             : ${omitidos.length}`);
  for (const o of omitidos) console.log(`      · ${o.archivo} — ${o.razon.slice(0, 70)}`);
  console.log(`${'─'.repeat(62)}\n`);

  fs.writeFileSync(
    path.join(CONFIG.paths.index, 'ingesta-reporte.json'),
    JSON.stringify(
      {
        fecha: new Date().toISOString(),
        corpus: CORPUS,
        modeloEmbeddings: CONFIG.embeddingModel,
        dim: CONFIG.embeddingDim,
        documentos: documentos.length,
        fragmentos: chunks.length,
        tokensEmbedding: contadorEmbeddings.tokens,
        segundos: Number(seg),
        omitidos,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error('\n✗ Ingesta fallida:', e);
  process.exit(1);
});
