import { Step } from './steps';
import { Placed } from './compiler';

export const BAG_COUNT = 4;
export interface Bag { n: number; steps: Step[]; parts: Placed[]; firstStep: number; lastStep: number }

/** Split the build steps into (up to) 4 numbered bags with balanced piece counts.
 *  Each bag is a contiguous run of steps, like the numbered bags in a real set. */
export function makeBags(steps: Step[], k = BAG_COUNT): Bag[] {
  const kk = Math.max(1, Math.min(k, steps.length));
  const total = steps.reduce((n, s) => n + s.parts.length, 0);
  const bags: Bag[] = [];
  let i = 0, acc = 0;
  for (let b = 0; b < kk; b++) {
    const target = (total * (b + 1)) / kk;
    const group: Step[] = [];
    // leave at least one step for every remaining bag
    while (i < steps.length && (group.length === 0 || (b < kk - 1 && steps.length - i > kk - 1 - b && acc + steps[i].parts.length / 2 <= target) || b === kk - 1)) {
      group.push(steps[i]); acc += steps[i].parts.length; i++;
    }
    bags.push({ n: b + 1, steps: group, parts: group.flatMap(s => s.parts), firstStep: group[0].n, lastStep: group[group.length - 1].n });
  }
  return bags;
}
