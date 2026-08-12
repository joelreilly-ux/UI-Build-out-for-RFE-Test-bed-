import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_DEFAULT_FREQUENCY,
  AUDIO_DEFAULT_LEVEL,
  ApplicationAudioRuntime,
} from "../app/audio-runtime.ts";

class FakeParam {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
}

class FakeNode {
  connections = [];
  disconnected = false;
  connect(destination) { this.connections.push(destination); return destination; }
  disconnect() { this.disconnected = true; this.connections = []; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }

class FakeAnalyser extends FakeNode {
  fftSize = 512;
  smoothingTimeConstant = 0;
  frequencyBinCount = 256;
  getFloatTimeDomainData(data) { data.forEach((_, index) => { data[index] = Math.sin(index / data.length * Math.PI * 4); }); }
}

class FakeOscillator extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  onended = null;
  started = false;
  stopped = false;
  start() { this.started = true; }
  stop() { this.stopped = true; this.onended?.(new Event("ended")); }
}

class FakeContext {
  currentTime = 1;
  state = "running";
  destination = new FakeNode();
  gains = [];
  analysers = [];
  oscillators = [];
  closed = false;
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createAnalyser() { const node = new FakeAnalyser(); this.analysers.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
  async resume() { this.state = "running"; }
  async close() { this.closed = true; this.state = "closed"; }
}

function harness() {
  const contexts = [];
  const runtime = new ApplicationAudioRuntime(() => {
    const context = new FakeContext();
    contexts.push(context);
    return context;
  });
  return { runtime, contexts };
}

test("audio parameters can be prepared without creating application audio infrastructure", () => {
  const { runtime, contexts } = harness();
  runtime.setFrequency("channel-01", 156);
  runtime.setLevel("channel-01", 12);
  assert.equal(contexts.length, 0);
  assert.deepEqual(runtime.getChannelSnapshot("channel-01"), {
    channelId: "channel-01", frequency: 156, level: 12, active: false, availability: "unavailable", message: "Ready to start",
  });
});

test("application runtime and master graph initialise once while channel source restarts independently", async () => {
  const { runtime, contexts } = harness();
  await runtime.startChannel("channel-01");
  const contextIdentity = runtime.getContextIdentity();
  await runtime.startChannel("channel-01");
  assert.equal(contexts.length, 1);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().channelCreations, 1);
  assert.equal(runtime.getDiagnostics().sourceCreations, 1);
  assert.equal(runtime.getDiagnostics().activeSources, 1);

  runtime.stopChannel("channel-01");
  await runtime.startChannel("channel-01");
  assert.equal(runtime.getContextIdentity(), contextIdentity);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().channelCreations, 1);
  assert.equal(runtime.getDiagnostics().sourceCreations, 2);
  assert.equal(runtime.getDiagnostics().sourceDisposals, 1);
  assert.equal(runtime.getDiagnostics().activeSources, 1);
});

test("frequency and level updates target the current channel graph without creating a source", async () => {
  const { runtime, contexts } = harness();
  await runtime.startChannel("channel-01");
  runtime.setFrequency("channel-01", 156);
  runtime.setLevel("channel-01", 8);
  const snapshot = runtime.getChannelSnapshot("channel-01");
  assert.equal(snapshot.frequency, 156);
  assert.equal(snapshot.level, 8);
  assert.equal(contexts[0].oscillators[0].frequency.value, 156);
  assert.equal(runtime.getDiagnostics().sourceCreations, 1);
  assert.equal(runtime.getWaveform("channel-01").some((value) => value !== 0), true);
});

test("channel disposal is scoped and never closes or replaces the shared runtime", async () => {
  const { runtime, contexts } = harness();
  await runtime.startChannel("channel-01");
  const context = contexts[0];
  const masterIdentity = runtime.getContextIdentity();
  runtime.disposeChannel("channel-01");
  assert.equal(context.closed, false);
  assert.equal(runtime.getContextIdentity(), masterIdentity);
  assert.equal(runtime.getDiagnostics().activeSources, 0);
  assert.equal(runtime.getWaveform("channel-01"), null);

  await runtime.startChannel("channel-01");
  assert.equal(contexts.length, 1);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().channelCreations, 2);
  assert.equal(runtime.getChannelSnapshot("channel-01").frequency, AUDIO_DEFAULT_FREQUENCY);
  assert.equal(runtime.getChannelSnapshot("channel-01").level, AUDIO_DEFAULT_LEVEL);
});

test("only explicit application shutdown closes shared infrastructure", async () => {
  const { runtime, contexts } = harness();
  await runtime.startChannel("channel-01");
  await runtime.shutdownApplication();
  assert.equal(contexts[0].closed, true);
  assert.equal(runtime.getContextIdentity(), null);
  assert.equal(runtime.getDiagnostics().activeSources, 0);
});

test("initialisation failure is visible and retryable without affecting unrelated state", async () => {
  let attempts = 0;
  const context = new FakeContext();
  const runtime = new ApplicationAudioRuntime(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("Audio device unavailable");
    return context;
  });
  await runtime.startChannel("channel-01");
  assert.deepEqual(runtime.getChannelSnapshot("channel-01"), {
    channelId: "channel-01", frequency: AUDIO_DEFAULT_FREQUENCY, level: AUDIO_DEFAULT_LEVEL, active: false, availability: "error", message: "Audio device unavailable",
  });
  await runtime.startChannel("channel-01");
  assert.equal(runtime.getChannelSnapshot("channel-01").active, true);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
});
