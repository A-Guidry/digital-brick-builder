# Digital Brick Builder — architecture

Browser-only app (Vite + TypeScript + three.js). API keys live in localStorage and go only to the provider you choose.

## Pipeline
prompt / image -> **AI writes a shape spec (JSON)** -> `shapes.ts` validates -> `compiler.ts` voxelises and packs real parts
-> `validator.ts` checks -> problems? -> `repair.ts` fixes deterministically, else sends the problem report back to the AI (max 4 rounds)
-> final `Model` -> viewer / steps / build mode / BrickLink export.

The AI never sees part IDs or coordinates of bricks. Any spec containing them is rejected.

## Units
- x, z in studs. y is a height in studs too in the spec (1 stud = 2.5 plates, so proportions look right).
- The compiler works on a grid of 1 stud x 1 stud x 1 plate. A brick is 3 plates tall.

## Modules
catalog · shapes · compiler · validator · repair · llm (Anthropic/Gemini/local) · prompt · presets · steps · bricklink · viewer · builder · main
