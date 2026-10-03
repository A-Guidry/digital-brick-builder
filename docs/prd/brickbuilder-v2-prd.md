# Digital Brick Builder v2 (real-part core): PRD

| Field | Value |
|-------|-------|
| Status | Approved with conditions (gate G1) |
| Owner | Anthony Guidry |
| Date | 2026-10-03 |
| Version | 0.2 |

## 1. Summary
Rebuild Digital Brick Builder so every model is a list of **real LEGO-compatible parts** (real part numbers, colours, positions, rotations), not a grid of plain bricks. A new offline "Part Atlas" turns the LDraw parts library (24,858 parts) and the Official Model Repository dataset (1,373 real sets) into a versioned database of part shapes, connection points, usage statistics and real build orders. On top of it: (1) the AI makes **small but richer models** by writing a blueprint that a parts solver fits with a wider palette (slopes, tiles, round pieces, wheels, windows, doors) under today's size limit; (2) **big premade models** from the dataset load exactly as built, with official step order, in a performance mode (no tray, invisible boundary, no shadows, instanced rendering). The family site keeps running while the new core is built beside it and switched on by flag. A public free beta follows.

## 2. Problem
- **Who:** Anthony's kids and nephews (6-14), then other families. Secondary: the adults who help them buy the bricks.
- **Pain:** (a) Models from today's generator look crude: a "unicorn" came out as a "W"; only plain bricks and plates are used, so no slopes, wheels or windows. (b) Models cannot be bought as shown: bricks are an approximation of a voxel grid. (c) Real LEGO models cannot be shown at all: our stud-stacking rule and 1-stud grid break them. (d) Larger models would be slow because the viewer has one rendering mode.
- **Current alternatives:** LEGO instructions (fixed sets only), BrickLink Studio / LDraw (powerful, hard for kids, no AI), other AI-to-brick tools (voxel mush).
- **Evidence:** Observed in this project (Oct 2026): blind tests of 5-4-1 and then 6-0-1 for richer prompts; converting real sets to our voxel grid produced floating, disconnected, unrecognisable models even when 100% of parts were read from the library. The dataset itself: 1,373 sets, 979 with official STEP markers, about 593,000 part placements, 5,426 distinct parts (counts approximate; to be recomputed by the pipeline).

## 3. Goals & Success Metrics
| Goal | Metric | Target | Timeframe |
|------|--------|--------|-----------|
| Richer small models | Blind A/B vs. today's production, 10 subjects (vehicles, buildings, animals, robots) | Win at least 8 of 10 | Before switching the flag on for kids |
| Reliable builds | Share of generated models valid on first try (real connectivity check, no AI repair) | At least 95% | Same |
| Fast | Median time, prompt to finished model | Under 30 s | Same |
| Buildable as shown | Models whose parts list matches the viewer exactly and exports to BrickLink with real IDs | 100% | M2 |
| Big premade models run well | Frame rate on iPhone 12 or newer / mid laptop at 1,500 and 2,500 parts | 30+ fps / 60 fps | M4 |
| Sustainable cost | AI cost per finished model (average, free tier) | At or below today's 3-4 calls | Public beta |
North-star metric: **share of kids' prompts that end in a model the kid keeps** (saved, or shopping list opened), measured in the family beta.

## 4. Non-Goals
- Not selling or shipping physical LEGO; no store, no stock or price lookup in v1.
- No Technic hinges, gears or motors in v1 (stud connections only; Technic pins are the most common part in the dataset but would skew the palette).
- No user-published public gallery or chat in v1 (children's safety and legal scope).
- No reproduction of official instruction PDFs; no use of them in the shipped product.
- No fine-tuning of an AI model in v1 (retrieval and a solver first).

## 5. Users & Journeys
- **Kid (6-14):** types or says "a police car with a siren", sees it build piece by piece, orbits it, asks for changes, saves it.
- **Adult helper:** opens the saved model, sees the real parts list and colours, exports it to BrickLink.
- **Anthony (owner/curator):** reviews generated and premade models, controls the premade library and licences, watches cost and quality.
Critical journey: prompt -> (about 20-30 s) -> a recognisable model made of real parts -> step-by-step build with the next parts highlighted -> save/export. "Worth it" moment: the model has wheels, windows, a door and clearly looks like what was asked for.

## 6. Scope
### MVP (v1)
| # | Feature / job | Priority | Acceptance criteria |
|---|---------------|----------|---------------------|
| 1 | **Part Atlas** (offline pipeline): ingest LDraw library, OMR dataset, Rebrickable names/colours; output parts DB, colours, models DB, stats | P0 | Deterministic build (same inputs, same hashes); every palette part has geometry, stud/tube positions, BrickLink ID and colour map; run in CI |
| 2 | **Part palette**: about 200 real parts chosen by dataset usage and availability, with a documented selection | P0 | Covers 80%+ of the placements of small vehicles/buildings/animals in the dataset; reviewed by owner |
| 3 | **PartModel format**: placements (part, colour, orientation, position) plus steps; LDraw import/export | P0 | Round-trips an OMR model without loss; legacy voxel Model converts to it |
| 4 | **Real connectivity validator**: connections from actual stud/anti-stud overlap, not "stacking" | P0 | All 24 previously passing real models pass; known floating models fail; property tests |
| 5 | **Parts solver ("brickifier")**: fits palette parts to the AI blueprint volume, uses slopes on slopes, round parts on cylinders, tiles on exposed tops | P0 | Meets the valid-first-try and runtime budgets; beats the current generator in blind test |
| 6 | **Assembly library**: wheels, windows in walls, doors, roofs, trees, wings extracted from real models, parametric by size (replaces `features.ts` kinds) | P0 | Each kind passes shape, connection and mirror tests |
| 7 | **Blueprint prompt + retrieval hints**: AI writes plan + shapes + assemblies; 1-2 similar real models are shown as hints | P1 | Blind-test uplift over blueprint alone |
| 8 | **New viewer** on PartModel: instanced rendering from LDraw geometry with levels of detail; profiles Small / Mid / Large | P0 | Frame-rate targets above; no visual regression on small models |
| 9 | **Large-model mode**: wide area or no tray, invisible boundary, no shadows, one view until complete, simplified physics | P1 | 2,500-part premade models at target fps on reference devices |
| 10 | **Premade library** from OMR: curated, credited, with official step order | P1 | Each model shows author and licence; steps match the file's STEP markers |
| 11 | **Instructions** generated by us (own renders, own step planner), including parts per step | P0 | Works for generated and premade models; no PDF content used |
| 12 | **Export**: BrickLink wanted-list XML with real IDs/colours; LDraw .ldr | P0 | Importing the XML into BrickLink shows the same parts and counts |
| 13 | **Flagged migration**: new core runs beside the old; per-user flag; old path remains fallback until retired | P0 | Kids' site never regresses; one-click switch back |
| 14 | **Release gate**: blind A/B harness, validity and speed benchmarks, perf tests, licence/attribution check in CI | P0 | A failing gate blocks release |
### Later
Remix of real models ("make this police car blue"); Technic and hinges; saving shared galleries; stock/price lookup; fine-tuned model trained on the dataset; voice; teacher/classroom mode.

## 7. UX Requirements
- **Onboarding:** none beyond opening the link (guest by default, as today); setup links for family remain.
- **Loading:** show the plan first, then build steps as they are solved; never a blank screen; large models show a progress bar for geometry download.
- **Errors:** plain-language messages (existing mapper); if the new solver fails, fall back to the old path silently and log it.
- **One view until complete (large mode):** camera follows the current step; free orbit unlocks at completion. *(Assumption A7; confirm.)*
- **Accessibility:** WCAG 2.2 AA contrast, focus states, 44px touch targets; no information by colour alone (parts list has names and numbers); respects reduced motion.
- **Trust signals:** credits page for premade models; "LEGO-compatible, not affiliated" notice; clear daily-allowance messages.
- **Recovery:** every build autosaved; undo the last AI change; export works offline once loaded.

## 8. UI & Brand
Platforms: responsive web (phones, tablets, laptops). Keep the current editorial/brutalist look (flat, sharp corners, one accent) per the project design rules. Parts list and step panels are dense and left-aligned. Light and dark themes. Tone: short, friendly, concrete.

## 9. Technical Approach
- **Architecture (data flow):**
  1. *Offline* Part Atlas: LDraw `complete.zip` + OMR jsonl + Rebrickable CSV -> normalise -> `atlas/` assets (versioned, hashed): `parts.json` (id, name, category, bounding box, stud and tube positions, BrickLink ID, usage count), `geometry/<id>.bin` (LOD0 triangles without studs, LOD1 box proxy, studs as instances), `colors.json`, `models/<set>.json` (placements, steps, author, licence, source), `stats.json` (co-occurrence, "which part for which surface").
  2. *Runtime generate:* prompt -> retrieval (similar real models by name/theme/size) -> AI blueprint (plan + shapes + assemblies) -> solver -> real validator -> repair (deterministic first, AI last) -> vision look-check (kept from today) -> PartModel.
  3. *Runtime show:* PartModel -> instanced renderer with profile -> steps/instructions -> export.
- **Stack:** TypeScript, Vite, three.js (instancing), cannon-es for small-model tray only (boundary-only physics for large), Node proxy (existing), Python/uv scripts for the pipeline, vitest + node:test + Playwright, GitHub Pages (or object storage + CDN for atlas assets, decision pending).
- **Data model (core entities):** Part, Colour, Placement{part, colour, matrix(24 orientations), x,y,z in LDraw units}, PartModel{placements, steps, source}, Assembly{kind, params, generator}, AtlasModel{set, author, licence, steps}, Blueprint{plan, shapes, assemblies}.
- **Integrations:** LDraw library (CC BY 4.0), OMR (CC BY 2.0), Rebrickable CSV (terms to confirm), BrickLink wanted-list XML, Gemini via the existing shared proxy (+ local Qwen).
- **AI/LLM:** System 2 (Gemini/Claude/Qwen) writes plan and blueprint only; deterministic code does geometry, part fitting, validation. Jev System 1 kept for triage/gating in the dev workflow. Evals: blind A/B (10 prompts), automatic validity and speed benchmarks, look-check score. No fine-tuning in v1; dataset used for retrieval and statistics.
- **Security & privacy:** unchanged proxy model (passcode, guest id, rate limits, secrets outside the repo). New: atlas assets are static and public; no personal data in models; if the public beta reaches children, a privacy review (COPPA/GDPR-K) is required before launch (Open Question Q2).
- **Scale & performance budgets:** small models (up to 300 parts) 60 fps on all devices; mid (300-1,500) 30+ fps on iPhone 12+; large (up to 2,500; premade only) 30+ fps iPhone, 60 fps laptop; initial atlas download for the palette under 5 MB compressed (to be measured), geometry lazy-loaded per part; solver under 5 s for 500 parts on a mid laptop; generation median under 30 s.
- **Build vs. buy:** reuse LDraw/OMR data and three.js; build the solver, validator and assembly library; consider an existing LDraw loader only for import.
- **Testing, observability, CI/CD, rollback:** golden models (round-trip and validity), property-based solver tests (always connected, never exceeds palette, deterministic), perf tests with frame-time capture in Playwright, pipeline determinism test, licence/attribution test, mutation checks on critical logic (as done for `features.ts`). Flag-based rollout with a one-click rollback; error and latency telemetry without personal data.

## 10. Business Model
Free for family; free public beta with daily allowances to cap AI cost. Hypothesis: optional paid tier later (more daily builds, saved galleries, large premade models) only if demand appears. Unit economics: AI cost per build (target at or below today's 3-4 calls on free-tier Gemini); hosting is static assets plus one small VPS already in place. Budget: open (Q5).

## 11. Go-to-Market
Positioning: "Describe it, get a real, buildable LEGO-style model with a parts list and instructions." First 100 users: family and friends, then a few parent communities. Channels: word of mouth, short build videos. Retention loop: saved builds and weekly "challenge" prompt. Launch only after the release gate passes.

## 12. Competitive Landscape
| Alternative | Strength | Weakness | Our angle |
|-------------|----------|----------|-----------|
| LEGO official sets/instructions | Quality, brand | Fixed, not generative | Anything you can describe |
| BrickLink Studio / LDraw | Full power | Steep learning curve, no AI | Kid-simple plus real parts |
| Voxel-to-brick AI tools | Easy | Crude, not buildable as shown | Real part numbers and valid connections |
| Generic text-to-3D | Impressive images | Not buildable | Buildable with a shopping list |

## 13. Risks & Mitigations
| Risk | Likelihood | Impact | Early signal | Mitigation |
|------|------------|--------|--------------|------------|
| Solver quality or speed disappoints | Med | High | Blind test below 6/10, solve time over 5 s | Greedy + local search with time limits; keep old path as fallback; assemblies for the hard parts |
| Real connectivity rules are subtle (clutch, tubes, offsets) | Med | High | Valid models rejected or invalid ones accepted | Build from stud/tube geometry in the library; golden tests from real sets |
| Geometry too heavy on phones | Med | High | Palette download over 5 MB, fps under target | LOD proxies, lazy load, instancing, profiles |
| Licensing/IP (OMR attribution, trademarks, derived instructions, training on PDFs) | Med | High | Counsel or LEGO objection | Credits page, own instructions from OMR steps and own solver, PDFs excluded, "not affiliated" notice, library can be switched off by config |
| Children's privacy in public beta | Med | High | Planning public launch | Privacy review before launch; no accounts or sharing in v1 |
| Dataset gaps (few animals, Technic-heavy) | High | Med | Poor animal results | Own blueprint+solver for animals; filter Technic from statistics; add curated assemblies |
| Dual maintenance of old and new paths | Med | Med | Bug fixes needed twice | Strict flag plan, retire old path at M5, shared tests |
| Scope creep / time | High | Med | Milestones slip | Milestones with exit gates; cut lines per milestone |
| The dominant quality error is the AI's layout, not the part representation | Med | High | G1 shows no uplift | Gate G1 before M1; keep voxel core + catalog as fallback |
Kill / pivot criteria: if gate G1 shows the solver below 6 of 10 wins or over 20% invalid, stop the rebuild, keep the voxel path plus catalog, and ship only the standalone A-track pieces (premade viewer, export).

## 14. Milestones
Durations are estimates and not commitments (one engineer plus AI assistance). **M0-M2 is the MVP; M3-M5 are cut lines.**
| Milestone | Scope | Estimate | Exit gate |
|-----------|-------|----------|-----------|
| M0 Part Atlas v0 | Pipeline with cached inputs (run locally; commit only atlas outputs), starter palette of about 60 parts, geometry, stud data, BrickLink map, models DB | 1-2 wks | Deterministic hashes; palette under 5 MB |
| **G1 Solver experiment (gate)** | Real validator + solver v0; 10 saved blueprints rendered as voxel bricks vs. solver; blind A/B | 1-2 wks | Solver wins 6 of 10, 90% valid, under 5 s; otherwise stop the rebuild |
| M1 Better small models | Full palette (about 200 parts), blueprint prompt, vision check on new core, benchmark vs. production | 3-4 wks | Blind 8 of 10, 95% valid, under 30 s median |
| M2 Viewer + export | Instanced viewer on PartModel, BrickLink/LDraw export, flagged switch for kids | 2-3 wks | Perf targets on small models; flag rollback tested |
| *Decision point: public beta wanted?* | Owner decision with privacy review scope | | |
| M3 Assemblies + retrieval | Assembly library, retrieval hints | 2-3 wks | Blind uplift |
| M4 Premade + large mode | Premade OMR library, boundary mode, profiles, OMR steps as instructions, credits page | 3 wks | 2,500 parts at target fps |
| M5 Public beta hardening | Quotas, privacy review, observability, accessibility audit, retire old path | 2-3 wks | Release gate green |

## 15. Assumptions
- A1: Palette of about 200 parts chosen by dataset usage, availability and role coverage (slopes, tiles, round, wheels, windows, doors).
- A2: Studs-only connections in v1; Technic and hinges deferred.
- A3: Asset hosting on the existing static host or a CDN; decision at M2.
- A4: No model training in v1; retrieval + solver first.
- A5: Instructions are generated by our own renderer from OMR step markers and our own step planner; PDFs are never shown, copied, or used as training data (owner asked for "our own version based on the PDFs"; this PRD narrows that to the OMR step data until counsel advises).
- A6: Rebrickable CSV usage terms permit this use (to confirm).
- A7: "One view until complete" means a step-following camera that unlocks free orbit at the end.
- A8: Timelines in section 14 are rough estimates.
- A9: Mobile performance targets are measured on iPhone 12 and a mid Android phone.

## 16. Open Questions
| Question | Owner | Needed by |
|----------|-------|-----------|
| Q1: Is deriving our own instructions "based on" the official PDFs acceptable in law? (This PRD avoids it.) | Owner / counsel | Before M4 |
| Q2: Privacy requirements for a public beta with children (COPPA/GDPR-K)? | Owner / counsel | Before M5 |
| Q3: Final palette list and which parts are excluded (rare, expensive, discontinued)? | Owner | End of M0 |
| Q4: Where to host atlas assets (static host vs. CDN) and size limits? | Eng | M2 |
| Q5: Budget and calendar constraints? | Owner | Before M0 |
| Q6: Exact behaviour of "one view until complete" on phones? | Owner / design | M4 |

## Council Deliberation
*Input: this PRD, v0.1. Evidence cited by section number.*

### Phase 1: Assessments
**Contrarian.** (1) The rebuild bets that the part representation is the bottleneck. Our own evidence says otherwise: the biggest gains this month (6-0-1 blind test) came from prompt, catalog and look-check changes on the *old* voxel core (Sec. 2, Evidence). The "unicorn looked like a W" failure was the AI's spatial layout, which a parts solver does not fix. (2) Fitting real parts to a volume is a known hard problem (brickification/"legolization" research); a 200-part palette plus real connectivity may still produce mush at our size, and the failure would show up after weeks of work (Sec. 6 items 4-5). (3) Real connectivity (clutch, tubes, offsets) is subtle; a validator that is too strict rejects good models, too loose accepts floating ones (Sec. 13). (4) Two parallel cores doubles maintenance (Sec. 13). (5) A public beta with children is a legal and reputational tail risk that the plan defers to M5.
**First-principles.** The PRD merges two products. (A) *Show and export real models*: Part Atlas, PartModel, viewer, premade library, steps, BrickLink/LDraw export. It is deterministic, data-driven and needs no AI. (B) *Generate new models*: blueprint -> solver. Its quality depends on the AI and is uncertain. B needs A's data and format, but A does not need B. Build A's foundation first, and test B's central claim (does a parts solver beat voxel bricks on the *same* blueprint?) as a cheap, isolated experiment before committing the whole schedule. The owner's "small better models first" is right as the goal, but it should be reached by the cheapest experiment, not the largest build.
**Expansionist.** The atlas is a compounding asset. Statistics ("which part for which surface") feed the solver; real models feed retrieval; the same format enables *remix* ("make this police car blue with a bigger siren"), editing by part, classroom sets, and LDraw/Studio interoperability that adults will value. Retrieve-and-adapt (start from a real car and change it) may beat generating vehicles from scratch. Animals, where the dataset is thin, stay on blueprint+solver.
**Outsider.** A 10-year-old does not care about part IDs; they care that the model looks like a unicorn. The adult cares that it can be bought. Make sure the first thing a child sees improved is the *model*, not the plumbing. Also ask whether a public beta is wanted at all for a family project; it multiplies obligations (privacy, attribution, support, cost). Naming and trademark use ("LEGO") need care.
**Executor.** 14-19 weeks of estimates for one person plus AI is a large commitment; M0-M2 is the real MVP and M3-M5 must be optional cut lines. Practicalities: the 146 MB library and 218 MB dataset must not be downloaded in CI each run (cache or run locally and commit only the atlas outputs); atlas size and schema versioning need a plan; palette download size must be measured in M0, not assumed; unit economics are fine if calls per build stay at 3-4 (Sec. 3, 10).

### Phase 2: Peer review (cross-examination)
- *Contrarian vs. First-principles:* "Decoupling A from B delays the AI improvement the owner wants." Response: not if the B experiment runs first for two weeks on 10 saved blueprints; it gives an answer sooner than M1 as written.
- *First-principles vs. Contrarian:* "The old core got the gains, so skip the rebuild." Rebuttal from our evidence: catalog wheels came out as chunky blocks and real small sets could not be represented at all (Sec. 2). The 1-stud grid caps shape fidelity; round parts and slopes are the only way to exceed it. Both sides are partly right, so the decision needs the experiment.
- *Expansionist:* remix is attractive but a distraction before the core is proven; keep it in "Later" and design PartModel so it is possible.
- *Outsider vs. Executor:* a public beta is a separate decision; make it an explicit gate after M2 results, not an assumption.
- *Executor:* the PRD lacked explicit cut lines and a CI data plan (accepted).

### Phase 3: Decision matrix
| Option | Feasibility & effort | Risk / failure severity | Expected upside | Key evidence / assumptions |
|---|---|---|---|---|
| A. Full rebuild exactly as drafted (M0-M5) | Hard; 14-19 wks; one-shot | High: late discovery if solver disappoints | High if solver works | Sec. 13; assumes solver beats voxel bricks (unproven) |
| B. Patch the voxel core (catalog + retrieval + critic) | Easy; 2-4 wks | Low | Medium; capped by the 1-stud grid | 6-0-1 blind test shows real gains; premade real models still impossible |
| **C. Staged hybrid: Part Atlas + PartModel + viewer/premade (A-track) with a gated solver experiment (B-track)** | Medium; first value in 2-3 wks | Low-medium: kill criterion after the experiment | High: keeps option value of A, avoids a blind bet on B | Sec. 2, 6, 13; experiment is cheap and decisive |
| D. Fine-tune a model on the dataset first | Hard; GPU, eval, hosting | High | Unknown | No evidence yet; deferred (A4) |

### Phase 4: Chairman's verdict
**Verdict: GO on Option C (staged hybrid), with a hard gate.**
**Core rationale.** The data asset (real parts, real steps, real geometry) is valuable regardless of how the generator evolves, and the A-track is low-risk and visible. The generator is where the uncertainty lives, and our own results show that the AI's layout, not the part model, caused the worst failures. So we spend two weeks proving whether a parts solver beats voxel bricks on identical blueprints before committing to M1-M5 as written. This keeps the owner's priority (better small models first) while removing the biggest schedule risk.
**The final move (next 2 weeks).** Build Part Atlas v0 for a 60-part starter palette (bricks, plates, slopes, tiles, round, wheel/window/door assemblies) with real geometry and stud positions; save 10 production blueprints (the current subjects: car, bus, house, castle, rocket, unicorn, giraffe, robot, cat, dog); build solver v0 and the real validator; run the blind A/B harness on the *same blueprints* rendered by voxel bricks vs. the solver.
**Success criteria.** Solver wins at least 6 of 10, at least 90% valid on first try, solve under 5 s for 500 parts, palette download under 5 MB. **Kill criteria:** under 6/10 wins or over 20% invalid -> stop the rebuild, keep the voxel core plus catalog, and ship only the A-track pieces that stand alone (premade viewer, export).

### Required PRD changes (applied)
Milestones reordered with a gate (M0 Atlas v0 and G1 solver experiment first); explicit cut lines; CI data plan; remix added to Later; public beta made an explicit gate; added risk "AI layout, not part representation, is the dominant error".

## Revision Log
| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial draft v0.1 | Owner request for a production rebuild using the LDraw/OMR data |
| 2026-10-03 | v0.2: council verdict applied: staged hybrid, gate G1, cut lines, CI data plan, remix in Later, public-beta decision point, new risk | Council deliberation |
