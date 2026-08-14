import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticMeterEnabled, diagnosticScopeEnabled, getAudioDiagnosticMode } from "../app/audio-diagnostics.ts";

test("audio reduction modes remove only the requested observation layers", () => {
  assert.equal(getAudioDiagnosticMode(), "full");
  assert.deepEqual(["full", "no-scope", "no-meter", "no-observers", "minimal-fence", "native-fence", "native-fence-scope"].map((mode) => ({
    mode,
    meter: diagnosticMeterEnabled(mode),
    scope: diagnosticScopeEnabled(mode),
  })), [
    { mode: "full", meter: true, scope: true },
    { mode: "no-scope", meter: true, scope: false },
    { mode: "no-meter", meter: false, scope: true },
    { mode: "no-observers", meter: false, scope: false },
    { mode: "minimal-fence", meter: false, scope: false },
    { mode: "native-fence", meter: false, scope: false },
    { mode: "native-fence-scope", meter: false, scope: true },
  ]);
});
