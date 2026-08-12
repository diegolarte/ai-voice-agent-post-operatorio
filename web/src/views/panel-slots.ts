import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { base, tokens } from '../estilos.ts';
import { CATALOGO_SLOTS } from '../../../shared/slots-catalogo.ts';
import type { SlotsSintomas } from '../../../shared/types.ts';

/**
 * Las casillas clínicas llenándose en vivo mientras el agente conversa.
 * Es la superficie que hace observable el sondeo: se ve qué ya se preguntó,
 * qué falta y qué casilla núcleo sigue bloqueando el cierre de la llamada.
 */
@customElement('panel-slots')
export class PanelSlots extends LitElement {
  @property({ type: Object }) slots: SlotsSintomas = {};
  @property({ type: Array }) faltantes: string[] = [];

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 6px;
      }
      li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 7px 10px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.03);
        border-left: 3px solid transparent;
        font-size: 0.85rem;
        transition: background 0.25s ease;
      }
      li.lleno {
        border-left-color: var(--acento);
        background: rgba(56, 189, 248, 0.08);
      }
      li.pendiente-nucleo {
        border-left-color: var(--amarillo);
      }
      .etiqueta {
        color: var(--texto-tenue);
      }
      li.lleno .etiqueta {
        color: var(--texto);
      }
      .valor {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        text-align: right;
      }
      .valor.pendiente {
        color: var(--texto-tenue);
        font-weight: 400;
        opacity: 0.6;
      }
      .nucleo {
        font-size: 0.62rem;
        color: var(--amarillo);
        letter-spacing: 0.06em;
      }
    `,
  ];

  private formatear(clave: string, valor: unknown): string {
    if (valor === undefined || valor === null) return '—';
    if (clave === 'dolor_nrs') return `${valor} / 10`;
    if (clave === 'fiebre_c') return `${valor} °C`;
    return String(valor).replace(/_/g, ' ');
  }

  render() {
    const pendientesNucleo = new Set(this.faltantes);

    return html`
      <div class="panel">
        <h3 class="titulo">
          <span>Casillas clínicas</span>
          ${this.faltantes.length
            ? html`<span class="pastilla amarillo">${this.faltantes.length} por indagar</span>`
            : html`<span class="pastilla verde">núcleo completo</span>`}
        </h3>
        <ul>
          ${CATALOGO_SLOTS.map((def) => {
            const valor = this.slots[def.clave];
            const lleno = valor !== undefined && valor !== null;
            const bloqueante = pendientesNucleo.has(def.clave);
            return html`
              <li class=${lleno ? 'lleno' : bloqueante ? 'pendiente-nucleo' : ''}>
                <span class="etiqueta">
                  ${def.etiqueta}
                  ${bloqueante ? html`<span class="nucleo"> · NÚCLEO</span>` : ''}
                </span>
                <span class="valor ${lleno ? '' : 'pendiente'}">
                  ${this.formatear(def.clave, valor)}
                </span>
              </li>
            `;
          })}
        </ul>
      </div>
    `;
  }
}
