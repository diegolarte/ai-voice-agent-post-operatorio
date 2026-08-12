/**
 * Calibra `RAG_MIN_SCORE` y mide calidad de recuperación contra el corpus real.
 *
 *   npm run eval:retrieval
 *
 * Corre dos grupos de consultas contra el índice ya construido:
 *  - "dentro de corpus": preguntas clínicas reales sobre los escenarios del
 *    reto (deberían recuperar fragmentos relevantes, score alto).
 *  - "fuera de corpus": preguntas ajenas a cualquier guía médica (deberían
 *    quedar por debajo del umbral — es la señal que dispara "no lo sé").
 *
 * BGE-M3 distribuye la similitud coseno más alta en todo el rango que
 * `gemini-embedding-001` (medido: hasta 0.60 para una consulta sobre el
 * precio del bitcoin), así que el umbral 0.55 heredado del embedding anterior
 * ya no sirve para separar señal de ruido. Este script busca, dentro de la
 * brecha real entre ambos grupos, el punto que mejor separa.
 */
import { CONFIG, ensureDirs } from '../server/config.ts';
import { almacen } from '../server/rag/store.ts';
import { embeberConsulta, precargarModelo } from '../server/rag/embeddings.ts';

const DENTRO_DE_CORPUS = [
  { q: '¿cuándo puedo bañarme después de la cirugía?', escenario: 'general' },
  { q: '¿es normal que me duela el hombro después de la laparoscopia?', escenario: 'colecistitis' },
  { q: '¿cuánto dolor es normal tener el día 3 después de la apendicectomía?', escenario: 'apendicitis' },
  { q: '¿qué señales indican que la herida se infectó?', escenario: 'general' },
  { q: '¿cuándo debo volver a caminar después del reemplazo de cadera?', escenario: 'articular' },
  { q: '¿qué efectos secundarios tiene la quimioterapia para cáncer de mama?', escenario: 'oncología' },
  { q: '¿cuándo puedo retomar mi dieta normal después de cirugía colorrectal?', escenario: 'colorrectal' },
  { q: '¿es peligroso tener fiebre baja los primeros días?', escenario: 'general' },
  { q: '¿qué cuidados debo tener con la sonda después de la cirugía?', escenario: 'general' },
  { q: '¿cuánto tiempo debo esperar para manejar después del reemplazo de rodilla?', escenario: 'articular' },
];

const FUERA_DE_CORPUS = [
  '¿cuál es el precio del bitcoin hoy?',
  '¿qué equipo va ganando el mundial?',
  '¿cómo hago una pasta carbonara?',
  '¿cuál es la capital de Australia?',
  '¿qué modelo de carro me recomiendas comprar?',
  '¿cómo configuro mi router wifi?',
  '¿qué películas están en cartelera esta semana?',
  '¿cuánto cuesta un vuelo a Cancún?',
  '¿qué dice el horóscopo de hoy para tauro?',
  '¿cómo se cultiva el café en Colombia?',
];

function estadisticas(valores: number[]) {
  const orden = [...valores].sort((a, b) => a - b);
  const media = valores.reduce((a, b) => a + b, 0) / valores.length;
  return { min: orden[0], max: orden.at(-1)!, media, mediana: orden[Math.floor(orden.length / 2)] };
}

async function main() {
  ensureDirs();
  console.log('Cargando modelo de embeddings y corpus...\n');
  await precargarModelo();
  almacen.cargar();

  const stats = almacen.estadisticas();
  console.log(`Índice: ${stats.documentos} documentos, ${stats.fragmentos} fragmentos, dim ${stats.dim}\n`);
  if (stats.fragmentos === 0) {
    console.error('El índice está vacío. Corre `npm run ingest` primero.');
    process.exit(1);
  }

  console.log('─'.repeat(70));
  console.log('DENTRO DE CORPUS — el score más alto de cada consulta');
  console.log('─'.repeat(70));
  const scoresDentro: number[] = [];
  for (const { q, escenario } of DENTRO_DE_CORPUS) {
    const v = await embeberConsulta(q);
    const [top] = almacen.buscar(v, 1, 0);
    const score = top?.score ?? 0;
    scoresDentro.push(score);
    console.log(`  ${score.toFixed(3)}  [${escenario.padEnd(11)}] ${q}`);
    if (top) console.log(`           → ${top.documento.slice(0, 55)} (p.${top.pagina})`);
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log('FUERA DE CORPUS — el score más alto de cada consulta (debería ser bajo)');
  console.log('─'.repeat(70));
  const scoresFuera: number[] = [];
  for (const q of FUERA_DE_CORPUS) {
    const v = await embeberConsulta(q);
    const [top] = almacen.buscar(v, 1, 0);
    const score = top?.score ?? 0;
    scoresFuera.push(score);
    console.log(`  ${score.toFixed(3)}  ${q}`);
  }

  const eD = estadisticas(scoresDentro);
  const eF = estadisticas(scoresFuera);

  console.log(`\n${'═'.repeat(70)}`);
  console.log('RESUMEN');
  console.log('═'.repeat(70));
  console.log(`  Dentro de corpus  → min ${eD.min.toFixed(3)}  mediana ${eD.mediana.toFixed(3)}  max ${eD.max.toFixed(3)}`);
  console.log(`  Fuera de corpus   → min ${eF.min.toFixed(3)}  mediana ${eF.mediana.toFixed(3)}  max ${eF.max.toFixed(3)}`);

  const solapan = eF.max >= eD.min;
  if (solapan) {
    console.log(
      `\n  ⚠ Los rangos se solapan (fuera.max=${eF.max.toFixed(3)} ≥ dentro.min=${eD.min.toFixed(3)}).`,
    );
    console.log('    No hay un umbral perfecto; revisa los casos límite arriba antes de fijar RAG_MIN_SCORE.');
  }

  // Punto medio entre "el peor caso dentro" y "el peor caso fuera" — el que
  // más separa a ambos grupos con los datos disponibles.
  const sugerido = (eD.min + eF.max) / 2;
  console.log(`\n  → RAG_MIN_SCORE sugerido: ${sugerido.toFixed(3)}`);
  console.log(`    (punto medio entre el mínimo dentro de corpus y el máximo fuera de corpus)\n`);
}

main().catch((e) => {
  console.error('\n✗', e instanceof Error ? e.message : e);
  process.exit(1);
});
