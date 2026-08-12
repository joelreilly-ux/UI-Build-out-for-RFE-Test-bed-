# RFE UI quality gate

The milestone is prepared on `milestone/ui-interaction-harness`.

## Run locally

- Launch the app: `pnpm dev`
- Run build, typecheck and lint: `pnpm run check`
- Run the focused browser and axe checks: `pnpm run test:e2e`
- Verify and prepare the stress fixture: `pnpm run test:stress-ui`

## Read the GitHub result

Open the repository on GitHub, choose **Actions**, then open **UI Quality Gate**. A green tick is PASS. A red cross is FAIL; open the failed step for its log. Failure screenshots, video and traces are attached as the `ui-quality-gate-evidence` artifact when available.

## Manual 32 / 32 stress check

Run `pnpm run test:stress-ui`, launch the app, choose **RFE_32x32_Benchmark** under **Preset**, and start the test session. For 10–15 minutes, move and select modules, edit controls, and inspect Threads. Confirm the timer advances normally, Diagnostics remain coherent at 32 modules / 32 Threads, controls remain responsive, Thread geometry follows movement, and no blank screen, lock-up, stale selection or visible error appears.

The browser gate also verifies directional navigation across Threads, Sound Desk and Visualiser, state retention when returning to Threads, the shared session timer, explicit channel output terminals, five complete Thread channels, complete/incomplete/unused Channel Rail states, the canonical 5 × 5 Plotter workflow, reassignment/unplot, Visualiser inspection synchronization, compact touch controls, reduced motion, and accessibility labels. Focus, free window management, audio generation, mixing, distribution behavior and particle/simulation behavior remain outside the current milestone.
