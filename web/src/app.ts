import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { base, tokens } from './estilos.ts';
import { SesionCentinela } from './live/session.ts';
import './views/panel-slots.ts';
import './views/panel-triaje.ts';
import './views/panel-evidencia.ts';
import './views/panel-resumen.ts';
import './views/consola.ts';
import './visual-3d.ts';
import type {
  Cita,
  PacienteDemo,
  ResumenLlamada,
  SlotsSintomas,
  Triaje,
  VistaUi,
} from '../../shared/types.ts';

interface LineaTranscripcion {
  hablante: 'agente' | 'paciente';
  texto: string;
}

@customElement('centinela-app')
export class CentinelaApp extends LitElement {
  @state() private vista: VistaUi = 'llamada';
  @state() private pacientes: PacienteDemo[] = [];
  @state() private paciente: PacienteDemo | null = null;
  @state() private diaPostop = 3;

  @state() private conectado = false;
  @state() private enLlamada = false;
  @state() private microfonoAbierto = false;
  @state() private estado = 'Seleccione un paciente para iniciar la llamada.';
  @state() private error = '';
  @state() private quienHabla: 'agente' | 'paciente' | 'nadie' = 'nadie';

  @state() private slots: SlotsSintomas = {};
  @state() private triaje: Triaje | null = null;
  @state() private citas: Cita[] = [];
  @state() private resumen: ResumenLlamada | null = null;
  @state() private transcripcion: LineaTranscripcion[] = [];
  @state() private latencias: number[] = [];

  private sesion: SesionCentinela | null = null;

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        height: 100vh;
        overflow: hidden;
        position: relative;
        background: var(--fondo);
      }
      gdm-live-audio-visuals-3d {
        position: fixed;
        inset: 0;
        z-index: 0;
      }
      .marco {
        position: relative;
        z-index: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      nav {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 12px 20px;
        border-bottom: 1px solid var(--borde);
        background: rgba(11, 18, 32, 0.78);
        backdrop-filter: blur(10px);
      }
      .marca {
        font-weight: 700;
        font-size: 1rem;
        margin-right: 14px;
        letter-spacing: -0.01em;
      }
      .marca span {
        color: var(--acento);
      }
      nav button {
        background: none;
        border: 1px solid transparent;
        color: var(--texto-tenue);
        padding: 6px 13px;
        border-radius: 8px;
        font-size: 0.82rem;
        font-weight: 500;
      }
      nav button.activa {
        background: rgba(56, 189, 248, 0.13);
        border-color: color-mix(in srgb, var(--acento) 40%, transparent);
        color: var(--acento);
      }
      nav button.auto {
        animation: destello 1.2s ease;
      }
      @keyframes destello {
        0%,
        100% {
          box-shadow: 0 0 0 0 transparent;
        }
        40% {
          box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.28);
        }
      }
      .derecha {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .punto {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--texto-tenue);
      }
      .punto.on {
        background: var(--verde);
      }

      main {
        flex: 1;
        min-height: 0;
        display: grid;
        grid-template-columns: 320px minmax(0, 1fr) 340px;
        gap: 14px;
        padding: 14px 20px 18px;
        box-sizing: border-box;
      }
      main.consola {
        grid-template-columns: 1fr;
      }
      .columna {
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .centro {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-height: 0;
      }

      .ficha {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      select {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid var(--borde);
        border-radius: 8px;
        color: var(--texto);
        padding: 8px 10px;
        font-family: inherit;
        font-size: 0.84rem;
        flex: 1;
        min-width: 160px;
        /* Sin esto el navegador pinta el desplegable con su blanco por
           defecto y el texto claro queda invisible salvo en la opción
           resaltada. */
        color-scheme: dark;
      }
      select option {
        background: var(--panel-solido);
        color: var(--texto);
      }
      .datos {
        font-size: 0.78rem;
        color: var(--texto-tenue);
        line-height: 1.6;
        margin-top: 8px;
      }
      .datos b {
        color: var(--texto);
        font-weight: 500;
      }

      .controles {
        display: flex;
        gap: 9px;
        flex-wrap: wrap;
        margin-top: 12px;
      }
      .accion {
        border: none;
        border-radius: 9px;
        padding: 10px 17px;
        font-weight: 600;
        font-size: 0.85rem;
      }
      .llamar {
        background: var(--verde);
        color: #04220f;
      }
      .colgar {
        background: var(--rojo);
        color: #2a0808;
      }
      .mic {
        background: var(--acento);
        color: #08131f;
      }
      .mic.abierto {
        background: rgba(56, 189, 248, 0.18);
        color: var(--acento);
        border: 1px solid var(--acento);
      }
      .accion[disabled] {
        opacity: 0.4;
        cursor: default;
      }

      .estado {
        font-size: 0.8rem;
        color: var(--texto-tenue);
        margin-top: 10px;
        line-height: 1.5;
      }
      .estado.err {
        color: var(--rojo);
      }

      .transcripcion {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
      }
      .linea {
        font-size: 0.85rem;
        line-height: 1.55;
        margin-bottom: 9px;
      }
      .linea b {
        color: var(--acento);
      }
      .linea.paciente b {
        color: var(--texto-tenue);
      }
      .ondas {
        display: inline-flex;
        gap: 2px;
        margin-left: 6px;
        vertical-align: middle;
      }
      .ondas i {
        width: 2px;
        height: 9px;
        background: var(--acento);
        border-radius: 2px;
        animation: onda 0.9s ease-in-out infinite;
      }
      .ondas i:nth-child(2) {
        animation-delay: 0.15s;
      }
      .ondas i:nth-child(3) {
        animation-delay: 0.3s;
      }
      @keyframes onda {
        0%,
        100% {
          transform: scaleY(0.4);
        }
        50% {
          transform: scaleY(1);
        }
      }
      .lat {
        font-family: ui-monospace, monospace;
        font-size: 0.72rem;
        color: var(--texto-tenue);
      }
    `,
  ];

  connectedCallback() {
    super.connectedCallback();
    void fetch('/api/pacientes')
      .then((r) => r.json())
      .then((p: PacienteDemo[]) => {
        this.pacientes = p;
        this.paciente = p[0] ?? null;
      })
      .catch(() => (this.error = 'No se pudo contactar el backend. ¿Está corriendo `npm run dev`?'));
  }

  // -------------------------------------------------------------------------

  private async iniciarLlamada() {
    this.error = '';
    this.resumen = null;
    this.slots = {};
    this.triaje = null;
    this.citas = [];
    this.transcripcion = [];
    this.latencias = [];
    this.vista = 'llamada';

    const callId = `call_${Date.now().toString(36)}`;
    this.sesion = new SesionCentinela(
      {
        estado: (t, tipo) => {
          if (tipo === 'error') this.error = t;
          else this.estado = t;
        },
        slots: (s) => (this.slots = s),
        triaje: (t) => (this.triaje = t),
        citas: (c) => {
          // Se acumulan sin duplicar: la evidencia de la llamada es el conjunto
          // de todo lo citado, no sólo lo del último turno.
          const mapa = new Map(this.citas.map((x) => [x.chunkId, x]));
          for (const x of c) mapa.set(x.chunkId, x);
          this.citas = [...mapa.values()];
        },
        navegar: (v) => this.navegarAuto(v),
        transcripcion: (hablante, texto) => this.agregarLinea(hablante, texto),
        resumen: (r) => {
          this.resumen = r;
          this.enLlamada = false;
          this.microfonoAbierto = false;
        },
        metricas: (ms) => (this.latencias = [...this.latencias, ms]),
        conectado: (c) => (this.conectado = c),
        hablando: (q) => (this.quienHabla = q),
      },
      callId,
      this.paciente,
      this.diaPostop,
    );

    try {
      this.enLlamada = true;
      await this.sesion.conectar();
      await this.sesion.iniciarMicrofono();
      this.microfonoAbierto = true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.enLlamada = false;
    }
  }

  private async colgar() {
    const r = await this.sesion?.colgar();
    if (r) {
      this.resumen = r;
      this.vista = 'resumen';
    }
    this.enLlamada = false;
    this.microfonoAbierto = false;
    this.sesion = null;
  }

  private alternarMicrofono() {
    if (!this.sesion) return;
    if (this.microfonoAbierto) {
      this.sesion.detenerMicrofono();
      this.microfonoAbierto = false;
    } else {
      void this.sesion.iniciarMicrofono().then(() => (this.microfonoAbierto = true));
    }
  }

  private agregarLinea(hablante: 'agente' | 'paciente', texto: string) {
    const ultima = this.transcripcion.at(-1);
    if (ultima && ultima.hablante === hablante) {
      this.transcripcion = [
        ...this.transcripcion.slice(0, -1),
        { hablante, texto: `${ultima.texto} ${texto}`.replace(/\s+/g, ' ') },
      ];
    } else {
      this.transcripcion = [...this.transcripcion, { hablante, texto }];
    }
  }

  /** Navegación disparada por el propio agente durante la conversación. */
  private vistaAutomatica: VistaUi | null = null;
  private navegarAuto(v: VistaUi) {
    if (this.vista === 'consola') return; // no interrumpir al administrador
    this.vista = v;
    this.vistaAutomatica = v;
    setTimeout(() => {
      if (this.vistaAutomatica === v) this.vistaAutomatica = null;
      this.requestUpdate();
    }, 1300);
  }

  // -------------------------------------------------------------------------

  private renderLateralIzquierdo() {
    const p = this.paciente;
    return html`
      <div class="panel">
        <h3 class="titulo">Llamada</h3>
        <div class="ficha">
          <select
            ?disabled=${this.enLlamada}
            @change=${(e: Event) => {
              const id = (e.target as HTMLSelectElement).value;
              this.paciente = this.pacientes.find((x) => x.paciente_id === id) ?? null;
            }}
          >
            ${this.pacientes.map(
              (x) => html`<option value=${x.paciente_id} ?selected=${x.paciente_id === p?.paciente_id}>
                ${x.nombre_completo} — ${x.procedimiento}
              </option>`,
            )}
          </select>
          <select
            ?disabled=${this.enLlamada}
            @change=${(e: Event) => (this.diaPostop = Number((e.target as HTMLSelectElement).value))}
            style="flex:0 0 auto;min-width:0"
          >
            ${[1, 3, 7, 14].map(
              (d) => html`<option value=${d} ?selected=${d === this.diaPostop}>día ${d}</option>`,
            )}
          </select>
        </div>

        ${p
          ? html`<div class="datos">
              <b>${p.edad} años · ${p.genero}</b> · ${p.procedimiento}<br />
              Cirugía ${p.fecha_cirugia} · ${p.ciudad}, ${p.departamento}<br />
              ${p.eps} · CC ${p.documento_cc}<br />
              Comorbilidades:
              <b>${p.comorbilidades.length ? p.comorbilidades.join(', ') : 'ninguna'}</b>
            </div>`
          : ''}

        <div class="controles">
          ${!this.enLlamada
            ? html`<button class="accion llamar" ?disabled=${!p} @click=${this.iniciarLlamada}>
                Iniciar llamada
              </button>`
            : html`
                <button
                  class="accion mic ${this.microfonoAbierto ? 'abierto' : ''}"
                  @click=${this.alternarMicrofono}
                >
                  ${this.microfonoAbierto ? 'Micrófono abierto' : 'Abrir micrófono'}
                </button>
                <button class="accion colgar" @click=${this.colgar}>Colgar</button>
              `}
        </div>

        <div class="estado ${this.error ? 'err' : ''}">${this.error || this.estado}</div>
        ${this.latencias.length
          ? html`<div class="estado lat">
              último turno ${this.latencias.at(-1)} ms · ${this.latencias.length} medidos
            </div>`
          : ''}
      </div>

      <panel-slots .slots=${this.slots} .faltantes=${this.triaje?.slotsFaltantes ?? []}></panel-slots>
    `;
  }

  private renderCentro() {
    if (this.vista === 'resumen') {
      return html`<panel-resumen .resumen=${this.resumen}></panel-resumen>`;
    }
    if (this.vista === 'evidencia') {
      return html`<panel-evidencia .citas=${this.citas}></panel-evidencia>`;
    }
    if (this.vista === 'triaje') {
      return html`<panel-triaje .triaje=${this.triaje}></panel-triaje>`;
    }

    return html`
      <div class="panel transcripcion">
        <h3 class="titulo">
          <span>Conversación</span>
          ${this.quienHabla !== 'nadie'
            ? html`<span class="pastilla">
                ${this.quienHabla === 'agente' ? 'Centinela habla' : 'paciente habla'}
                <span class="ondas"><i></i><i></i><i></i></span>
              </span>`
            : ''}
        </h3>
        ${this.transcripcion.length === 0
          ? html`<p class="vacio">
              La transcripción aparecerá aquí en cuanto empiece la conversación. Use audífonos para
              evitar que el micrófono capte la voz del agente.
            </p>`
          : this.transcripcion.map(
              (l) => html`<div class="linea ${l.hablante}">
                <b>${l.hablante === 'agente' ? 'Centinela' : 'Paciente'}:</b> ${l.texto}
              </div>`,
            )}
      </div>
    `;
  }

  render() {
    const vistas: { id: VistaUi; etiqueta: string }[] = [
      { id: 'llamada', etiqueta: 'Llamada' },
      { id: 'evidencia', etiqueta: `Evidencia${this.citas.length ? ` (${this.citas.length})` : ''}` },
      { id: 'triaje', etiqueta: 'Triaje' },
      { id: 'resumen', etiqueta: 'Resumen' },
      { id: 'consola', etiqueta: 'Consola' },
    ];

    return html`
      <gdm-live-audio-visuals-3d
        .inputNode=${this.sesion?.nodoEntrada}
        .outputNode=${this.sesion?.nodoSalida}
      ></gdm-live-audio-visuals-3d>

      <div class="marco">
        <nav>
          <div class="marca">Centi<span>nela</span></div>
          ${vistas.map(
            (v) => html`<button
              class=${[
                this.vista === v.id ? 'activa' : '',
                this.vistaAutomatica === v.id ? 'auto' : '',
              ].join(' ')}
              @click=${() => (this.vista = v.id)}
            >
              ${v.etiqueta}
            </button>`,
          )}
          <div class="derecha">
            ${this.triaje
              ? html`<span class="pastilla ${this.triaje.nivel}">${this.triaje.nivel}</span>`
              : ''}
            <span class="punto ${this.conectado ? 'on' : ''}"></span>
            <span style="font-size:.75rem;color:var(--texto-tenue)">
              ${this.conectado ? 'en línea' : 'desconectado'}
            </span>
          </div>
        </nav>

        ${this.vista === 'consola'
          ? html`<main class="consola"><consola-conocimiento></consola-conocimiento></main>`
          : html`<main>
              <div class="columna">${this.renderLateralIzquierdo()}</div>
              <div class="centro">${this.renderCentro()}</div>
              <div class="columna">
                <panel-triaje .triaje=${this.triaje}></panel-triaje>
                <panel-evidencia .citas=${this.citas}></panel-evidencia>
              </div>
            </main>`}
      </div>
    `;
  }
}
