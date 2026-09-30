import { Model } from './compiler';
import { PART_BY_ID, COLOR_BY_ID } from './catalog';

export interface Line { part: string; name: string; bl: string; color: string; colorName: string; blColor: number; hex: string; qty: number }

export function partsList(model: Model): Line[] {
  const m = new Map<string, Line>();
  for (const p of model.parts) {
    const k = `${p.part}|${p.color}`;
    const pd = PART_BY_ID[p.part], cd = COLOR_BY_ID[p.color];
    if (!m.has(k)) m.set(k, { part: p.part, name: pd.name, bl: pd.bl, color: p.color, colorName: cd.name, blColor: cd.bl, hex: cd.hex, qty: 0 });
    m.get(k)!.qty++;
  }
  return [...m.values()].sort((a, b) => a.colorName.localeCompare(b.colorName) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}
const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

/** BrickLink "Upload Wanted List" XML. */
export function wantedListXml(model: Model): string {
  const items = partsList(model).map(l =>
    `  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${esc(l.bl)}</ITEMID>\n    <COLOR>${l.blColor}</COLOR>\n    <MINQTY>${l.qty}</MINQTY>\n  </ITEM>`);
  return `<INVENTORY>\n${items.join('\n')}\n</INVENTORY>\n`;
}
export function csv(model: Model): string {
  return 'BrickLink Part,Part Name,BrickLink Color ID,Color,Qty\n' +
    partsList(model).map(l => `${l.bl},"${l.name}",${l.blColor},"${l.colorName}",${l.qty}`).join('\n') + '\n';
}
