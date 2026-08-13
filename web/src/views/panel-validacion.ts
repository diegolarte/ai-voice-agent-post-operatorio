import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { base, tokens } from '../estilos.ts';
import type { NivelTriaje } from '../../../shared/types.ts';

export interface InformeEvaluacion {
  disponible: boolean;
  fecha?: string;
  evaluados?: number;
  matriz?: Record<NivelTriaje, Record<NivelTriaje, number>>;
  falsosNegativos?: unknown[];
  error?: string;
}

const NIVELES: NivelTriaje[] = ['verde', 'amarillo', 'rojo'];
const ORDEN: Record<NivelTriaje, number> = { verde: 0, amarillo: 1, rojo: 2 };

/**
 * Validación del motor de triaje contra el ground truth del dataset.
 *
 * La rúbrica evalúa cómo clasifica el agente "donde escalar es claramente lo
 * correcto, donde claramente no lo es, y en situaciones ambiguas". Esta vista
 * es la respuesta medida a esa pregunta, no una afirmación: sale de
 * `logs/eval-triaje.json`, que produce `npm run eval`.
 *
 * Se muestran las dos caras del resultado a propósito. Enseñar sólo los cero
 * falsos negativos sería contar media historia: el precio de esa garantía es
 * sobre-escalar parte de los casos verdes, y ese número también está aquí.
 */
@customElement('panel-validacion')
export class PanelValidacion extends LitElement {
  @property({ type: Object }) informe: InformeEvaluacion | null = null;

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
        font-size: 1.05rem;
      }
      .sub {
        color: var(--texto-tenue);
        font-size: 0.78rem;
        margin-bottom: 16px;
      }
      section {
        margin-bottom: 18px;
      }
      h4 {
        margin: 0 0 8px;
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--texto-tenue);
      }

      .titular {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-bottom: 16px;
      }
      .cifra {
        flex: 1 1 130px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--borde);
        border-radius: 10px;
        padding: 11px 13px;
      }
      .cifra .n {
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1.1;
      }
      .cifra .et {
        font-size: 0.72rem;
        color: var(--texto-tenue);
        margin-top: 3px;
        line-height: 1.35;
      }
      .cifra.bien .n {
        color: var(--verde);
      }
      .cifra.costo .n {
        color: var(--amarillo);
      }

      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;
      }
      th,
      td {
        padding: 7px 9px;
        text-align: center;
        border: 1px solid var(--borde);
      }
      th {
        color: var(--texto-tenue);
        font-weight: 600;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      td.fila {
        text-align: left;
        color: var(--texto-tenue);
        font-weight: 600;
      }
      /* La diagonal es el acierto. */
      td.acierto {
        background: color-mix(in srgb, var(--verde) 16%, transparent);
        font-weight: 700;
      }
      /* Sobre-escalar: cuesta, pero es seguro. */
      td.sobre {
        background: color-mix(in srgb, var(--amarillo) 14%, transparent);
      }
      /* Sub-escalar: la falla que no se puede pagar. */
      td.sub {
        background: color-mix(in srgb, var(--rojo) 18%, transparent);
      }
      td.cero {
        color: var(--texto-tenue);
      }
      .leyenda {
        display: flex;
        gap: 14px;
        flex-wrap: wrap;
        font-size: 0.72rem;
        color: var(--texto-tenue);
        margin-top: 8px;
      }
      .muestra {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 3px;
        margin-right: 5px;
        vertical-align: -1px;
      }
      .nota {
        font-size: 0.8rem;
        line-height: 1.55;
        color: var(--texto-tenue);
        margin: 0;
      }
      .nota b {
        color: var(--texto);
        font-weight: 600;
      }
      code {
        background: rgba(255, 255, 255, 0.08);
        padding: 1px 5px;
        border-radius: 4px;
        font-size: 0.9em;
      }
    `,
  ];

  render() {
    const i = this.informe;

    if (!i) {
      return html`<div class="panel">
        <h3 class="titulo">Validación</h3>
        <p class="vacio">Cargando la evaluación…</p>
      </div>`;
    }

    if (!i.disponible || !i.matriz) {
      return html`<div class="panel">
        <h3 class="titulo">Validación</h3>
        <p class="vacio">
          Todavía no hay evaluación. Ejecute <code>npm run eval</code> para contrastar el
          motor de triaje contra el ground truth del dataset; el informe queda en
          <code>logs/eval-triaje.json</code> y aparece aquí.
          ${i.error ? html`<br /><br />Detalle: ${i.error}` : ''}
        </p>
      </div>`;
    }

    const m = i.matriz;
    const total = i.evaluados ?? 0;

    // Un falso negativo es predecir MENOS gravedad de la real: el fallo
    // catastrófico en seguimiento clínico.
    let subEscalados = 0;
    let sobreEscalados = 0;
    for (const real of NIVELES) {
      for (const pred of NIVELES) {
        const n = m[real]?.[pred] ?? 0;
        if (ORDEN[pred] < ORDEN[real]) subEscalados += n;
        else if (ORDEN[pred] > ORDEN[real]) sobreEscalados += n;
      }
    }

    const totalFila = (real: NivelTriaje) =>
      NIVELES.reduce((s, p) => s + (m[real]?.[p] ?? 0), 0);
    const totalColumna = (pred: NivelTriaje) =>
      NIVELES.reduce((s, r) => s + (m[r]?.[pred] ?? 0), 0);

    const noVerdes = totalFila('amarillo') + totalFila('rojo');
    const noVerdesEscalados = noVerdes - subEscalados;
    const verdesTotal = totalFila('verde');
    const verdesSobre = verdesTotal - (m.verde?.verde ?? 0);

    const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');

    return html`
      <div class="panel">
        <h2>Validación del motor de triaje</h2>
        <div class="sub">
          ${total} casos del dataset contrastados contra el ground truth ·
          ${i.fecha ? new Date(i.fecha).toLocaleString('es-CO') : 'sin fecha'} ·
          reproducible con <code>npm run eval</code>
        </div>

        <div class="titular">
          <div class="cifra bien">
            <div class="n">${subEscalados}</div>
            <div class="et">Falsos negativos<br />(clasificar por debajo de la gravedad real)</div>
          </div>
          <div class="cifra bien">
            <div class="n">${pct(noVerdesEscalados, noVerdes)}</div>
            <div class="et">De los casos que requerían atención, cuántos escalaron</div>
          </div>
          <div class="cifra costo">
            <div class="n">${pct(verdesSobre, verdesTotal)}</div>
            <div class="et">Verdes escalados de más<br />(el costo asumido)</div>
          </div>
        </div>

        <section>
          <h4>Matriz de confusión</h4>
          <table>
            <thead>
              <tr>
                <th style="text-align:left">Real \\ Predicho</th>
                ${NIVELES.map((n) => html`<th>${n}</th>`)}
                <th>total</th>
              </tr>
            </thead>
            <tbody>
              ${NIVELES.map(
                (real) => html`<tr>
                  <td class="fila">${real}</td>
                  ${NIVELES.map((pred) => {
                    const n = m[real]?.[pred] ?? 0;
                    const clase =
                      real === pred
                        ? 'acierto'
                        : ORDEN[pred] < ORDEN[real]
                          ? 'sub'
                          : n > 0
                            ? 'sobre'
                            : 'cero';
                    return html`<td class=${clase}>${n}</td>`;
                  })}
                  <td class="fila" style="text-align:center">${totalFila(real)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
          <div class="leyenda">
            <span
              ><i
                class="muestra"
                style="background:color-mix(in srgb, var(--verde) 45%, transparent)"
              ></i
              >acierto</span
            >
            <span
              ><i
                class="muestra"
                style="background:color-mix(in srgb, var(--amarillo) 45%, transparent)"
              ></i
              >escaló de más (costo)</span
            >
            <span
              ><i
                class="muestra"
                style="background:color-mix(in srgb, var(--rojo) 55%, transparent)"
              ></i
              >escaló de menos (inaceptable)</span
            >
          </div>
        </section>

        <section>
          <h4>Por clase</h4>
          <table>
            <thead>
              <tr>
                <th style="text-align:left">Nivel</th>
                <th>casos</th>
                <th>sensibilidad</th>
                <th>precisión</th>
              </tr>
            </thead>
            <tbody>
              ${NIVELES.map((n) => {
                const aciertos = m[n]?.[n] ?? 0;
                return html`<tr>
                  <td class="fila">${n}</td>
                  <td>${totalFila(n)}</td>
                  <td>${pct(aciertos, totalFila(n))}</td>
                  <td>${pct(aciertos, totalColumna(n))}</td>
                </tr>`;
              })}
            </tbody>
          </table>
        </section>

        <section>
          <h4>Cómo leer esto</h4>
          <p class="nota">
            La fusión de triaje es <b>asimétrica a propósito</b>: ante desacuerdo entre las
            reglas deterministas y el razonador, se toma el máximo, nunca el promedio. En
            seguimiento postoperatorio el falso negativo —no alertar cuando había que
            alertar— es la falla que no se puede pagar; el falso positivo cuesta una
            revisión de enfermería.
            <br /><br />
            Por eso las dos cifras van juntas: <b>${subEscalados} casos por debajo de su
            gravedad real</b>, y el precio de esa garantía son
            <b>${verdesSobre} de ${verdesTotal} casos verdes</b> que se escalaron sin
            necesitarlo. Es el intercambio que se eligió, no un efecto secundario.
          </p>
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'panel-validacion': PanelValidacion;
  }
}
