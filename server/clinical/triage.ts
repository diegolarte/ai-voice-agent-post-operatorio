import type { NivelTriaje, SlotsSintomas, Triaje } from '../../shared/types.ts';
import { evaluarBanderas, nivelPorReglas, ordenTriaje } from './redflags.ts';
import { slotsFaltantes } from './slots.ts';

/**
 * Fusiona las dos opiniones de criticidad: el motor determinista de reglas y el
 * razonador clínico fundamentado en el corpus.
 *
 * La regla de fusión es `max`, no un promedio ni una votación, y esa asimetría
 * es deliberada: la rúbrica establece que el falso negativo es la falla
 * catastrófica. Basta con que UNA de las dos vías detecte riesgo para que la
 * llamada escale. Se paga con algún falso positivo —una enfermera revisa un
 * caso que resultó benigno— y ese es el error barato.
 */
export function fusionar(params: {
  slots: SlotsSintomas;
  nivelModelo: NivelTriaje;
  justificacionModelo: string;
}): Triaje {
  const { slots, nivelModelo, justificacionModelo } = params;

  const banderas = evaluarBanderas(slots);
  const nivelReglas = nivelPorReglas(banderas);
  const nivel = ordenTriaje[nivelReglas] >= ordenTriaje[nivelModelo] ? nivelReglas : nivelModelo;

  const faltantes = slotsFaltantes(slots);

  const partes: string[] = [];
  if (banderas.length) {
    partes.push(`Reglas: ${banderas.map((b) => b.motivo).join(' ')}`);
  } else {
    partes.push('Reglas: ningún signo de alarma disparado.');
  }
  if (justificacionModelo) partes.push(`Razonador: ${justificacionModelo}`);
  if (nivelReglas !== nivelModelo) {
    partes.push(
      `Discrepancia (reglas=${nivelReglas}, razonador=${nivelModelo}) resuelta al máximo por asimetría clínica.`,
    );
  }

  return {
    nivel,
    nivelReglas,
    nivelModelo,
    fusion: 'max_asimetrico',
    banderas,
    justificacion: partes.join(' '),
    slotsFaltantes: faltantes,
    // Un "verde" con casillas núcleo sin llenar no es un verde: es una decisión
    // tomada sin información. El agente debe seguir preguntando antes de cerrar.
    requiereIndagar: faltantes.length > 0 && nivel !== 'rojo',
  };
}

/** Qué se le dice al paciente sobre el siguiente paso, según el nivel. */
export function proximosPasos(nivel: NivelTriaje): string[] {
  switch (nivel) {
    case 'rojo':
      return [
        'Se notifica de inmediato al personal de enfermería con el detalle de la llamada.',
        'El paciente debe acudir hoy al servicio de urgencias o esperar el contacto del equipo clínico.',
        'No esperar al siguiente control programado.',
      ];
    case 'amarillo':
      return [
        'Queda registrado para revisión del equipo clínico en las próximas horas.',
        'El paciente debe vigilar la evolución y reconsultar si el síntoma empeora.',
        'Se mantiene el control programado.',
      ];
    default:
      return [
        'Evolución dentro de lo esperado; no se requiere escalamiento.',
        'Continuar las indicaciones de egreso.',
        'Se mantiene el control programado.',
      ];
  }
}

export function decisionLegible(t: Triaje): string {
  const etiqueta =
    t.nivel === 'rojo'
      ? 'ESCALAR — atención hoy'
      : t.nivel === 'amarillo'
        ? 'VIGILAR — revisión del equipo clínico'
        : 'SIN ESCALAMIENTO — evolución esperada';
  return t.requiereIndagar ? `${etiqueta} (con casillas pendientes por indagar)` : etiqueta;
}
