# RFE Milestone 09 local quality gate

The combined Milestones 08–09 batch is implementation-complete, automatically verified, and user-approved as the Milestone 09 project baseline.

## Run locally

- Launch the app: `pnpm dev`
- Run build, typecheck and lint: `pnpm run check`
- Run the focused browser and axe checks: `pnpm run test:e2e`
- Verify and prepare the stress fixture: `pnpm run test:stress-ui`

## Read the GitHub result

Open the repository on GitHub, choose **Actions**, then open **UI Quality Gate**. A green tick is PASS. A red cross is FAIL; open the failed step for its log. Failure screenshots, video and traces are attached as the `ui-quality-gate-evidence` artifact when available.

## Manual 32 / 32 stress check

Run `pnpm run test:stress-ui`, launch the app, choose **RFE_32x32_Benchmark** under **Preset**, and start the test session. For 10–15 minutes, move and select modules, edit controls, and inspect Threads. Confirm the timer advances normally, Diagnostics remain coherent at 32 modules / 32 Threads, controls remain responsive, Thread geometry follows movement, and no blank screen, lock-up, stale selection or visible error appears.

The browser gate verifies all retained navigation, routing, dynamic-channel, concurrency, Monitor, responsive, reduced-motion and accessibility behavior plus channel-bound sine source placement, menu-to-Inspector transfer, matching Channel Out wiring, smoothed disconnect-to-silence without source churn, node removal/restoration, one composite waveform of all sounding routed channels, explicit Threads `SD MUTED` status at -100% Sound Desk Live Trim, X-to-pan replotting, Y neutrality, relative Live Trim/mute/zero restoration, programmed-level separation, shared workspace transport paired to the elapsed timer, active/inactive preservation, smoothing diagnostics, and state retention across workspaces. Distance/depth/elevation audio, automatic distribution, Blend/processing semantics, arbitrary graph mixing and simulation remain outside Milestone 09.

Automated Web Audio lifecycle and analyser checks do not independently prove stereo perception, loudness, clipping, clicks/pops, transient cleanliness, or output-device behavior. Milestone 09 listening and interaction acceptance was completed on 2026-08-12. Repeat the conservative-volume procedure in `milestone_notes/milestone_09_spatial_session.txt` after any future audio-graph change.

For the local M10.1 candidate, deterministic tests additionally validate sample-peak calibration, summed fixtures, the -6 dBFS sample fence, latched non-finite safety mute, one authoritative safety path, final analyser tap, invalid-value rejection and graph lifecycle. These tests do not establish true peak, acoustic SPL, hearing safety, speaker safety, or subjective audio quality. Follow `SAFE_LISTENING_CHARTER.md` and the low-level protocol in `milestone_notes/milestone_10_1_output_safety.txt`.
