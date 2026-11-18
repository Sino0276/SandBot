# 6a spec: POLLEN·NECTAR ball physics (detailed design for implementers)

Approved plan: `plan.md` in this folder (Korean). This file is the detailed engineering design. It was checked against the tree at main `fbbf098`; line numbers are approximate — verify in code.
Where this file and plan.md disagree, plan.md (user decisions) wins.

## 0. Principles

- Balls are NOT added to the Articulation tree. Each ball is its own 6-DOF body with constant diagonal mass. Balls touching a moving robot body are folded into the robot's LCP via the Schur/Delassus complement, so the robot mass matrix never grows. All other balls are solved in small per-island LCPs.
- Feature fully absent unless asked: if the world spec has no `elements` key, no element code runs → the 8 golden hashes cannot change (only the `spec.version` assertion in `worldGolden.test.ts:85` changes from 6 to 7; it is not part of the hash).
- Positions only from the renderer; physics from season data. World spec carries which layout groups to spawn and where preload slots are; radius/mass/contact params come from `FieldSpec.elements` via `resolveSeason` (existing rule: the simulator does not trust renderer geometry).
- Every assumed constant is marked `[가정]` in code comments AND listed in `docs/assumptions.md` (new; see §8).

## 1. Modules

### New `src/shared/sim/elements/` (pure TS, deterministic, no Map iteration order, no wall clock/random)

- `elementData.ts`: constants `MAX_WORLD_ELEMENTS=64`, `MAX_PRELOADS=4`, `MAX_COUPLED_ROWS=48`, `ISLAND_DENSE_ROWS=60`, `PGS_SWEEPS=30`, `SLEEP_SPEED=5e-3` (m/s, also |ω|·r), `SLEEP_TIME=0.5` s, `V_BOUNCE=0.25` m/s, `TANGENT_COMPLIANCE_RATIO=0.01`, `AIR_DENSITY=1.2`, `REENTRY_DELAY_NANOS=3e9` [가정], `CORE_DEPTH_RATIO=0.3` [가정], `OUT_OF_FIELD_Z=-0.05`; `resolveElementType(field, kind)`.
- `spawn.ts`: `elementSpawns(field, specElements, start, bodyFrame) → SimElementState[]` — order: layout entries in season-array order filtered by group, then preloads in slot order. `autoPreloadSlots(footprint, field, start) → { face: 'front'|'back'|'left'|'right', slots: Vec3[] } | null` — shared with the renderer (plan: front, then back, left, right; if all blocked → null → run without preloads + warning `worldPreloadNoRoom`). Front slots: centres at `maxX + r + 0.5 mm` in robot frame, spaced `2r + 0.5 mm`, z = r, centred in y; analogous for other faces. Blocked = sphere separation < 0 vs walls/solid structures (statics) or outside the field.
- `ballContact.ts`: narrow phase ball vs floor/static hull/robot shape/ball reusing `collideShapes` (`collision3d.ts`, ball = `{kind:'capsule', sphere:true}`), plus exact sphere–cylinder (new). Builds rows (soft normal, restitution, friction). Tangents from `frictionTangent` (`bodyCollision.ts`).
- `broadPhase.ts`: integer grid 0.125 m cells over [−2.5, 2.5]² clamped; `head`/`next` Int32Arrays built in descending index order so lists come out ascending; queries 3×3 cells. Robot shape AABBs from shared placement looked up in covered cells. Maps only for lookup, never ordering.
- `islands.ts`: union-find (root = smallest index; robot node R = −1 sorts first), ball-only island solve (dense exported `solveBoxLcp` with 2-pass friction stagger and warm start by key; > `ISLAND_DENSE_ROWS` rows → PGS `PGS_SWEEPS` fixed sweeps in row order, warm-started, notice `elementIslandLarge`), sleeping.
- `elementWorld.ts`:

```ts
class ElementWorld {
  constructor(spec: WorldSpec, field: FieldSpec, art: Articulation | null)
  prepare(
    art: Articulation | null,
    frames: ContactFrames | null,
    h: number
  ): { rows: ContactRow[]; coupled: CoupledElements | null }
  finish(art: Articulation | null, h: number, robotFailed: boolean): Notice[] // other islands, integrate, sleep, out-of-field + re-entry
  snapshot(): SimElementState[] // full precision, for 6d continuation
  displayPoses(): { revision: number; poses: Int32Array; flags: Uint8Array }
  tickState(): ElementTickState // 6c seam: centres, radii, kinds, flags
}
```

State SoA Float64Array: `pos[3N]`, `quat[4N]` (w,x,y,z), `vel[3N]`, `omega[3N]`, `flags` (asleep, out), `sleepTimer`, `outSinceNanos`.

### Modified (verify line numbers)

- `articulation.ts`: `ContactRow` (~:75) and internal `Row` (~:440) gain `elements?: readonly ElementPart[]` and `compliance?: number`. `ContactSet` (~:85) gains `elements?: CoupledElements`. `externalRows` (~:1392) copies the new fields. `constrained` (~:1143) and `clampLimits` (~:1206) get a NEW branch taken only when some row has `elements` or `compliance`; otherwise existing code runs verbatim (byte-identical arithmetic). New `elementVelocities(): Float64Array | null` valid after `step`.
- `world.ts`: constructor (~:282-435) `this.elements = spec.elements ? new ElementWorld(...) : null`; `integrate` (~:505) runs substeps when `this.articulation || this.elements` (elements-only substep when no articulation); `substep` (~:514-574) computes `frames` once and passes it to `BodyCollision.rows` (new optional param) and `elements.prepare`; append element rows AFTER body-collision rows and after the `blocking` filter (balls never set `blocked`); pass `coupled` in ContactSet; extend the catch (~:558-563). New `gameState()` and `elementSnapshot()`. `pose()` unchanged (golden).
- `bodyCollision.ts`: `rows(art, h, m, frames?)`; extract body placement (~:275-285) into `placeRobotBodies(frames, h)` shared with ElementWorld; same arithmetic.
- `worldSpec.ts`: `WORLD_SPEC_VERSION` 7; types below; parse step after the collider fields (keep error order); Cylinder collider kind.
- `seasons/fieldSpec.ts` (~:119): `elements`; extend `checkFieldSpec`. `seasons/biobuzz.ts`: element types + GARDEN layout (+ LOADING ZONE re-entry slots derived from zones). `none.ts`: `elements: null`. `symmetry.ts`: `mirrorElementPlacement`.
- `shared/play.ts`: `gameState` PlayEvent; new SimNoticeCodes.
- Main: `main/sidecar/world.ts` `SimWorld.gameState?()`, `elementSnapshot?()`; `session.ts` capture in `stepWorld` (~:624-661), `gameThrottle` 16 ms, flush at pause (~:492), Step end (~:608), finish before phase/finished (~:952) like pose; `settleWorld` gives final state.
- Renderer: preload component (`scene/model.ts`, new `scene/preload.ts`, `project/projectFile.ts` v14, sceneStore `setPreload`, new `editor/preload/` card/model/gizmo, Add Component entry), Cylinder Collider (`scene/collider.ts`, collider card/gizmo/fit, `play/worldColliders.ts`), world building `play/worldElements.ts` + `playActions.worldFor` `withElements` after `withRunField`, `playStore` (`simGame`, `ghostGame`, `lastRunElements`, `run.elements`), `playSettings.ts` (`gameElements`), scene `editor/scene/ElementsView.tsx` + `elementsViewModel.ts` mounted in `FieldView.tsx`, `FieldInspector` section, Preferences › Simulation, i18n ko/en, `consoleModel`.

### World spec v7 (`elements` optional top-level key)

```ts
export type SimElementKind = 'pollen' | 'nectarRed' | 'nectarBlue'
export type SimElementGroup = 'garden'            // 6b adds 'flower' | 'hiveCell'; 6d 'humanPlayer'
export type SimPreloadSpec = { kind: 'pollen'; body: number; position: Vec3 } // body frame at q=0 (−1 = robot frame)
export type SimElementState = { kind: SimElementKind; position: Vec3; orientation: [number, number, number, number]; velocity: Vec3; angularVelocity: Vec3; asleep: boolean; out: boolean }
WorldSpec.elements?: { groups: SimElementGroup[]; preloads: SimPreloadSpec[] } // 6d adds initial?: SimElementState[]
```

Parse: read after colliders; groups unique & known; season `elements` non-null; ≤ 4 preloads; `body < joints.length`, ≥ −1; coords finite within MAX_COORD; total spawn ≤ 64. Missing key → result object has no key (v6-identical except version). Update the ~12 test files/fixtures that reference version 6.

### Cylinder collider (user decision; Unity has none → temporary deviation)

- Scene `colliders` kind `'cylinder'`: Center, Radius, Height (full, flat caps), Direction X/Y/Z — like Capsule. `sanitizeCollider` ranges like capsule (radius [5e-4,1], height [1e-3? ,20]).
- World spec `SimCollider` `{kind:'cylinder', a: Vec3, b: Vec3, radius}` in body frame (endpoints = cap centres; segment ≥ MIN length; |coords| ≤ 10 m).
- Ball pairs: exact sphere–solid-cylinder closest point (side, cap face, rim edge) → normal/depth.
- All other pairs (walls, structures, floor, self-collision with other robot bodies, preload overlap checks): circumscribed 32-gon prism hull (`cylinderPrism`-style, radius r/cos(π/32)) [가정], built once.
- Editor: Add Component › Simulation › Cylinder Collider, card ("Cylinder Collider" title untranslated), [하위에 맞추기] (axis = the bounds axis whose other two extents are most equal, radius = max of other two half-extents, height = extent along axis), gizmo (two circles + 4 lines, Unity collider colours), `bodyShapeReason`/counts updated, help text noting the Unity deviation. Builder sends endpoints.

## 2. Physics

### 2.1 State & integration (1 ms absolute grid shared with robot)

- Free prediction: `v* = v + h·(g + F_drag/m + F_L/m)`. Drag `F_drag = −½ρC_dA|v|v`; Magnus `F_L = ½ρA·min(C_Lmax, s·r|ω|/|v|)·|v|²·(ω̂×v̂)` (explicit; skip when |v| or |ω| tiny).
- Rolling and spin resistance: capped explicit angular impulses using previous substep's floor/support normal impulse λₙ′: `ω_t ← ω_t − min(|ω_t|, μ_rr·r·λₙ′/I)·ω̂_t`, `ω_n ← ω_n − min(|ω_n|, μ·r_s·λₙ′/I)·sgn`. No LCP rows. No-slip friction then gives deceleration ≈ `μ_rr·g/(1+I/mr²)`.
- After LCP: `x⁺ = x + h·v⁺`, `q⁺ = normalize(q + ½h·(ω⁺⊗q))` (sqrt only). Isotropic inertia I = 0.4·m·(r⁵−r_i⁵)/(r³−r_i³) with r_i/r = 0.95 → I ≈ 0.6344·m·r² (POLLEN ≈ 1.998e-5, NECTAR ≈ 5.477e-5 kg·m²) → no gyroscopic term.

### 2.2 Contacts & keys

- Normal n points from the other body into ball e; row velocity = n·(u_e(p) − v_other(p)).
- Ball part a_e = [d; (p − x_e)×d] in field axes.
- Robot part j = −art.relativeJacobian(frames, body, null, p_C, d_C). C frame floating base: p_C = p − (x, y, 0), field axes. Fixed base: p_C = R_startᵀ(p − start), d rotated likewise. A contact with the immovable chassis of a fixed-base robot gives j ≡ 0 → treat as static (does not join robot island).
- Static targets: `staticShapes` entries (walls w0–w3, solid/occluding field structures, floor fl) — `collision3d.ts:125-185`.
- Band: `|v_rel|·h + COLLISION_MARGIN`.
- Keys: new prefix `g`: `gn.e3/rk0`, `gt1.e3/j1k0`, `gt2.…`, `gn.e3/fl`, `gn.e3/w0`, `gn.e3/s11`, `gn.e2/e5`. Must not clash with existing prefixes `w n t f l u c`.

### 2.3 Soft normal & restitution

- Per-contact spring `k_c = 2·k_plate` (plate test = two contacts in series). Damping `c = 2ζ√(k_c·m_eff)`, ζ = 1; m_eff = ball mass or reduced mass for ball–ball (for ball–robot use ball mass).
- Penetration δ = −g > 0: `target = (h·k_c/(h·k_c + c))·δ/h`, compliance `γ = 1/(h·(h·k_c + c))` added to A_kk: `w = Aλ + b + γλ ≥ 0`, λ ≥ 0. Quasi-static force ≈ k_c·δ.
- Speculative (g ≥ 0): target = −g/h, keep γ.
- Hard core: δ ≥ δ_core = CORE_DEPTH_RATIO·r → rigid row (γ = 0, target = 0, no push-out) + notice `elementCrushed`.
- Restitution: if `v_n* = J·u* < −V_BOUNCE` and `−v_n*·h > g`: `target = e·(−v_n*) − (1+e)·max(g,0)/h`, γ = 0. e by surface class: floor, hard (walls/structures), element, robot.

### 2.4 Friction

Two box rows per contact ±μλₙ, `friction:{normal,mu}`, existing 2-pass stagger. μ = Unity Average of element μ and surface μ (collider friction, WALL_FRICTION, structure μ, FLOOR_FRICTION). Tangent compliance `γ_t = TANGENT_COMPLIANCE_RATIO/m_e`.

### 2.5 Robot coupling (exact)

KKT `[[M̂,0],[0,M_E]]·[v;u] = [p;p_E] + [Jᵀ;J_Eᵀ]λ`, M_E diagonal ⇒

- `A_kl = j_kᵀM̂⁻¹j_l + Σ_{e∈P_k∩P_l} a_kᵀW_e a_l + δ_kl·γ_k`, `W_e = diag(1/m ×3, 1/I ×3)`
- `b_k = j_kᵀv* + Σ_e a_kᵀu_e* − target_k`
- `v⁺ = v* + Σ y_k λ_k`, `u_e⁺ = u_e* + W_e·Σ_{k∋e} a_k λ_k`
  In `constrained`: `y_k = ldlSolve(factor, j_k)` only when j_k ≠ 0. Skip the single-coordinate snap (~:1173-1182) for rows with element parts. `clampLimits` adds the same element blocks and γ to its external rows (`b = j·v + a·u − target + γ·λ_main`) and updates u. Flywheel slowdown and roller reaction fall out of this.

### 2.6 Islands, ordering, sleeping

- Pair order: for each ball e ascending: robot shapes (body −1…, collider k), statics (w0–w3, s*, fl), balls f > e; each pair once, sorted by (min, max, token); within a pair: points, then n, t1, t2.
- Union-find root = smallest index; R's island via `art.step`; others in root order.
- Sleeping: timer counts while |v| and |ω|r < SLEEP_SPEED; island sleeps when every member ≥ SLEEP_TIME and not R's island; on sleep v = ω = 0 exactly. Wake when an awake ball or robot pair produces a manifold point. GARDEN balls spawn asleep (placed exactly at rest); preloads spawn awake.

### 2.7 Budgets, failure, performance

- Robot island row cap MAX_COUPLED_ROWS (separate from MAX_COLLISION_ROWS); balls admitted robot-contact-first then by depth; excess solved one-way against kinematic robot at v* (`b += j·v*`) + notice `elementCouplingLimit`.
- Failure: R's solve throws → current behaviour (robot v = 0) + coupled balls' u = 0. Ball island throws → zero only that island + `worldError {detail:'element island e<root>: …'}`. Pair with non-finite values dropped + `worldError 'element e3/rk0'`.
- Performance targets (logged by `elements/elementPerf.test.ts`, CI cap 5× like collisionPerf): P1 56 asleep ≤ +0.02 ms over baseline; P2 56 awake on floor ≤ 0.3 ms; P3 4 preloads held while driving ≤ 0.7 ms; P4 8 coupled ≤ 1.5 ms p99 ≤ 4 ms; P5 12-ball corner pile ≤ 0.4 ms. If P3/P4 miss: weld relative sleep or Woodbury-structured factorization (decide before freezing the 9th hash). User chose accuracy first: slower than realtime is acceptable.

### 2.8 Out of field & re-entry (user decision)

- "Out": centre beyond a wall's OUTER face (innerHalf + thickness) by more than r in x or y, or z < OUT_OF_FIELD_Z. Then: removed from physics (no rows), hidden in display (flag out), `outSinceNanos = t`.
- After REENTRY_DELAY_NANOS (3 s [가정]) POLLEN is re-entered by "field staff": choose the LOADING ZONE (red or blue; season zones `RED_LOADING_ZONE` + mirror in biobuzz.ts) whose centre is nearest to the exit point (ties: red first); candidate slots = positions inside that zone touching the perimeter wall (z = r, centre r + 0.5 mm from the wall inner face), ordered from the zone centre outward deterministically; take the first slot whose sphere does not overlap the robot outline prism/colliders (use the robot's current footprint) or other balls; place at rest (v = ω = 0, awake). If none free, retry every tick (no sim stop). NECTAR re-entry belongs to 6d (human player) — in 6a NECTAR never spawns except in perf tests; if NECTAR goes out in 6a just keep it out (flag) and note.
- simNotices (once per run per code+params): `elementOutOfField {kind}`, `elementReentered {kind}`.

## 3. Preload component (PROJECT_VERSION 14)

- Data `SceneObject.preload?: { kind: 'pollen'; enabled?: false; center: Vec3 }`; allowed on group/assembly/part, not robot or CAD root (`canHavePreload` like `canHaveWheel`); one per object; 4 per robot. `sanitizePreload` clamps centre to ±10 m, removes −0, fixed key order; `samePreload`.
- Store `setPreload` immutable, one undo step, no-op for same value; `isPlaceholderScene` treats preload as content.
- File v14: parse object (`kind` enum, `center` vec3, optional `enabled` boolean); else `invalidData`; v13 and below have no key (rewrite only bumps version). The same v14 also carries Cylinder colliders.
- Builder `play/worldElements.ts`: slot = object pivot + center expressed in its body frame via `jointBodyFrames` and `robotMeshIndex` (follows joint bodies at q = 0). Slots in hierarchy order. Warnings: `worldTooManyPreloads`, `worldPreloadOverlap` (separation < −1 mm vs robot colliders or other slots, `shapeSeparation`), `worldPreloadBelowFloor`, `worldPreloadNoRoom` (auto placement failed). No slots → `autoPreloadSlots` (front → back → left → right).
- Inspector `editor/preload/PreloadCard.tsx`: card order … Collider → Preload → Scripts; header enable checkbox, title "Preload Slot" (untranslated), simulation badge, [Remove]; fields Element (POLLEN, disabled select), Center (display units, accepts `12in`); info: slot n/4, body (chassis or joint name), orphan (not under a robot), overlap/limit warnings. Add Component › Simulation entry disabled with tooltip when object already has one or robot has 4. Robot card shows preload source (slots vs auto face vs none).
- Gizmo `PreloadGizmos.tsx`: three great circles at POLLEN diameter, yellow, two depth passes, renderOrder 11, not clickable; during a run follows display pose.
- Unity analogy: empty GameObject with a spawn-point MonoBehaviour drawing OnDrawGizmos wire spheres.

## 4. Initial layout & settings

- Spawned in 6a: GARDEN POLLEN 4 + 4 (red at x = innerHalf − r, y = −innerHalf + r(1+2k), z = r, k=0..3 — check: CM says starting in the corner closest to the alliance area against the audience or rear wall; verify against biobuzz.ts GARDEN zone and startKeepOut and adjust; blue = Rz(π) mirror) + robot preloads = 12 balls.
- Deferred: FLOWER POLLEN → 6b; HIVE CELL NECTAR → 6b; human-player NECTAR → 6d. NECTAR types defined now.
- Season data `FieldSpec.elements: { types, layout, reentry? } | null`: type fields radius, mass, inertia, material(display colour; reflectance for 6c), contact {plateStiffness, coreDepthRatio, friction, rollingResistance, spinRadius, restitution{floor, hard, element, robot}}, air {dragCoefficient, magnusSlope, magnusMax}. `checkFieldSpec`: every placement has an Rz(π) partner, sphere vs statics separation ≥ −1e-9, no pairwise overlap, resting on floor (z = r).
- Assumed values [가정] (POLLEN / NECTAR): k_plate 3000 / 4500 N/m; e floor 0.30, hard 0.64, element 0.5, robot 0.5; μ 0.5; μ_rr 0.05; C_d 0.5; Magnus slope 0.5, max 0.3; core 0.3·r; re-entry 3 s; cylinder 32-gon for non-ball pairs; sleep thresholds. Masses/diameters are sourced (AndyMark: POLLEN 24.9 g Ø0.0711 m; NECTAR 41.3 g Ø0.0914 m).
- Setting `RendererPlaySettings.gameElements: boolean` default ON, personal, renderer-only like `hiveState` (`playSettings.ts`), not sent by `runSettings`. In Preferences › Simulation and a new Field inspector section "경기 요소" (toggle, counts per group with 6b/6d labels for deferred groups, preload source per robot). `PlayRunField` records it so a running session keeps its value.
- Editor display: ElementsView draws the layout as opaque non-pickable balls when BIOBUZZ and setting on, plus preload balls for the target robot (auto placement translucent; same targeting rule as StartMarkers). Hidden by `fieldElementsHidden`/isolation.

## 5. Protocol & renderer

- Event: `{ type: 'gameState'; runId; tNanos; revision; poses: number[] /* 7·N ints: xyz×1e4, quat×1e4 */; flags?: number[] /* bit0 asleep, bit1 out */; final?: SimElementState[] /* only at finish */ }`.
- Main: `stepWorld` keeps latestGame only when revision changed; `gameThrottle` 16 ms separate from poseThrottle, same cadence; flush at the three pose flush points; t = 0 flushes immediately. Validate finite / lengths (≤ 64·7).
- Renderer: `run.elements.kinds` from the builder via shared `elementSpawns` order; events with mismatched length ignored. `simGame` separate slice (never touches run/simPose); at run end → `ghostGame` (like endPose) and `lastRunElements` kept for 6d. ElementsView: three dynamic InstancedMeshes + three ghost meshes (translucent, renderOrder 5), updated imperatively from `usePlayStore.subscribe` + `invalidate()`; raycast no-op; materials/geometry via deferred dispose (StrictMode). 60 Hz robot pose path and poseDisplay untouched.

## 6. Tests

- Analytic (`elements/*.test.ts`, drag & Magnus off unless needed): slide→roll v₀/(1+I/mr²) and rolling decel μ_rr·g/(1+I/mr²) ±2%; bounce from 0.5 m → e²h₀ ±2%; resting ball still 10 s with sleep off (|v|<1e-5, drift<1e-6 m), sleeps at 0.5 s, sinks mg/k_c ±1%; wall-backed pyramid & 4-ball row stable 5 s, energy non-increasing, penetration below core; chassis push: ball reaches robot speed, robot momentum drop = m_bΔv ±1%, penetration < 1 mm, ω = v/r; CR-servo roller intake pulls ball to a backstop, normal ≈ k_c·δ ±5%; flywheel + fixed hood free spin: exit speed ≈ ω₁R/2, ω₁ = ω₀/(1 + 0.4085·mR²/I) ±5%, angular impulse R·λ_t = IΔω ±1%, energy loss ≥ 0 — run with Mesh 64-pt and Cylinder collider and compare; motor-driven flywheel recovery; 5 m/s restitution no tunneling; island failure containment.
- Out-of-field: POLLEN thrown over the wall re-enters after 3 s in the nearer LOADING ZONE against the wall; blocked slot waits; deterministic.
- Determinism: same trace twice byte-identical incl. elementSnapshot; shuffled construction order unchanged.
- Golden: 8 unchanged (version assertion bumped). 9th: BIOBUZZ red GARDEN, mecanum robot with box chassis collider + Cylinder intake roller (CR servo, μ 1.0) + 4 hopper preload slots; drive into the GARDEN with intake on for 3 s; tracer appends the snapshot per tick.
- Contract/spec: v7 parse (absent key = v6 values), v14 file, preload sanitize/undo, cylinder collider sanitize/file/card, builder auto placement / NoRoom / overlap warnings, checkFieldSpec element rules, session gameState throttle & flush order, playStore ghost, ElementsView instance counts / hidden / no raycast.
- Integration: hand-built scene (preload on an empty group in a hopper) → buildWorldSpec + withElements → JSON → parseWorldSpec → PhysicsWorld; first-tick positions == shared elementSpawns.
- Performance P1–P5.
- E2E (real app, xvfb): INIT shows GARDEN balls + preloads; keyboard TeleOp intakes and shoots; STOP leaves ghost layout; ball shot over the wall comes back in a LOADING ZONE; Field toggle turns elements off; v14 save/reopen; undo preload/cylinder; realtime factor logged.

## 7. 6b–6d seams

- 6b: generalize `ElementPart` to `BodyPart` with a W-provider so the HIVE can be a dynamic 1-DOF pivot in the islands; FLOWER inner static hulls; `flower`/`hiveCell` layout groups; cameras read HIVE angle per tick.
- 6c: sphere layer from `tickState()` in fieldRaycast and vision occlusion; materials for color sensor.
- 6d: scoring zones, G407-type notices, human-player injection, AUTO→TELEOP continuation via `elements.initial` (final snapshot + robot's last pose).

## 8. Assumptions document (user request)

New `docs/assumptions.md` (Korean): one table per stage (3a,3b,3c,4ab,4c,4d,5,6a + sidecar timing/vision), columns: 항목 · 값 · 위치(파일·상수) · 근거/출처 · 측정 방법 · 상태. Sweep every `[가정]` in src/, sidecar/, and CLAUDE.md "가정"/"실측이 필요한 값" lists. CLAUDE.md gets an invariant: new assumed values go in code `[가정]` comments AND this file.

## 9. CLAUDE.md updates (final step)

Status paragraph (6a), invariants (9 golden hashes, WORLD_SPEC_VERSION 7, PROJECT_VERSION 14, MESH_CACHE_TAG unchanged unless changed, assumptions doc rule, Cylinder Collider temporary deviation), a 6a code-structure bullet like the 4c/4d/5 bullets (modules, physics, coupling, islands, out-of-field, preload, cylinder, renderer, tests, limits), and fix sentences that say elements don't exist.
