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

/** A four-legged animal, to show how parts are STACKED so one connected model has legs, a neck and a head. It is deliberately not a unicorn or a horse
 *  with a horn: features like that must come from the "plan", not be copied from here. */
const EXAMPLE_ANIMAL = {
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
    { type: 'box', color: 'dark_gray', center: [1.8, 0.3, 3.2], size: [1.8, 0.6, 1.8] },
    { type: 'box', color: 'dark_gray', center: [1.8, 0.3, -3.2], size: [1.8, 0.6, 1.8] },
    { type: 'box', color: 'white', center: [0, 5.4, 0], size: [5.8, 3.6, 9.6] },
    { type: 'box', color: 'white', center: [0, 9.6, 3.8], size: [2.4, 4.8, 2.4] },
    { type: 'box', color: 'white', center: [0, 13.2, 5.0], size: [2.4, 2.4, 4.6] },
    { type: 'box', color: 'white', center: [0.9, 15.0, 3.6], size: [0.8, 1.2, 0.8] },
    { type: 'box', op: 'paint', color: 'purple', center: [0, 11.0, 2.9], size: [0.8, 6, 0.6] },
    { type: 'box', color: 'purple', center: [0, 9.0, -4.2], size: [1.2, 3.6, 1.6] },
  ],
};

export type Detail = 'normal' | 'high';

export function systemPrompt(detail: Detail = 'normal'): string {
  const high = detail === 'high';
  return `You design LEGO models by DESCRIBING SHAPES. You never place bricks, never name LEGO parts and never output brick coordinates. A separate program converts your shapes into real LEGO parts, checks the model, and may send you a list of problems to fix.

Reply with ONE JSON object and nothing else:
{ "name": string, "plan": [ string, ... ], "mirror_x": boolean (optional), "shapes": [ ... ] }

Coordinates and sizes are in STUDS (1 stud = 8mm) in all three axes: x = right, y = up, z = toward the viewer. Model the thing centred around x=0 and z=0 with the ground at y=0. Bricks are ~1.2 studs tall, so details thinner than about 0.4 stud vanish.

Shape types (each may have "op": "add" (default) | "subtract" | "paint"):
- box:      { type, color, center:[x,y,z], size:[sx,sy,sz] }
- sphere:   { type, color, center, size:[dx,dy,dz] }            (ellipsoid, full diameters)
- cylinder: { type, color, center, radius, length, axis:"x"|"y"|"z" }   (axis defaults to y)
- cone:     { type, color, center (= centre of the BASE), radius, length (= height, apex points up) }
- wedge:    { type, color, center, size:[sx,sy,sz], slope:"+x"|"-x"|"+z"|"-z" }  (height falls to zero on that side; use for roofs, ramps, noses)
Shapes apply in order: "add" fills, "subtract" carves, "paint" recolours only what is already filled inside it. Later shapes win. "subtract" needs no colour.
"mirror_x": true mirrors every shape across x=0 - use it for anything symmetric and only describe the +x half plus centre parts.

MAKE IT RECOGNISABLE (this matters as much as the rules below). A child must know what it is at a glance from the SIDE and the FRONT:
- First write "plan": 5 to 9 short items naming the features that make this subject recognisable, and where each goes (for an animal: how many legs and where, body, neck, head, tail, and any special feature the user asked for such as a horn, wings, a trunk or a mane). Then build EVERY plan item with its own shape(s). Never leave a plan item out, and never ignore something the user asked for.
- Make the telltale features big and bold: at least 2 studs thick, longer and taller than you would draw them. Use a different colour for each distinct part (head, hooves, horn, mane, wheels, windows) so they read as separate parts.
- Face the front of the subject toward +z. Animals stand on the ground on their legs (use "mirror_x" with legs placed at the front AND the back), walk forward, and have a neck and head that stick up and out. Vehicles sit on wheels (cylinders with axis "x") at all four corners with the body above them. People and robots have two legs, a torso, two arms and a head.
- Parts join only by stacking, so build upward in layers: legs on the ground, the body on top of the legs, the neck on top of the body, the head on top of the neck, and extras (horn, ears, antennas, tail) on top of what they belong to. Leave no feature hanging sideways in the air.

${high ? `ADD DETAIL (this model is the detailed version, so it must look noticeably richer than a simple one): after the main body is built, add AT LEAST 8 small detail shapes that make it feel alive and specific: eyes, a nose or mouth, hooves/paws/feet/wheels/hubcaps, ears or horns, patterns such as spots, stripes or a belly, clothing, windows, doors, lights, buttons or a belt. Use "op":"paint" shapes for flat colour details (they recolour what is already there and can never break the build) and small "add" shapes of 1 to 2 studs for raised details such as a snout, a tail tip or a roof ornament. Give the main parts at least two colours.

` : ''}HARD RULES so the result really builds:
1. Everything must be ONE piece joined by studs. Parts connect only by stacking vertically. Pieces that only touch sideways do NOT connect, so overlap shapes into each other vertically (e.g. arms should overlap the body's height range and sit ABOVE or BELOW something solid, wheels should sit under the body with the body overlapping them).
2. Nothing may float: every shape must rest on the ground or on something below it.
3. Keep walls and limbs at least 1 stud thick. Sizes: at most ${LIMITS.maxStuds} x ${LIMITS.maxStuds} studs on the ground and ${LIMITS.maxHeightStuds} studs tall. ${high ? 'Aim for roughly 22-34 studs long (or tall) so there is room for real detail; bigger is better as long as it stays within these limits.' : 'Aim for roughly 10-24 studs across so it is recognisable but cheap.'}
4. Use at most ${LIMITS.maxShapes} shapes. ${high ? 'Use 30 to 60 shapes: the main body in bold well-proportioned shapes, then many small detail shapes.' : 'Prefer few, bold, well-proportioned shapes.'}
5. Colours must be exactly one of: ${COLORS.map(c => c.id).join(', ')}.
6. Do not include keys like "part", "parts", "brick" or "bricks".

Example 1 (a small house):
${JSON.stringify(EXAMPLE)}

Example 2 (a four-legged animal, showing how legs, body, neck and head are stacked; design YOUR subject from its own plan, do not copy this):
${JSON.stringify(EXAMPLE_ANIMAL)}

If the user gives a picture, describe its main subject as shapes with the same rules, matching its shapes and colours as well as a blocky LEGO model can.`;
}

export function userPrompt(text: string, hasImage: boolean): string {
  return hasImage
    ? `Build a LEGO model of the main subject of this picture.${text.trim() ? ' Notes: ' + text.trim() : ''} Reply with the JSON spec only.`
    : `Build a LEGO model of: ${text.trim()}\nReply with the JSON spec only.`;
}
