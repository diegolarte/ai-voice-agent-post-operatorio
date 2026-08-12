import type { PaginaPdf } from './pdf.ts';

const OBJETIVO = 1100; // caracteres por fragmento
const SOLAPE = 180; // continuidad entre fragmentos contiguos
const MINIMO = 220; // por debajo de esto el fragmento no aporta contexto citable

export interface FragmentoCrudo {
  pagina: number;
  texto: string;
}

/**
 * Trocea respetando fronteras naturales: primero párrafos, y sólo si un párrafo
 * excede el objetivo se parte por oraciones. Cada fragmento recuerda su página
 * para que la cita pueda verificarse contra la fuente real, que es exactamente
 * lo que el jurado comprueba.
 */
export function trocear(paginas: PaginaPdf[]): FragmentoCrudo[] {
  const fragmentos: FragmentoCrudo[] = [];

  for (const { pagina, texto } of paginas) {
    const parrafos = texto
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, ' ').trim())
      .filter(Boolean);

    let buffer = '';
    const emitir = () => {
      const limpio = buffer.trim();
      if (limpio.length >= MINIMO) fragmentos.push({ pagina, texto: limpio });
      buffer = '';
    };

    for (const parrafo of parrafos) {
      for (const pieza of parrafo.length > OBJETIVO ? porOraciones(parrafo) : [parrafo]) {
        if (buffer.length + pieza.length + 1 > OBJETIVO && buffer.length > 0) {
          const previo = buffer;
          emitir();
          buffer = cola(previo, SOLAPE);
        }
        buffer += (buffer ? ' ' : '') + pieza;
      }
    }
    emitir();
  }

  // Rescata páginas cortas (instructivos, tablas de alarma) que caerían bajo el
  // mínimo: en un corpus clínico suelen ser justo las de mayor valor.
  if (fragmentos.length === 0) {
    for (const { pagina, texto } of paginas) {
      const limpio = texto.replace(/\s+/g, ' ').trim();
      if (limpio.length >= 80) fragmentos.push({ pagina, texto: limpio });
    }
  }

  return fragmentos;
}

function porOraciones(parrafo: string): string[] {
  const oraciones = parrafo.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [parrafo];
  const piezas: string[] = [];
  let actual = '';

  for (const oracion of oraciones) {
    if (actual.length + oracion.length > OBJETIVO && actual) {
      piezas.push(actual.trim());
      actual = '';
    }
    // Una sola oración monstruosa (tablas mal extraídas): corte duro.
    if (oracion.length > OBJETIVO) {
      for (let i = 0; i < oracion.length; i += OBJETIVO) {
        piezas.push(oracion.slice(i, i + OBJETIVO).trim());
      }
      continue;
    }
    actual += oracion;
  }
  if (actual.trim()) piezas.push(actual.trim());
  return piezas.filter(Boolean);
}

/** Últimos `n` caracteres cortados en frontera de palabra, para el solape. */
function cola(texto: string, n: number): string {
  if (texto.length <= n) return texto;
  const recorte = texto.slice(-n);
  const espacio = recorte.indexOf(' ');
  return espacio === -1 ? recorte : recorte.slice(espacio + 1);
}
