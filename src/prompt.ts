import { COLORS } from './catalog';
import { LIMITS } from './shapes';

export interface Msg { role: 'user' | 'assistant'; text: string; image?: { mime: string; base64: string } }

const EXAMPLE = {
  name: 'Little house',
  mirror_x: true,
  shapes: [
    { type: 'box', color: 'light_gray', center: [0, 0.6, 0], size: [12, 1.2, 10] },
    { type: 'box', color: 'white', center: [0, 3.6, 0], size: [10, 4.8, 8] },
    { type: 'box', op: 'subtract', center: [0, 3.6, 0], size: [8, 4.8, 6] },
    { type: 'box', op: 'subtract', color: 'white', center: [0, 2.4, 4], size: [2, 2.4, 2] },
    { type: 'wedge', color: 'red', center: [3, 7.5, 0], size: [6, 3, 11], slope: '+x' },
  ],
};

export function systemPrompt(): string {
  return `You design LEGO models by DESCRIBING SHAPES. You never place bricks, never name LEGO parts and never output brick coordinates. A separate program converts your shapes into real LEGO parts, checks the model, and may send you a list of problems to fix.

Reply with ONE JSON object and nothing else:
{ "name": string, "mirror_x": boolean (optional), "shapes": [ ... ] }

Coordinates and sizes are in STUDS (1 stud = 8mm) in all three axes: x = right, y = up, z = toward the viewer. Model the thing centred around x=0 and z=0 with the ground at y=0. Bricks are ~1.2 studs tall, so details thinner than about 0.4 stud vanish.

Shape types (each may have "op": "add" (default) | "subtract" | "paint"):
- box:      { type, color, center:[x,y,z], size:[sx,sy,sz] }
- sphere:   { type, color, center, size:[dx,dy,dz] }            (ellipsoid, full diameters)
- cylinder: { type, color, center, radius, length, axis:"x"|"y"|"z" }   (axis defaults to y)
- cone:     { type, color, center (= centre of the BASE), radius, length (= height, apex points up) }
- wedge:    { type, color, center, size:[sx,sy,sz], slope:"+x"|"-x"|"+z"|"-z" }  (height falls to zero on that side; use for roofs, ramps, noses)
Shapes apply in order: "add" fills, "subtract" carves, "paint" recolours only what is already filled inside it. Later shapes win. "subtract" needs no colour.
"mirror_x": true mirrors every shape across x=0 - use it for anything symmetric and only describe the +x half plus centre parts.

HARD RULES so the result really builds:
1. Everything must be ONE piece joined by studs. Parts connect only by stacking vertically. Pieces that only touch sideways do NOT connect, so overlap shapes into each other vertically (e.g. arms should overlap the body's height range and sit ABOVE or BELOW something solid, wheels should sit under the body with the body overlapping them).
2. Nothing may float: every shape must rest on the ground or on something below it.
3. Keep walls and limbs at least 1 stud thick. Sizes: at most ${LIMITS.maxStuds} x ${LIMITS.maxStuds} studs on the ground and ${LIMITS.maxHeightStuds} studs tall. Aim for roughly 10-24 studs across so it is recognisable but cheap.
4. Use at most ${LIMITS.maxShapes} shapes. Prefer few, bold, well-proportioned shapes.
5. Colours must be exactly one of: ${COLORS.map(c => c.id).join(', ')}.
6. Do not include keys like "part", "parts", "brick" or "bricks".

Example (a small house):
${JSON.stringify(EXAMPLE)}

If the user gives a picture, describe its main subject as shapes with the same rules, matching its shapes and colours as well as a blocky LEGO model can.`;
}

export function userPrompt(text: string, hasImage: boolean): string {
  return hasImage
    ? `Build a LEGO model of the main subject of this picture.${text.trim() ? ' Notes: ' + text.trim() : ''} Reply with the JSON spec only.`
    : `Build a LEGO model of: ${text.trim()}\nReply with the JSON spec only.`;
}
