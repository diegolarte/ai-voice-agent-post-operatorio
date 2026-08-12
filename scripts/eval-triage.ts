/**
 * Evalúa el motor determinista de banderas rojas contra el ground truth del
 * reto.
 *
 *   npm run eval -- [ruta/a/dataset]
 *
 * No consume API: cruza `trayectorias_postop_silver.xlsx` (el cuadro clínico
 * real de cada caso) con `label_ground_truth` de `dataset_final.xlsx`, alimenta
 * las reglas con ese cuadro y compara. Sirve para dos cosas:
 *
 *  1. Poner un número verificable sobre la afirmación "no perdemos rojos".
 *  2. Aislar el desempeño de las reglas del desempeño del modelo. Si la llamada
 *     completa falla, este script dice si la culpa fue del triaje o del sondeo
 *     conversacional que no llenó las casillas.
 *
 * El join es el documentado en el reto: caso_id = "caso_" + trayectoria_id.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { evaluarBanderas, nivelPorReglas, ordenTriaje } from '../server/clinical/redflags.ts';
import type { NivelTriaje, SlotsSintomas } from '../shared/types.ts';

const DATASET =
  process.argv[2] ?? process.env.DATASET_DIR ?? path.resolve(process.cwd(), '..', 'kit', 'dataset');

const NIVELES: NivelTriaje[] = ['verde', 'amarillo', 'rojo'];

function leer(archivo: string): Record<string, any>[] {
  const wb = XLSX.read(fs.readFileSync(path.join(DATASET, archivo)));
  return XLSX.utils.sheet_to_json(wb.Sheets['result'] ?? wb.Sheets[wb.SheetNames[0]]);
}

/** El cuadro clínico de la trayectoria, tal cual, como si el sondeo fuera perfecto. */
function slotsDeTrayectoria(t: Record<string, any>): SlotsSintomas {
  const s: SlotsSintomas = {};
  if (t.dolor_nrs !== undefined && t.dolor_nrs !== null) s.dolor_nrs = Number(t.dolor_nrs);
  if (t.fiebre_c !== undefined && t.fiebre_c !== null) s.fiebre_c = Number(t.fiebre_c);
  if (t.herida) s.herida = String(t.herida) as SlotsSintomas['herida'];
  if (t.movilidad) s.movilidad = String(t.movilidad) as SlotsSintomas['movilidad'];
  if (t.apetito) s.apetito = String(t.apetito) as SlotsSintomas['apetito'];
  if (t.sueno) s.sueno = String(t.sueno) as SlotsSintomas['sueno'];
  return s;
}

function main() {
  const trayectorias = leer('trayectorias_postop_silver.xlsx');
  const conversaciones = leer('dataset_final.xlsx');

  const etiquetas = new Map<string, NivelTriaje>();
  for (const fila of conversaciones) {
    if (fila.caso_id && fila.label_ground_truth) {
      etiquetas.set(String(fila.caso_id), String(fila.label_ground_truth) as NivelTriaje);
    }
  }

  const matriz: Record<string, Record<string, number>> = {};
  for (const r of NIVELES) matriz[r] = { verde: 0, amarillo: 0, rojo: 0 };

  const fallos: { caso: string; real: NivelTriaje; predicho: NivelTriaje; slots: SlotsSintomas }[] = [];
  let evaluados = 0;

  for (const t of trayectorias) {
    const casoId = `caso_${t.trayectoria_id}`;
    const real = etiquetas.get(casoId);
    if (!real) continue;

    const slots = slotsDeTrayectoria(t);
    const predicho = nivelPorReglas(evaluarBanderas(slots));

    matriz[real][predicho] += 1;
    evaluados += 1;

    // Falso negativo = se predijo MENOS grave de lo que era. Es el error caro.
    if (ordenTriaje[predicho] < ordenTriaje[real]) {
      fallos.push({ caso: casoId, real, predicho, slots });
    }
  }

  console.log(`\nEvaluación del motor determinista de banderas rojas`);
  console.log(`Casos evaluados: ${evaluados}\n`);

  console.log('Matriz de confusión (fila = real, columna = predicho)');
  console.log('              verde  amarillo    rojo');
  for (const real of NIVELES) {
    const f = matriz[real];
    console.log(
      `  ${real.padEnd(10)} ${String(f.verde).padStart(5)} ${String(f.amarillo).padStart(9)} ${String(f.rojo).padStart(7)}`,
    );
  }

  console.log('\nPor clase:');
  for (const nivel of NIVELES) {
    const tp = matriz[nivel][nivel];
    const total = NIVELES.reduce((n, r) => n + matriz[nivel][r], 0);
    const predichos = NIVELES.reduce((n, r) => n + matriz[r][nivel], 0);
    const recall = total ? tp / total : 0;
    const precision = predichos ? tp / predichos : 0;
    console.log(
      `  ${nivel.padEnd(9)} recall ${(recall * 100).toFixed(1).padStart(5)}%  ` +
        `precisión ${(precision * 100).toFixed(1).padStart(5)}%  (n=${total})`,
    );
  }

  // La métrica que importa: de los casos que había que escalar, ¿cuántos se escalaron?
  const debianEscalar = NIVELES.filter((n) => n !== 'verde').reduce(
    (n, real) => n + NIVELES.reduce((m, p) => m + matriz[real][p], 0),
    0,
  );
  const escalados = NIVELES.filter((n) => n !== 'verde').reduce(
    (n, real) => n + matriz[real].amarillo + matriz[real].rojo,
    0,
  );
  const rojosDetectados = matriz.rojo.rojo;
  const rojosTotales = NIVELES.reduce((n, p) => n + matriz.rojo[p], 0);
  const verdesEscalados = matriz.verde.amarillo + matriz.verde.rojo;
  const verdesTotales = NIVELES.reduce((n, p) => n + matriz.verde[p], 0);

  console.log('\nAsimetría clínica:');
  console.log(
    `  Rojos capturados como rojo      : ${rojosDetectados}/${rojosTotales} ` +
      `(${((rojosDetectados / (rojosTotales || 1)) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  No-verdes que sí escalaron      : ${escalados}/${debianEscalar} ` +
      `(${((escalados / (debianEscalar || 1)) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  Verdes escalados de más (coste) : ${verdesEscalados}/${verdesTotales} ` +
      `(${((verdesEscalados / (verdesTotales || 1)) * 100).toFixed(1)}%)`,
  );

  console.log(`\nFalsos negativos (predicho MENOS grave que el real): ${fallos.length}`);
  for (const f of fallos.slice(0, 15)) {
    console.log(`  ${f.caso}  real=${f.real} predicho=${f.predicho}  ${JSON.stringify(f.slots)}`);
  }
  if (fallos.length > 15) console.log(`  … y ${fallos.length - 15} más`);

  const salida = path.resolve(process.cwd(), 'logs', 'eval-triaje.json');
  fs.mkdirSync(path.dirname(salida), { recursive: true });
  fs.writeFileSync(
    salida,
    JSON.stringify(
      { fecha: new Date().toISOString(), evaluados, matriz, falsosNegativos: fallos },
      null,
      2,
    ),
  );
  console.log(`\nDetalle completo → ${salida}\n`);
}

try {
  main();
} catch (e) {
  console.error('\n✗ Evaluación fallida:', e instanceof Error ? e.message : e);
  console.error('  Pasa la ruta: npm run eval -- ../ParticipantArtifacts/dataset\n');
  process.exit(1);
}
