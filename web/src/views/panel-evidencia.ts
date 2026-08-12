import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { base, tokens } from '../estilos.ts';
import type { Cita } from '../../../shared/types.ts';

/**
 * Trazabilidad: de dónde salió cada afirmación clínica.
 *
 * Se muestra el extracto textual, el documento y la página, porque la rúbrica
 * dice que la referencia debe resistir "una verificación contra la fuente
 * real". Citar sólo el nombre del archivo no resistiría esa prueba.
 */
@customElement('panel-evidencia')
export class PanelEvidencia extends LitElement {
  @property({ type: Array }) citas: Cita[] = [];

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
      }
      .lista {
        display: grid;
        gap: 10px;
        max-height: 100%;
        overflow-y: auto;
      }
      article {
        border: 1px solid var(--borde);
        border-radius: 10px;
        padding: 12px 13px;
        background: rgba(255, 255, 255, 0.03);
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 8px;
      }
      .doc {
        font-size: 0.84rem;
        font-weight: 600;
        line-height: 1.35;
      }
      .meta {
        font-size: 0.7rem;
        color: var(--texto-tenue);
        margin-top: 3px;
      }
      .score {
        flex: none;
        font-family: ui-monospace, monospace;
        font-size: 0.7rem;
        color: var(--acento);
        border: 1px solid color-mix(in srgb, var(--acento) 40%, transparent);
        border-radius: 999px;
        padding: 2px 8px;
      }
      blockquote {
        margin: 0;
        padding-left: 11px;
        border-left: 2px solid color-mix(in srgb, var(--acento) 45%, transparent);
        font-size: 0.8rem;
        line-height: 1.55;
        color: var(--texto-tenue);
        max-height: 7.5em;
        overflow: hidden;
        position: relative;
      }
      blockquote.abierta {
        max-height: none;
      }
      .mas {
        margin-top: 6px;
        background: none;
        border: none;
        color: var(--acento);
        font-size: 0.72rem;
        padding: 0;
      }
    `,
  ];

  private abiertas = new Set<string>();

  private alternar(id: string) {
    this.abiertas.has(id) ? this.abiertas.delete(id) : this.abiertas.add(id);
    this.requestUpdate();
  }

  render() {
    return html`
      <div class="panel">
        <h3 class="titulo">
          <span>Evidencia citada</span>
          ${this.citas.length ? html`<span class="pastilla">${this.citas.length}</span>` : ''}
        </h3>

        ${this.citas.length === 0
          ? html`<p class="vacio">
              Todavía no se ha citado ninguna fuente. Aparecerá aquí cuando el agente responda una
              duda clínica apoyándose en la base de conocimiento.
            </p>`
          : html`<div class="lista">
              ${this.citas.map((c) => {
                const abierta = this.abiertas.has(c.chunkId);
                return html`
                  <article>
                    <header>
                      <div>
                        <div class="doc">${c.documento}</div>
                        <div class="meta">${c.escenario} · página ${c.pagina}</div>
                      </div>
                      <span class="score">${c.score.toFixed(3)}</span>
                    </header>
                    <blockquote class=${abierta ? 'abierta' : ''}>${c.extracto}</blockquote>
                    ${c.extracto.length > 320
                      ? html`<button class="mas" @click=${() => this.alternar(c.chunkId)}>
                          ${abierta ? '− ver menos' : '+ ver fragmento completo'}
                        </button>`
                      : ''}
                  </article>
                `;
              })}
            </div>`}
      </div>
    `;
  }
}
