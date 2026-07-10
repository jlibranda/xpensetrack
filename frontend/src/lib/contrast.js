// Returns a readable text color (dark or white) to place on top of a given
// background hex color, based on perceived luminance (WCAG-ish). Used so that
// light brand colors (e.g. yellow) keep dark, visible text instead of white.
export function contrastText(hex, dark = '#1f2937', light = '#ffffff') {
  if (!hex || typeof hex !== 'string') return light;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return light;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // Contrast ratio against white vs black; pick the more readable one.
  const contrastWhite = 1.05 / (L + 0.05);
  const contrastBlack = (L + 0.05) / 0.05;
  return contrastBlack >= contrastWhite ? dark : light;
}
