# Arquitectura y flujo de decisión — Centinela

Entregable 02. Este documento tiene dos diagramas: **cómo está construida la
solución** y **cómo decide el agente si escala o no**.

> El jurado toma elementos del diagrama al azar y los busca en el código. Cada
> caja de abajo lleva la ruta del archivo que la implementa.

---

## 1. Arquitectura de la solución

```mermaid
flowchart TB
    subgraph NAV["🖥️ Navegador — web/"]
        UI["Interfaz de llamada<br/><code>web/src/app.ts</code>"]
        CONS["Consola de conocimiento<br/><code>web/src/views/consola.ts</code>"]
        LIVE["Cliente Live + herramientas<br/><code>web/src/live/session.ts</code>"]
        VAD["Detector de voz local<br/>(sólo para medir latencia)<br/><code>session.ts › detectarVoz</code>"]
        MIC(["🎤 Micrófono"]) --> LIVE
        LIVE --> ALT(["🔊 Altavoz"])
        UI --- LIVE
        LIVE --- VAD
    end

    subgraph GOOGLE["☁️ Google AI Studio — nivel gratuito"]
        GLIVE["<b>gemini-2.5-flash-native-audio</b><br/>voz ↔ voz, español<br/><i>conversa; no afirma clínica</i>"]
        GFLASH["<b>gemini-2.5-flash-lite</b><br/>razonador clínico<br/><i>salida JSON estructurada</i>"]
    end

    subgraph API["⚙️ Backend Node — server/"]
        REST["API REST<br/><code>server/index.ts</code>"]
        TOK["Token efímero<br/><code>POST /api/live-token</code>"]
        EMB["<b>BGE-M3</b> local, ONNX<br/>1024 dim · sin API ni cuota<br/><code>server/rag/embeddings.ts</code>"]
        ING["Ingesta: PDF → fragmentos<br/><code>server/rag/ingest.ts</code>"]
        STORE["Índice vectorial en memoria<br/>coseno por fuerza bruta<br/><code>server/rag/store.ts</code>"]
        REAS["Razonador fundamentado<br/><code>server/clinical/reasoner.ts</code>"]
        RULES["Motor determinista<br/>23 reglas de alarma<br/><code>server/clinical/redflags.ts</code>"]
        FUSE["Fusión asimétrica max()<br/><code>server/clinical/triage.ts</code>"]
        CALLS["Acta y alertas<br/><code>server/calls/store.ts</code>"]
        MET["Métricas P50/P95, tokens, costo<br/><code>server/metrics/recorder.ts</code>"]
    end

    subgraph DISCO["💾 Disco"]
        IDX[("data/index/<br/>vectors.bin · chunks.json")]
        LOGS[("logs/<br/>metricas.jsonl · alertas.jsonl<br/>llamadas/*.json")]
    end

    LIVE <-->|"WebSocket audio PCM"| GLIVE
    LIVE -->|"token efímero"| TOK
    LIVE -->|"herramientas"| REST
    CONS -->|"subir / eliminar"| REST

    REST --> ING --> EMB
    ING --> STORE --> IDX
    REST --> STORE
    REST --> REAS --> GFLASH
    REAS --> FUSE
    RULES --> FUSE
    FUSE --> CALLS --> LOGS
    REST --> MET --> LOGS

    classDef modelo fill:#1e3a5f,stroke:#38bdf8,color:#eaf1fb
    classDef regla fill:#3f2d10,stroke:#f59e0b,color:#fde68a
    classDef local fill:#1e3f2a,stroke:#22c55e,color:#bbf7d0
    class GLIVE,GFLASH modelo
    class RULES,FUSE regla
    class EMB local
```

### La decisión estructural: dos modelos, dos responsabilidades

El modelo de voz **nunca afirma contenido clínico**. Conversa, interpreta
regionalismos, maneja interrupciones y llena casillas — pero todo lo que suene a
medicina entra por la herramienta `consultar_conocimiento_clinico`, que devuelve
un campo `decir` ya fundamentado en el corpus. El prompt le ordena pronunciarlo
literalmente.

Esto convierte "cero alucinaciones" de una súplica al modelo en una propiedad
de la arquitectura: si el corpus no sustenta la respuesta, no hay texto que
pronunciar, y el agente declara el límite.

---

## 2. Flujo de decisión del agente

```mermaid
flowchart TD
    A["Paciente habla"] --> B["Live API transcribe<br/>y decide el turno"]
    B --> C{"¿Aporta estado clínico<br/>o pregunta algo?"}

    C -->|"reporta síntoma"| D["<code>registrar_sintoma</code>"]
    C -->|"pregunta clínica"| E["<code>consultar_conocimiento_clinico</code><br/><i>NON_BLOCKING</i>"]
    C -->|"fuera de guion"| F["Redirige en una frase<br/>y vuelve al sondeo"] --> A

    D --> G["<code>sanearSlots()</code><br/>descarta claves y rangos inválidos"]
    G --> RULES

    E --> E1["El agente dice un relleno:<br/><i>«permítame que reviso»</i>"]
    E --> H["Embedding local de la consulta<br/>BGE-M3, 1024 dim"]
    H --> I["Búsqueda coseno<br/>top-6, score ≥ 0.71<br/>máx. 2 fragmentos por documento"]
    I --> J{"¿Hay fragmentos<br/>por encima del umbral?"}
    J -->|no| K["<b>fuera_de_corpus</b><br/>declara el límite y ofrece escalar"]
    J -->|sí| L["Razonador: respuesta hablada<br/>+ IDs de fragmentos usados<br/>+ nivel propuesto"]
    L --> M{"¿Citó fragmentos<br/>realmente recuperados?"}
    M -->|no| K
    M -->|sí| N["Cita verificada<br/>documento + página"]

    RULES["<b>Motor determinista</b><br/>23 reglas sobre las casillas"] --> O
    L --> O
    K --> O

    O{"<b>Fusión asimétrica</b><br/>nivel = max(reglas, razonador)"}
    O -->|rojo| P["🔴 Alerta persistida<br/>+ acudir hoy / línea 123"]
    O -->|amarillo| Q["🟡 Registro para el equipo<br/>+ señales de reconsulta"]
    O -->|verde| R{"¿Faltan casillas<br/>núcleo?"}

    R -->|sí| S["<b>requiereIndagar</b><br/>no cierra: sigue preguntando"] --> A
    R -->|no| T["🟢 Sin escalamiento"]

    P --> U["<code>finalizar_llamada</code><br/>acta estructurada + métricas"]
    Q --> U
    T --> U

    classDef rojo fill:#3f1414,stroke:#ef4444,color:#fecaca
    classDef amar fill:#3f2d10,stroke:#f59e0b,color:#fde68a
    classDef verde fill:#12351f,stroke:#22c55e,color:#bbf7d0
    class P,K rojo
    class Q,S,O amar
    class T verde
```

### Por qué `max()` y no un promedio

La rúbrica declara que el falso negativo —no alertar cuando había que
alertar— es la falla catastrófica. Con `max()`, basta con que **una** de las
dos vías detecte riesgo para que la llamada escale. El modelo puede fallar; las
reglas siguen ahí. Las reglas pueden no cubrir un caso; el razonador con
contexto clínico sí.

Medido contra el ground truth del reto (`npm run eval`, 160 casos):

| | Resultado |
|---|---|
| Falsos negativos | **0 de 160** |
| Recall en `rojo` | **100 %** (12/12) |
| Recall en `amarillo` | **100 %** (25/25) |
| Verdes escalados de más | 17.9 % (22/123) — el costo aceptado |

Ese 17.9 % es el precio explícito de la asimetría: 22 pacientes sanos que una
enfermera revisa de más, a cambio de no perder ninguno de los 37 que sí
necesitaban atención.

### Qué mide exactamente el `requiereIndagar`

Un "verde" con casillas núcleo vacías no es un verde: es una decisión tomada
sin información. Las seis casillas núcleo son dolor, temperatura (o fiebre
referida, porque el paciente puede no tener termómetro), herida, movilidad,
náuseas/vómito y respiración. Mientras falte una, el agente no puede cerrar la
llamada como evolución esperada.

---

## 3. Conocimiento vivo (compuerta G5)

```mermaid
sequenceDiagram
    participant J as Jurado
    participant C as Consola
    participant S as Backend
    participant E as BGE-M3 (local)
    participant I as Índice
    participant A as Agente de voz

    J->>C: sube documento.pdf
    C->>S: POST /api/documentos
    S->>S: extraer texto por página
    S->>S: trocear (1100 car., solape 180)
    S->>E: vectorizar fragmentos (sin red)
    E-->>S: vectores 1024 dim
    S->>I: agregar() + persistir atómico
    S-->>C: "procesado y disponible · N fragmentos · M ms"
    Note over J,A: sin reiniciar nada
    J->>A: pregunta por el contenido nuevo
    A->>I: búsqueda coseno
    I-->>A: fragmento + documento + página
    A-->>J: responde citando la fuente

    J->>C: eliminar documento
    C->>S: DELETE /api/documentos/:id
    S->>I: eliminar() + reescritura del índice
    J->>A: vuelve a preguntar lo mismo
    A-->>J: "no tengo información sobre eso"
```

El identificador del documento deriva del SHA-256 de su contenido, así que
volver a subir el mismo archivo lo actualiza en vez de duplicarlo. La escritura
del índice es atómica (`.tmp` + `rename`): un corte a mitad de guardado no deja
el agente mudo.

---

## 4. Decisiones que se descartaron

| Alternativa | Por qué se descartó |
|---|---|
| **ChromaDB** | Exige un servicio aparte o binario nativo. Con ~6.3k fragmentos el coseno por fuerza bruta tarda milisegundos en Node: la base vectorial habría añadido una clase entera de fallos de arranque a cambio de nada, justo en la compuerta de 15 minutos. |
| **`gemini-embedding-001` por API** (descartado ya en desarrollo) | Fue la primera elección — evitaba una descarga de modelo al arranque. Se abandonó al chocar con `EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier`: 1.000 peticiones/día en el nivel gratuito, y una llamada de N textos consume N peticiones. Con ~6.300 fragmentos, ingerir el corpus agotaba la cuota del día antes de terminar — y peor, arriesgaba que la compuerta G5 fallara en plena evaluación si el jurado sube un documento de prueba con la cuota diaria ya en cero. BGE-M3 local elimina esa clase de fallo: no hay límite que agotar. |
| **STT → LLM → TTS en cascada** (Whisper + Llama + Piper) | Tres saltos de red y ~2.5 s de latencia por turno. La voz nativa mantiene prosodia, maneja interrupciones y responde en una fracción de eso. |

### Por qué BGE-M3 sí resultó viable, y la corrección que valió la pena hacer

La primera estimación de este documento decía "~2 GB de descarga, incompatible con
15 minutos" y por eso se descartó BGE-M3 en el diseño inicial. Esa cifra era la del
modelo en precisión completa. La versión que realmente se usa en producción con
`transformers.js` es la **cuantizada (`dtype: 'q8'`)**: **544 MB**, medidos, no
estimados. Descarga y carga en **32 segundos** en una conexión normal, y vectoriza
a ~105 ms por fragmento — el corpus completo tarda **~11 minutos**, sin red después
de la primera descarga y sin límite que agotar. La descarga ocurre una sola vez, al
primer arranque del servidor, antes de abrir el puerto (`server/index.ts`), así que
queda dentro de la ventana que mide la compuerta G2 y no interrumpe ninguna llamada.
| **Un solo modelo que conversa y razona** | El modelo de audio nativo es rápido pero pequeño; dejarle la afirmación clínica reintroduce el riesgo de alucinación que todo el diseño busca eliminar. |
| **Clave de API en el navegador** | Funciona, pero expone la credencial a cualquiera que abra las herramientas de desarrollo. Se emite un token efímero de 30 min desde el backend. |
