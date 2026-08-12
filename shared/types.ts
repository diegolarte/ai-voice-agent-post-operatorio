/**
 * Contratos compartidos entre el backend y la interfaz.
 * Un solo lugar para el vocabulario del dominio: si cambia aquí, cambia en ambos lados.
 */

// ---------------------------------------------------------------------------
// Conocimiento clínico (RAG)
// ---------------------------------------------------------------------------

export type DocumentOrigin = 'corpus' | 'consola';

export type DocumentStatus = 'procesando' | 'disponible' | 'error';

export interface KnowledgeDocument {
  id: string;
  titulo: string;
  archivo: string;
  escenario: string;
  paginas: number;
  fragmentos: number;
  bytes: number;
  sha256: string;
  origen: DocumentOrigin;
  estado: DocumentStatus;
  error?: string;
  agregadoEn: string;
}

export interface Chunk {
  id: string;
  docId: string;
  pagina: number;
  texto: string;
}

/** Un fragmento recuperado, con su score y la referencia citable. */
export interface Cita {
  chunkId: string;
  docId: string;
  documento: string;
  escenario: string;
  pagina: number;
  score: number;
  extracto: string;
}

// ---------------------------------------------------------------------------
// Estado clínico de la llamada
// ---------------------------------------------------------------------------

/**
 * Las casillas que el agente debe llenar conversando. Se corresponden 1:1 con
 * las columnas de `trayectorias_postop_silver.xlsx`, más los signos de alarma
 * que el corpus exige descartar y que la trayectoria no modela.
 */
export interface SlotsSintomas {
  dolor_nrs?: number;
  fiebre_c?: number;
  /**
   * El reto advierte que el paciente "a veces ni [tiene] un termómetro".
   * Sin esta casilla, la ausencia de `fiebre_c` sería indistinguible entre
   * "no tiene fiebre" y "no pudo medirse", que es justo el falso negativo caro.
   */
  fiebre_referida?: 'no' | 'sensacion' | 'escalofrios';
  /**
   * Los valores de `herida`, `movilidad`, `apetito` y `sueno` reproducen
   * literalmente el vocabulario de `trayectorias_postop_silver.xlsx`, para que
   * el motor de reglas sea evaluable contra el ground truth del reto sin
   * traducciones intermedias (ver `npm run eval`). Los valores adicionales
   * —`secrecion`, `dehiscencia`, `nula`, `nulo`— cubren signos de alarma que
   * el dataset no modela pero que el corpus clínico obliga a descartar.
   */
  herida?: 'normal' | 'eritema_leve' | 'secrecion' | 'secrecion_purulenta' | 'dehiscencia';
  movilidad?: 'normal' | 'limitada_esperada' | 'incapacitante_nueva' | 'nula';
  apetito?: 'normal' | 'levemente_disminuido' | 'muy_disminuido' | 'nulo';
  sueno?: 'normal' | 'levemente_alterado' | 'muy_alterado';
  nauseas_vomito?: 'ninguno' | 'nauseas' | 'vomito' | 'vomito_persistente';
  transito_intestinal?: 'normal' | 'estrenido' | 'sin_gases_ni_heces';
  respiracion?: 'normal' | 'disnea_leve' | 'disnea_marcada' | 'dolor_toracico';
  sangrado?: 'ninguno' | 'leve' | 'activo';
  pierna?: 'normal' | 'dolor_pantorrilla' | 'edema_unilateral';
  estado_mental?: 'normal' | 'confusion' | 'somnolencia_marcada';
}

export type NivelTriaje = 'verde' | 'amarillo' | 'rojo';

export interface BanderaRoja {
  regla: string;
  nivel: NivelTriaje;
  motivo: string;
  slot: keyof SlotsSintomas;
  valor: unknown;
}

export interface Triaje {
  nivel: NivelTriaje;
  /** Nivel propuesto por el motor determinista de reglas. */
  nivelReglas: NivelTriaje;
  /** Nivel propuesto por el razonador clínico fundamentado. */
  nivelModelo: NivelTriaje;
  /** Por asimetría clínica el nivel final es el MÁXIMO de ambos. */
  fusion: 'max_asimetrico';
  banderas: BanderaRoja[];
  justificacion: string;
  slotsFaltantes: (keyof SlotsSintomas)[];
  requiereIndagar: boolean;
}

// ---------------------------------------------------------------------------
// Consulta clínica (el contrato de la herramienta que llama el modelo de voz)
// ---------------------------------------------------------------------------

export interface ConsultaRequest {
  callId: string;
  pregunta: string;
  slots?: SlotsSintomas;
  /** Marca de tiempo del cliente al emitir la llamada a herramienta (ms epoch). */
  tCliente?: number;
}

export interface ConsultaResponse {
  /** Texto EXACTO que el agente de voz debe pronunciar. Corto y hablable. */
  respuestaHablada: string;
  /** `true` si el corpus no sustenta una respuesta: el agente debe declarar el límite. */
  fueraDeCorpus: boolean;
  citas: Cita[];
  triaje: Triaje;
  /** Identificador del evento de escalamiento, si se generó uno. */
  alertaId?: string;
  latenciaMs: number;
}

// ---------------------------------------------------------------------------
// Llamada y escalamiento
// ---------------------------------------------------------------------------

export interface PacienteDemo {
  paciente_id: string;
  nombre_completo: string;
  edad: number;
  genero: string;
  procedimiento: string;
  fecha_cirugia: string;
  comorbilidades: string[];
  ciudad: string;
  departamento: string;
  documento_cc: string;
  eps: string;
  dia_postop: number;
}

export interface TurnoTranscrito {
  hablante: 'agente' | 'paciente';
  texto: string;
  ts: string;
}

export interface Alerta {
  id: string;
  callId: string;
  nivel: NivelTriaje;
  creadaEn: string;
  motivo: string;
  banderas: BanderaRoja[];
  citas: Cita[];
  slots: SlotsSintomas;
}

export interface ResumenLlamada {
  callId: string;
  paciente: PacienteDemo | null;
  iniciadaEn: string;
  finalizadaEn: string;
  duracionSeg: number;
  nivelFinal: NivelTriaje;
  slots: SlotsSintomas;
  sintomasReportados: string[];
  decision: string;
  proximosPasos: string[];
  alertas: Alerta[];
  citasUsadas: Cita[];
  transcripcion: TurnoTranscrito[];
  metricas: MetricasLlamada;
}

// ---------------------------------------------------------------------------
// Observabilidad (§5 de la rúbrica: métricas obligatorias)
// ---------------------------------------------------------------------------

export interface MetricasLlamada {
  turnos: number;
  latenciaP50Ms: number | null;
  latenciaP95Ms: number | null;
  tokensEntrada: number;
  tokensSalida: number;
  invocacionesModelo: number;
  consultasRag: number;
  costoUsd: number;
}

export interface EventoLatencia {
  callId: string;
  turno: number;
  /** Desde que el paciente termina de hablar hasta el primer audio del agente. */
  latenciaMs: number;
  ts: string;
}

export type VistaUi = 'llamada' | 'evidencia' | 'triaje' | 'resumen' | 'consola';
