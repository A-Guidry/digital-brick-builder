import { Model, Placed } from './compiler';
import { buildOrder } from './validator';

export const MAX_PER_STEP = 4;
export interface Step { n: number; parts: Placed[]; }

/** Build steps: layer by layer, never more than 4 new parts per step, every part attaches to something already built. */
export function makeSteps(model: Model): Step[] {
  const { order } = buildOrder(model.parts);
  const steps: Step[] = [];
  let cur: Placed[] = [];
  const flush = () => { if (cur.length) { steps.push({ n: steps.length + 1, parts: cur }); cur = []; } };
  let lastKey = '';
  for (const p of order) {
    // group same part+colour together so a step reads "2 x brick 2x4 red"
    const key = `${Math.floor(p.y / 3)}`;
    if (cur.length >= MAX_PER_STEP || (lastKey && key !== lastKey && cur.length >= 2)) flush();
    cur.push(p); lastKey = key;
  }
  flush();
  return steps;
}
