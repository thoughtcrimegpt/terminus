# TERMINUS

A living predator–prey ecosystem, set after the singularity.

**scrap → survivors → machines**

Three trophic levels, one closed loop. Scrap caches replenish in the ruins. Survivors forage
the scrap and breed. Machines hunt the survivors and replicate. Nothing is scripted — every
boom, famine and collapse on the chart falls out of the agent rules.

Single self-contained HTML file. No build step, no dependencies, no network calls.
Open `index.html` in a browser.

## What it does

- **Live Lotka–Volterra dynamics.** Survivors peak, machines peak ~15s later, survivors crash,
  machines starve, scrap recovers, and the cycle restarts. It oscillates indefinitely at the
  default settings.
- **Drop things in.** Paint survivors, machines, or scrap straight onto the world, or wipe a
  region clear. The sim absorbs it and re-stabilises.
- **Everything is tunable live** — metabolism, breeding cost, forage speed, prey yield, sight
  range, resupply rate — with a rolling population chart underneath.

## Two mechanics that aren't just predator/prey

- **Panic.** Survivors sense machines inside their panic range and flee, running faster than
  they forage but burning energy to do it. Panic range is deliberately shorter than machine
  sight range, so machines usually see first.
- **Concealment.** Dense scrap is cover. A survivor standing in a rich cache is harder to
  detect, which shortens a machine's effective sight range. Food and safety occupy the same
  ground, so survivors are pushed toward exactly where the machines patrol.

## The feed

The page opens as a "live feed" — a short typed transmission, then the world. Extras that
make it read like surveillance footage rather than a toy:

- **Self-improvement.** The machines' threat model versions up as terminations accumulate
  (v1.0 → v2.2 max): each level quietly buys them more sight, more pursuit speed and a lower
  metabolism. The equilibrium you're watching is slowly being negotiated away. Toggle it off
  in the MACHINES panel for a pure fixed-parameter ecosystem.
- **System log.** A cold event feed in the corner of the stage — threat model updates,
  termination milestones, population collapse warnings, extinction notices.
- **Corpses.** Kills leave fallen figures that litter the field and fade over ~30 seconds.
  The red vignette pulse tracks the live kill rate.
- **Extinction.** With auto-rescue off, humanity hitting zero ends the feed: a glitching
  end-card with time survived, total terminated, and the final threat model version.
  THE PURGE preset disables auto-rescue so it's allowed to actually finish.
- **Sound.** Procedural WebAudio — a low ambient drone plus kill ticks, all generated,
  no assets. Enabled from the intro or the `M` key. The tab title tracks the living
  ("TERMINUS — 214 remain").

## Controls

| | |
|---|---|
| `1` `2` `3` `4` | Human / Machine / Scrap / Clear brush |
| click + drag | paint into the world |
| `space` | pause |
| `R` | reset |
| `M` | sound on/off |

## Scenarios

- **EQUILIBRIUM** — the default oscillation. Neither side wins.
- **THE PURGE** — wide-sighted, low-metabolism machines with almost no cover to hide in.
  Survivors are wiped out in roughly fifteen seconds and only persist via auto-rescue.
- **REWILD** — no machines at all. Survivors grow logistically, overshoot the carrying
  capacity of the scrap, and mass-starve on their own. Then drop a single machine in.

## Notes

Auto-rescue only restores a species that has actually existed since the last reset, so REWILD
stays machine-free until you place one yourself.

Agents are capped at 4000 survivors / 900 machines. Neighbour lookups go through a spatial
hash and the scrap grid is drawn in batched passes, so it holds 60+ fps at the caps.
