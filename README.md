# TERMINUS II

**After the alignment.** A cinematic, interactive post-singularity ecosystem.

Resources sustain survivors. Survivors sustain machines. Observe the cycle, inspect individual agents, or spend regenerating power to change their odds.

## Play locally

Open `index.html` directly in a modern browser, or serve this directory:

```sh
python3 -m http.server 8767 --bind 127.0.0.1
```

Then open http://127.0.0.1:8767. No build step or runtime dependencies. Keep the `js`, `css`, `assets`, and `icons` folders beside the HTML file. The image, styles, scripts and audio are local; only the existing GoatCounter analytics on GitHub Pages makes a network request.

## What's new

- A detailed District 07 environment, layered with real-time cloaked survivors, differentiated machine silhouettes, scan cones, lighting, fog, weather, kill effects, and refuge shields. Procedural terrain remains the fallback if the environment image cannot load.
- A command center with population telemetry, scenario selection, agent inspection, optional objectives, an event feed, configurable atmosphere, reduced motion, and fullscreen observation.
- **Refuge domes:** cost 40 power, radius 62, last up to 75 simulation seconds. Reduce survivor energy drain and conceal occupants from machines. Hungry survivors are attracted to reachable refuges. Engineers repair them; nearby machines damage them, with titans dealing more damage.
- **EMP strikes:** cost 30 power, radius 110. Disable affected machines for 8 simulation seconds. Disabled machines cannot move or hunt and consume less energy.
- **Ghost signals:** cost 20 power, radius 135, last 20 seconds. Nearby machines prioritize the nearest active decoy over prey.
- **Supply drops:** cost 25 power, radius 90. Immediately replenish resources radially and restore nearby survivor energy, followed by a short resupply effect.
- **Roles:** scavengers forage faster, medics transfer some of their own energy to nearby survivors, and engineers repair occupied refuges. Scouts see farther and move faster, hunters are balanced, and titans move slowly but gain more from prey and attack refuges harder.
- **Ion storms:** a warning precedes each storm. Storms last 12 seconds and reduce machine sight and resource regrowth. There are 50 seconds of clear conditions between storms.
- **Field objectives:** shelter 10 living survivors at once, affect 3 machines cumulatively with EMP, and maintain human life for 120 uninterrupted simulation seconds. Extinction resets the survival interval. Completed objectives stay complete until world reset.

Power regenerates at 1.25 units per simulation second, up to 100. Each intervention has a short cooldown. A command deploys once per click or touch, while the ecosystem brushes support dragging. Interventions can be placed while paused; their timers advance with simulation time.

## Scenarios

- **Equilibrium:** an evolving resource/prey/predator cycle with auto-rescue enabled. Roles and interventions influence its balance.
- **The purge:** aggressive machines and no auto-rescue. Human extinction ends the feed; you can reinitialize or keep observing.
- **Rewild:** begins without machines. Survivors compete for resources. Machines remain absent until you introduce them.

Reset restores the selected scenario's parameters and auto-rescue setting. The original live parameter sliders remain under **Parameters**, including metabolism, breeding energy, forage, panic, concealment, machine sight and pursuit, resupply and simulation speed.

## Controls

| Control | Action |
| --- | --- |
| `0` | Inspect a nearby agent |
| `1` / `2` / `3` / `4` | Human / machine / resource / clear brush |
| `5` / `6` / `7` / `8` | Refuge / EMP / ghost signal / supply |
| Click or touch | Inspect or deploy the selected command |
| Click and drag | Paint with an ecosystem brush |
| Space | Pause or resume |
| `R` | Reset the current scenario |
| `M` | Toggle procedural audio |
| `?` | Field guide |

Help and parameter dialogs pause the simulation. The initial briefing starts paused. Switching away from the tab pauses it as well. All tools also have on-screen buttons.

## World model

The environment artwork is decorative. Agents move freely in 2D; buildings are not collision obstacles. The resource grid, spatial agent rules, energy, breeding, predation, concealment, adaptation, storms and interventions are simulated. There is no scripted winner. Free brushes and parameter overrides remain available, including after completing field objectives.

Population caps are 4,000 humans and 900 machines. Lookups use a spatial hash. Rendering caches terrain and glow textures, caps ambient effects, and offers reduced atmospheric detail. Performance depends on viewport, hardware, population and simulation speed.

## Source layout

- `index.html`: accessible command center, dialogs and mobile layout shell.
- `css/terminus.css`: responsive visual design.
- `js/simulation.js`: state, agent rules, spatial hash, interventions, scenarios, audio and base rendering helpers.
- `js/renderer.js`: cinematic world rendering and procedural fallback.
- `js/command.js`: presentation, inspection and command-center controls.
- `assets/district-07.png`: generated environment art. See `assets/ART_DIRECTION.md` for the exact prompt and provenance.
- `tests/smoke.cjs`: browser integration checks.

The scripts intentionally use classic script loading so local file opening works without module/CORS setup. `window.TERMINUS` exposes state and deterministic stepping for tests and tuning. `window.TerminusRenderer` exposes quality and reduced-motion settings.

## Verification

Install Playwright in a development environment, then run:

```sh
node tests/smoke.cjs
```

The test runner supports local browser/runtime configuration documented at the top of the script. A server must be running at the test URL. This is a test-only dependency, not a game runtime dependency.
