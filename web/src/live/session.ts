import {
  Behavior,
  FunctionResponseScheduling,
  GoogleGenAI,
  Modality,
  Type,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import { createBlob, decode, decodeAudioData } from '../audio/utils.ts';
import { construirPrompt } from './prompt.ts';
import { CATALOGO_SLOTS } from '../../../shared/slots-catalogo.ts';
import type {
  Cita,
  ConsultaResponse,
  PacienteDemo,
  ResumenLlamada,
  SlotsSintomas,
  Triaje,
  VistaUi,
} from '../../../shared/types.ts';

export interface EventosSesion {
  estado(texto: string, tipo?: 'info' | 'error'): void;
  slots(slots: SlotsSintomas): void;
  triaje(triaje: Triaje): void;
  citas(citas: Cita[]): void;
  navegar(vista: VistaUi): void;
  transcripcion(hablante: 'agente' | 'paciente', texto: string): void;
  resumen(resumen: ResumenLlamada): void;
  metricas(latenciaMs: number): void;
  conectado(listo: boolean): void;
  hablando(quien: 'agente' | 'paciente' | 'nadie'): void;
}

const MUESTREO_ENTRADA = 16000;
const MUESTREO_SALIDA = 24000;

/** Umbral de energía RMS para el detector de voz local (medición de latencia). */
const UMBRAL_VOZ = 0.012;
const SILENCIO_MS = 450;

/**
 * Herramientas declaradas `NON_BLOCKING`.
 *
 * Fuente única de verdad: la declaración de la herramienta y la respuesta que
 * se le envía tienen que coincidir. El campo `scheduling` SÓLO es válido en la
 * respuesta de una función no bloqueante; mandarlo en una bloqueante hace que
 * el servidor cierre la sesión con 1011 (internal error) a mitad de la llamada.
 * Antes eran dos listas separadas y se desincronizaron en la ruta de error.
 */
const NO_BLOQUEANTES = new Set(['consultar_conocimiento_clinico']);

export class SesionCentinela {
  private client!: GoogleGenAI;
  private session: Session | null = null;

  private ctxEntrada = new AudioContext({ sampleRate: MUESTREO_ENTRADA });
  private ctxSalida = new AudioContext({ sampleRate: MUESTREO_SALIDA });
  readonly nodoEntrada = this.ctxEntrada.createGain();
  readonly nodoSalida = this.ctxSalida.createGain();

  private stream: MediaStream | null = null;
  private fuente: MediaStreamAudioSourceNode | null = null;
  private procesador: ScriptProcessorNode | null = null;
  private reproduciendo = new Set<AudioBufferSourceNode>();
  private siguienteInicio = 0;

  private slots: SlotsSintomas = {};
  private grabando = false;

  /**
   * Si el socket sigue vivo. `this.session` no sirve para saberlo: el objeto
   * sobrevive al cierre del WebSocket, así que sin esta bandera el micrófono
   * sigue empujando audio a un socket muerto ~23 veces por segundo.
   */
  private viva = false;

  /**
   * IDs de llamadas a herramienta que el servidor canceló.
   *
   * Ocurre de forma natural: el paciente interrumpe mientras el agente está
   * consultando el corpus, el turno se descarta y con él la llamada pendiente.
   * Responder a un id ya cancelado también cierra la sesión con 1011.
   */
  private cancelados = new Set<string>();

  // --- medición de latencia (§5 de la rúbrica) -----------------------------
  private hablandoPaciente = false;
  private ultimaVozTs = 0;
  private tFinHabla: number | null = null;
  private latenciaPendiente = true;

  constructor(
    private readonly ev: EventosSesion,
    public readonly callId: string,
    private paciente: PacienteDemo | null,
    private diaPostop: number,
  ) {
    this.nodoSalida.connect(this.ctxSalida.destination);
  }

  // -------------------------------------------------------------------------
  // Conexión
  // -------------------------------------------------------------------------

  async conectar(): Promise<void> {
    this.ev.estado('Solicitando credencial de sesión…');

    const r = await fetch('/api/live-token', { method: 'POST' });
    const datos = await r.json();
    if (!r.ok || !datos.token) {
      throw new Error(datos.error ?? 'No se pudo obtener la credencial de voz.');
    }
    if (datos.modo === 'clave_directa') {
      console.warn('[live] tokens efímeros no disponibles; se usa la clave directa.');
    }

    this.client = new GoogleGenAI({
      apiKey: datos.token,
      httpOptions: datos.modo === 'efimero' ? { apiVersion: 'v1alpha' } : undefined,
    });

    await fetch('/api/llamada/iniciar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId: this.callId, pacienteId: this.paciente?.paciente_id }),
    });

    this.ev.estado('Conectando con el agente…');
    this.session = await this.client.live.connect({
      model: datos.modelo,
      config: this.configuracion(),
      callbacks: {
        onopen: () => {
          this.viva = true;
          this.ev.conectado(true);
          this.ev.estado('Conectado. Active el micrófono para hablar.');
        },
        onmessage: (m) => void this.alRecibir(m),
        onerror: (e: any) => {
          console.error('[live] error', e);
          this.alMorir();
          this.ev.estado(`Error de conexión: ${e?.message ?? 'desconocido'}`, 'error');
        },
        onclose: (e: any) => {
          this.alMorir();
          const codigo = e?.code ?? '—';
          // 1000 es un cierre limpio (colgamos nosotros); cualquier otro es caída.
          if (codigo === 1000) {
            this.ev.estado('Llamada finalizada.');
          } else {
            this.ev.estado(
              `Se cayó la conexión con el agente (${codigo}). Pulse «Iniciar llamada» para retomar.`,
              'error',
            );
          }
        },
      },
    });
  }

  private configuracion() {
    return {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        languageCode: 'es-US',
        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Leda' } },
      },
      // Las transcripciones alimentan el resumen estructurado y el acta de la
      // llamada; sin ellas el resumen sería una reconstrucción, no un registro.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Una llamada de seguimiento puede pasar los minutos de contexto nativo.
      contextWindowCompression: { slidingWindow: {} },
      systemInstruction: {
        parts: [{ text: construirPrompt(this.paciente, this.diaPostop) }],
      },
      tools: [{ functionDeclarations: this.herramientas() }],
    } as any;
  }

  private herramientas() {
    const propiedadesSlots: Record<string, unknown> = {};
    for (const s of CATALOGO_SLOTS) {
      propiedadesSlots[s.clave] =
        s.clave === 'dolor_nrs'
          ? { type: Type.INTEGER, description: 'Dolor 0–10 declarado por el paciente.' }
          : s.clave === 'fiebre_c'
            ? { type: Type.NUMBER, description: 'Temperatura en °C medida con termómetro.' }
            : { type: Type.STRING, enum: s.valores, description: s.etiqueta };
    }

    return [
      {
        name: 'registrar_sintoma',
        description:
          'Registra lo que el paciente acaba de reportar sobre su estado. Llámala en cada turno donde aprendas algo nuevo. Envía únicamente valores que el paciente haya dicho.',
        parameters: { type: Type.OBJECT, properties: propiedadesSlots },
      },
      {
        name: 'consultar_conocimiento_clinico',
        // Asíncrona: el modelo sigue conversando mientras el backend recupera y
        // razona, en vez de dejar un silencio de ~1 s en plena llamada.
        // El `behavior` sale de NO_BLOQUEANTES para que no pueda divergir de la
        // respuesta que se envía en `despachar`.
        behavior: NO_BLOQUEANTES.has('consultar_conocimiento_clinico')
          ? Behavior.NON_BLOCKING
          : undefined,
        description:
          'Consulta la base de conocimiento clínico para responder una duda del paciente o para orientar sobre un síntoma. Devuelve el campo `decir`, que debes pronunciar tal cual.',
        parameters: {
          type: Type.OBJECT,
          required: ['pregunta'],
          properties: {
            pregunta: {
              type: Type.STRING,
              description:
                'La duda o el síntoma, redactado de forma completa e independiente del contexto. Ej: "dolor en el hombro derecho tres días después de una colecistectomía laparoscópica".',
            },
          },
        },
      },
      {
        name: 'navegar_interfaz',
        description:
          'Cambia la vista que el equipo clínico ve en pantalla, para que acompañe la fase de la conversación.',
        parameters: {
          type: Type.OBJECT,
          required: ['vista'],
          properties: {
            vista: {
              type: Type.STRING,
              enum: ['llamada', 'evidencia', 'triaje', 'resumen'],
              description:
                'llamada: sondeo de síntomas · evidencia: fuentes citadas · triaje: signos de alarma · resumen: cierre.',
            },
          },
        },
      },
      {
        name: 'finalizar_llamada',
        description:
          'Cierra la llamada y genera el resumen estructurado. Úsala sólo tras despedirte y comunicar el siguiente paso.',
        parameters: { type: Type.OBJECT, properties: {} },
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Mensajes del servidor
  // -------------------------------------------------------------------------

  private async alRecibir(m: LiveServerMessage): Promise<void> {
    // Debe evaluarse ANTES de despachar: si en el mismo mensaje llega una
    // cancelación, la respuesta correspondiente ya no debe salir.
    const cancelacion = (m as any).toolCallCancellation?.ids as string[] | undefined;
    if (cancelacion?.length) {
      for (const id of cancelacion) this.cancelados.add(id);
    }

    if (m.toolCall?.functionCalls?.length) {
      for (const fc of m.toolCall.functionCalls) void this.despachar(fc);
    }

    const sc = m.serverContent;

    if (sc?.inputTranscription?.text) {
      const t = sc.inputTranscription.text;
      this.ev.transcripcion('paciente', t);
      void this.enviarTurno('paciente', t);
    }
    if (sc?.outputTranscription?.text) {
      const t = sc.outputTranscription.text;
      this.ev.transcripcion('agente', t);
      void this.enviarTurno('agente', t);
    }

    const audio = sc?.modelTurn?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (audio?.data) {
      // Primer audio del turno: cierra la medición de latencia.
      if (this.latenciaPendiente && this.tFinHabla !== null) {
        const latencia = Math.round(performance.now() - this.tFinHabla);
        this.latenciaPendiente = false;
        this.ev.metricas(latencia);
        void this.enviarTurno(null, null, latencia);
      }
      this.ev.hablando('agente');
      await this.reproducir(audio.data);
    }

    if (sc?.interrupted) this.detenerReproduccion();
    if (sc?.turnComplete) this.ev.hablando('nadie');

    if (m.usageMetadata) {
      const entrada = m.usageMetadata.promptTokenCount ?? 0;
      const salida = m.usageMetadata.responseTokenCount ?? 0;
      if (entrada || salida) void this.enviarTurno(null, null, undefined, entrada, salida);
    }
  }

  private async despachar(fc: { id?: string; name?: string; args?: any }): Promise<void> {
    let respuesta: Record<string, unknown> = { ok: true };
    let scheduling: FunctionResponseScheduling | undefined;

    try {
      switch (fc.name) {
        case 'registrar_sintoma': {
          const r = await this.postJson('/api/llamada/slots', {
            callId: this.callId,
            slots: fc.args ?? {},
          });
          this.slots = r.slots;
          this.ev.slots(r.slots);
          this.ev.triaje(r.triaje);
          if (r.triaje.nivel !== 'verde') this.ev.navegar('triaje');

          const faltan: string[] = r.triaje.slotsFaltantes ?? [];
          respuesta = {
            ok: true,
            casillas_faltantes: faltan,
            siguiente_pregunta_sugerida: faltan.length
              ? (CATALOGO_SLOTS.find((s) => s.clave === faltan[0])?.pregunta ?? null)
              : null,
            nota: faltan.length
              ? 'Faltan casillas núcleo: sigue indagando antes de cerrar.'
              : 'Casillas núcleo completas.',
          };
          break;
        }

        case 'consultar_conocimiento_clinico': {
          const r: ConsultaResponse = await this.postJson('/api/consulta', {
            callId: this.callId,
            pregunta: String(fc.args?.pregunta ?? ''),
            slots: this.slots,
          });

          this.ev.citas(r.citas);
          this.ev.triaje(r.triaje);
          this.ev.navegar(r.triaje.nivel === 'verde' ? 'evidencia' : 'triaje');

          respuesta = {
            decir: r.respuestaHablada,
            instruccion: 'Pronuncia el campo `decir` tal cual. No agregues información clínica propia.',
            fundamentada: !r.fueraDeCorpus,
            fuentes: r.citas.map((c) => `${c.documento} (p. ${c.pagina})`),
            nivel: r.triaje.nivel,
          };
          // Interrumpe el relleno conversacional para entregar ya la respuesta.
          scheduling = FunctionResponseScheduling.INTERRUPT;
          break;
        }

        case 'navegar_interfaz': {
          const vista = String(fc.args?.vista ?? 'llamada') as VistaUi;
          this.ev.navegar(vista);
          respuesta = { ok: true, vista };
          break;
        }

        case 'finalizar_llamada': {
          const resumen: ResumenLlamada = await this.postJson('/api/llamada/cerrar', {
            callId: this.callId,
          });
          this.ev.resumen(resumen);
          this.ev.navegar('resumen');
          respuesta = {
            ok: true,
            nivel: resumen.nivelFinal,
            decision: resumen.decision,
            proximos_pasos: resumen.proximosPasos,
          };
          break;
        }

        default:
          respuesta = { error: `Herramienta desconocida: ${fc.name}` };
      }
    } catch (e) {
      const detalle = e instanceof Error ? e.message : String(e);
      console.error(`[herramienta ${fc.name}]`, detalle);
      respuesta = {
        error: detalle,
        decir:
          'Perdóneme, tuve un inconveniente técnico para verificar eso. Prefiero que lo revise una enfermera.',
      };
      // Ojo: no se fija `scheduling` aquí. Este catch cubre las cuatro
      // herramientas y tres de ellas son bloqueantes; el filtro de abajo es el
      // que decide si el campo puede viajar.
    }

    // `scheduling` sólo viaja en respuestas de herramientas no bloqueantes.
    const puedeAgendar = Boolean(fc.name && NO_BLOQUEANTES.has(fc.name));
    const agendado = puedeAgendar && scheduling ? { scheduling } : {};

    if (!this.viva) return; // la sesión ya murió: enviar aquí sólo genera ruido

    // El servidor descartó esta llamada (típicamente el paciente interrumpió
    // mientras se consultaba el corpus). Responderla cerraría la sesión.
    if (fc.id && this.cancelados.has(fc.id)) {
      this.cancelados.delete(fc.id);
      return;
    }

    try {
      this.session?.sendToolResponse({
        functionResponses: [
          { id: fc.id, name: fc.name, response: respuesta, ...agendado } as any,
        ],
      });
    } catch (e) {
      console.warn(`[herramienta ${fc.name}] no se pudo entregar la respuesta:`, e);
    }
  }

  // -------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------

  async iniciarMicrofono(): Promise<void> {
    if (this.grabando) return;
    await this.ctxEntrada.resume();
    await this.ctxSalida.resume();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    this.fuente = this.ctxEntrada.createMediaStreamSource(this.stream);
    this.fuente.connect(this.nodoEntrada);
    this.procesador = this.ctxEntrada.createScriptProcessor(2048, 1, 1);

    this.procesador.onaudioprocess = (e) => {
      if (!this.grabando || !this.viva) return;
      const pcm = e.inputBuffer.getChannelData(0);
      this.detectarVoz(pcm);
      try {
        this.session?.sendRealtimeInput({ media: createBlob(pcm) });
      } catch (err) {
        // El socket se cayó entre el guard y el envío: se corta el micrófono en
        // vez de repetir el fallo 23 veces por segundo.
        this.viva = false;
        console.warn('[live] envío de audio abortado, la sesión ya no está viva:', err);
        this.detenerMicrofono();
      }
    };

    this.fuente.connect(this.procesador);
    this.procesador.connect(this.ctxEntrada.destination);
    this.grabando = true;
    this.ev.estado('🔴 Micrófono abierto — hable con normalidad.');
  }

  /**
   * Detector de voz local por energía RMS.
   *
   * Existe sólo para medir la latencia que exige la rúbrica: "desde que el
   * paciente termina de hablar hasta que empieza a sonar el audio del agente".
   * El corte de turno real lo decide el VAD del servidor; este detector no
   * interviene en la conversación, únicamente marca el instante t0.
   */
  private detectarVoz(pcm: Float32Array): void {
    let suma = 0;
    for (let i = 0; i < pcm.length; i++) suma += pcm[i] * pcm[i];
    const rms = Math.sqrt(suma / pcm.length);
    const ahora = performance.now();

    if (rms > UMBRAL_VOZ) {
      if (!this.hablandoPaciente) {
        this.hablandoPaciente = true;
        this.ev.hablando('paciente');
      }
      this.ultimaVozTs = ahora;
      this.tFinHabla = null;
      return;
    }

    if (this.hablandoPaciente && ahora - this.ultimaVozTs > SILENCIO_MS) {
      this.hablandoPaciente = false;
      // t0 = el instante en que dejó de haber voz, no el momento en que lo detectamos.
      this.tFinHabla = this.ultimaVozTs;
      this.latenciaPendiente = true;
      this.ev.hablando('nadie');
    }
  }

  private async reproducir(base64: string): Promise<void> {
    this.siguienteInicio = Math.max(this.siguienteInicio, this.ctxSalida.currentTime);
    const buffer = await decodeAudioData(decode(base64), this.ctxSalida, MUESTREO_SALIDA, 1);
    const fuente = this.ctxSalida.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(this.nodoSalida);
    fuente.addEventListener('ended', () => this.reproduciendo.delete(fuente));
    fuente.start(this.siguienteInicio);
    this.siguienteInicio += buffer.duration;
    this.reproduciendo.add(fuente);
  }

  private detenerReproduccion(): void {
    for (const f of this.reproduciendo) {
      try {
        f.stop();
      } catch {
        /* ya terminó */
      }
      this.reproduciendo.delete(f);
    }
    this.siguienteInicio = 0;
  }

  /**
   * La sesión dejó de estar viva (cierre limpio, caída o error). Corta el
   * micrófono para que no siga empujando audio a un socket muerto, que es lo
   * que producía la cascada de "WebSocket is already in CLOSING or CLOSED".
   */
  private alMorir(): void {
    this.viva = false;
    this.ev.conectado(false);
    if (this.grabando) this.detenerMicrofono();
    this.detenerReproduccion();
  }

  detenerMicrofono(): void {
    this.grabando = false;
    this.procesador?.disconnect();
    this.fuente?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.procesador = null;
    this.fuente = null;
    this.stream = null;
    this.ev.hablando('nadie');
    this.ev.estado('Micrófono cerrado.');
  }

  async colgar(): Promise<ResumenLlamada | null> {
    this.detenerMicrofono();
    this.detenerReproduccion();
    try {
      return await this.postJson('/api/llamada/cerrar', { callId: this.callId });
    } catch {
      return null;
    } finally {
      this.session?.close();
      this.session = null;
      this.ev.conectado(false);
    }
  }

  // -------------------------------------------------------------------------

  private async postJson(url: string, cuerpo: unknown): Promise<any> {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const datos = await r.json();
    if (!r.ok) throw new Error(datos?.error ?? `HTTP ${r.status}`);
    return datos;
  }

  private async enviarTurno(
    hablante: 'agente' | 'paciente' | null,
    texto: string | null,
    latenciaMs?: number,
    tokensEntrada?: number,
    tokensSalida?: number,
  ): Promise<void> {
    try {
      await this.postJson('/api/llamada/turno', {
        callId: this.callId,
        hablante,
        texto,
        latenciaMs,
        tokensEntrada,
        tokensSalida,
      });
    } catch {
      /* la telemetría nunca debe tumbar la llamada */
    }
  }
}
