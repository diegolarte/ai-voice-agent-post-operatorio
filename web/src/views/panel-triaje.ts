import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { base, tokens } from '../estilos.ts';
import type { Triaje } from '../../../shared/types.ts';

/**
 * Muestra la decisión y —más importante— CÓMO se tomó: qué dijo el motor de
 * reglas, qué dijo el razonador, y cuál prevaleció. La rúbrica evalúa la
 * lógica de escalamiento, no sólo su resultado, así que la discrepancia entre
 * ambas vías se muestra en vez de esconderse.
 */
@customElement('panel-triaje')
export class PanelTriaje extends LitElement {
  @property({ type: Object }) triaje: Triaje | null = null;

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .semaforo {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px;
        border-radius: 10px;
        margin-bottom: 14px;
      }
      .semaforo.verde {
        background: color-mix(in srgb, var(--verde) 14%, transparent);
      }
      .semaforo.amarillo {
        background: color-mix(in srgb, var(--amarillo) 14%, transparent);
      }
      .semaforo.rojo {
        background: color-mix(in srgb, var(--rojo) 16%, transparent);
        animation: latido 1.6s ease-in-out infinite;
      }
      @keyframes latido {
        0%,
        100% {
          box-shadow: 0 0 0 0 color-mix(in srgb, var(--rojo) 40%, transparent);
        }
        50% {
          box-shadow: 0 0 0 10px transparent;
        }
      }
      .luz {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        flex: none;
      }
      .luz.verde {
        background: var(--verde);
      }
      .luz.amarillo {
        background: var(--amarillo);
      }
      .luz.rojo {
        background: var(--rojo);
      }
      .nivel {
        font-size: 1.05rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .sub {
        font-size: 0.75rem;
        color: var(--texto-tenue);
      }
      .fusion {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .bandera {
        padding: 9px 11px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
        border-left: 3px solid var(--borde);
        margin-bottom: 7px;
        font-size: 0.82rem;
        line-height: 1.45;
      }
      .bandera.rojo {
        border-left-color: var(--rojo);
      }
      .bandera.amarillo {
        border-left-color: var(--amarillo);
      }
      .regla {
        font-family: ui-monospace, monospace;
        font-size: 0.68rem;
        color: var(--texto-tenue);
        display: block;
        margin-top: 3px;
      }
      .indagar {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px dashed color-mix(in srgb, var(--amarillo) 50%, transparent);
        font-size: 0.8rem;
        color: var(--amarillo);
        line-height: 1.45;
      }
    `,
  ];

  render() {
    const t = this.triaje;
    if (!t) {
      return html`<div class="panel">
        <h3 class="titulo">Triaje</h3>
        <p class="vacio">Sin evaluación todavía. Aparecerá en cuanto el paciente reporte su primer síntoma.</p>
      </div>`;
    }

    const etiqueta =
      t.nivel === 'rojo'
        ? 'ESCALAR — atención hoy'
        : t.nivel === 'amarillo'
          ? 'VIGILAR — revisión del equipo'
          : 'SIN ESCALAMIENTO';

    return html`
      <div class="panel">
        <h3 class="titulo">Decisión de triaje</h3>

        <div class="semaforo ${t.nivel}">
          <span class="luz ${t.nivel}"></span>
          <div>
            <div class="nivel">${etiqueta}</div>
            <div class="sub">fusión ${t.fusion.replace('_', ' ')} · gana el más grave</div>
          </div>
        </div>

        <div class="fusion">
          <span class="pastilla ${t.nivelReglas}">reglas: ${t.nivelReglas}</span>
          <span class="pastilla ${t.nivelModelo}">razonador: ${t.nivelModelo}</span>
        </div>

        ${t.banderas.length
          ? t.banderas.map(
              (b) => html`
                <div class="bandera ${b.nivel}">
                  ${b.motivo}
                  <span class="regla">regla ${b.regla} · ${String(b.slot)} = ${String(b.valor)}</span>
                </div>
              `,
            )
          : html`<p class="vacio">Ningún signo de alarma disparado por el motor de reglas.</p>`}

        ${t.requiereIndagar
          ? html`<div class="indagar">
              Faltan ${t.slotsFaltantes.length} casilla(s) núcleo. El agente debe seguir
              indagando antes de cerrar la llamada como evolución esperada.
            </div>`
          : ''}
      </div>
    `;
  }
}
