# RFE Milestone 07 quality gate

The approved Milestones 06–07 batch is reconciled through the repository review branch documented in `HANDOVER.txt`.

## Run locally

- Launch the app: `pnpm dev`
- Run build, typecheck and lint: `pnpm run check`
- Run the focused browser and axe checks: `pnpm run test:e2e`
- Verify and prepare the stress fixture: `pnpm run test:stress-ui`

## Read the GitHub result

Open the repository on GitHub, choose **Actions**, then open **UI Quality Gate**. A green tick is PASS. A red cross is FAIL; open the failed step for its log. Failure screenshots, video and traces are attached as the `ui-quality-gate-evidence` artifact when available.

## Manual 32 / 32 stress check

Run `pnpm run test:stress-ui`, launch the app, choose **RFE_32x32_Benchmark** under **Preset**, and start the test session. For 10–15 minutes, move and select modules, edit controls, and inspect Threads. Confirm the timer advances normally, Diagnostics remain coherent at 32 modules / 32 Threads, controls remain responsive, Thread geometry follows movement, and no blank screen, lock-up, stale selection or visible error appears.

The browser gate verifies directional navigation across Threads, Sound Desk and Visualiser, state retention, the shared session timer, dynamic channel terminals, a 24-channel scroll/removal case, empty-state channel-number reset, the canonical 5 × 5 Plotter workflow, Visualiser synchronization, CH 01 Web Audio lifecycle isolation, precise frequency controls, real Monitor state, reduced motion, and accessibility labels. Multi-channel audible output, spatial audio, mixing/distribution behavior and particle/simulation behavior remain outside the approved milestone.
