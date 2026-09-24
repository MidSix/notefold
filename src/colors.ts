import type { NoteColor } from './parser';

/** Colour of each category in light and dark themes, plus its display name. */
export const PALETTE: Record<NoteColor, { light: string; dark: string; label: string }> = {
  blue: { light: '#1a73e8', dark: '#3794ff', label: 'Azul' },
  green: { light: '#1e8e3e', dark: '#3fb950', label: 'Verde' },
  yellow: { light: '#b08800', dark: '#d29922', label: 'Amarillo' },
  red: { light: '#d93025', dark: '#f85149', label: 'Rojo' },
  purple: { light: '#8250df', dark: '#a371f7', label: 'Morado' },
};
