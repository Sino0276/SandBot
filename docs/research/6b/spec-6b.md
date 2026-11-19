# 6b spec: dynamic HIVE, CELL trays, FLOWER cage, flower/hiveCell placements (detailed design for implementers)

Approved plan: `plan-6b.md` in this folder (Korean). This file is the engineering design. It was checked against main `f3a9bbd`; line numbers are approximate — verify in code. Where this file and plan-6b.md disagree, plan-6b.md (user decisions) wins.

Official sources used (all FIRST; keep URLs in code comments as `[확인: …]`):

- Competition Manual (CM) TU06 HTML: `https://first-resources.pdx-prod.ftclive.org/ftc/game/cm-html` — 9.6 HIVE, 9.7 FLOWER, 10.3.1 staging, 10.5.1 HIVE TIP.
- Event Field Guide (EFG) V1.0: `https://ftc-resources.firstinspires.org/ftc/field/eventfieldguide` — §11 setup, §12 HIVE calibration table.
- Initial Field Element Assembly Guide (IFG) V1.0: `https://ftc-resources.firstinspires.org/ftc/field/initialfieldguide`.
- Field Acceptance Checklist (FAC) rev 26-27.3: `https://ftc-resources.firstinspires.org/ftc/field/field-check` — 1.7, 1.13, 2.2–2.11.
- **Official field CAD STEP**: `https://ftc-resources.firstinspires.org/ftc/field/field-cad-step` (zip sha256 `5e768b731f1ec8dcd14debba53225c43718877923c351ce08504305f68f7fe00`, CM 9.1 calls the CAD the official representation). FIRST file: never commit it. Measured values (Appendix A) are committed as numbers with `[확인: 공식 필드 CAD …]`.
- Not published anywhere (checked CM, EFG, IFG, FAC, mitigation guide, Q&A, AndyMark): HIVE mass/COM/inertia, damper stroke/force, bearing friction. These are `[가정]`.

## 0. Principles

- **HIVE = pinned pseudo-element.** Each HIVE is an extra node in `ElementWorld` after the balls (index `count + k`, `k` in `field.hives` order). It uses the existing 6-wide velocity slot with invMass 0 and invInertia 1/I; every HIVE row part is `a = [0, 0, 0, 0, s, 0]` (only ω_y). Therefore `articulation.ts`, `islands.ts`, `denseLcp.ts` are **not changed**, and ball-only arithmetic is bit-identical by construction. Build HIVE parts only through one helper; a test asserts with `Object.is` that HIVE slots 0–3 and 5 stay `+0`.
- **No new state in hashed outputs.** `pose()`, `elementSnapshot()`/`SimElementState` stay as in 6a (golden 9 hashes `elementSnapshot()` every tick). HIVE state goes to new accessors (`hiveSnapshot()`, `gameState().hives`).
- **Absent unless asked.** HIVEs are dynamic only when `ElementWorld` exists (world spec `elements` + season has elements). Without `elements` the HIVE is fixed at `field.hiveTipped` exactly as in 4ab/4d (golden 7, all camera tests unchanged).
- **Untouched ⇒ identical bytes.** A HIVE starts asleep at the exact stop constant (`startAngle`/`tippedAngle` value, not a recomputed number), adds no rows, no notices, no `maxSpeed`, no island slots until a ball touches it. The `prepare` all-asleep early return must still fire when no ball and no HIVE is awake. New FLOWER/HIVE static pieces that nothing touches produce no contacts. Goldens 1–7 and 9 stay byte-identical; golden 8 is re-recorded (FLOWER cage, user decision); golden 10 is new.
- **Geometry from the official CAD**, dynamics from the official calibration table; everything else `[가정]` in code comments AND `docs/assumptions.md` (new "6b" table) AND the new reference doc.

## 1. Season data model (`seasons/fieldSpec.ts`, `biobuzz.ts`, `symmetry.ts`, `none.ts`)

### 1.1 Parts

```ts
// 2D point (local x, y)
export type Vec2 = { x: number; y: number } // already exists in worldSpec/fieldGeometry — reuse
// One convex piece or exact primitive of a structure/HIVE, in the carrier frame of its owner.
export type FieldPartShape =
  | { kind: 'box'; center: Vec3; rotation: Vec3; size: Vec3 } // same semantics as FieldShape box
  | { kind: 'prism'; center: Vec3; rotation: Vec3; polygon: readonly Vec2[]; height: number }
  //   convex polygon (CCW, ≥ 3 pts) in the local x-y plane around `center`, extruded ±height/2 along local z
  | { kind: 'cylinder'; center: Vec3; rotation: Vec3; radius: number; height: number } // upright (rotation x = y = 0)
export type FieldPart = {
  shape: FieldPartShape
  robots: boolean // used by robot 3D body collision (stage 5) and startOverlaps
  balls: boolean // used by ball contacts (6a ElementWorld)
}
```

- `FieldStructure.parts?: readonly FieldPart[]`. When present, **robot 3D collision and balls use the parts** instead of `shape`; every other consumer (planar `fieldCollision`/`structureRows`, `fieldOverlaps`, `startConflicts`, presets, `checkFieldSpec` preset rules, 4c `fieldRaycast`, 4d occlusion, `spawn.ts` `blocked`, renderer open/season notices) keeps reading `shape` (the envelope box). Parts of `carrier: 'field'` structures must lie inside the envelope box within `PART_ENVELOPE_TOLERANCE` (1e-3 m) **except** the FLOWER Field Wall Bracket (it overhangs the wall rail and ±v; listed exception, see A.2) — the check lists exceptions by part key (`PART_ENVELOPE_EXCEPTIONS = {'flowerWallBracket'}`). The FLOWER middle-ring wall tab (u −0.06604) is 1.43 mm beyond the envelope's wall face (u −0.064606): clip it at the wall face (the wall is there) rather than exempting `flowerRingMiddle`. HIVE-carrier CELL structures are not checked for containment (contract review: their envelope box is display-only and the A.1 tray — base tube, ribs — exceeds it).
- `FieldPart.key: FieldPartKey` is **required** (contract review: the renderer colours parts by key, the envelope exceptions and the CELL floor/Back Skin lookup use it; calculation still uses the array index). Vocabulary `FIELD_PART_KEYS`: `flowerRingBottom`, `flowerRingMiddle`, `flowerRingTop`, `flowerLip`, `flowerPipe`, `flowerUpright`, `flowerWallBracket`, `flowerBackstop`, `flowerSpacer`, `cellFloor`, `cellWall`, `cellRoof`, `cellBackSkin`, `cellRib`, `cellBaseTube`, `cellStandoff`, `hivePivot`. The prefix names the owner (`fieldPartOwner`: flower* on FLOWER structures, cell* on CELL structures, hive* in `FieldHive.parts`); `checkFieldSpec` rejects unknown keys and keys on the wrong owner. Ball and robot pieces of the same physical part share the key and differ by `robots`/`balls`.
- `FieldHive` gains `dynamics?: { massMoment: number; inertia: number; pivotFriction: number }` and `parts?: readonly FieldPart[]` (HIVE body frame, moving; the pivot assembly). The CELL trays are `parts` on the existing CELL structures 13–16 (carrier `hiveRed`/`hiveBlue`, flags stay DISPLAY: solid/occludes/sensed false). HIVE carrier parts use `robots: false`, `balls: true`.
- `mirrorStructure`/`mirrorHive` mirror parts exactly like shapes (`mirrorVec3` center, `mirrorRotation`, polygon/size/radius unchanged). `checkFieldSpec`: part sizes > 0, polygon convex CCW, cylinders upright, containment, pair symmetry (`sameShape` extended to parts), HIVE dynamics finite/positive.
- Ring sectors use angles k·22.5°; cos/sin of those come from exact sqrt expressions (`cos 22.5° = √(2+√2)/2`, `sin 22.5° = √(2−√2)/2`, `cos 45° = √2/2`) — **no new Math.sin/cos in season data** (golden 8 dependency, Node upgrades).

### 1.2 Element placements

```ts
export type FieldElementPlacement = {
  group: SimElementGroup // 'garden' | 'flower' | 'hiveCell'
  kind: SimElementKind
  position: Vec3 // field coordinates, or carrier-frame coordinates when `carrier` is set
  carrier?: 'hiveRed' | 'hiveBlue'
  when?: 'start' | 'tipped' // with carrier: spawn only if that HIVE's initial state matches
}
export function placementActive(
  p: FieldElementPlacement,
  hiveTipped: readonly [boolean, boolean]
): boolean
export function placementFieldPosition(field: FieldSpec, p: FieldElementPlacement, hiveTipped): Vec3
//   carrier: T(pivot)·R_y(θ_initial)·position with rotationMatrix({x:0,y:θ,z:0}) and applyMatrix3 (same as tagFieldPose)
```

- `mirrorElementPlacement` mirrors `carrier` and keeps `when`.
- Tipped-start hiveCell NECTAR (red HIVE, `when: 'tipped'`, θ +30°, the −X CELL is up) is the start layout with only x negated: (x, y) → (−x, y) `[확인: CM 10.3.1 "in a line against the side closest to the ALLIANCE AREA of corresponding color": body-frame y_b is field +Y, so −y_b is the red wall side in both start states; the −X tray is the +X tray's (x, y) → (−x, −y) image but symmetric in y, so the balls touch the same side wall]`. This replaces the earlier `[결정]` that the tipped start is a plain mirror ((−x, −y), which put the balls against the blue-side wall). Blue is `mirrorElementPlacement` of red. It changes the spawn bytes only for a world with the `hiveCell` group and a tipped red HIVE; no golden covers that case.
- Layout order in BIOBUZZ: GARDEN (red 4, blue 4) → FLOWER (FLOWER 9, 10, 11, 12 × 4 bottom→top) → hiveCell (red start 3, red tipped 3, blue start 3, blue tipped 3). GARDEN stays first, so ball indices 0–7 are unchanged.
- `checkElements` per group: garden as 6a; flower: inside its FLOWER envelope, separation from every ball part of that FLOWER ≥ −1e-9, bottom ball rests on the floor (z = r), each other ball touches the one below (distance 2r ± 1e-9); hiveCell: in carrier frame, separation from the CELL tray ball parts ≥ −1e-9 and touching floor and Back Skin (±1e-9); symmetry by group.

### 1.3 BIOBUZZ data (values in Appendix A)

- FLOWER 9 and 11 get `parts` (others by `mirrorStructure`; FLOWER 11 = Rz(+π/2)·FLOWER 9 in CAD — write FLOWER 11 data from the same local description rotated, exactly: local u→field +Y... use the existing FLOWER_11 box frame; derive part centers by the exact 90° map (x, y) → (−y, x) of FLOWER 9's local offsets, no trig).
- FLOWER ball pieces (`robots: false, balls: true`): bottom/middle/top rings as 16 sector prisms each (inner chord at r_in, clipped to the ring's outer convex polygon), the three middle-ring NECTAR lips, 4 pipes (cylinder: exact for balls), 2 peanut uprights (prism), Field Wall Bracket as sector prisms outside its inner edge, backstop as 3 boxes + 2 spacer cylinders.
- FLOWER robot pieces (`robots: true, balls: false`): bottom/middle/top ring plates as single convex prisms (hole filled — robots never reach into the hole; `[결정]`), 4 pipes (cylinder → 16-gon prism for robots as today), 2 peanut uprights, bracket (one convex prism), backstop 3 boxes + 2 spacers. Pieces used by both may set both flags (pipes, uprights, backstop).
- CELL tray parts (body frame of the owning HIVE, +X CELL = structure 14 for red; −X = (x, y) → (−x, −y)), `robots: false, balls: true`: floor skin, 2 side-wall skins, 2 roof skins (pentagon roof), Back Skin (pentagon prism), mouth rib and back rib each as 5 boxes (outer contour, radial width per A.1), Cell Base Tube, 2 Churro standoffs. Mouth (outer end x_b = 0.544982) **open**. Lips (1.5–2 mm) ignored `[가정]`; floor/wall/roof fillets ignored `[결정: resting POLLEN/NECTAR touch the flat skins beyond the fillet tangent points]`.
- HIVE `parts`: pivot assembly box |x_b| ≤ 0.175, |y_b| ≤ 0.0191, z_b ∈ [−0.0689, 0.0222] `[가정: bearing plates + axle + damper holders as one box]`. The fixed A-frame top corners/axle holders are not modelled for balls `[가정]`.
- HIVE `dynamics` (both HIVEs; blue by `mirrorHive`):
  - `massMoment` = **0.0900 kg·m** `[결정: 공식 보정표(EFG §12.3) 창의 가운데 — Appendix B]`. Gravity torque about field +Y: τ = massMoment·g·sin θ (COM on the body z axis above the pivot; blue mirror gives the same formula).
  - `inertia` = estimate from CAD geometry × AndyMark part weights (method A.3), expected ≈ 0.35 kg·m² `[가정]`.
  - `pivotFriction` = 0.005 N·m `[가정: F608ZZ 차폐 베어링 둘, 출처 없음]` (must stay < 0.029 N·m so the calibration window holds).
- Stops: θ ∈ [min(start, tipped), max(start, tipped)] = [−π/6, π/6] for both HIVEs `[확인: FAC 1.13 53.5 ± 0.5 in at full damper compression ≙ ±30°]`; rigid, no bounce `[가정: Blum 970A stroke/force unpublished; FAC 2.7 dampers prevent bouncing]`.

## 2. HIVE dynamics in `ElementWorld`

- State per HIVE k: `theta[k]`, `thetaDot[k]`, `hiveAsleep[k]` (start 1), `hiveTimer[k]`, `tips[k]`, `restStop[k]` (−1 lower, +1 upper, 0 none). Initial θ = exactly `hive.tippedAngle` or `hive.startAngle` by `spec.field.hiveTipped`.
- Node index `count + k`. `uStar`/`u` sized `6·(count + H)`. Helpers `invMassOf(node)`/`invInertiaOf(node)` return `1/mass[e]`, `1/inertia[e]` (the same expressions as today) for balls and `0`, `1/inertia` for HIVEs; use them everywhere `this.mass[e]`/`this.inertia[e]` are read for a node (CoupledElements, island bodies, `solveSingleContact`).
- **Predict** (awake HIVE): `ω* = ω + h·(massMoment·GRAVITY·sin θ)/I` in slot 4; slots 0–3, 5 = +0. `Math.sin` of θ is new transcendental use (golden 10 only).
- **Rows** (awake HIVE only), keys start with `g` (no collision with gn/gt1/gt2):
  - lower stop `ghl.h<k>`: part a4 = +1, target −max(θ − lower, 0)/h, lo 0, hi ∞, no compliance.
  - upper stop `ghu.h<k>`: part a4 = −1, target −max(upper − θ, 0)/h, lo 0, hi ∞.
  - pivot friction `ghf.h<k>`: part a4 = +1, target 0, lo −pivotFriction·h, hi +pivotFriction·h (fixed box, no `friction` field).
  - Stop and friction rows have no Contact: `BallRow.contact = −1`; guard every `contacts[row.contact]` use (rowCount, softenOneWay, solveSingleContact, pinch logic). Order: after all contact rows.
- **Integrate**: θ += h·ω, then clamp to [lower, upper]; if clamped, θ is set to the exact bound constant. Set the display `moved` flag when θ changes.
- **Islands**: `UnionFind(count + H)`; union(ball, HIVE node) for each ball–HIVE contact. Ball roots unchanged when no HIVE contact. Robot admission: HIVE candidate appended after the balls (coupledIndex of balls unchanged); count HIVE stop/friction rows in `total`/`cost`; treat a ball's HIVE contact like a ball–ball contact (counted and linking only when the HIVE is admitted). Islands containing a HIVE use the dense solver up to `HIVE_ISLAND_DENSE_ROWS` = 256 `[결정: 넘어감 기준이 PGS 30회 근사로 흔들리지 않게]`; above it PGS + existing `elementIslandLarge`. A HIVE-only island (stop/friction rows only) must not take `solveSingleContact` unless the helper-based shape check passes (it may; make the fast path node-aware or exclude HIVE nodes).
- **Sleep**: HIVE timer counts while |ω|·`HIVE_ARM` < `SLEEP_SPEED` (`HIVE_ARM` = 0.545 m, mouth radius) **and the HIVE is not being driven** `[결정: 6b review]`: between the stops (θ not exactly a stop constant) a saturated pivot-friction row (|impulse of `ghf.h<k>`| ≥ `pivotFriction·h·(1 − 1e-9)`, i.e. friction is sliding) means the net torque is creeping it off the stop, so it is not resting even if |ω| is below the threshold. A HIVE held by static pivot friction (friction row inside its box) and one resting on a stop still count as slow. Without this a load whose net torque exceeds the threshold by about 1.4 % froze at −29.87° (4N+1P placed: no tip, balls asleep with it) and the calibration window below was biased low by sleeping. A group (union of balls and HIVE) sleeps together; asleep HIVE has ω = +0 exactly and θ at its current (clamped) value. Wake: an awake ball contacting a tray part wakes the HIVE; an awake HIVE wakes the asleep balls it touches (like a dynamic robot body, without `robotTouch`). HIVE speed never enters `maxSpeed`. The all-asleep early return additionally requires all HIVEs asleep.
- **Tip** (CM 10.5.1: reaches the other stable state and the other damper contacts): when θ is clamped to the bound opposite to `restStop[k]` (or `restStop` is 0 and θ reaches either bound after leaving the other) → `tips[k] += 1`, `restStop[k]` = that bound, notice `hiveTip { hive: 'red' | 'blue' }`. Initial `restStop` = the initial bound. (Notice de-dup means one Console line per HIVE per run; `tips` keeps the count for 6d.)
- **Failure containment**: an island throw zeroes the HIVE ω too; `failSubstep` zeroes awake HIVE ω; worldError detail `element island h<k>: …` when the root is a HIVE node.
- **Outputs**: `hiveSnapshot(): SimHiveState[]` (`{ angle, angularVelocity, asleep, tips }`, `field.hives` order, −0 normalised); `hiveAngles(): readonly [number, number] | null` (for cameras); `gameState()` adds `hives` (θ·1e4 rounded ints, no −0) and `hiveTips` (same length, `tips` per HIVE) when the world has dynamic HIVEs (`quantizeHives` returns both); revision bumps when quantised angles or tip counts change; `ElementWorldOptions.initialHives?: SimHiveState[]` (tests, 6d): angle and angular velocity must be finite (`RangeError` otherwise), `tips` a non-negative integer, an angle outside the stops is clamped to the stop constant. `restStop` is not part of `SimHiveState`, so a snapshot taken between the stops restarts with `restStop` = 0 (the first stop touched counts as a tip even if it is the one just left): 6d must continue from a HIVE that rests on a stop (asleep, θ a stop constant) `[결정: 6b review: adding `restStop` to the snapshot would change golden 10's bytes]`.

## 3. Ball–HIVE contacts (`hivePairs`, after `staticPairs`, before `ballPairs`)

- HIVE AABB prefilter in field coordinates each substep (from parts' local AABBs rotated). For each awake ball near: c_l = R_y(−θ)(c − pivot) (same `rotationMatrix({x:0,y:θ,z:0})` transposed), test parts' local AABBs, narrow phase `sphereHull` for box/prism parts (local hulls built once), rotate normal/point back to field.
- Contact: `f = −1`, `body = −2`, new field `hive = k` (−1 otherwise), `dynamic = false`. Token `e<i>/h<k>p<j>` (j = part index in the HIVE's ball part list: CELL structure parts first in structure order, then `hive.parts`). mu = (ball μ + `STRUCTURE_FRICTION` 0.4)/2 `[가정: CELL PETG 표면 μ = 구조물 μ]`, restitution `.hard` `[가정: PETG 껍질 = 딱딱한 면]`, stiffness `2·plateStiffness`, mass m_e, core 0.3r. otherOmega = [0, ω_k, 0]; tangent "other" velocity ω_k ŷ × (p − pivot).
- Parts: ball part as for statics; HIVE part `{ ball: count + k, a: [0, 0, 0, 0, s, 0] }` with s = −((p − pivot) × d)_y = −(r_z·d_x − r_x·d_z) for normal and both tangents.
- Rolling resistance reaction on the HIVE: none (same as robot). Pinch/held: HIVE contacts count as firm (like robot/static).

## 4. FLOWER cage in static shapes (`collision3d.ts`, `bodyCollision.ts`, `elementWorld.ts`)

- `staticShapes(field)` (robots: BodyCollision, startOverlaps): a structure with `parts` emits its `robots` parts **in place** (same position in walls → structures → floor order) as hulls (box → `boxHull`, prism → `prismHull`, cylinder → `prismHull(cylinderPrism)`); tokens `s<i>p<j>` (j = index in the structure's parts array); `target` stays `{ kind: 'structure', index: i }`; `chassis = s.solid`, `joints = s.solid || s.occludes` as today. Structures without parts unchanged. `startOverlaps` de-duplicates targets per structure (report a structure once, deepest).
- New `ballStaticShapes(field)` (frozen per FieldSpec, WeakMap) for `ElementWorld`: walls (as today, `box: true`), structures with carrier `field` and (solid ∨ occludes) — without parts as today; with parts: one **group** entry `{ envelope AABB, pieces[] }` whose pieces are the `balls` parts (hull, or exact cylinder `{a, b, radius}` for `sphereCylinder`) with tokens `s<i>p<j>`; then floor. ElementWorld checks the envelope AABB before pieces. Order and tokens of everything else unchanged.
- Golden 8: assertion `'cn.rk0/s11'` becomes a prefix check `'cn.rk0/s11p'`; re-record with the reason in the test comment and CLAUDE.md.
- Performance: chassis against a cage must stay within `MAX_COLLISION_ROWS` 28 in the golden-8 scene and the new perf case; if not, report — do not raise the limit silently.

## 5. Spawns and counts

- `ELEMENT_GROUPS = ['garden', 'flower', 'hiveCell']` (renderer `RUN_ELEMENT_GROUPS` follows).
- `elementSpawns(field, elements, start, bodyFrame, hiveTipped)`: layout order filtered by `groups` and `placementActive`, positions by `placementFieldPosition`; all layout balls start asleep; preloads after (awake) — unchanged.
- `parseWorldSpec` counts with the same `placementActive` rule (import from `seasons/fieldSpec.ts`, not from `elements/spawn.ts`). BIOBUZZ total with all groups: 8 + 16 + 6 + 4 preloads = 34 ≤ 64.
- `autoPreloadSlots(..., groups)`: unchanged logic; `blocked` keeps the FLOWER **box**. Callers pass groups excluding `'hiveCell'` (never near the floor; avoids a hiveState dependency in the renderer memo).

## 6. Cameras (`tagPoses.ts`, `vision.ts`, `fieldCameras.ts`, `world.ts`)

- `tagFieldPoseAt(field, tag, angle)` with exactly the current statements (`rotationMatrix({x:0, y:angle, z:0})`, `applyMatrix3`, `matMul3`, pivot additions); `tagFieldPose(…, hiveTipped)` calls it with `carrierAngle`.
- `FieldVision.observe(…, hive?: readonly [number, number] | null)`: null or angles `===` the constructor angles → precomputed entries (no arithmetic); otherwise rebuild only the changed carrier's entries through `tagFieldPoseAt`, cached by `===` on the last angles.
- `FieldCameras.read(…, hiveAngles?: () => readonly [number, number] | null)` called only for due frames; `PhysicsWorld.inputs()` passes `() => this.elements?.hiveAngles() ?? null`. Worlds without elements never call it.
- Sidecar unchanged (team field-pose constants are static; robotPose degrades after a tip, as on a real field — document).

## 7. World, protocol, main

- `WORLD_SPEC_VERSION` 8 (history line: "8: 경기 요소 묶음 flower·hiveCell, HIVE 동역학(6b)"); reject 7. Update literal asserts (`worldSpec.test.ts`, `worldGolden.test.ts` ×2) and tests using `'flower'` as an invalid group (use e.g. `'humanPlayer'`).
- `shared/play.ts`: `gameState` event adds `hives?: number[]`, `hiveTips?: number[]` (together with `hives`, same length; live tip count for the Field inspector, since `hiveTip` is de-duplicated per run) and `finalHives?: SimHiveState[]`; `SimNoticeCode` adds `'hiveTip'` (params `{ hive }`). `SimHiveState` lives in `worldSpec.ts` next to `SimElementState`.
- `gameState.ts`: `GameState.hives?: number[]`, `GameState.hiveTips?: number[]`; `isValidGameState` accepts optional `hives` (safe ints, length ≤ 2, equal to the first state's count when `hiveCount` given) and `hiveTips` (safe ints ≥ 0, length equal to `hives`, both absent counts as 0); quantise with the same `quantize`; `hiveDisplayAngle`/`hiveDisplayTips` read them. Main (`session.takeGame`) and the renderer (`playStore`) both fix the HIVE count from the run's first state and never store an empty `hives`.
- `PhysicsWorld.hiveSnapshot()`, `SimWorld.hiveSnapshot?()`; `session.ts` carries `hives` with the pose throttle (same tick), `finalHives` next to `final` at the end (`settleWorld` first). `NOTICE_PARAM_KEYS` untouched (sidecar-only).
- `PROJECT_VERSION` stays 14. Sidecar protocol stays 4. `MESH_CACHE_TAG` stays `model-v5`.

## 8. Renderer

- `play/playStore.ts`: `SimGameState.hives`/`hiveTips`, `GhostGame.hives`/`hiveTips`, `LastRunElements.hives` (6d seam). INIT clears; project open clears (as balls).
- `editor/scene/poseDisplay.ts`-style `bindHiveDisplay`: in `FieldView` carrier groups keep the model rotation; an inner `motion` group (no rotation prop) is bound while `runLocksField(run) && run.field.gameElements` and writes `rotation.y = θ_sim − θ_model`, reset to 0 on cleanup (StrictMode-safe, `invalidate()`). Same for `FieldColliderOutlines` carrier groups and the CAD companion CELL visibility (imperative toggle when |θ − startAngle| > 1e-4).
- Ghost HIVE: CELL trays + tags at the end angle with `GHOST_MATERIAL` renderOrder 5, only when the end angle differs from the displayed start angle; cleared at next INIT/project open.
- FLOWER drawn as its parts (ball pieces, colors: pipes green `#3fae49`, rings `#202020`, top ring `#f2c200`, backstop `#8e44ad`, uprights/bracket `#303030` `[결정: 표시 색]`); the envelope box is no longer drawn. CELL drawn as tray parts with `HIVE_CELL` material (translucent, renderOrder 4).
- 4e outline (`fieldOutlineMeshes`): FLOWER ball pieces and CELL trays in the normal outline; FLOWER envelope boxes in the dim colour `#54c84d` 0.55 (still used by sensors/camera/planar path). Update the asserted counts.
- `hiveState` = **start** state: reword `playSettings.ts` comments, i18n `preferences.simulation.hiveState/hiveHint`, `field.inspector.hiveState/hiveHint`, `field.inspector.cad.hiveTippedNote` (applies from the next INIT; with game elements off the HIVE stays fixed). Field inspector shows a live line during a run (`field.inspector.hiveNow`: angle and tips per HIVE, from `simGame.hives`/`hiveTips`) and the end state after STOP until the next INIT (`field.inspector.hiveEnd`, from `ghostGame` or `lastRunElements.hives`). The start-state option is labelled "Untipped"/"넘어가지 않음" (`hiveStart`), not "Start".
- `FieldElementsSection`: flower/hiveCell counts live (from resolved spawns with the current start state); `humanPlayer` stays deferred (6d).
- `ElementsView`/`editElementLayers`: edit-time balls include flower and hiveCell (hiveCell positions by the current start state).
- Console: `console.notices.sim.hiveTip.red|blue` (info level; add the info branch in playStore — today every simNotice is a warning).

## 9. Golden hashes

- 1–7, 9: unchanged (verify before/after).
- 8: re-recorded (FLOWER cage) with the token prefix change.
- 10 (`worldGolden.test.ts` `hiveTip()`): BIOBUZZ, groups all three, `hiveTipped` [false, false], a webcam on the robot seeing RED AUDIENCE tags (34–37) before and after the tip, `initial` states tossing POLLEN into the red upward CELL (+X) so the HIVE tips (exactly one `hiveTip` notice), balls spill and reach the floor, and a robot intake (cylinder roller) at FLOWER <3>'s retrieval opening pulling out its bottom POLLEN. Hash input = 9th's plus `hiveSnapshot()` per tick. Twice in-process identical; no `worldError`; no `null` in the text.

## 10. Tests

- Data: parts containment/symmetry/convexity, exact-sqrt sector angles, placements (`checkElements` new rules), Appendix A numbers, `placementActive`/count parity between `parseWorldSpec` and `elementSpawns`.
- `sphereHull` vs brute force on prism parts; FLOWER channel: 4 POLLEN stack asleep at start; a POLLEN dropped into the top opening falls to the stack; NECTAR stops on the middle-ring lips (FAC 2.9); POLLEN cannot escape sideways between pipes (FAC 2.11); an intake through the retrieval opening extracts the bottom POLLEN; robot chassis vs cage within 28 rows.
- HIVE: **calibration table (EFG §12.3, six rows)** with balls placed at rest against the Back Skin (gentle) and tossed (`[가정: 던지기 = 0.3 m 위에서 1 m/s]`); empty HIVE holds at both stops (bistable); stop has no bounce; balls spill after a tip; blue = Rz(π) mirror of red (positions within 1e-9); asleep HIVE θ `Object.is` the stop constant; HIVE slots 0–3, 5 stay `+0`; determinism (two runs byte-identical); robot-held ball touching the HIVE joins the robot island.
- Camera: angles === start → tags `Object.is`-equal to the static path; after a tip tags follow.
- Main/renderer: gameState hives validation, session throttle/same tick/finalHives, playStore, FieldView binding/ghost, FieldElementsSection, Console info level, first-tick integration (renderer builder → JSON → `parseWorldSpec` → `PhysicsWorld`: element positions = `elementSpawns` incl. flower/hiveCell, HIVE angles = start).
- Perf (record; CI ×5): P7 HIVE island tip (3N+3P) substep median ≤ 1.0 ms; P8 16 FLOWER balls awake ≤ 0.6 ms; P9 chassis against cage ≤ 0.5 ms; P1–P6 unchanged within noise.

## 11. New assumptions (code `[가정]` + `docs/assumptions.md` 6b table + reference doc)

HIVE inertia (A.3 estimate), pivot friction 0.005 N·m, rigid no-bounce stops, CELL μ 0.4 and restitution "hard", lips/fillets ignored, pivot assembly box, A-frame corners not modelled for balls, ring sectors 16 (hole chord error r_in·(1 − cos 11.25°) ≈ 0.7–1.0 mm), robot ring plates filled, toss definition for tests, `HIVE_ISLAND_DENSE_ROWS` 256 (결정), FLOWER straight-column start (결정: CAD staging is also an on-axis column; EFG says zig-zag unspecified), bottom-ring hole from CAD (CM nominal 2.79 in conflicts with CAD ≈ 3.04 in; CM is "approximately", CAD is official).

## 12. Documents

- `docs/reference/hive-flower-6b.md` (same template as the other reference docs), README table row, `field-biobuzz.md` (HIVE §7, structures §6, FLOWER), `balls-6a.md` §20 (6b row), `collision.md` (static pieces/tokens), `sensors-vision.md` (tags follow HIVE), `docs/assumptions.md` 6b table, CLAUDE.md 6b section + invariants (golden 10, v8), `docs/research/6b/cad-measurements.md` (Appendix A with method and the STEP URL/sha256) and the measurement scripts used.

---

## Appendix A. Official CAD measurements (red HIVE body frame / FLOWER 9 local frame)

Method: STEP meshed read-only with occt-import-js (FTC (X,Y,Z) = (CAD z, x, y), inches → m); red HIVE mapped to body frame with θ = −30° about the CAD red pivot (0, −0.323647, 1.11633) m. CAD pivot y differs from the repo symmetric pivot (−0.32385) by 0.2 mm — use the repo pivot and the HIVE's own symmetry (`[결정: CAD 비대칭 0.2 mm 버림, 4ab 규칙]`). Values below are body-frame, symmetric in y_b.

### A.1 CELL (+X CELL; −X by (x, y) → (−x, −y))

| item                   | value (m)                                                                                                                  | CAD mesh / note |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Back Skin plate        | x_b ∈ [0.239217, 0.239725], pentagon                                                                                       | y_b             | ≤ 0.26589, z_b −0.04719…0.33198 (notch at bottom centre for the base tube)                                                                                                                   | #863; ball face x_b = 0.239725          |
| mouth (open)           | x_b = 0.544982 (outer face of the outer Goal Rib)                                                                          | #873            |
| floor skin inner face  | z_b = −0.037287 (outer −0.037795, 0.508 mm PETG)                                                                           | #845            |
| side wall inner faces  |                                                                                                                            | y_b             | = 0.256007 (outer 0.256515), from z_b −0.00988 to the roof junction                                                                                                                          | #845                                    |
| roof inner planes      | z = 0.327137 − 0.6389·                                                                                                     | y               | (32.574°); wall/roof sharp junction z 0.163576 at                                                                                                                                            | y                                       | = 0.256007; apex inner sharp 0.327137 (rounded 0.322072) | #870           |
| inner pentagon (sharp) | (±0.256007, −0.037287), (±0.256007, 0.163576), (0, 0.327137); extruded x_b ∈ [0.239725, 0.544982]                          |                 |
| ribs (both ends)       | outer contour                                                                                                              | y_b             | ≤ 0.2667, apex 0.33274, bottom flat −0.047955 (boss to −0.075489 around the base tube); radial width ≈ 0.012–0.0127; mouth rib x_b ∈ [0.52019, 0.544982], back rib x_b ∈ [0.239217, 0.26162] | #833, #873; inner lips 1.5–2 mm ignored |
| Cell Base Tube         | x_b ∈ [0.119532, 0.544982],                                                                                                | y_b             | ≤ 0.0127, z_b ∈ [−0.068885, −0.043485]                                                                                                                                                       | #830                                    |
| Churro standoffs (2)   | x_b ∈ [0.258826, 0.526034],                                                                                                | y_b             | ∈ [0.240614, 0.250012], z_b ∈ [0.152578, 0.163449]                                                                                                                                           | #871/#875                               |
| AprilTag sticker       | z_b −0.03792 (centre), matches repo TAG_Z                                                                                  | #858            |
| ballast screw          | x_b = ±0.513232, z_b = −0.056185 (outside, under the floor)                                                                | #872            |
| pivot assembly         |                                                                                                                            | x_b             | ≤ 0.175,                                                                                                                                                                                     | y_b                                     | ≤ 0.0191, z_b ∈ [−0.0689, 0.0222]                        | #902/#919/#883 |
| dampers                | 2 × Blum 970A (am-1762 / am-5865), tips at (±0.060604, 0, −0.067869), lever 0.0888 m; contact the fixed A-Frame Top Corner | #886/#890       |
| CM cross-check         | opening ≈ 20 × 14 in, depth 12 in (CM 9.6.2); CAD aperture 20.02 × 14.00 in                                                |                 |

### A.2 FLOWER 9 (local u = field +X into the field, v = field +Y, w = Z; axis at field (−1.728254, −0.594180); wall inner face u = −0.064605)

| item                  | value (m)                                                                                                                                                                                                                                                            | note                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| bottom ring (Layer X) | w ∈ [0, 0.008992]; hole r 0.0384–0.0390 (use 0.0387), chamfer to r 0.04158 at the top edge; outer u ≤ +0.060985 (field), ≥ −0.062713 (wall),                                                                                                                         | v                                                | ≤ 0.075489                                                    | #810; CM "≈ 2.79 in" conflicts |
| middle ring (Layer B) | w ∈ [0.099162, 0.133452]; hole r 0.0489; outer u ≤ +0.061239, ≥ −0.059741 (wall tab to −0.06604 at                                                                                                                                                                   | v                                                | ≤ 0.026416),                                                  | v                              | ≤ 0.075514                                                                                                               | #814            |
| NECTAR lips (3)       | w ∈ [0.104267, 0.10795]; inner edge r 0.042926 at the bottom rising 45° to 0.046482; angular extents −10°…+10° (+u) and ±(130°…160°)                                                                                                                                 | #814; FAC 2.9                                    |
| top ring (Layer C)    | w ∈ [0.514452, 0.543662]; opening r 0.0507 (dia 3.97–4.01 in; CM ≈ 4 in, FAC 21.5 ± 0.25 in); outer chamfered octagon                                                                                                                                                | u                                                | ≤ 0.060935,                                                   | v                              | ≤ 0.075209 (hull in the geometry note)                                                                                   | #819            |
| pipes (4, HIPS)       | centres (±0.043815, ±0.043815); r 0.013343; w ∈ [0.108052, 0.539852]                                                                                                                                                                                                 | #790…; channel free radius 0.048621              |
| peanut uprights (2)   | w ∈ [0.008992, 0.104242]; hull (u, v) in for A: (−2.450,−1.131) (−2.051,−1.873) (−1.945,−1.882) (−1.202,−1.482) (−1.194,−1.376) (−1.593,−0.633) (−1.700,−0.625) (−2.442,−1.024); B = A mirrored in v                                                                 | #796/#797                                        |
| Field Wall Bracket    | w ∈ [0.2905, 0.30066]; hull (u, v) in: (−3.743,−2.865) (−3.166,−3.325) (−1.901,−3.317) (−0.964,−2.358) (−0.976,2.390) (−1.938,3.333) (−3.230,3.302) (−3.743,2.865); inner edge r 0.048082 on the wall side (ball pieces: sectors outside r 0.048082 within the hull) | #798; overhangs the envelope (allowed exception) |
| backstop              | w ∈ [0.569062, 0.575412]; bar width 0.008865; back segment u ∈ [−0.058826, −0.049962] for                                                                                                                                                                            | v                                                | ≤ 0.0254; two 45° segments to rounded ends u −0.0096…−0.0191, | v                              | ≤ 0.069215; hull in the geometry note; spacers Ø0.009525 × 0.0254 at (u −0.01585, v ±0.062865), w ∈ [0.543662, 0.569062] | #801, #788/#789 |
| retrieval opening     | w ∈ [0.008992, 0.099162] (3.55 in), open on +u and ±v; depth ring front to upright faces ≈ 0.0909                                                                                                                                                                    | CM 3.55 × 3.57 in                                |

FLOWER 11 = Rz(+π/2)·FLOWER 9 about its own axis; 10 = Rz(π)·9; 12 = Rz(π)·11 (CAD, exact).

### A.3 HIVE mass estimate (for inertia only)

AndyMark per-part weights (shipping fields, `[가정]`): Goal Rib 168 g ×2, skins (PETG 1.27 g/cm³ × area × 0.508 mm) ≈ 378 g, Base Tube 172 g, Churro 37 g ×2, fasteners ≈ 90 g, 5 ballast washers 2.72 g + wing nut ≈ 4.5 g per CELL → CELL ≈ 1.07 kg; pivot assembly ≈ 0.48 kg; HIVE ≈ 2.6 kg. Distribute each part's mass uniformly over its CAD shape (A.1 boxes/skins) and integrate (x_b² + z_b²) → `inertia` (expected ≈ 0.35 kg·m²). Record the computed COM height for comparison only (the calibrated `massMoment` is what the simulator uses; note any large difference in the reference doc).

## Appendix B. Calibration window (EFG §12.3, CM 10.5.1)

Balls at rest against the Back Skin and floor (centre x_b = 0.239725 + r, z_b = −0.037287 + r), one row along the floor (7 POLLEN fit: 7 × 0.0711 = 0.4977 ≤ 0.512014 inner width; the 8th nests in a second row at x_b + √3·r). Tipping torque arm at θ = −30°: x' = x_b cos θ + z_b sin θ.

| load    | torque / g (kg·m) | required                       |
| ------- | ----------------- | ------------------------------ |
| 3N + 1P | 0.036063          | —                              |
| 3N + 2P | 0.042020          | no tip (2nd tossed onto 3N+1P) |
| 3N + 3P | 0.047978          | tip                            |
| 6P      | 0.035746          | —                              |
| 7P      | 0.041704          | no tip (7th tossed onto 6P)    |
| 8P      | 0.048989          | tip                            |

Window [0.042020, 0.047978], midpoint 0.044999 → holding torque at the stop = massMoment·g·sin 30° ⇒ **massMoment = 0.0900 kg·m**; half-window 0.00298 kg·m ⇒ pivot friction must be < 0.0292 N·m. The implementation verifies this by simulation (balls settled by the simulator, not the analytic positions) and adjusts `massMoment` to the simulated window midpoint if it differs by more than 1 % — report the final value.

## Implementation notes (written after the 6b merge; the reference document `docs/reference/hive-flower-6b.md` is the up-to-date source)

- Appendix A.2 backstop: the shipped data uses a 12.7 mm bar (rear bar u [−0.06074, −0.04804], diagonal bars at normal distances 0.049307 / 0.062007 from the axis), re-measured from the CAD in `cad-scripts/flower.py`; the 8.9 mm / u [−0.058826, −0.049962] row above is the earlier reading.
- Appendix A.3: running `cad-scripts/inertia.py` gives CELL 1.0927 kg, HIVE 2.6654 kg, inertia 0.3861 kg·m² (shipped value 0.386), COM height 0.05768 m, M·z_com 0.15373 kg·m. The "expected ≈ 0.35" above was a rough guess.
- Appendix B: the simulator-measured window is [0.08669, 0.09503] (midpoint 0.09086, 0.95 % from the shipped 0.0900); see the reference document, section 11.
- §12: `docs/research/6b/cad-measurements.md` was not written; the measurements live in `cad-geometry-notes.txt`, `cad-scripts/` and section 2 of the reference document.
