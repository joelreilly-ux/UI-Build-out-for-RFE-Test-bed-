# RFE UI quality gate

The milestone is prepared on `milestone/ui-interaction-harness`.

## Run locally

- Launch the app: `pnpm dev`
- Run build, typecheck and lint: `npm run check`
- Run the focused browser and axe checks: `npm run test:e2e`
- Verify and prepare the stress fixture: `npm run test:stress-ui`

## Read the GitHub result

Open the repository on GitHub, choose **Actions**, then open **UI Quality Gate**. A green tick is PASS. A red cross is FAIL; open the failed step for its log. Failure screenshots, video and traces are attached as the `ui-quality-gate-evidence` artifact when available.

## Manual 32 / 32 stress check

Run `npm run test:stress-ui`, launch the app, choose **RFE_32x32_Benchmark** under **Preset**, and start the test session. For 10–15 minutes, move and select modules, edit controls, and inspect Threads. Confirm the timer advances normally, Diagnostics remain coherent at 32 modules / 32 Threads, controls remain responsive, Thread geometry follows movement, and no blank screen, lock-up, stale selection or visible error appears.

Focus, free window management, module creation/removal, audio, scheduling and particle/simulation behavior remain outside this milestone.
