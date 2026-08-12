import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { base, tokens } from '../estilos.ts';
import type { KnowledgeDocument } from '../../../shared/types.ts';

/**
 * Consola de administración del conocimiento (compuerta G5).
 *
 * Contrato funcional exigido por el reto: subir · listar · eliminar · indicar
 * visiblemente "procesado y disponible". El indicador de estado no es
 * decorativo: mientras dice "procesando" el documento todavía no está en el
 * índice, y el jurado necesita saber cuándo puede preguntarle al agente.
 */
@customElement('consola-conocimiento')
export class ConsolaConocimiento extends LitElement {
  @state() private documentos: KnowledgeDocument[] = [];
  @state() private estadisticas: { documentos: number; fragmentos: number } | null = null;
  @state() private subiendo = false;
  @state() private progreso = '';
  @state() private error = '';
  @state() private filtro = '';

  static styles = [
    tokens,
    base,
    css`
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
        padding: 24px 28px;
        box-sizing: border-box;
      }
      header {
        margin-bottom: 20px;
      }
      h1 {
        margin: 0 0 4px;
        font-size: 1.35rem;
      }
      .sub {
        color: var(--texto-tenue);
        font-size: 0.85rem;
      }
      .zona {
        border: 2px dashed var(--borde);
        border-radius: 12px;
        padding: 26px;
        text-align: center;
        margin-bottom: 18px;
        transition: border-color 0.2s ease, background 0.2s ease;
      }
      .zona.encima {
        border-color: var(--acento);
        background: rgba(56, 189, 248, 0.07);
      }
      .zona p {
        margin: 0 0 12px;
        color: var(--texto-tenue);
        font-size: 0.88rem;
      }
      .boton {
        background: var(--acento);
        color: #08131f;
        border: none;
        border-radius: 8px;
        padding: 9px 18px;
        font-weight: 600;
        font-size: 0.86rem;
      }
      .boton[disabled] {
        opacity: 0.5;
        cursor: default;
      }
      input[type='file'] {
        display: none;
      }
      .buscador {
        width: 100%;
        box-sizing: border-box;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid var(--borde);
        border-radius: 8px;
        padding: 9px 12px;
        color: var(--texto);
        font-family: inherit;
        font-size: 0.85rem;
        margin-bottom: 12px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.83rem;
      }
      th {
        text-align: left;
        color: var(--texto-tenue);
        font-size: 0.68rem;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        padding: 8px 10px;
        border-bottom: 1px solid var(--borde);
      }
      td {
        padding: 9px 10px;
        border-bottom: 1px solid rgba(148, 176, 214, 0.1);
        vertical-align: middle;
      }
      tr.nuevo {
        animation: entrar 1.6s ease;
      }
      @keyframes entrar {
        from {
          background: rgba(56, 189, 248, 0.22);
        }
      }
      .titulo-doc {
        font-weight: 500;
        line-height: 1.35;
      }
      .archivo {
        color: var(--texto-tenue);
        font-size: 0.72rem;
      }
      .eliminar {
        background: none;
        border: 1px solid color-mix(in srgb, var(--rojo) 45%, transparent);
        color: var(--rojo);
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 0.74rem;
      }
      .aviso {
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 0.83rem;
        margin-bottom: 12px;
      }
      .aviso.error {
        background: color-mix(in srgb, var(--rojo) 14%, transparent);
        color: var(--rojo);
      }
      .aviso.info {
        background: rgba(56, 189, 248, 0.12);
        color: var(--acento);
      }
      .resumen {
        display: flex;
        gap: 18px;
        margin-bottom: 14px;
        font-size: 0.8rem;
        color: var(--texto-tenue);
      }
      .resumen b {
        color: var(--texto);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  private recienAgregado: string | null = null;

  connectedCallback() {
    super.connectedCallback();
    void this.cargar();
  }

  private async cargar() {
    try {
      const r = await fetch('/api/documentos');
      const d = await r.json();
      this.documentos = d.documentos ?? [];
      this.estadisticas = d.estadisticas ?? null;
    } catch (e) {
      this.error = `No se pudo cargar el índice: ${e instanceof Error ? e.message : e}`;
    }
  }

  private async subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    this.error = '';

    for (const archivo of Array.from(archivos)) {
      this.subiendo = true;
      this.progreso = `Procesando «${archivo.name}» — extrayendo texto y vectorizando…`;

      const cuerpo = new FormData();
      cuerpo.append('archivo', archivo);
      cuerpo.append('escenario', 'Cargado desde consola');

      try {
        const r = await fetch('/api/documentos', { method: 'POST', body: cuerpo });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);

        this.recienAgregado = d.documento.id;
        this.progreso = `«${d.documento.titulo}» disponible: ${d.documento.fragmentos} fragmentos en ${d.ms} ms. El agente ya lo puede citar.`;
        await this.cargar();
      } catch (e) {
        this.error = `«${archivo.name}»: ${e instanceof Error ? e.message : e}`;
        this.progreso = '';
      } finally {
        this.subiendo = false;
      }
    }
  }

  private async eliminar(doc: KnowledgeDocument) {
    if (!confirm(`¿Eliminar «${doc.titulo}»?\n\nEl agente dejará de poder citarlo de inmediato.`)) {
      return;
    }
    try {
      const r = await fetch(`/api/documentos/${doc.id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error);
      this.progreso = `«${doc.titulo}» eliminado. El agente lo olvidó.`;
      await this.cargar();
    } catch (e) {
      this.error = `No se pudo eliminar: ${e instanceof Error ? e.message : e}`;
    }
  }

  render() {
    const filtro = this.filtro.trim().toLowerCase();
    const visibles = filtro
      ? this.documentos.filter(
          (d) =>
            d.titulo.toLowerCase().includes(filtro) || d.escenario.toLowerCase().includes(filtro),
        )
      : this.documentos;

    return html`
      <header>
        <h1>Consola de conocimiento clínico</h1>
        <div class="sub">
          Lo que subas aquí queda disponible para el agente de inmediato; lo que elimines, lo
          olvida al instante. Se aceptan PDF, TXT y MD.
        </div>
      </header>

      ${this.error ? html`<div class="aviso error">${this.error}</div>` : ''}
      ${this.progreso ? html`<div class="aviso info">${this.progreso}</div>` : ''}

      <div
        class="zona"
        @dragover=${(e: DragEvent) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.add('encima');
        }}
        @dragleave=${(e: DragEvent) =>
          (e.currentTarget as HTMLElement).classList.remove('encima')}
        @drop=${(e: DragEvent) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).classList.remove('encima');
          void this.subir(e.dataTransfer?.files ?? null);
        }}
      >
        <p>Arrastra documentos aquí, o</p>
        <button
          class="boton"
          ?disabled=${this.subiendo}
          @click=${() => this.renderRoot.querySelector<HTMLInputElement>('#archivo')?.click()}
        >
          ${this.subiendo ? 'Procesando…' : 'Seleccionar archivos'}
        </button>
        <input
          id="archivo"
          type="file"
          multiple
          accept=".pdf,.txt,.md"
          @change=${(e: Event) => void this.subir((e.target as HTMLInputElement).files)}
        />
      </div>

      ${this.estadisticas
        ? html`<div class="resumen">
            <span><b>${this.estadisticas.documentos}</b> documentos</span>
            <span><b>${this.estadisticas.fragmentos.toLocaleString('es')}</b> fragmentos indexados</span>
          </div>`
        : ''}

      <input
        class="buscador"
        type="search"
        placeholder="Filtrar por título o escenario…"
        .value=${this.filtro}
        @input=${(e: Event) => (this.filtro = (e.target as HTMLInputElement).value)}
      />

      <table>
        <thead>
          <tr>
            <th>Documento</th>
            <th>Escenario</th>
            <th>Frag.</th>
            <th>Estado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${visibles.map(
            (d) => html`
              <tr class=${d.id === this.recienAgregado ? 'nuevo' : ''}>
                <td>
                  <div class="titulo-doc">${d.titulo}</div>
                  <div class="archivo">
                    ${d.archivo} · ${d.paginas} pág · ${(d.bytes / 1024).toFixed(0)} KB
                    ${d.origen === 'consola' ? ' · subido en caliente' : ''}
                  </div>
                </td>
                <td>${d.escenario}</td>
                <td>${d.fragmentos}</td>
                <td>
                  <span class="pastilla ${d.estado === 'disponible' ? 'verde' : 'amarillo'}">
                    ${d.estado === 'disponible' ? 'procesado y disponible' : d.estado}
                  </span>
                </td>
                <td>
                  <button class="eliminar" @click=${() => this.eliminar(d)}>Eliminar</button>
                </td>
              </tr>
            `,
          )}
          ${visibles.length === 0
            ? html`<tr>
                <td colspan="5" style="color:var(--texto-tenue);padding:18px 10px">
                  ${this.documentos.length
                    ? 'Ningún documento coincide con el filtro.'
                    : 'El índice está vacío. Ejecuta `npm run ingest` o sube un documento.'}
                </td>
              </tr>`
            : ''}
        </tbody>
      </table>
    `;
  }
}
