import type { SlotsSintomas } from '../../shared/types.ts';
import { CATALOGO_SLOTS, SLOTS_NUCLEO, type ClaveSlot } from '../../shared/slots-catalogo.ts';

export { CATALOGO_SLOTS, SLOTS_NUCLEO };
export type { ClaveSlot, DefinicionSlot } from '../../shared/slots-catalogo.ts';

/** Casillas núcleo aún sin responder. Mientras existan, el agente debe indagar. */
export function slotsFaltantes(slots: SlotsSintomas): ClaveSlot[] {
  return SLOTS_NUCLEO.filter((clave) => {
    if (slots[clave] !== undefined && slots[clave] !== null) return false;
    // La temperatura se da por cubierta si el paciente no tiene termómetro
    // pero sí respondió por sensación térmica.
    if (clave === 'fiebre_c' && slots.fiebre_referida !== undefined) return false;
    return true;
  });
}

/** Traduce las casillas a frases legibles para el resumen y la alerta. */
export function describirSlots(slots: SlotsSintomas): string[] {
  const salida: string[] = [];
  for (const def of CATALOGO_SLOTS) {
    const valor = slots[def.clave];
    if (valor === undefined || valor === null) continue;
    if (def.clave === 'dolor_nrs') salida.push(`Dolor ${valor}/10`);
    else if (def.clave === 'fiebre_c') salida.push(`Temperatura ${valor} °C`);
    else salida.push(`${def.etiqueta}: ${String(valor).replace(/_/g, ' ')}`);
  }
  return salida;
}

/**
 * Descarta claves desconocidas y normaliza tipos antes de tocar el estado.
 * El modelo puede alucinar una casilla o mandar "38,5" con coma; nada de lo que
 * llegue por la herramienta entra al estado clínico sin pasar por aquí.
 */
export function sanearSlots(entrada: unknown): SlotsSintomas {
  const salida: SlotsSintomas = {};
  if (!entrada || typeof entrada !== 'object') return salida;
  const bruto = entrada as Record<string, unknown>;

  for (const def of CATALOGO_SLOTS) {
    const valor = bruto[def.clave];
    if (valor === undefined || valor === null || valor === '') continue;

    if (def.clave === 'dolor_nrs') {
      const n = Number(valor);
      if (Number.isFinite(n)) salida.dolor_nrs = Math.max(0, Math.min(10, Math.round(n)));
    } else if (def.clave === 'fiebre_c') {
      const n = Number(String(valor).replace(',', '.'));
      // Tolera "38" o "38,5"; descarta Fahrenheit y ruido.
      if (Number.isFinite(n) && n >= 33 && n <= 43) salida.fiebre_c = Number(n.toFixed(1));
    } else if (def.valores?.includes(String(valor))) {
      (salida as Record<string, unknown>)[def.clave] = String(valor);
    }
  }
  return salida;
}
