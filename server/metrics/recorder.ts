import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.ts';
import type { MetricasLlamada } from '../../shared/types.ts';

/**
 * Registro de observabilidad. Cada número que aparece en el README sale de
 * aquí y queda escrito en `logs/metricas.jsonl`, para que el jurado pueda
 * contrastar lo reportado contra lo ocurrido en la sesión (§5 de la rúbrica).
 */

export interface AcumuladorLlamada {
  callId: string;
  latencias: number[];
  tokensEntradaLive: number;
  tokensSalidaLive: number;
  tokensEntradaRazonador: number;
  tokensSalidaRazonador: number;
  tokensEmbeddings: number;
  invocacionesModelo: number;
  consultasRag: number;
  turnos: number;
}

const acumuladores = new Map<string, AcumuladorLlamada>();

export function acumulador(callId: string): AcumuladorLlamada {
  let a = acumuladores.get(callId);
  if (!a) {
    a = {
      callId,
      latencias: [],
      tokensEntradaLive: 0,
      tokensSalidaLive: 0,
      tokensEntradaRazonador: 0,
      tokensSalidaRazonador: 0,
      tokensEmbeddings: 0,
      invocacionesModelo: 0,
      consultasRag: 0,
      turnos: 0,
    };
    acumuladores.set(callId, a);
  }
  return a;
}

export function registrarLatencia(callId: string, latenciaMs: number): void {
  if (!Number.isFinite(latenciaMs) || latenciaMs <= 0 || latenciaMs > 60_000) return;
  const a = acumulador(callId);
  a.latencias.push(latenciaMs);
  a.turnos = Math.max(a.turnos, a.latencias.length);
  anexar('latencia', { callId, latenciaMs, turno: a.latencias.length });
}

export function registrarUsoLive(
  callId: string,
  entrada: number,
  salida: number,
): void {
  const a = acumulador(callId);
  a.tokensEntradaLive += entrada;
  a.tokensSalidaLive += salida;
}

export function registrarConsultaRag(
  callId: string,
  datos: { tokensEntrada: number; tokensSalida: number; tokensEmbeddings: number; latenciaMs: number; citas: number },
): void {
  const a = acumulador(callId);
  a.consultasRag += 1;
  a.invocacionesModelo += 1; // el razonador
  a.tokensEntradaRazonador += datos.tokensEntrada;
  a.tokensSalidaRazonador += datos.tokensSalida;
  a.tokensEmbeddings += datos.tokensEmbeddings;
  anexar('consulta_rag', { callId, ...datos });
}

export function percentil(valores: number[], p: number): number | null {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  // Interpolación lineal — con 5-15 turnos por llamada el método del índice
  // más cercano distorsiona demasiado el P95.
  const pos = (orden.length - 1) * p;
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  if (bajo === alto) return Math.round(orden[bajo]);
  return Math.round(orden[bajo] + (orden[alto] - orden[bajo]) * (pos - bajo));
}

/** Costo estimado por llamada a precios públicos de la API (USD). */
export function costoUsd(a: AcumuladorLlamada): number {
  const p = CONFIG.precios;
  const M = 1_000_000;
  const total =
    (a.tokensEntradaLive / M) * p.liveAudioEntrada +
    (a.tokensSalidaLive / M) * p.liveAudioSalida +
    (a.tokensEntradaRazonador / M) * p.razonadorEntrada +
    (a.tokensSalidaRazonador / M) * p.razonadorSalida +
    (a.tokensEmbeddings / M) * p.embeddings;
  return Number(total.toFixed(6));
}

export function resumirLlamada(callId: string): MetricasLlamada {
  const a = acumulador(callId);
  return {
    turnos: a.turnos,
    latenciaP50Ms: percentil(a.latencias, 0.5),
    latenciaP95Ms: percentil(a.latencias, 0.95),
    tokensEntrada: a.tokensEntradaLive + a.tokensEntradaRazonador,
    tokensSalida: a.tokensSalidaLive + a.tokensSalidaRazonador,
    invocacionesModelo: a.invocacionesModelo,
    consultasRag: a.consultasRag,
    costoUsd: costoUsd(a),
  };
}

/** Agregado histórico sobre todas las llamadas registradas, para el README. */
export function agregadoGlobal() {
  const todas = [...acumuladores.values()];
  const latencias = todas.flatMap((a) => a.latencias);
  const costos = todas.map(costoUsd);

  return {
    llamadas: todas.length,
    turnos: latencias.length,
    latenciaP50Ms: percentil(latencias, 0.5),
    latenciaP95Ms: percentil(latencias, 0.95),
    consultasRagPorLlamada: media(todas.map((a) => a.consultasRag)),
    invocacionesPorTurno: latencias.length
      ? Number((todas.reduce((n, a) => n + a.invocacionesModelo, 0) / latencias.length).toFixed(2))
      : null,
    tokensEntradaPorLlamada: media(todas.map((a) => a.tokensEntradaLive + a.tokensEntradaRazonador)),
    tokensSalidaPorLlamada: media(todas.map((a) => a.tokensSalidaLive + a.tokensSalidaRazonador)),
    costoMedioUsd: costos.length
      ? Number((costos.reduce((n, c) => n + c, 0) / costos.length).toFixed(6))
      : null,
    modelos: {
      voz: CONFIG.liveModel,
      razonador: CONFIG.reasonerModel,
      embeddings: CONFIG.embeddingModel,
    },
  };
}

function media(valores: number[]): number | null {
  if (!valores.length) return null;
  return Number((valores.reduce((a, b) => a + b, 0) / valores.length).toFixed(2));
}

function anexar(tipo: string, datos: Record<string, unknown>): void {
  try {
    fs.mkdirSync(CONFIG.paths.logs, { recursive: true });
    fs.appendFileSync(
      path.join(CONFIG.paths.logs, 'metricas.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), tipo, ...datos }) + '\n',
    );
  } catch (e) {
    console.warn('[metricas] no se pudo escribir el log:', e);
  }
}
