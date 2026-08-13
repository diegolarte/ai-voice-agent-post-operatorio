import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

/**
 * Carga `.env` sin dependencias externas. Node 20 no expone `--env-file` de
 * forma estable en todos los runners, y una dependencia menos es un riesgo
 * menos para la compuerta de 15 minutos.
 */
function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

export const CONFIG = {
  apiKey: process.env.GEMINI_API_KEY ?? '',

  /**
   * Compuerta G3 — ambos modelos pertenecen a la familia Google Gemini, gama Flash.
   * `liveModel` conversa; `reasonerModel` razona sobre el corpus. Ver docs/INFORME-FINAL.md §3.
   */
  liveModel: process.env.LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-preview-12-2025',
  /**
   * `gemini-2.5-flash` fue la elección original, pero Google la retiró para
   * cuentas nuevas (HTTP 404 "no longer available to new users") — se
   * descubrió al probar el endpoint real, no por el catálogo de /models, que
   * seguía listándolo. Los sucesores `gemini-3.5-flash`/`gemini-3.6-flash`
   * tardan 4-20s por defecto (thinking activado) y `thinkingBudget: 0` les
   * devuelve HTTP 400 — no lo soportan. `gemini-2.5-flash-lite` sí pertenece
   * a la gama Flash (compuerta G3) y responde en ~1-1.5s sin configuración
   * especial.
   */
  reasonerModel: process.env.REASONER_MODEL ?? 'gemini-3.5-flash-lite',

  /**
   * Modelos de reserva para el razonador, en orden.
   *
   * El nivel gratuito impone una cuota **diaria por modelo** que en algunos
   * casos es de sólo 20 peticiones
   * (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`), y el `retryDelay`
   * que devuelve el error engaña: sugiere esperar segundos cuando en realidad
   * no se repone hasta el día siguiente. Cada modelo tiene su propia cuota, así
   * que agotar uno no agota los demás.
   *
   * Todos son de la gama Flash de Gemini, así que la cadena no compromete la
   * compuerta G3 sea cual sea el que acabe respondiendo.
   */
  reasonerFallbacks: (
    process.env.REASONER_FALLBACKS ??
    'gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-flash-lite-latest,gemini-3-flash-preview'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /**
   * BGE-M3 local (ONNX vía transformers.js) — libre según G3, sin cuota. Ver
   * la nota de cabecera en `server/rag/embeddings.ts` para el porqué del
   * cambio desde `gemini-embedding-001`.
   */
  embeddingModel: process.env.EMBEDDING_MODEL ?? 'Xenova/bge-m3',
  embeddingDim: Number(process.env.EMBEDDING_DIM ?? 1024),
  voice: process.env.LIVE_VOICE ?? 'Leda',

  port: Number(process.env.PORT ?? 8787),
  topK: Number(process.env.RAG_TOP_K ?? 6),
  /**
   * Calibrado empíricamente contra el corpus completo con BGE-M3
   * (`npm run eval:retrieval`): dentro de corpus min 0.722, fuera de corpus
   * max 0.708 — 0.71 separa ambos grupos sin solape en la muestra de prueba.
   * BGE-M3 distribuye el coseno más alto en todo el rango que
   * `gemini-embedding-001`; el 0.55 anterior no servía para este modelo.
   */
  minScore: Number(process.env.RAG_MIN_SCORE ?? 0.71),

  paths: {
    index: path.join(ROOT, 'data', 'index'),
    uploads: path.join(ROOT, 'data', 'uploads'),
    patients: path.join(ROOT, 'data', 'pacientes.json'),
    logs: path.join(ROOT, 'logs'),
    calls: path.join(ROOT, 'logs', 'llamadas'),
  },

  /**
   * Precios públicos de la API de Gemini (USD por millón de tokens), usados para
   * estimar el costo por llamada que exige §5 de la rúbrica. Se declaran aquí
   * como constantes auditables en vez de números mágicos en el reporte.
   * Fuente: https://ai.google.dev/gemini-api/docs/pricing
   */
  precios: {
    liveAudioEntrada: 3.0,
    liveAudioSalida: 12.0,
    liveTextoEntrada: 0.5,
    razonadorEntrada: 0.3,
    razonadorSalida: 2.5,
    /** BGE-M3 corre localmente: costo real $0. Se deja en 0 para que el
     * reporte de costos (§5) refleje la realidad y no un precio de API que
     * ya no aplica. */
    embeddings: 0,
  },
} as const;

export function ensureDirs() {
  for (const dir of [
    CONFIG.paths.index,
    CONFIG.paths.uploads,
    CONFIG.paths.logs,
    CONFIG.paths.calls,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function requireApiKey(): string {
  if (!CONFIG.apiKey) {
    throw new Error(
      'Falta GEMINI_API_KEY. Copia .env.example a .env y pega tu clave de https://aistudio.google.com/app/apikey',
    );
  }
  return CONFIG.apiKey;
}
