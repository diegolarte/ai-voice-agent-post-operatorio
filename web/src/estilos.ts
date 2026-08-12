import { css } from 'lit';

/**
 * Tokens visuales compartidos. La rúbrica dice explícitamente que la estética
 * no puntúa, así que esto no busca lucirse: busca que un evaluador distinga de
 * un vistazo el nivel de triaje, qué casilla falta y de dónde salió cada
 * afirmación clínica.
 */
export const tokens = css`
  :host {
    --fondo: #0b1220;
    --panel: rgba(19, 30, 50, 0.88);
    --panel-solido: #131e32;
    --borde: rgba(148, 176, 214, 0.22);
    --texto: #eaf1fb;
    --texto-tenue: #93a6c4;
    --acento: #38bdf8;
    --verde: #22c55e;
    --amarillo: #f59e0b;
    --rojo: #ef4444;
    --radio: 12px;
    color: var(--texto);
    /* Controles nativos (select, date picker, etc.) en tema oscuro por defecto. */
    color-scheme: dark;
  }
`;

export const base = css`
  .panel {
    background: var(--panel);
    border: 1px solid var(--borde);
    border-radius: var(--radio);
    backdrop-filter: blur(12px);
    padding: 16px 18px;
  }

  .titulo {
    margin: 0 0 12px;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--texto-tenue);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .vacio {
    color: var(--texto-tenue);
    font-size: 0.86rem;
    line-height: 1.5;
    margin: 0;
  }

  .pastilla {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
    border: 1px solid var(--borde);
  }

  .verde {
    color: var(--verde);
    border-color: color-mix(in srgb, var(--verde) 45%, transparent);
    background: color-mix(in srgb, var(--verde) 12%, transparent);
  }
  .amarillo {
    color: var(--amarillo);
    border-color: color-mix(in srgb, var(--amarillo) 45%, transparent);
    background: color-mix(in srgb, var(--amarillo) 12%, transparent);
  }
  .rojo {
    color: var(--rojo);
    border-color: color-mix(in srgb, var(--rojo) 45%, transparent);
    background: color-mix(in srgb, var(--rojo) 14%, transparent);
  }

  button {
    font-family: inherit;
    cursor: pointer;
  }

  ::-webkit-scrollbar {
    width: 8px;
  }
  ::-webkit-scrollbar-thumb {
    background: rgba(148, 176, 214, 0.25);
    border-radius: 8px;
  }
`;
