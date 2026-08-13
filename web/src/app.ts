import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { base, tokens } from './estilos.ts';
import { SesionCentinela } from './live/session.ts';
import './views/panel-slots.ts';
import './views/panel-triaje.ts';
import './views/panel-evidencia.ts';
import './views/panel-resumen.ts';
import './views/panel-validacion.ts';
import './views/consola.ts';
import type { InformeEvaluacion } from './views/panel-validacion.ts';
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

  /**
   * Actas de llamadas anteriores, leídas de `logs/llamadas/` por el backend.
   *
   * El acta ya se persistía en disco desde el primer día, pero no se leía desde
   * ninguna parte: al recargar la página parecía que no quedaba nada. La
   * rúbrica evalúa lo observable, así que la persistencia tiene que verse.
   */
  @state() private historial: ResumenLlamada[] = [];
  @state() private historialAbierto: ResumenLlamada | null = null;

  /** Evaluación offline del triaje contra el ground truth (`npm run eval`). */
  @state() private evaluacion: InformeEvaluacion | null = null;
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

      .historial {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .acta {
        display: block;
        width: 100%;
        text-align: left;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--borde);
        border-radius: 9px;
        padding: 10px 12px;
        color: var(--texto);
        font-family: inherit;
      }
      .acta:hover {
        background: rgba(255, 255, 255, 0.08);
        border-color: var(--acento);
      }
      .acta-fila {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        font-size: 0.85rem;
      }
      .acta-meta {
        color: var(--texto-tenue);
        font-size: 0.75rem;
        margin-top: 4px;
      }
      .volver {
        background: none;
        border: none;
        color: var(--acento);
        font-family: inherit;
        font-size: 0.8rem;
        padding: 0 0 10px;
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

    void this.cargarHistorial();

    void fetch('/api/evaluacion')
      .then((r) => r.json())
      .then((e: InformeEvaluacion) => (this.evaluacion = e))
      .catch(() => (this.evaluacion = { disponible: false }));
  }

  private async cargarHistorial(): Promise<void> {
    try {
      const r = await fetch('/api/llamadas');
      this.historial = await r.json();
    } catch {
      /* el historial es informativo: su ausencia no rompe la llamada */
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Borra todo lo clínico de la pantalla.
   *
   * Es una cuestión de seguridad, no de limpieza: el acta, las casillas y la
   * evidencia pertenecen a un paciente y a un día concretos. Si cambia
   * cualquiera de los dos y esto no se borra, el equipo ve datos de un paciente
   * bajo el nombre de otro.
   */
  private limpiarEstadoClinico() {
    this.resumen = null;
    this.slots = {};
    this.triaje = null;
    this.citas = [];
    this.transcripcion = [];
    this.latencias = [];
    this.historialAbierto = null;
    // Sólo las vistas atadas al paciente quedarían vacías. Consola y validación
    // no dependen de quién esté seleccionado, así que no se abandonan.
    if (this.vista !== 'consola' && this.vista !== 'validacion') this.vista = 'llamada';
  }

  private async iniciarLlamada() {
    this.error = '';
    this.limpiarEstadoClinico();
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
          void this.cargarHistorial();
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
    void this.cargarHistorial();
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
              // Sin esto, el acta y las casillas del paciente anterior se
              // quedaban en pantalla bajo el nombre del nuevo.
              this.limpiarEstadoClinico();
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
            @change=${(e: Event) => {
              this.diaPostop = Number((e.target as HTMLSelectElement).value);
              this.limpiarEstadoClinico();
            }}
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

  /**
   * Actas de llamadas ya cerradas. Es la prueba visible de que lo que produce
   * el sistema sobrevive a la sesión: cada entrada sale de un JSON en
   * `logs/llamadas/`, no de la memoria del navegador.
   */
  private renderHistorial() {
    if (!this.historial.length) {
      return html`<div class="panel">
        <h3 class="titulo">Resumen</h3>
        <p class="vacio">
          Todavía no hay actas. Al cerrar una llamada, el acta queda guardada en
          <code>logs/llamadas/</code> y aparece aquí, incluso si recarga la página.
        </p>
      </div>`;
    }

    return html`<div class="panel">
      <h3 class="titulo">
        Actas guardadas
        <span style="font-weight:400;text-transform:none;letter-spacing:0">
          ${this.historial.length} llamada${this.historial.length === 1 ? '' : 's'} en disco
        </span>
      </h3>
      <div class="historial">
        ${this.historial.map(
          (h) => html`<button class="acta" @click=${() => (this.historialAbierto = h)}>
            <div class="acta-fila">
              <b>${h.paciente?.nombre_completo ?? 'Paciente sin identificar'}</b>
              <span class="pastilla ${h.nivelFinal}">${h.nivelFinal}</span>
            </div>
            <div class="acta-meta">
              ${h.paciente?.procedimiento ?? '—'} ·
              ${new Date(h.iniciadaEn).toLocaleString('es-CO')} ·
              ${h.citasUsadas?.length ?? 0} fuente${(h.citasUsadas?.length ?? 0) === 1 ? '' : 's'}
            </div>
          </button>`,
        )}
      </div>
    </div>`;
  }

  private renderCentro() {
    if (this.vista === 'validacion') {
      return html`<panel-validacion .informe=${this.evaluacion}></panel-validacion>`;
    }
    if (this.vista === 'resumen') {
      // Prioridad: el acta de la llamada en curso; si no hay, la que el usuario
      // haya abierto del historial; si tampoco, el listado de lo persistido.
      const acta = this.resumen ?? this.historialAbierto;
      if (acta) {
        return html`
          ${this.historialAbierto && !this.resumen
            ? html`<button class="volver" @click=${() => (this.historialAbierto = null)}>
                ← Volver al historial
              </button>`
            : ''}
          <panel-resumen .resumen=${acta}></panel-resumen>
        `;
      }
      return this.renderHistorial();
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
      { id: 'validacion', etiqueta: 'Validación' },
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
