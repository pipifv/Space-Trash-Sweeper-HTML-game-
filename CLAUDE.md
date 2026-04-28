# ProjectPlane — 天火：终极进化 (AI Codebase Reference)

## Project Identity
- **Title**: 天火：终极进化 / SkyFire: Ultimate Evolution
- **Type**: Single-player 3D tunnel shooter (starfox-like), browser-based
- **Genre**: Sci-fi arcade bullet-hell with roguelike talent progression
- **Entry Point**: `index.html` — open directly in browser, no build step
- **Original**: `../planeNewUI.html` (2385-line monolith — preserved as reference)

## Tech Stack
| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| 3D Engine | Three.js | r128 | Legacy global-script loading (`THREE.*`), NOT ES module |
| Animation | GSAP | 3.12.2 | Used exclusively by `TargetCursorVanilla` |
| PostFX | EffectComposer + UnrealBloomPass + ShaderPass | r128 | Legacy `examples/js/` loading |
| Audio | Web Audio API | — | Procedural synth BGM + SFX, no audio files |
| Storage | localStorage | — | All save data, no server |
| Fonts | Google Fonts — Orbitron | — | weights: 500, 700, 900 |

## File Map & Dependency Order

```
index.html                  # Shell: CSS ref, DOM skeleton, <script> load chain
├── css/style.css           # All styles (~280 lines, CSS custom properties)
└── js/                     # Loaded in THIS exact order (globals chain):
    ├── config.js           # [1] CONFIG, MODES, MECH_CONFIGS, METEOR_TYPES, TALENTS_DB, ACHIEVEMENTS_DEF, SAVE_DATA, globalThree
    ├── dom-cache.js        # [2] DOM singleton — caches all frequently-accessed DOM elements
    ├── cursor.js           # [3] TargetCursorVanilla class (uses GSAP)
    ├── background.js       # [4] Ring animation loop (self-starting rAF)
    ├── particles.js        # [5] ParticleSystem class (uses THREE)
    ├── sfx.js              # [6] SFX singleton — Web Audio procedural synth
    ├── ui-helper.js        # [7] UIHelper singleton + window.* global bridge functions
    ├── game.js             # [8] Game class — the entire game loop
    └── main.js             # [9] window.onload bootstrap
```

**Load-order invariant**: Each file may reference globals defined in files above it. Never reorder without checking dependencies.

---

## Global Namespace Map

Every symbol below is a `window`-scope global (no modules, no IIFE wrapping):

### Constants (from config.js)
- `CONFIG` — Tuning parameters, partially hydrated from `localStorage.gameSettings`
- `MODES` — 7 game mode definitions keyed by modeId string
- `MECH_CONFIGS` — 3 mech types: `default`, `heavy`, `assassin`
- `METEOR_TYPES` — 6 obstacle tiers (id 0–5, id 5 is special "core" type)
- `TALENTS_DB` — 14 talent definitions × 4 tiers each
- `ACHIEVEMENTS_DEF` — 11 achievement definitions
- `SAVE_DATA` — Player progress object, hydrated from localStorage at load
- `globalThree` — Persistent Three.js context shared across Game instances
- `userConfig` — Mutable settings object (reference from `localStorage.gameSettings`)

### Singletons
- `DOM` — Cached DOM element references (populated at parse time)
- `SFX` — Audio context + synth methods + BGM scheduler
- `UIHelper` — UI mutation methods + timeout tracker + achievement popup system

### Classes
- `TargetCursorVanilla` — Custom sci-fi cursor (GSAP-driven, mobile-disabled)
- `ParticleSystem` — Object-pooled THREE.Mesh particle engine
- `Game` — The game loop (one instance at a time, stored as `window.gameInstance`)

### Live State
- `window.gameInstance` — Active Game instance (null when not playing)
- `window.customCursor` — Active TargetCursorVanilla instance
- `window.shopEventsBound` — Guard flag to prevent duplicate shop event listeners
- `ringWrappers`, `ringMouseX`, `ringMouseY`, `ringCurrX`, `ringCurrY` — Background ring animation state

### Global Bridge Functions (on window)
- `window.clearGameData()` — Nuke localStorage, reload page
- `window.showPanel(id)` — Switch UI panel; `null` hides overlay (enters game)
- `window.showModeSelect()` — Show mode select, update special-mode lock state
- `window.startGame(modeId)` — Destroy existing Game, create new one
- `window.saveSettings()` — Persist settings from DOM sliders to localStorage + CONFIG

---

## Persistent Data Schema (localStorage)

### Keys
```
totalCores         : integer   — lifetime currency earned
magnetCount        : integer   — consumable magnet powerups remaining
highScoresTime     : JSON[]    — top 5 [{time: float_seconds, score: integer}]
upgrade_armor      : integer 0–5
upgrade_engine     : integer 0–5
upgrade_weapon     : integer 0–5
unlockedMechs      : JSON[]    — e.g. ["default", "heavy"]
currentMech        : string    — one of: "default", "heavy", "assassin"
achievements       : JSON[]    — array of achievement ID strings
isFirstPlay        : "0"|absent — absent means first play
gameSettings       : JSON      — {BASE_SPEED, BGM_VOLUME, OBSTACLE_DENSITY, GRAZE_DISTANCE, MOUSE_SENSITIVITY, TUNNEL_RADIUS}
```

### SAVE_DATA Hydration (config.js `loadSaveData()`)
```js
SAVE_DATA = {
    totalCores: int,
    magnetCount: int,
    highScores: [{time: float, score: int}, ...],  // max 5
    upgrades: { armor: 0-5, engine: 0-5, weapon: 0-5 },
    unlockedMechs: ["default", ...],
    currentMech: "default"|"heavy"|"assassin",
    achievements: ["first_blood", ...],
    isFirstPlay: bool
}
```

---

## Game Architecture Deep Dive

### Lifecycle
```
User clicks mode button
  → window.startGame(modeId)
    → if gameInstance exists: gameInstance.destroy()  ← full cleanup
    → new Game(modeId)
      → constructor: initThree() → initTunnel() → initPlayer() → initEntities() → initPools()
      → bindEvents()
      → initShopEvents() (once ever, guarded by shopEventsBound)
      → start() → sets this.state, shows HUD
      → requestAnimationFrame(this.animate)
```

### Game.state Schema (the entire game frame)
```js
this.state = {
    // Core lifecycle
    playing: bool,          // false = dead or not started
    paused: bool,           // pause menu active

    // Progression
    time: float,            // elapsed seconds (timeScale-adjusted)
    lastSecCheck: int,      // last integer second for achievement polling
    actionScore: float,     // raw score accumulator from actions
    gold: int,              // cores collected this run
    combo: int,             // current combo counter
    comboTimer: float,      // seconds until combo resets (2.0s window)

    // Resources
    hp: float,              // current HP (0 = dead)
    energy: float,          // 0–stats.maxEn
    overload: float,        // 0–300 (300 triggers rampage)

    // Status Effects (all store Date.now() timestamps)
    invincibleUntil: timestamp,
    bulletTimeUntil: timestamp,
    bulletTimeActive: bool,
    stunUntil: timestamp,
    rampageUntil: timestamp,
    springboardUntil: timestamp,
    overloadCooldownUntil: timestamp,
    overloadDecayTimer: timestamp,
    doubleScoreUntil: timestamp,
    coreStringUntil: timestamp,
    safeTunnelUntil: timestamp,   // "safe zone" end time

    // Skill State
    activeSkill: null|'spread'|'ironWall'|'blink',
    skillActiveUntil: timestamp,
    skillCooldownUntil: timestamp,

    // Environment
    currentBiome: 'default'|'lava'|'quantum',
    tunnelRotation: float,        // z-rotation for quantum biome
    mouseX: -1..1, mouseY: -1..1, // normalized mouse position
    safeWallAngle: float,
    safeAngleTimer: float,
    dynamicDensityMultiplier: 0.5..1.5,

    // Roguelike Progression
    nextRoguelikeLevel: int,       // starts at 1, increments on level-up
    talents: [{id, tier, name, stat, val, valDesc}, ...],
    talentRecords: { [talentId]: [{tier, val}, ...] },  // max 2 records per talent
    rerollCount: int,
    harvestTimer: float,

    // Stats (aggregated from talents)
    stats: {
        hp:0, regen:0, dodge:0, armor:0,
        dmg:0, fireRate:0, crit:0, overload:0,
        maxEn:100, graze:0, cdr:0, harvest:0,
        magnet:0, luck:0
    },

    // Mission
    missionDuration: 0|30,   // 30 for special modes

    // Misc
    hasMagnet: bool,          // magnet consumable active this run
    isBoosting: bool,         // mouse button held
    isRampage: bool,
    lastFireTime: timestamp,
    lastHitTime: timestamp,
}
```

### Game Loop (Game.update)
```
animate() rAF loop
  └─ update()
       ├─ dt = clamp((now - lastTime)/1000, 0, 0.1)
       ├─ timeScale calculation (bulletTime: 0.05, normal: 1.0)
       ├─ state.time += dt * timeScale
       ├─ combo decay
       ├─ checkRoguelikeLevelUp()
       ├─ harvestTimer → periodic core gain
       ├─ regen tick
       ├─ every 1s: achievement polling, biome transition check
       ├─ mission complete check (special modes)
       ├─ speed calculation (base + stage ramp)
       ├─ updatePlayerState()    ← boost/rampage/overload FSM
       ├─ updateMovement()       ← mouse→ship lerp, camera shake
       ├─ updateSpawns()         ← probabilistic entity spawning
       ├─ updateCollisions()     ← bullet↔rock, wall↔ship, rock↔ship + graze
       ├─ updateEntities()       ← tunnel segments, meteor cleanup, item pickup
       ├─ particles.update()
       └─ updateHUD()            ← DOM stats + skill bars
```

### Object Pool Pattern
```
initPools(): pre-allocate 150 rocks, 50 bullets, 50 items, 20 meteors
getPooled(type): find first invisible mesh → make visible → return
               : if none, create new, add to pool, return
releasePooled(type, obj): set visible=false, teleport to (0,0,1000)
```
All pooled meshes are perpetually in the scene; visibility toggles reuse.

### Memory Management (Game.destroy)
Critical cleanup sequence:
1. `state.playing = false`
2. `cancelAnimationFrame(this.animationId)`
3. Remove all 5 window event listeners
4. `UIHelper.clearAllTimeouts()` — kills all pending setTimeout
5. `SFX.stopBGM()` — kills BGM scheduler
6. `clearScene()` — walls: `safeRemove()`; others: `releasePooled()`
7. `ParticleSystem.dispose()` — disposes all geometries + materials
8. `safeRemove(tunnelGroup)` — recursive scene removal
9. `safeRemove(ship)` — recursive scene removal
10. Pool drain: all pool meshes removed from scene via `safeRemove()`
11. `disposables.forEach(d => d.dispose())` — tracked geometries/materials
12. `DOM.floatingTexts/ActionLog/toastContainer.innerHTML = ''` — DOM cleanup

---

## Rendering Pipeline
```
THREE.Scene (globalThree.scene)
  ├─ AmbientLight(0x223355, 1.5)
  ├─ DirectionalLight(0xffffff, 2.0) at (5,10,5)
  ├─ FogExp2(color, 0.003) — color changes with biome
  ├─ tunnelGroup (4 repeating cylinder segments + 1 torus ring)
  ├─ ship (Group: body + wings + cockpit + engineFlame)
  ├─ Pooled objects (rocks, bullets, items, meteors) — 270 total
  └─ Dynamic obstacles (walls — geometry created per-wall, disposed on pass)

EffectComposer passes:
  1. RenderPass(scene, camera)
  2. UnrealBloomPass (SKIPPED on mobile — this.isMobile guard)
  3. invertPass — custom invert shader (activated during bulletTime: amount 0→1)
  4. FXAAShader — anti-aliasing

Camera: PerspectiveCamera(80°, aspect, 0.1, 1000) at (0, 2, 12)
PixelRatio: fixed at 1 (power-saving)
```

---

## Biome System
| Score Threshold | Biome | Fog Color | Wire Color | Visual Effect |
|----------------|-------|-----------|------------|---------------|
| 0 | default | #020813 | #003366 | None |
| 30,000 | lava | #301008 | #ff4500 | None |
| 80,000 | quantum | #200830 | #9933ff | Tunnel rotates on Z axis |

---

## Mode System (MODES)
```
rookie     adv    dmgMult:1.0  maxSpd:2.0   scoreMult:1.0  density:0.9   iframe:1200  stun:0
novice     adv    dmgMult:1.2  maxSpd:2.7   scoreMult:1.3  density:1.4   iframe:1200  stun:0
elite      adv    dmgMult:1.5  maxSpd:3.0   scoreMult:1.8  density:2.0   iframe:150   stun:100
ace        adv    dmgMult:2.0  maxSpd:3.5   scoreMult:2.5  density:2.2   iframe:100   stun:150
endless    endL   dmgMult:1.0  maxSpd:Inf   scoreMult:1.5  density:1.6   iframe:1000  stun:0
super_core spec   dmgMult:1.0  maxSpd:2.0   scoreMult:1.0  density:0     iframe:1000  stun:0   (30s, gold-only)
sweeper    spec   dmgMult:1.0  maxSpd:2.0   scoreMult:1.0  density:5.0   iframe:1000  stun:0   (30s, rocks-only)
```
- `iframe`: invincibility frames after hit (ms)
- `stun`: stun duration after hit (ms), 0 = no stun
- Special modes: 30-second fixed duration, excluded from leaderboard

---

## Mech System
| Mech | Scale | Speed | HP | Color | E-Skill | Passive |
|------|-------|-------|-----|-------|---------|---------|
| default | 0.6 | 1.0 | 1.0 | #00e5ff | Overload Spread (40en, 3s) | Rampage +1s, rampage dmg ×0.8 |
| heavy | 0.8 | 0.8 | 1.5 | #ffd700 | Iron Wall (50en, 3s) | 20% chance block for 50% dmg |
| assassin | 0.5 | 1.2 | 0.8 | #9933ff | Shadow Step (30en, instant) | Double combo gain, double graze energy |

---

## Scoring Formula
```
totalScore = floor(state.time * 100 * 0.4 + state.actionScore * 0.6)

actionScore sources:
  - Passive: currentSpeed * 2.0 * dt * doubleMult (accumulates per frame)
  - Rock destroy: 150 * type.scoreMult * (1 + combo * 0.1) * doubleMult
  - Core pickup: 800 * (1 + combo * 0.1) * doubleMult
  - Graze: 100 * (1 + combo * 0.1) * doubleMult
  - Crazy graze: 300 * (1 + combo * 0.1) * doubleMult

Leaderboard sorts by TIME (not score).
```

---

## Collision Detection
- **Wall↔Ship**: Angular sector check — wall defines a `startAngle`/`closedAngle` arc at `radius`; ship angle computed from `atan2(dy,dx)`, compared against arc accounting for wall's `rotation.z`
- **Rock↔Ship**: 2D distance (XY plane) against `hitRadius + 0.8`, checked at 3 lateral sample points; only when rock Z passes through ship Z
- **Bullet↔Rock**: Simple 3D distance against `rock.radius + 1`
- **Graze**: Same as rock collision but enlarged radius (+ GRAZE_DISTANCE + stats.graze); only triggers once per rock (grazed flag)

---

## Key Control Surface
| Input | Action | Context |
|-------|--------|---------|
| Mouse move | Ship position (normalized to tunnel radius) | Always |
| Mouse left hold | Boost (×2 speed, builds overload) | Game active |
| Space | Fire (150ms base interval, scales with fireRate) | Game active |
| Q | Bullet Time (costs 100en, 1.2s, destroys near obstacles) | Game active |
| E | Mech skill | Game active |
| Escape | Toggle pause | Game active |

---

## BGM System (SFX)
- Procedural 16-step sequencer: sine sub-bass, sawtooth bass, square melody
- Runs on `setTimeout(schedule, 30)` loop, not Web Audio scheduling
- Low-pass filter (2kHz normal, 500Hz low-health)
- Heartbeat oscillator (80Hz) pulses every 800ms when HP < 30%
- All SFX are short oscillator sweeps (play frequency → exponential ramp to 10Hz)

---

## Particle System (ParticleSystem)
- Object-pooled THREE.Mesh instances
- 3 geometry types: BoxGeometry(cube), PlaneGeometry(trail), SphereGeometry(smoke)
- Material cache keyed by hex color (AdditiveBlending)
- Each particle: `{velocity: Vector3, life: 0→1, decay: rate}`
- Mobile: particle count halved
- Full `dispose()` frees all geometries, materials, and removes from scene

---

## UI Panel State Machine
```
menu ──────────────────────────────────────────► game (showPanel(null))
  │  ├─ showModeSelect() → mode-select-ui
  │  ├─ showPanel('shop-ui')
  │  ├─ showPanel('achievements-ui')
  │  └─ showPanel('settings-ui')
  │
mode-select-ui
  │  ├─ startGame(modeId) → game
  │  └─ showPanel('menu')
  │
game active
  │  ├─ togglePause() → pause-ui
  │  ├─ checkRoguelikeLevelUp() → roguelike-ui (modal)
  │  └─ die()/missionComplete() → game-over
  │
pause-ui
  │  ├─ togglePause() → game
  │  └─ quitGame() → game-over
  │
roguelike-ui
  │  └─ selectTalent() → game (resume)
  │
game-over
  └─ showPanel('menu')
```

Panel visibility is controlled by toggling `.hidden` class on `.panel` elements and the `#overlay` container.

---

## Common Modification Patterns

### Adding a new game mode
1. Add entry to `MODES` in config.js
2. Add button in index.html mode-select-ui section
3. If special rules needed, add conditionals in `updateSpawns()` / `update()` / `start()`

### Adding a new talent
1. Add entry to `TALENTS_DB` in config.js with id, stat name, 4-tier values/descriptions
2. The `stats` object in game state must have a matching key (auto-incremented by `selectTalent`)
3. Add stat usage logic where appropriate (e.g., in `fire()`, `updatePlayerState()`, etc.)

### Adding a new achievement
1. Add entry to `ACHIEVEMENTS_DEF` in config.js
2. Call `UIHelper.unlockAchievement('id')` at trigger point
3. Achievement ID is the persistence key — idempotent (won't fire twice)

### Adding a new mech
1. Add `MECH_CONFIGS` entry
2. Add mech-row HTML in shop-ui
3. Add skill logic in `activateSkill()` and any passive logic in `updatePlayerState()`/`takeDamage()`/`fire()` etc.

### Modifying rendering
- Three.js scene is `globalThree.scene` (persistent, never recreated)
- Camera is `globalThree.camera`
- Renderer is `globalThree.renderer`
- Composer is `globalThree.composer` (may be null on mobile for bloom)
- New geometries/materials MUST be tracked via `this.track()` for disposal on destroy

---

## Critical Safety Rules
1. **Never reinitialize `globalThree`** — it's created once and reused across all Game instances
2. **Always call `this.track(geoOrMat)`** for any disposable Three.js resource to prevent GPU leaks
3. **Always check `this.particles` for null** before calling update (it's nulled in destroy)
4. **DOM element references in `DOM` object** are captured at parse time — if replacing HTML, reinitialize DOM
5. **`shopEventsBound` guard** prevents duplicate event listeners across Game restarts
6. **Mobile detection** uses `/Mobi|Android/i.test(navigator.userAgent)` — affects cursor, particles, bloom
7. **`localStorage` is the sole persistence layer** — no server, no IndexedDB
8. **Panel visibility** depends on `#overlay` container state + individual panel `.hidden` class
