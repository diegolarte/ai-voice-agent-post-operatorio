import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { base, tokens } from '../estilos.ts';
import type { ResumenLlamada } from '../../../shared/types.ts';

/**
 * El acta de la llamada: quién, qué reportó, qué se decidió, con qué evidencia
 * y qué sigue. Es el entregable que la rúbrica exige que quede "al terminar la
 * llamada", y el mismo objeto que se persiste en `logs/llamadas/`.
 */
@customElement('panel-resumen')
export class PanelResumen extends LitElement {
  @property({ type: Object }) resumen: ResumenLlamada | null = null;

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        overflow-y: auto;
      }
      h2 {
        margin: 0 0 4px;
        font-size: 1.1rem;
      }
      .sub {
        color: var(--texto-tenue);
        font-size: 0.8rem;
        margin-bottom: 16px;
      }
      section {
        margin-bottom: 16px;
      }
      h4 {
        margin: 0 0 7px;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--texto-tenue);
      }
      ul {
        margin: 0;
        padding-left: 18px;
        font-size: 0.85rem;
        line-height: 1.6;
      }
      .decision {
        padding: 12px 14px;
        border-radius: 10px;
        font-weight: 600;
        font-size: 0.92rem;
      }
      .decision.verde {
        background: color-mix(in srgb, var(--verde) 14%, transparent);
        color: var(--verde);
      }
      .decision.amarillo {
        background: color-mix(in srgb, var(--amarillo) 14%, transparent);
        color: var(--amarillo);
      }
      .decision.rojo {
        background: color-mix(in srgb, var(--rojo) 16%, transparent);
        color: var(--rojo);
      }
      .metricas {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
        gap: 8px;
      }
      .metrica {
        background: rgba(255, 255, 255, 0.04);
        border-radius: 8px;
        padding: 9px 10px;
      }
      .metrica .n {
        font-size: 1rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .metrica .k {
        font-size: 0.66rem;
        color: var(--texto-tenue);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .turno {
        font-size: 0.82rem;
        line-height: 1.5;
        margin-bottom: 6px;
      }
      .turno b {
        color: var(--acento);
      }
      .turno.paciente b {
        color: var(--texto-tenue);
      }
      .fuentes {
        font-size: 0.78rem;
        color: var(--texto-tenue);
        line-height: 1.55;
      }
      .descargar {
        background: none;
        border: 1px solid var(--borde);
        color: var(--texto-tenue);
        border-radius: 8px;
        padding: 6px 12px;
        font-size: 0.75rem;
      }
    `,
  ];

  private descargar() {
    if (!this.resumen) return;
    const blob = new Blob([JSON.stringify(this.resumen, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${this.resumen.callId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  render() {
    const r = this.resumen;
    if (!r) {
      return html`<div class="panel">
        <h3 class="titulo">Resumen</h3>
        <p class="vacio">El resumen estructurado se genera cuando el agente cierra la llamada.</p>
      </div>`;
    }

    const m = r.metricas;
    return html`
      <div class="panel">
        <h2>${r.paciente?.nombre_completo ?? 'Paciente anónimo'}</h2>
        <div class="sub">
          ${r.paciente
            ? `${r.paciente.edad} años · ${r.paciente.procedimiento} · día ${r.paciente.dia_postop} postop · ${r.paciente.eps}`
            : 'Sin ficha asociada'}
          · ${r.duracionSeg}s · ${r.callId}
        </div>

        <section>
          <h4>Decisión</h4>
          <div class="decision ${r.nivelFinal}">${r.decision}</div>
        </section>

        <section>
          <h4>Síntomas reportados</h4>
          ${r.sintomasReportados.length
            ? html`<ul>
                ${r.sintomasReportados.map((s) => html`<li>${s}</li>`)}
              </ul>`
            : html`<p class="vacio">No se registró ningún síntoma.</p>`}
        </section>

        <section>
          <h4>Próximos pasos</h4>
          <ul>
            ${r.proximosPasos.map((p) => html`<li>${p}</li>`)}
          </ul>
        </section>

        ${r.alertas.length
          ? html`<section>
              <h4>Alertas generadas</h4>
              ${r.alertas.map(
                (a) => html`<div class="turno">
                  <span class="pastilla ${a.nivel}">${a.nivel}</span> ${a.motivo}
                </div>`,
              )}
            </section>`
          : ''}

        <section>
          <h4>Referencias usadas</h4>
          ${r.citasUsadas.length
            ? html`<div class="fuentes">
                ${r.citasUsadas.map((c) => html`<div>· ${c.documento} — p. ${c.pagina}</div>`)}
              </div>`
            : html`<p class="vacio">No se citó ninguna fuente en esta llamada.</p>`}
        </section>

        <section>
          <h4>Métricas de la llamada</h4>
          <div class="metricas">
            <div class="metrica">
              <div class="n">${m.latenciaP50Ms ?? '—'}</div>
              <div class="k">P50 ms</div>
            </div>
            <div class="metrica">
              <div class="n">${m.latenciaP95Ms ?? '—'}</div>
              <div class="k">P95 ms</div>
            </div>
            <div class="metrica">
              <div class="n">${m.turnos}</div>
              <div class="k">turnos</div>
            </div>
            <div class="metrica">
              <div class="n">${m.consultasRag}</div>
              <div class="k">consultas RAG</div>
            </div>
            <div class="metrica">
              <div class="n">${m.tokensEntrada.toLocaleString('es')}</div>
              <div class="k">tokens in</div>
            </div>
            <div class="metrica">
              <div class="n">${m.tokensSalida.toLocaleString('es')}</div>
              <div class="k">tokens out</div>
            </div>
            <div class="metrica">
              <div class="n">$${m.costoUsd.toFixed(4)}</div>
              <div class="k">costo USD</div>
            </div>
          </div>
        </section>

        <section>
          <h4>Transcripción</h4>
          ${r.transcripcion.length
            ? r.transcripcion.map(
                (t) => html`<div class="turno ${t.hablante}">
                  <b>${t.hablante === 'agente' ? 'Centinela' : 'Paciente'}:</b> ${t.texto}
                </div>`,
              )
            : html`<p class="vacio">Sin transcripción registrada.</p>`}
        </section>

        <button class="descargar" @click=${this.descargar}>Descargar acta JSON</button>
      </div>
    `;
  }
}
