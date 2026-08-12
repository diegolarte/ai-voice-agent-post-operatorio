import type { SlotsSintomas } from './types.ts';

export type ClaveSlot = keyof SlotsSintomas;

export interface DefinicionSlot {
  clave: ClaveSlot;
  etiqueta: string;
  /** Pregunta sugerida, en español colombiano y sin jerga clínica. */
  pregunta: string;
  /** Sin esta casilla no se puede cerrar la llamada con seguridad. */
  nucleo: boolean;
  valores?: string[];
}

/**
 * El catálogo de casillas que el agente llena conversando.
 *
 * Vive en `shared/` porque lo consumen los dos lados: el backend para decidir
 * qué falta y el navegador para declarar el esquema de la herramienta y pintar
 * el panel. Una sola definición evita que el modelo pueda enviar una casilla
 * que el servidor no sabe interpretar.
 *
 * Las nueve primeras replican las columnas de `trayectorias_postop_silver.xlsx`
 * —el cuadro clínico que el dataset considera "la verdad" de cada llamada— y el
 * resto cubre los síndromes de alarma que el corpus obliga a descartar y que la
 * trayectoria no modela (tromboembolismo, obstrucción, sangrado).
 */
export const CATALOGO_SLOTS: DefinicionSlot[] = [
  {
    clave: 'dolor_nrs',
    etiqueta: 'Dolor (0–10)',
    pregunta: '¿Qué tanto le duele ahora, si cero es nada y diez es lo peor que ha sentido?',
    nucleo: true,
  },
  {
    clave: 'fiebre_c',
    etiqueta: 'Temperatura (°C)',
    pregunta: '¿Se ha tomado la temperatura? ¿Cuánto le dio?',
    nucleo: true,
  },
  {
    clave: 'fiebre_referida',
    etiqueta: 'Fiebre referida',
    pregunta: '¿Ha sentido calentura o escalofríos, aunque no se haya tomado la temperatura?',
    nucleo: false,
    valores: ['no', 'sensacion', 'escalofrios'],
  },
  {
    clave: 'herida',
    etiqueta: 'Herida',
    pregunta: '¿Cómo ve la herida? ¿Está roja, hinchada, o le sale algún líquido?',
    nucleo: true,
    valores: ['normal', 'eritema_leve', 'secrecion', 'secrecion_purulenta', 'dehiscencia'],
  },
  {
    clave: 'movilidad',
    etiqueta: 'Movilidad',
    pregunta: '¿Ha podido levantarse y caminar un poco?',
    nucleo: true,
    valores: ['normal', 'limitada_esperada', 'incapacitante_nueva', 'nula'],
  },
  {
    clave: 'apetito',
    etiqueta: 'Apetito',
    pregunta: '¿Ha podido comer y tomar líquidos?',
    nucleo: false,
    valores: ['normal', 'levemente_disminuido', 'muy_disminuido', 'nulo'],
  },
  {
    clave: 'sueno',
    etiqueta: 'Sueño',
    pregunta: '¿Ha podido dormir?',
    nucleo: false,
    valores: ['normal', 'levemente_alterado', 'muy_alterado'],
  },
  {
    clave: 'nauseas_vomito',
    etiqueta: 'Náuseas / vómito',
    pregunta: '¿Ha tenido náuseas o ha vomitado?',
    nucleo: true,
    valores: ['ninguno', 'nauseas', 'vomito', 'vomito_persistente'],
  },
  {
    clave: 'transito_intestinal',
    etiqueta: 'Tránsito intestinal',
    pregunta: '¿Ha podido expulsar gases o ir al baño?',
    nucleo: false,
    valores: ['normal', 'estrenido', 'sin_gases_ni_heces'],
  },
  {
    clave: 'respiracion',
    etiqueta: 'Respiración',
    pregunta: '¿Siente que le falta el aire o le duele el pecho al respirar?',
    nucleo: true,
    valores: ['normal', 'disnea_leve', 'disnea_marcada', 'dolor_toracico'],
  },
  {
    clave: 'sangrado',
    etiqueta: 'Sangrado',
    pregunta: '¿La herida le está sangrando en este momento?',
    nucleo: false,
    valores: ['ninguno', 'leve', 'activo'],
  },
  {
    clave: 'pierna',
    etiqueta: 'Piernas',
    pregunta: '¿Siente dolor o hinchazón en una pantorrilla más que en la otra?',
    nucleo: false,
    valores: ['normal', 'dolor_pantorrilla', 'edema_unilateral'],
  },
  {
    clave: 'estado_mental',
    etiqueta: 'Estado mental',
    pregunta: '(observación del agente durante la conversación)',
    nucleo: false,
    valores: ['normal', 'confusion', 'somnolencia_marcada'],
  },
];

export const SLOTS_NUCLEO = CATALOGO_SLOTS.filter((s) => s.nucleo).map((s) => s.clave);
