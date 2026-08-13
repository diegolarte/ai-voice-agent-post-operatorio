# Diagramas

Estos SVG **no se editan a mano**. Son el render de los bloques `mermaid` de
[`../ARQUITECTURA.md`](../ARQUITECTURA.md), que es la fuente de verdad del
entregable 02.

| Imagen | Diagrama |
|---|---|
| `01-arquitectura.svg` | Arquitectura de la solución |
| `02-flujo-decision.svg` | Flujo de decisión del agente |
| `03-conocimiento-vivo.svg` | Conocimiento vivo (compuerta G5) |

## Por qué existen si el Markdown ya renderiza mermaid

GitHub renderiza los bloques `mermaid` de `ARQUITECTURA.md` de forma nativa, y
ahí siguen siendo la referencia. Estos SVG son para que el **informe final** sea
autocontenido: se ve igual fuera de GitHub —exportado a PDF, abierto en otro
visor de Markdown, o pegado en una presentación— donde mermaid no se renderiza.

## Cómo regenerarlos

Se rinden con mermaid en un navegador y se guardan con fondo opaco (`#0b1220`)
para que el texto claro de los `classDef` siga siendo legible sobre cualquier
fondo. El tema es `dark`, que es el que corresponde a esos `classDef`.

Mermaid **no es dependencia del proyecto** a propósito: sólo hace falta para
regenerar imágenes, y añadirlo encarecería `npm install` sin aportar nada al
funcionamiento del agente, justo en la compuerta de arranque de 15 minutos.

Si cambias un diagrama en `ARQUITECTURA.md`, regenera el SVG correspondiente
para que no se desincronicen.
