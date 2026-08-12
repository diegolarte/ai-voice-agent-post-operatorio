import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { CONFIG } from '../config.ts';

/**
 * Embeddings locales con BGE-M3 (vía ONNX/transformers.js) — sin API, sin
 * cuota, sin llave.
 *
 * Se empezó con `gemini-embedding-001` (ver historial), pero el nivel
 * gratuito de esa API impone `EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier`
 * = 1000 peticiones/día, y una llamada de "N textos" consume N peticiones de
 * esa cuota. Con ~6300 fragmentos en el corpus, ingerirlo agotaba el día
 * entero, y —más grave— arriesgaba que la compuerta G5 fallara en plena
 * evaluación si el jurado sube un documento de prueba y la cuota diaria ya
 * está en cero. BGE-M3 local elimina esa clase de fallo por completo: no hay
 * límite que agotar. Coincide además con lo sugerido en `stack-tecnico.md`
 * §4, y BGE-M3 está reconocido por entender mejor el español clínico que el
 * embedding de Gemini.
 *
 * El modelo cuantizado (`dtype: 'q8'`) pesa ~544 MB — no los ~2.2 GB de la
 * versión completa — y se descarga una sola vez en el primer arranque,
 * cacheado en disco por transformers.js. `precargarModelo()` se llama al
 * levantar el servidor para que esa descarga ocurra durante el setup
 * (compuerta G2), no a mitad de la primera llamada de un paciente.
 */

/** Tokens de embedding "consumidos", para el reporte de costo (§5). Con inferencia
 * local el costo real es $0; se sigue contando para que el reporte muestre el
 * volumen procesado, no un costo inventado. */
export const contadorEmbeddings = { tokens: 0, llamadas: 0 };

let extractor: FeatureExtractionPipeline | null = null;
let cargando: Promise<FeatureExtractionPipeline> | null = null;

async function obtenerExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  if (!cargando) {
    cargando = pipeline('feature-extraction', CONFIG.embeddingModel, { dtype: 'q8' }).then((p) => {
      extractor = p as FeatureExtractionPipeline;
      return extractor;
    });
  }
  return cargando;
}

/** Descarga y carga el modelo por adelantado. Ver nota de arquitectura arriba. */
export async function precargarModelo(): Promise<void> {
  const t0 = Date.now();
  await obtenerExtractor();
  console.log(`[embeddings] ${CONFIG.embeddingModel} listo en ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const LOTE = 16;

/**
 * Vectoriza texto con BGE-M3. El parámetro `tarea` se conserva en la firma
 * por compatibilidad con el resto del código —BGE-M3, a diferencia de otros
 * modelos BGE, no requiere un prefijo de instrucción distinto para consultas
 * frente a documentos (así lo indica su ficha de modelo)—.
 */
export async function embeber(
  textos: string[],
  _tarea: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  onProgreso?: (hechos: number, total: number) => void,
): Promise<Float32Array[]> {
  if (textos.length === 0) return [];
  const modelo = await obtenerExtractor();
  const salida: Float32Array[] = [];

  for (let i = 0; i < textos.length; i += LOTE) {
    const lote = textos.slice(i, i + LOTE);
    const tensor = await modelo(lote, { pooling: 'mean', normalize: true });

    const [n, dim] = tensor.dims;
    if (dim !== CONFIG.embeddingDim) {
      throw new Error(
        `El modelo devolvió vectores de ${dim} dimensiones; se esperaban ${CONFIG.embeddingDim}. ` +
          `Ajusta EMBEDDING_DIM en .env.`,
      );
    }
    const datos = tensor.data as Float32Array;
    for (let k = 0; k < n; k++) {
      salida.push(datos.slice(k * dim, (k + 1) * dim));
    }

    contadorEmbeddings.llamadas += 1;
    contadorEmbeddings.tokens += lote.reduce((n2, t) => n2 + Math.ceil(t.length / 4), 0);
    onProgreso?.(Math.min(i + LOTE, textos.length), textos.length);
  }

  return salida;
}

export async function embeberConsulta(texto: string): Promise<Float32Array> {
  const [v] = await embeber([texto], 'RETRIEVAL_QUERY');
  return v;
}
