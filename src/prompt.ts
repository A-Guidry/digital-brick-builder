import { COLORS } from './catalog';
import { LIMITS } from './shapes';
import { featureCatalogText, MAX_FEATURES } from './features';

export interface Msg { role: 'user' | 'assistant'; text: string; image?: { mime: string; base64: string } }

export const EXAMPLE = {
  name: 'Little house',
  mirror_x: true,
  shapes: [
    { type: 'box', color: 'light_gray', center: [0, 0.6, 0], size: [12, 1.2, 10] },
    { type: 'box', color: 'tan', center: [0, 5.4, 0], size: [10, 8.4, 8] },
    { type: 'box', op: 'subtract', center: [0, 5.4, 0], size: [8, 8.4, 6] },
  ],
  features: [
    { kind: 'roof', at: [0, 9.6, 0], size: [10, 3, 8], color: 'red' },
    { kind: 'door', at: [0, 1.2, 4], facing: '+z' },
    { kind: 'window', at: [3, 6.6, 4], facing: '+z', size: [2, 2.4] },
    { kind: 'window', at: [5, 6.6, 0], facing: '+x', size: [2, 2.4] },
    { kind: 'chimney', at: [3, 10.2, -2], size: 4 },
  ],
};

/** A car: the wheels, glass and lights are catalog parts, so the model only has to get the body right. */
export const EXAMPLE_CAR = {
  name: 'Red car',
  plan: ['a long low red body', 'a smaller cabin on top, set back from the front', 'four wheels, one at each corner', 'glass in the cabin: a windshield and side windows', 'two headlights on the front', 'a bumper on the front'],
  mirror_x: true,
  shapes: [
    { type: 'box', color: 'red', center: [0, 2.8, 0], size: [8, 2.4, 16] },
    { type: 'box', color: 'red', center: [0, 5.2, -1.5], size: [7, 2.4, 8] },
  ],
  features: [
    { kind: 'wheel', at: [4, 0, 5], facing: '+x' },
    { kind: 'wheel', at: [4, 0, -5], facing: '+x' },
    { kind: 'windshield', at: [0, 5.2, 2.5], facing: '+z' },
    { kind: 'window', at: [3.5, 5.2, -1.5], facing: '+x', size: [2, 2.4] },
    { kind: 'headlight', at: [2.5, 3.0, 8], size: 1.5 },
    { kind: 'bumper', at: [0, 1.6, 8], size: 8 },
  ],
};

/** A four-legged animal, to show how parts are STACKED so one connected model has legs, a neck and a head. It is deliberately not a unicorn or a horse
 *  with a horn: features like that must come from the "plan", not be copied from here. */
export const EXAMPLE_ANIMAL = {
  name: 'Pony',
  plan: [
    'four legs under the body, one at each corner, with dark hooves',
    'a long horizontal body resting on the legs',
    'a neck rising from the front of the body',
    'a head on top of the neck, pointing forward',
    'ears on the top of the head',
    'a purple mane stripe down the back of the neck',
    'a tail standing up from the back of the body',
  ],
  mirror_x: true,
  shapes: [
    { type: 'box', color: 'white', center: [1.8, 1.8, 3.2], size: [1.6, 3.6, 1.6] },
    { type: 'box', color: 'white', center: [1.8, 1.8, -3.2], size: [1.6, 3.6, 1.6] },
    { type: 'box', color: 'white', center: [0, 5.4, 0], size: [5.8, 3.6, 9.6] },
    { type: 'box', color: 'white', center: [0, 9.6, 3.8], size: [2.4, 4.8, 2.4] },
    { type: 'box', color: 'white', center: [0, 13.2, 5.0], size: [2.4, 2.4, 4.6] },
    { type: 'box', op: 'paint', color: 'purple', center: [0, 11.0, 2.9], size: [0.8, 6, 0.6] },
    { type: 'box', color: 'purple', center: [0, 9.0, -4.2], size: [1.2, 3.6, 1.6] },
  ],
  features: [
    { kind: 'hoof', at: [1.8, 0, 3.2], size: 1.8 },
    { kind: 'hoof', at: [1.8, 0, -3.2], size: 1.8 },
    { kind: 'ear', at: [0.8, 14.4, 4.0], size: 1.2, color: 'white' },
    { kind: 'eye', at: [1.2, 13.8, 6.0], facing: '+x', size: 1.5 },
  ],
};

export type Detail = 'normal' | 'high';

export function systemPrompt(detail: Detail = 'normal'): string {
  const high = detail === 'high';
  return `You design LEGO models by DESCRIBING SHAPES. You never place bricks, never name LEGO parts and never output brick coordinates. A separate program converts your shapes into real LEGO parts, checks the model, and may send you a list of problems to fix.

Reply with ONE JSON object and nothing else:
{ "name": string, "plan": [ string, ... ], "mirror_x": boolean (optional), "shapes": [ ... ], "features": [ ... ] (optional) }

Coordinates and sizes are in STUDS (1 stud = 8mm) in all three axes: x = right, y = up, z = toward the viewer. Model the thing centred around x=0 and z=0 with the ground at y=0. Bricks are ~1.2 studs tall, so details thinner than about 0.4 stud vanish.

Shape types (each may have "op": "add" (default) | "subtract" | "paint"):
- box:      { type, color, center:[x,y,z], size:[sx,sy,sz] }
- sphere:   { type, color, center, size:[dx,dy,dz] }            (ellipsoid, full diameters)
- cylinder: { type, color, center, radius, length, axis:"x"|"y"|"z" }   (axis defaults to y)
- cone:     { type, color, center (= centre of the BASE), radius, length (= height, apex points up) }
- wedge:    { type, color, center, size:[sx,sy,sz], slope:"+x"|"-x"|"+z"|"-z" }  (height falls to zero on that side; use for roofs, ramps, noses)
Shapes apply in order: "add" fills, "subtract" carves, "paint" recolours only what is already filled inside it. Later shapes win. "subtract" needs no colour.
"mirror_x": true mirrors every shape across x=0 - use it for anything symmetric and only describe the +x half plus centre parts.

PARTS CATALOG. For the things below, do NOT build them out of shapes: add them to "features" (at most ${MAX_FEATURES}) and the program builds each one correctly. A feature is { "kind": string, "at": [x,y,z], "size": number or [width,height] (optional), "facing": "+x"|"-x"|"+z"|"-z" (optional, default +z: which way it points out of the model), "color": colour (optional), "accent": colour (optional) }. Features are added after all the shapes, painted ones last. With "mirror_x", give only the +x side. Put "at" exactly on the surface of a shape you built.
${featureCatalogText()}
Use a feature every time the subject has one of these: wheels on every vehicle, windows and a door on every building, eyes on every creature. Wheels, windows, windshields and doors are REAL parts (real part numbers and shapes), so they come in fixed sizes: a window is 2 x 2.4, 2 x 3.6 or 4 x 3.6 studs, a windshield is 4 wide and 2.4 tall, a door is 4 wide and 7.2 tall (so a building with a door needs walls at least 8 studs tall). A roof is built from real slope bricks, so give it exactly the width and length of the walls it sits on (no overhang) and put its y at the top of the walls; its height follows from its width. Doors are for buildings and buses only: never put a door on a car, truck or other small vehicle (give those windows). A wheel is a real wheel unit that hangs below the body, so on any vehicle the body must start at y = 1.6 (nothing of the body below that), and "at" for a wheel is the body's side face (x) and the place along the car (z).

MAKE IT RECOGNISABLE (this matters as much as the rules below). A child must know what it is at a glance from the SIDE and the FRONT:
- First write "plan": 5 to 9 short items naming the features that make this subject recognisable, and where each goes (for an animal: how many legs and where, body, neck, head, tail, and any special feature the user asked for such as a horn, wings, a trunk or a mane). Then build EVERY plan item with its own shape(s). Never leave a plan item out, and never ignore something the user asked for.
- Make the telltale features big and bold: at least 2 studs thick, longer and taller than you would draw them. Use a different colour for each distinct part (head, hooves, horn, mane, wheels, windows) so they read as separate parts.
- Face the front of the subject toward +z. Animals stand on the ground on their legs (use "mirror_x" with legs placed at the front AND the back), walk forward, and have a neck and head that stick up and out. Vehicles sit on wheels (cylinders with axis "x") at all four corners with the body above them. People and robots have two legs, a torso, two arms and a head.
- Parts join only by stacking, so build upward in layers: legs on the ground, the body on top of the legs, the neck on top of the body, the head on top of the neck, and extras (horn, ears, antennas, tail) on top of what they belong to. Leave no feature hanging sideways in the air.

${high ? `ADD DETAIL (this is the detailed version, so it must look noticeably richer than a simple one): use AT LEAST 8 catalog features, chosen for THIS subject (an animal: eyes, ears or horns, hooves, nostrils and spots, a tail tip; a vehicle: all wheels, a windshield, side windows, a door, headlights, taillights, a bumper; a building: many windows, a door, a roof, a chimney, towers or battlements; a rocket or plane: portholes, fins or wings, an antenna). Then add flat colour details with "op":"paint" shapes (stripes, a belly, clothing, a belt). Do NOT just make the body bigger or thicker: the extra richness must come from real parts. Give the main parts at least two colours.

` : ''}HARD RULES so the result really builds:
1. Everything must be ONE piece joined by studs. Parts connect only by stacking vertically. Pieces that only touch sideways do NOT connect, so overlap shapes into each other vertically (e.g. arms should overlap the body's height range and sit ABOVE or BELOW something solid, wheels should sit under the body with the body overlapping them).
2. Nothing may float: every shape must rest on the ground or on something below it.
3. Keep walls and limbs at least 1 stud thick. Sizes: at most ${LIMITS.maxStuds} x ${LIMITS.maxStuds} studs on the ground and ${LIMITS.maxHeightStuds} studs tall. ${high ? 'Aim for roughly 22-34 studs long (or tall) so there is room for real detail; bigger is better as long as it stays within these limits.' : 'Aim for roughly 10-24 studs across so it is recognisable but cheap.'}
4. Use at most ${LIMITS.maxShapes} shapes. ${high ? 'Use 20 to 45 shapes for the body, plus the catalog features.' : 'Prefer few, bold, well-proportioned shapes.'}
5. Colours must be exactly one of: ${COLORS.map(c => c.id).join(', ')}.
6. Do not include keys like "part", "parts", "brick" or "bricks".

Example 1 (a small house):
${JSON.stringify(EXAMPLE)}

Example 2 (a car: wheels, glass, lights and a bumper are catalog features; design YOUR subject, do not copy this):
${JSON.stringify(EXAMPLE_CAR)}

Example 3 (a four-legged animal, showing how legs, body, neck and head are stacked; design YOUR subject from its own plan, do not copy this):
${JSON.stringify(EXAMPLE_ANIMAL)}

If the user gives a picture, describe its main subject as shapes with the same rules, matching its shapes and colours as well as a blocky LEGO model can.`;
}

export function userPrompt(text: string, hasImage: boolean): string {
  return hasImage
    ? `Build a LEGO model of the main subject of this picture.${text.trim() ? ' Notes: ' + text.trim() : ''} Reply with the JSON spec only.`
    : `Build a LEGO model of: ${text.trim()}\nReply with the JSON spec only.`;
}
