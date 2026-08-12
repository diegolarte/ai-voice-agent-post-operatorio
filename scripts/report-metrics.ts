/**
 * Calcula las métricas obligatorias (§5 de la rúbrica) leyendo los logs reales.
 *
 *   npm run metricas
 *
 * Se hace así a propósito: los números del README no se escriben a mano, se
 * derivan de `logs/metricas.jsonl` y `logs/llamadas/*.json`. La rúbrica
 * contrasta lo reportado contra los logs de la sesión, y "reportar números que
 * no se sostienen es peor que no reportarlos".
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../server/config.ts';
import { percentil } from '../server/metrics/recorder.ts';
import type { ResumenLlamada } from '../shared/types.ts';

function leerJsonl(archivo: string): any[] {
  if (!fs.existsSync(archivo)) return [];
  return fs
    .readFileSync(archivo, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

function main() {
  const eventos = leerJsonl(path.join(CONFIG.paths.logs, 'metricas.jsonl'));
  const latencias = eventos.filter((e) => e.tipo === 'latencia').map((e) => e.latenciaMs as number);
  const consultas = eventos.filter((e) => e.tipo === 'consulta_rag');

  const llamadas: ResumenLlamada[] = fs.existsSync(CONFIG.paths.calls)
    ? fs
        .readdirSync(CONFIG.paths.calls)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(CONFIG.paths.calls, f), 'utf8')))
    : [];

  if (!latencias.length && !llamadas.length) {
    console.log('\nNo hay datos todavía. Haz al menos una llamada completa y vuelve a ejecutar.\n');
    return;
  }

  const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const turnos = llamadas.reduce((n, l) => n + l.metricas.turnos, 0) || latencias.length;

  const tokensIn = llamadas.reduce((n, l) => n + l.metricas.tokensEntrada, 0);
  const tokensOut = llamadas.reduce((n, l) => n + l.metricas.tokensSalida, 0);
  const costos = llamadas.map((l) => l.metricas.costoUsd);
  const ragPorLlamada = llamadas.map((l) => l.metricas.consultasRag);
  const invocaciones = llamadas.reduce((n, l) => n + l.metricas.invocacionesModelo, 0);

  const fila = (k: string, v: string) => console.log(`| ${k.padEnd(42)} | ${v.padStart(14)} |`);

  console.log(`\n### Métricas medidas — ${llamadas.length} llamada(s), ${turnos} turno(s)\n`);
  console.log(`| ${'Métrica'.padEnd(42)} | ${'Valor'.padStart(14)} |`);
  console.log(`|${'-'.repeat(44)}|${'-'.repeat(16)}|`);
  fila('Latencia P50 (fin de habla → primer audio)', `${percentil(latencias, 0.5) ?? '—'} ms`);
  fila('Latencia P95', `${percentil(latencias, 0.95) ?? '—'} ms`);
  fila('Latencia mínima / máxima', `${Math.min(...latencias)} / ${Math.max(...latencias)} ms`);
  fila('Turnos medidos', String(latencias.length));
  console.log(`|${'-'.repeat(44)}|${'-'.repeat(16)}|`);
  fila('Tokens de entrada por turno', turnos ? (tokensIn / turnos).toFixed(0) : '—');
  fila('Tokens de salida por turno', turnos ? (tokensOut / turnos).toFixed(0) : '—');
  fila('Tokens de entrada por llamada', llamadas.length ? (tokensIn / llamadas.length).toFixed(0) : '—');
  fila('Tokens de salida por llamada', llamadas.length ? (tokensOut / llamadas.length).toFixed(0) : '—');
  fila('Invocaciones al modelo por turno', turnos ? (invocaciones / turnos).toFixed(2) : '—');
  fila('Consultas al RAG por llamada', media(ragPorLlamada).toFixed(2));
  console.log(`|${'-'.repeat(44)}|${'-'.repeat(16)}|`);
  fila('Costo medio por llamada (USD)', `$${media(costos).toFixed(4)}`);
  fila('Costo máximo observado (USD)', `$${(costos.length ? Math.max(...costos) : 0).toFixed(4)}`);

  if (consultas.length) {
    const latRag = consultas.map((c) => c.latenciaMs as number);
    console.log(`\n### Desglose de la consulta clínica (${consultas.length} consultas)\n`);
    console.log(`  Latencia interna P50 : ${percentil(latRag, 0.5)} ms`);
    console.log(`  Latencia interna P95 : ${percentil(latRag, 0.95)} ms`);
    console.log(`  Citas devueltas (media): ${media(consultas.map((c) => c.citas)).toFixed(2)}`);
  }

  const porNivel = llamadas.reduce<Record<string, number>>((acc, l) => {
    acc[l.nivelFinal] = (acc[l.nivelFinal] ?? 0) + 1;
    return acc;
  }, {});
  if (Object.keys(porNivel).length) {
    console.log(`\n### Desenlace de las llamadas\n`);
    for (const [nivel, n] of Object.entries(porNivel)) console.log(`  ${nivel.padEnd(9)} ${n}`);
  }

  console.log(`\nModelos — voz: ${CONFIG.liveModel} · razonador: ${CONFIG.reasonerModel} · embeddings: ${CONFIG.embeddingModel}`);
  console.log(`Fuente: logs/metricas.jsonl (${eventos.length} eventos) y logs/llamadas/ (${llamadas.length} actas)\n`);
}

main();
