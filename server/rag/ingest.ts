import crypto from 'node:crypto';
import { extraerPdf } from './pdf.ts';
import { trocear, type FragmentoCrudo } from './chunker.ts';
import { embeber } from './embeddings.ts';
import type { Chunk, DocumentOrigin, KnowledgeDocument } from '../../shared/types.ts';

export interface ResultadoIngesta {
  doc: KnowledgeDocument;
  chunks: Chunk[];
  vectores: Float32Array[];
}

export class ErrorIngesta extends Error {}

/**
 * Convierte un archivo en fragmentos vectorizados listos para el índice.
 * Es el mismo camino para los 107 PDF del corpus y para un documento que el
 * jurado suba en caliente desde la consola: una sola ruta de código, sin
 * comportamientos divergentes entre "lo precargado" y "lo aprendido".
 */
export async function ingerir(params: {
  buffer: Buffer;
  nombreArchivo: string;
  titulo?: string;
  escenario: string;
  origen: DocumentOrigin;
  onProgreso?: (hechos: number, total: number) => void;
  /** Extrae y trocea sin vectorizar. Permite validar el corpus sin gastar cuota. */
  sinVectores?: boolean;
}): Promise<ResultadoIngesta> {
  const { buffer, nombreArchivo, escenario, origen, onProgreso, sinVectores } = params;

  const extension = nombreArchivo.toLowerCase().split('.').pop() ?? '';
  let fragmentos: FragmentoCrudo[];
  let paginas: number;

  if (extension === 'pdf') {
    const extraido = await extraerPdf(buffer);
    if (extraido.sinCapaDeTexto) {
      throw new ErrorIngesta(
        'El PDF no tiene capa de texto (parece escaneado). Se requiere OCR previo.',
      );
    }
    fragmentos = trocear(extraido.paginas);
    paginas = extraido.totalPaginas;
  } else if (['txt', 'md', 'markdown'].includes(extension)) {
    const texto = buffer.toString('utf8');
    fragmentos = trocear([{ pagina: 1, texto }]);
    paginas = 1;
  } else {
    throw new ErrorIngesta(`Formato no soportado: .${extension}. Se aceptan PDF, TXT y MD.`);
  }

  if (fragmentos.length === 0) {
    throw new ErrorIngesta('No se extrajo texto utilizable del documento.');
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  // El id deriva del contenido: subir dos veces el mismo archivo actualiza el
  // documento en vez de duplicarlo en el índice.
  const docId = `doc_${sha256.slice(0, 16)}`;
  const titulo = params.titulo ?? nombreArchivo.replace(/\.[^.]+$/, '');

  const vectores = sinVectores
    ? []
    : await embeber(
        // Se antepone el título a cada fragmento: mejora notablemente el recall
        // cuando el paciente nombra el procedimiento y el cuerpo del fragmento no.
        fragmentos.map((f) => `${titulo}\n\n${f.texto}`),
        'RETRIEVAL_DOCUMENT',
        onProgreso,
      );

  const chunks: Chunk[] = fragmentos.map((f, i) => ({
    id: `${docId}_c${i}`,
    docId,
    pagina: f.pagina,
    texto: f.texto,
  }));

  const doc: KnowledgeDocument = {
    id: docId,
    titulo,
    archivo: nombreArchivo,
    escenario,
    paginas,
    fragmentos: chunks.length,
    bytes: buffer.length,
    sha256,
    origen,
    estado: 'disponible',
    agregadoEn: new Date().toISOString(),
  };

  return { doc, chunks, vectores };
}
