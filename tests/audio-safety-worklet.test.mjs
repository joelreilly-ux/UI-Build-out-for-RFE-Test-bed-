import assert from "node:assert/strict";
import test from "node:test";

test("minimal-fence diagnostic retains the sample ceiling and latched non-finite mute without reports", async () => {
  let Processor = null;
  globalThis.sampleRate = 48_000;
  globalThis.AudioWorkletProcessor = class {
    port = { onmessage: null, messages: [], postMessage(message) { this.messages.push(message); } };
  };
  globalThis.registerProcessor = (name, constructor) => {
    assert.equal(name, "rfe-output-safety");
    Processor = constructor;
  };
  await import(`../public/audio-safety-worklet.js?minimal-fence-test=${Date.now()}`);
  const processor = new Processor({ processorOptions: { meterReportingEnabled: false, safetyMode: "minimal-fence" } });
  const output = [new Float32Array(4)];
  processor.process([[Float32Array.of(0.25, 8, -8, 0.1)]], [output]);
  assert.equal(output[0][0], 0.25);
  assert.ok(output[0][1] <= 10 ** (-6 / 20));
  assert.ok(output[0][2] >= -(10 ** (-6 / 20)));
  assert.deepEqual(processor.port.messages, []);

  processor.process([[Float32Array.of(0.1, Number.NaN, 0.1, 0.1)]], [output]);
  assert.deepEqual([...output[0]], [0, 0, 0, 0]);
  processor.process([[Float32Array.of(0.1, 0.1, 0.1, 0.1)]], [output]);
  assert.deepEqual([...output[0]], [0, 0, 0, 0]);
});
