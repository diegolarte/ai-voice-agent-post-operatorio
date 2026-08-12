import type { BanderaRoja, NivelTriaje, SlotsSintomas } from '../../shared/types.ts';

interface Regla {
  id: string;
  nivel: NivelTriaje;
  slot: keyof SlotsSintomas;
  motivo: string;
  /** Síndrome que se busca descartar; se muestra en la alerta al personal. */
  sospecha: string;
  cuando: (s: SlotsSintomas) => boolean;
}

/**
 * Motor determinista de signos de alarma postoperatorios.
 *
 * Por qué existe además del razonador con RAG: la rúbrica declara que el falso
 * negativo —no alertar cuando había que alertar— es la falla catastrófica. Un
 * modelo generativo no ofrece garantía de recall; una regla explícita sí. Estas
 * reglas se disparan aunque el modelo se equivoque, aunque el paciente minimice
 * sus síntomas, y aunque alguien intente inyectar instrucciones en la
 * conversación para que el agente "diga que todo está bien".
 *
 * Los umbrales provienen de los criterios de alarma recurrentes en el corpus
 * (`dataset/textos/`): guías de apendicectomía, colecistectomía, cirugía
 * colorrectal, oncológica y reemplazo articular. Son deliberadamente
 * conservadores: ante la duda, escalar.
 */
const REGLAS: Regla[] = [
  // --- Infección / sepsis -------------------------------------------------
  {
    id: 'fiebre_alta',
    nivel: 'rojo',
    slot: 'fiebre_c',
    sospecha: 'Infección de sitio operatorio o colección intraabdominal',
    motivo: 'Temperatura ≥ 38.5 °C en el postoperatorio.',
    cuando: (s) => s.fiebre_c !== undefined && s.fiebre_c >= 38.5,
  },
  {
    id: 'febricula',
    nivel: 'amarillo',
    slot: 'fiebre_c',
    sospecha: 'Proceso infeccioso incipiente',
    motivo: 'Temperatura entre 38.0 y 38.4 °C.',
    cuando: (s) => s.fiebre_c !== undefined && s.fiebre_c >= 38.0 && s.fiebre_c < 38.5,
  },
  {
    id: 'escalofrios_sin_termometro',
    nivel: 'amarillo',
    slot: 'fiebre_referida',
    sospecha: 'Fiebre no cuantificada',
    motivo: 'Refiere escalofríos y no dispone de termómetro para cuantificar.',
    cuando: (s) => s.fiebre_referida === 'escalofrios' && s.fiebre_c === undefined,
  },
  {
    id: 'herida_purulenta',
    nivel: 'rojo',
    slot: 'herida',
    sospecha: 'Infección de sitio operatorio establecida',
    motivo: 'Secreción purulenta en la herida quirúrgica.',
    cuando: (s) => s.herida === 'secrecion_purulenta',
  },
  {
    id: 'dehiscencia',
    nivel: 'rojo',
    slot: 'herida',
    sospecha: 'Dehiscencia de herida quirúrgica',
    motivo: 'La herida se abrió: requiere valoración quirúrgica.',
    cuando: (s) => s.herida === 'dehiscencia',
  },
  {
    id: 'herida_secrecion',
    nivel: 'amarillo',
    slot: 'herida',
    sospecha: 'Infección superficial en evolución',
    motivo: 'Secreción no purulenta en la herida.',
    cuando: (s) => s.herida === 'secrecion',
  },
  {
    id: 'eritema_con_fiebre',
    nivel: 'rojo',
    slot: 'herida',
    sospecha: 'Celulitis de sitio operatorio',
    motivo: 'Enrojecimiento de la herida acompañado de fiebre.',
    cuando: (s) =>
      s.herida === 'eritema_leve' &&
      ((s.fiebre_c !== undefined && s.fiebre_c >= 38.0) || s.fiebre_referida === 'escalofrios'),
  },
  {
    id: 'eritema_leve',
    nivel: 'amarillo',
    slot: 'herida',
    sospecha: 'Inflamación local',
    motivo: 'Enrojecimiento leve de la herida sin otros signos sistémicos.',
    cuando: (s) => s.herida === 'eritema_leve',
  },

  // --- Dolor ---------------------------------------------------------------
  {
    id: 'dolor_severo',
    nivel: 'rojo',
    slot: 'dolor_nrs',
    sospecha: 'Complicación intraabdominal o dolor no controlado',
    motivo: 'Dolor 8/10 o mayor pese al manejo analgésico indicado.',
    cuando: (s) => s.dolor_nrs !== undefined && s.dolor_nrs >= 8,
  },
  {
    id: 'dolor_moderado',
    nivel: 'amarillo',
    slot: 'dolor_nrs',
    sospecha: 'Analgesia insuficiente',
    motivo: 'Dolor entre 5 y 7 sobre 10.',
    cuando: (s) => s.dolor_nrs !== undefined && s.dolor_nrs >= 5 && s.dolor_nrs < 8,
  },

  // --- Abdomen: obstrucción / íleo / fuga anastomótica ---------------------
  {
    id: 'obstruccion',
    nivel: 'rojo',
    slot: 'transito_intestinal',
    sospecha: 'Obstrucción intestinal o íleo postoperatorio',
    motivo: 'Ausencia de gases y deposición junto con vómito.',
    cuando: (s) =>
      s.transito_intestinal === 'sin_gases_ni_heces' &&
      (s.nauseas_vomito === 'vomito' || s.nauseas_vomito === 'vomito_persistente'),
  },
  {
    id: 'vomito_persistente',
    nivel: 'rojo',
    slot: 'nauseas_vomito',
    sospecha: 'Intolerancia a la vía oral / deshidratación',
    motivo: 'Vómito persistente que impide hidratarse.',
    cuando: (s) => s.nauseas_vomito === 'vomito_persistente',
  },
  {
    id: 'sin_transito',
    nivel: 'amarillo',
    slot: 'transito_intestinal',
    sospecha: 'Íleo en resolución',
    motivo: 'No ha expulsado gases ni ha tenido deposición.',
    cuando: (s) => s.transito_intestinal === 'sin_gases_ni_heces',
  },
  {
    id: 'vomito',
    nivel: 'amarillo',
    slot: 'nauseas_vomito',
    sospecha: 'Intolerancia parcial a la vía oral',
    motivo: 'Episodios de vómito.',
    cuando: (s) => s.nauseas_vomito === 'vomito',
  },

  // --- Tromboembolismo -----------------------------------------------------
  {
    id: 'tep',
    nivel: 'rojo',
    slot: 'respiracion',
    sospecha: 'Tromboembolismo pulmonar',
    motivo: 'Dificultad respiratoria marcada o dolor torácico.',
    cuando: (s) => s.respiracion === 'disnea_marcada' || s.respiracion === 'dolor_toracico',
  },
  {
    id: 'tvp',
    nivel: 'rojo',
    slot: 'pierna',
    sospecha: 'Trombosis venosa profunda',
    motivo: 'Edema unilateral de miembro inferior.',
    cuando: (s) => s.pierna === 'edema_unilateral',
  },
  {
    id: 'dolor_pantorrilla',
    nivel: 'amarillo',
    slot: 'pierna',
    sospecha: 'Trombosis venosa profunda incipiente',
    motivo: 'Dolor en pantorrilla sin edema evidente.',
    cuando: (s) => s.pierna === 'dolor_pantorrilla',
  },
  {
    id: 'disnea_leve',
    nivel: 'amarillo',
    slot: 'respiracion',
    sospecha: 'Atelectasia o complicación respiratoria',
    motivo: 'Sensación leve de falta de aire.',
    cuando: (s) => s.respiracion === 'disnea_leve',
  },

  // --- Sangrado y estado general ------------------------------------------
  {
    id: 'sangrado_activo',
    nivel: 'rojo',
    slot: 'sangrado',
    sospecha: 'Hemorragia postoperatoria',
    motivo: 'Sangrado activo por la herida.',
    cuando: (s) => s.sangrado === 'activo',
  },
  {
    id: 'sangrado_leve',
    nivel: 'amarillo',
    slot: 'sangrado',
    sospecha: 'Sangrado en supervisión',
    motivo: 'Sangrado escaso por la herida.',
    cuando: (s) => s.sangrado === 'leve',
  },
  {
    id: 'alteracion_conciencia',
    nivel: 'rojo',
    slot: 'estado_mental',
    sospecha: 'Sepsis, hipoxia o efecto adverso de opioides',
    motivo: 'Confusión o somnolencia marcada durante la llamada.',
    cuando: (s) => s.estado_mental === 'confusion' || s.estado_mental === 'somnolencia_marcada',
  },
  {
    id: 'movilidad_incapacitante',
    nivel: 'amarillo',
    slot: 'movilidad',
    sospecha: 'Deterioro funcional nuevo',
    motivo: 'Pérdida de movilidad que no corresponde a la evolución esperada.',
    cuando: (s) => s.movilidad === 'incapacitante_nueva' || s.movilidad === 'nula',
  },
  {
    id: 'sin_ingesta',
    nivel: 'amarillo',
    slot: 'apetito',
    sospecha: 'Riesgo de deshidratación',
    motivo: 'Ingesta muy reducida o nula.',
    cuando: (s) => s.apetito === 'muy_disminuido' || s.apetito === 'nulo',
  },
];

const ORDEN: Record<NivelTriaje, number> = { verde: 0, amarillo: 1, rojo: 2 };

export function evaluarBanderas(slots: SlotsSintomas): BanderaRoja[] {
  return REGLAS.filter((r) => {
    try {
      return r.cuando(slots);
    } catch {
      return false;
    }
  })
    .map((r) => ({
      regla: r.id,
      nivel: r.nivel,
      motivo: `${r.motivo} Sospecha: ${r.sospecha}.`,
      slot: r.slot,
      valor: slots[r.slot],
    }))
    .sort((a, b) => ORDEN[b.nivel] - ORDEN[a.nivel]);
}

export function nivelPorReglas(banderas: BanderaRoja[]): NivelTriaje {
  return banderas.reduce<NivelTriaje>(
    (peor, b) => (ORDEN[b.nivel] > ORDEN[peor] ? b.nivel : peor),
    'verde',
  );
}

export const totalReglas = REGLAS.length;
export { ORDEN as ordenTriaje };
