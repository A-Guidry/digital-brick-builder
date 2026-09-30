// Real LEGO parts (rectangular bricks and plates) and real colours with BrickLink IDs.
export interface PartDef {
  id: string;          // our key, e.g. "brick-2x4"
  kind: 'brick' | 'plate';
  w: number;           // studs along x (before rotation)
  d: number;           // studs along z
  h: number;           // height in plates (brick=3, plate=1)
  bl: string;          // BrickLink part number
  name: string;
}
const mk = (kind: 'brick' | 'plate', w: number, d: number, bl: string): PartDef => ({
  id: `${kind}-${w}x${d}`, kind, w, d, h: kind === 'brick' ? 3 : 1, bl,
  name: `${kind === 'brick' ? 'Brick' : 'Plate'} ${w} x ${d}`,
});
export const PARTS: PartDef[] = [
  mk('brick', 1, 1, '3005'), mk('brick', 1, 2, '3004'), mk('brick', 1, 3, '3622'), mk('brick', 1, 4, '3010'),
  mk('brick', 1, 6, '3009'), mk('brick', 1, 8, '3008'), mk('brick', 2, 2, '3003'), mk('brick', 2, 3, '3002'),
  mk('brick', 2, 4, '3001'), mk('brick', 2, 6, '2456'), mk('brick', 2, 8, '3007'),
  mk('plate', 1, 1, '3024'), mk('plate', 1, 2, '3023'), mk('plate', 1, 3, '3623'), mk('plate', 1, 4, '3710'),
  mk('plate', 1, 6, '3666'), mk('plate', 1, 8, '3460'), mk('plate', 2, 2, '3022'), mk('plate', 2, 3, '3021'),
  mk('plate', 2, 4, '3020'), mk('plate', 2, 6, '3795'), mk('plate', 2, 8, '3034'),
];
export const PART_BY_ID: Record<string, PartDef> = Object.fromEntries(PARTS.map(p => [p.id, p]));

export interface ColorDef { id: string; name: string; bl: number; hex: string; }
export const COLORS: ColorDef[] = [
  { id: 'white', name: 'White', bl: 1, hex: '#f2f3f2' },
  { id: 'black', name: 'Black', bl: 11, hex: '#1b2a34' },
  { id: 'red', name: 'Red', bl: 5, hex: '#c91a09' },
  { id: 'dark_red', name: 'Dark Red', bl: 59, hex: '#720e0f' },
  { id: 'blue', name: 'Blue', bl: 7, hex: '#0055bf' },
  { id: 'dark_blue', name: 'Dark Blue', bl: 63, hex: '#0a3463' },
  { id: 'medium_azure', name: 'Medium Azure', bl: 156, hex: '#36aebf' },
  { id: 'yellow', name: 'Yellow', bl: 3, hex: '#f2cd37' },
  { id: 'orange', name: 'Orange', bl: 4, hex: '#fe8a18' },
  { id: 'green', name: 'Green', bl: 6, hex: '#237841' },
  { id: 'dark_green', name: 'Dark Green', bl: 80, hex: '#184632' },
  { id: 'lime', name: 'Lime', bl: 34, hex: '#bbe90b' },
  { id: 'tan', name: 'Tan', bl: 2, hex: '#e4cd9e' },
  { id: 'dark_tan', name: 'Dark Tan', bl: 69, hex: '#958a73' },
  { id: 'reddish_brown', name: 'Reddish Brown', bl: 88, hex: '#582a12' },
  { id: 'nougat', name: 'Nougat', bl: 28, hex: '#cc702a' },
  { id: 'light_nougat', name: 'Light Nougat', bl: 90, hex: '#f6d7b3' },
  { id: 'light_gray', name: 'Light Bluish Gray', bl: 86, hex: '#a0a5a9' },
  { id: 'dark_gray', name: 'Dark Bluish Gray', bl: 85, hex: '#6c6e68' },
  { id: 'bright_pink', name: 'Bright Pink', bl: 104, hex: '#e4adc8' },
  { id: 'purple', name: 'Dark Purple', bl: 89, hex: '#3f2a6d' },
];
export const COLOR_BY_ID: Record<string, ColorDef> = Object.fromEntries(COLORS.map(c => [c.id, c]));

/** Snap any CSS-ish colour name or hex to the nearest real LEGO colour. */
const ALIASES: Record<string, string> = {
  grey: 'light_gray', gray: 'light_gray', silver: 'light_gray', brown: 'reddish_brown', pink: 'bright_pink',
  cyan: 'medium_azure', teal: 'medium_azure', beige: 'tan', skin: 'nougat', gold: 'yellow', violet: 'purple',
  navy: 'dark_blue', darkgrey: 'dark_gray', darkgray: 'dark_gray', lightgrey: 'light_gray', lightgray: 'light_gray',
};
export function resolveColor(input: string | undefined): ColorDef | null {
  if (!input) return null;
  const k = input.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (COLOR_BY_ID[k]) return COLOR_BY_ID[k];
  const byName = COLORS.find(c => c.name.toLowerCase().replace(/[\s-]+/g, '_') === k);
  if (byName) return byName;
  const al = ALIASES[k.replace(/_/g, '')];
  if (al) return COLOR_BY_ID[al];
  if (/^#[0-9a-f]{6}$/.test(k)) {
    const n = parseInt(k.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    let best = COLORS[0], bd = Infinity;
    for (const c of COLORS) {
      const m = parseInt(c.hex.slice(1), 16);
      const d = (r - (m >> 16)) ** 2 + (g - ((m >> 8) & 255)) ** 2 + (b - (m & 255)) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  return null;
}
export const BRICK_H = 3;      // plates per brick
export const PLATES_PER_STUD = 2.5; // 8mm pitch / 3.2mm plate
