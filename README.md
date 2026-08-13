# RFE Prototype Test-Bed — Editable Local UI Harness

An editable structural prototype based on the RFE Base UI Specification v1.2. The implementation keeps the approved lighter grey-lilac desktop and lightly separated studio windows while borrowing compact control hierarchy from the secondary Figma reference.

In development, the **RFE UI Workshop** appears in the upper-right. It provides live controls for the shared palette, layout, geometry, typography, node and thread tokens. Changes persist locally in the current browser.

## Run locally

Requirements: Node.js 22.13+ and pnpm.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

For a production check:

```bash
pnpm build
pnpm test
```

## What is included

- Threads, Thread Inspector and contextual Monitor windows
- Reusable window, node, slider and diagnostic metric components
- Centralised visual tokens in `app/globals.css`
- Representative module graph and routing connections
- Selectable nodes with shared Inspector state
- Editable timing and injection controls
- Dynamic add/remove channel test-bed with scroll-contained large populations
- Dynamic isolated sine sources with independent frequency, exact 1 Hz tuning, compact level and Start/Stop controls
- Place transfers a sine player into Threads as one channel-bound output-only source node for explicit Channel Out wiring
- Channel Out disconnection smoothly silences only that channel while preserving its source and programmed state
- Sound Desk X-axis stereo placement and bounded relative Live Trim per plotted channel
- Threads Monitor reports `SD MUTED` for a focused active route at -100% Live Trim instead of implying a missing signal
- Shared Threads/Sound Desk/Visualiser Play/Pause/Stop transport paired to the elapsed session timer
- Contextual Monitor readout with one analyser-derived composite waveform of every sounding routed channel
- Shared session/master output separated from channel-owned audio resources
- Session running/paused state and studio/compact layout switch
- Responsive tablet and narrow-screen adaptations
- Development-only UI Workshop with live token editing
- Baseline, Studio / Spacious and Compact visual presets
- Local browser persistence, baseline reset and readable JSON export
- Named Figma test-build favourite palette extracted from the supplied reference image
- System eyedropper support with an imported-image click sampler fallback
- Palette import/export using simple JSON colour arrays or named palette entries

## Milestone boundaries

The approved repository baseline is Milestone 09. It includes verified multi-channel concurrency, channel-bound sine source placement/wiring, X-axis stereo placement, relative Live Trim, smoothed shared transport paired to the elapsed timer, composite sounding-channel Monitor waveform, and explicit Sound Desk mute status. Y audio, distance/depth/elevation, automatic distribution, Blend/processing semantics, arbitrary graph mixing, recording and sample playback remain unimplemented.

The current local-only M10/M10.1 candidate adds Clone/Duplicate source semantics and a non-bypassable final sample-peak safety boundary. Its commissioning oscillator range is 50 Hz–10 kHz; this is not a safe-frequency claim. The compact Monitor reports measured post-protection sample peak in dBFS, peak hold, reduction and safety state. It does not report acoustic SPL or true peak. See `SAFE_LISTENING_CHARTER.md` and `milestone_notes/milestone_10_1_output_safety.txt`. This candidate is unapproved and must not be promoted until user acceptance.

## Main editing surfaces

- `app/page.tsx` — data, reusable components, layout and local prototype state
- `app/audio-runtime.ts` — shared Web Audio infrastructure and isolated channel-instance lifecycle
- `app/globals.css` — design tokens, window language and responsive behavior
- `app/ui-config.ts` — typed baseline tokens, presets and CSS-variable mapping
- `app/ui-workshop.tsx` — development-only visual editing panel
- `app/layout.tsx` — page metadata and global shell

The Workshop is removed from production rendering. Its local values do not affect note, routing, diagnostic, engine or future simulation state.

Palette JSON may be a simple array such as `["#3f3055", "#a491be"]`, or an object containing `colors` or `palette`. Named entries accept `{ "name": "Selected Surface", "value": "#3f3055" }`.
