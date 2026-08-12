/**
 * Convierte los cuatro .xlsx del reto en `data/pacientes.json`.
 *
 *   npm run dataset -- [ruta/a/dataset]
 *
 * El join sigue lo documentado en el README del reto: `paciente_id` une los
 * cuatro archivos. El resultado se versiona para que el jurado no dependa de
 * tener el dataset a mano al levantar la solución.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { CONFIG, ensureDirs } from '../server/config.ts';
import type { PacienteDemo } from '../shared/types.ts';

const DATASET =
  process.argv[2] ??
  process.env.DATASET_DIR ??
  path.resolve(process.cwd(), '..', 'kit', 'dataset');

function leer(archivo: string): Record<string, any>[] {
  const ruta = path.join(DATASET, archivo);
  if (!fs.existsSync(ruta)) throw new Error(`No existe ${ruta}`);
  // `readFile` no está disponible en el build ESM de SheetJS (no enlaza `fs`).
  const wb = XLSX.read(fs.readFileSync(ruta));
  // Los cuatro archivos tienen una sola hoja llamada `result`.
  return XLSX.utils.sheet_to_json(wb.Sheets['result'] ?? wb.Sheets[wb.SheetNames[0]]);
}

function parsearLista(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.map(String);
  if (typeof valor !== 'string' || !valor.trim()) return [];
  try {
    const p = JSON.parse(valor);
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

function main() {
  ensureDirs();

  const clinicos = leer('perfiles_clinicos_pacientes_silver_contest.xlsx');
  const demograficos = leer('perfiles_pacientes_co.xlsx');
  const demoPorId = new Map(demograficos.map((d) => [String(d.paciente_id), d]));

  const pacientes: PacienteDemo[] = clinicos.map((c) => {
    const d = demoPorId.get(String(c.paciente_id)) ?? {};
    return {
      paciente_id: String(c.paciente_id),
      nombre_completo: String(d.nombre_completo ?? 'Paciente sin nombre'),
      edad: Number(c.edad) || 0,
      genero: String(c.genero ?? ''),
      procedimiento: String(c.procedimiento ?? ''),
      fecha_cirugia: String(c.fecha_cirugia ?? '').slice(0, 10),
      comorbilidades: parsearLista(c.comorbilidades),
      ciudad: String(d.ciudad ?? ''),
      departamento: String(d.departamento ?? ''),
      documento_cc: String(d.documento_cc ?? ''),
      eps: String(d.eps ?? ''),
      // El día postoperatorio lo elige quien opera la demo; 3 es el valor por
      // defecto porque es el día donde el dataset concentra más casos no verdes.
      dia_postop: 3,
    };
  });

  pacientes.sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo, 'es'));
  fs.writeFileSync(CONFIG.paths.patients, JSON.stringify(pacientes, null, 2));

  const porProcedimiento = pacientes.reduce<Record<string, number>>((acc, p) => {
    acc[p.procedimiento] = (acc[p.procedimiento] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`\n${pacientes.length} pacientes → ${CONFIG.paths.patients}`);
  for (const [proc, n] of Object.entries(porProcedimiento).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${proc}`);
  }
  console.log();
}

try {
  main();
} catch (e) {
  console.error('\n✗ No se pudo construir el dataset:', e instanceof Error ? e.message : e);
  console.error('  Pasa la ruta: npm run dataset -- ../ParticipantArtifacts/dataset\n');
  process.exit(1);
}
