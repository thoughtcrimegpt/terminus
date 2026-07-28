# TERMINUS — patch notes

## v1.0.1 — 2026-07-28

- Added GoatCounter page-view analytics. The script only injects on `github.io`, so local
  testing and `file://` opens never count against the deployed stats.

## v1.0 — 2026-07-28 — "the feed goes live"

First release. A living predator–prey ecosystem after the singularity:
**scrap → survivors → machines**, running on emergent agent rules with nothing scripted.

- Three trophic levels with live-tunable parameters and a rolling population chart.
  Defaults tuned to a self-sustaining Lotka–Volterra oscillation — survivors peak, machines
  peak ~15s later, survivors crash, machines starve, scrap recovers, repeat.
- **Panic** — survivors sense machines and flee; panic range is deliberately shorter than
  machine sight, so the machines usually see first.
- **Concealment** — dense scrap is cover, shortening a machine's effective sight range.
  Food and safety share the same ground.
- **Self-improvement** — the machines' threat model versions up every 400 terminations
  (v1.0 → v2.2 max), buying sight, pursuit speed and efficiency. The equilibrium is slowly
  negotiated away. Toggleable.
- Brushes for dropping in survivors, machines and scrap, or clearing a region.
- Three scenarios: EQUILIBRIUM, THE PURGE, REWILD.
- Cold-open transmission, procedural WebAudio drone and kill ticks, corpse litter, system
  event log, CRT scanlines, kill-rate vignette, live tab title, and a glitching
  HUMANITY: EXTINCT end-card with run statistics.
