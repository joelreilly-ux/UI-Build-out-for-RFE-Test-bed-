import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_DEFAULT_FREQUENCY,
  AUDIO_DEFAULT_LEVEL,
  ApplicationAudioRuntime,
  getDefaultChannelFrequency,
  liveTrimMultiplier,
  spatialXToPan,
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
class FakeStereoPanner extends FakeNode { pan = new FakeParam(); }

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
  panners = [];
  closed = false;
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createAnalyser() { const node = new FakeAnalyser(); this.analysers.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
  createStereoPanner() { const node = new FakeStereoPanner(); this.panners.push(node); return node; }
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
    channelId: "channel-01", frequency: 156, level: 12, liveTrim: 0, effectiveLevel: 12, pan: 0, routable: true, active: false, availability: "unavailable", message: "Ready to start",
  });
});

test("dynamic channel identities receive recognisable defaults without a fixed five-channel object fixture", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((sequence) => getDefaultChannelFrequency(`channel-${String(sequence).padStart(2, "0")}`)),
    [78, 110, 156, 221, 312, 441],
  );
});

test("five channels coexist through one context and master with isolated parameters and source lifecycles", async () => {
  const { runtime, contexts } = harness();
  const channelIds = ["channel-01", "channel-02", "channel-03", "channel-04", "channel-05"];
  for (const channelId of channelIds) await runtime.startChannel(channelId);

  const contextIdentity = runtime.getContextIdentity();
  assert.equal(contexts.length, 1);
  assert.deepEqual(runtime.getDiagnostics(), {
    runtimeCreations: 1,
    contextCreations: 1,
    masterCreations: 1,
    channelCreations: 5,
    channelDisposals: 0,
    analyserCreations: 5,
    analyserDisposals: 0,
    pannerCreations: 5,
    pannerDisposals: 0,
    sessionGateCreations: 1,
    smoothingRamps: 5,
    activeChannels: 5,
    sourceCreations: 5,
    sourceDisposals: 0,
    activeSources: 5,
  });
  assert.deepEqual(channelIds.map((channelId) => runtime.getChannelSnapshot(channelId).frequency), [78, 110, 156, 221, 312]);
  assert.equal(contexts[0].oscillators[0].connections[0], contexts[0].gains[4]);
  assert.equal(contexts[0].gains[4].connections[0], contexts[0].gains[2]);
  assert.equal(contexts[0].gains[2].connections[0], contexts[0].gains[3]);
  assert.equal(contexts[0].gains[3].connections[0], contexts[0].analysers[0]);
  assert.equal(contexts[0].analysers[0].connections[0], contexts[0].panners[0]);
  assert.equal(contexts[0].panners[0].connections[0], contexts[0].gains[1]);
  assert.equal(contexts[0].gains[1].connections[0], contexts[0].gains[0]);

  runtime.setFrequency("channel-03", 180);
  runtime.setLevel("channel-04", 7);
  assert.equal(runtime.getChannelSnapshot("channel-03").frequency, 180);
  assert.equal(runtime.getChannelSnapshot("channel-04").level, 7);
  assert.deepEqual(channelIds.filter((channelId) => channelId !== "channel-03").map((channelId) => runtime.getChannelSnapshot(channelId).frequency), [78, 110, 221, 312]);
  assert.deepEqual(channelIds.filter((channelId) => channelId !== "channel-04").map((channelId) => runtime.getChannelSnapshot(channelId).level), [20, 20, 20, 20]);
  assert.equal(runtime.getDiagnostics().sourceCreations, 5);

  runtime.stopChannel("channel-03");
  assert.equal(runtime.getChannelSnapshot("channel-03").active, false);
  assert.equal(runtime.getDiagnostics().activeSources, 4);
  assert.equal(channelIds.filter((channelId) => channelId !== "channel-03").every((channelId) => runtime.getChannelSnapshot(channelId).active), true);
  await runtime.startChannel("channel-03");
  assert.equal(runtime.getContextIdentity(), contextIdentity);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().sourceCreations, 6);
  assert.equal(runtime.getDiagnostics().activeSources, 5);
});

test("deleting an active identity disposes only its branch and replacement creation cannot swap peer state", async () => {
  const { runtime, contexts } = harness();
  for (const channelId of ["channel-01", "channel-02", "channel-03", "channel-04", "channel-05"]) await runtime.startChannel(channelId);
  runtime.setFrequency("channel-03", 333);
  const contextIdentity = runtime.getContextIdentity();

  runtime.disposeChannel("channel-02");
  assert.equal(contexts[0].closed, false);
  assert.equal(runtime.getContextIdentity(), contextIdentity);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().activeChannels, 4);
  assert.equal(runtime.getDiagnostics().activeSources, 4);
  assert.equal(runtime.getDiagnostics().channelDisposals, 1);
  assert.equal(runtime.getDiagnostics().analyserDisposals, 1);
  assert.equal(runtime.getChannelSnapshot("channel-03").frequency, 333);
  assert.equal(runtime.getChannelSnapshot("channel-03").active, true);

  await runtime.startChannel("channel-06");
  assert.equal(runtime.getChannelSnapshot("channel-06").frequency, 441);
  assert.equal(runtime.getChannelSnapshot("channel-03").frequency, 333);
  assert.equal(runtime.getDiagnostics().channelCreations, 6);
  assert.equal(runtime.getDiagnostics().activeSources, 5);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
});

test("channel-state synchronization removes stale runtime branches after a reducer-level reset", async () => {
  const { runtime } = harness();
  await runtime.startChannel("channel-01");
  await runtime.startChannel("channel-02");
  runtime.setFrequency("channel-03", 300);
  runtime.synchronizeChannels(["channel-02"]);
  assert.equal(runtime.getChannelSnapshot("channel-01").active, false);
  assert.equal(runtime.getChannelSnapshot("channel-02").active, true);
  assert.equal(runtime.getChannelSnapshot("channel-03").frequency, getDefaultChannelFrequency("channel-03"));
  assert.equal(runtime.getDiagnostics().activeChannels, 1);
  assert.equal(runtime.getDiagnostics().activeSources, 1);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
});

test("spatial X and bounded relative Live Trim remain independent per-channel and use smoothing", async () => {
  const { runtime, contexts } = harness();
  runtime.setSpatialX("channel-01", -2);
  runtime.setSpatialX("channel-02", 2);
  runtime.setLiveTrim("channel-01", 16);
  runtime.setLiveTrim("channel-02", -50);
  assert.equal(contexts.length, 0);
  await runtime.startChannel("channel-01");
  await runtime.startChannel("channel-02");
  assert.equal(runtime.getChannelSnapshot("channel-01").pan, -1);
  assert.equal(runtime.getChannelSnapshot("channel-02").pan, 1);
  assert.equal(runtime.getChannelSnapshot("channel-01").effectiveLevel, 23.2);
  assert.equal(runtime.getChannelSnapshot("channel-02").effectiveLevel, 10);
  assert.equal(contexts[0].panners[0].pan.value, -1);
  assert.equal(contexts[0].panners[1].pan.value, 1);

  const sourceCreations = runtime.getDiagnostics().sourceCreations;
  const ramps = runtime.getDiagnostics().smoothingRamps;
  runtime.setSpatialX("channel-01", 2);
  runtime.setLiveTrim("channel-02", -100);
  assert.equal(runtime.getChannelSnapshot("channel-01").pan, 1);
  assert.equal(runtime.getChannelSnapshot("channel-02").pan, 1);
  assert.equal(runtime.getChannelSnapshot("channel-02").effectiveLevel, 0);
  assert.equal(contexts[0].panners[0].pan.value, 1);
  assert.equal(contexts[0].panners[1].pan.value, 1);
  assert.equal(runtime.getDiagnostics().sourceCreations, sourceCreations);
  assert.equal(runtime.getDiagnostics().smoothingRamps, ramps + 2);

  runtime.setLiveTrim("channel-01", 0);
  assert.equal(runtime.getChannelSnapshot("channel-01").level, 20);
  assert.equal(runtime.getChannelSnapshot("channel-01").effectiveLevel, 20);
  assert.equal(liveTrimMultiplier(16), 1.16);
  assert.equal(liveTrimMultiplier(-100), 0);
  assert.deepEqual([-2, -1, 0, 1, 2].map(spatialXToPan), [-1, -0.5, 0, 0.5, 1]);
});

test("session transport gates active sources without rebuilding channels or programming", async () => {
  const { runtime, contexts } = harness();
  await runtime.startChannel("channel-01");
  await runtime.startChannel("channel-02");
  runtime.stopChannel("channel-02");
  runtime.setFrequency("channel-01", 156);
  runtime.setLiveTrim("channel-01", -25);
  runtime.setSpatialX("channel-01", -1);
  const before = runtime.getDiagnostics();

  runtime.pauseSession();
  assert.equal(runtime.getSessionPlaybackState(), "paused");
  assert.deepEqual(runtime.getSoundingChannelIds(), []);
  assert.equal(contexts[0].gains[1].gain.value, 0);
  assert.equal(runtime.getChannelSnapshot("channel-01").active, true);
  assert.equal(runtime.getChannelSnapshot("channel-02").active, false);
  runtime.playSession();
  assert.equal(runtime.getSessionPlaybackState(), "playing");
  assert.deepEqual(runtime.getSoundingChannelIds(), ["channel-01"]);
  assert.equal(contexts[0].gains[1].gain.value, 1);
  runtime.stopSession();
  assert.equal(runtime.getSessionPlaybackState(), "stopped");
  assert.deepEqual(runtime.getSoundingChannelIds(), []);
  assert.equal(contexts[0].gains[1].gain.value, 0);
  runtime.playSession();

  assert.equal(runtime.getDiagnostics().sourceCreations, before.sourceCreations);
  assert.equal(runtime.getDiagnostics().channelCreations, before.channelCreations);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().sessionGateCreations, 1);
  assert.equal(runtime.getChannelSnapshot("channel-01").frequency, 156);
  assert.equal(runtime.getChannelSnapshot("channel-01").liveTrim, -25);
  assert.equal(runtime.getChannelSnapshot("channel-01").pan, -0.5);
});

test("Channel Out disconnection smoothly gates only that active channel without destroying its source", async () => {
  const { runtime, contexts } = harness();
  await runtime.startChannel("channel-01");
  await runtime.startChannel("channel-02");
  runtime.setLiveTrim("channel-01", -50);
  const sourceCreations = runtime.getDiagnostics().sourceCreations;
  const smoothingRamps = runtime.getDiagnostics().smoothingRamps;
  assert.equal(contexts[0].gains[3].gain.value, 0.5);

  runtime.setChannelRoutable("channel-01", false);
  assert.equal(contexts[0].gains[3].gain.value, 0);
  assert.equal(runtime.getChannelSnapshot("channel-01").routable, false);
  assert.equal(runtime.getChannelSnapshot("channel-01").effectiveLevel, 0);
  assert.equal(runtime.getChannelSnapshot("channel-01").active, true);
  assert.equal(runtime.getChannelSnapshot("channel-02").effectiveLevel, 20);
  assert.equal(runtime.getDiagnostics().sourceCreations, sourceCreations);
  assert.equal(runtime.getDiagnostics().activeSources, 2);

  runtime.setChannelRoutable("channel-01", true);
  assert.equal(contexts[0].gains[3].gain.value, 0.5);
  assert.equal(runtime.getChannelSnapshot("channel-01").effectiveLevel, 10);
  assert.equal(runtime.getDiagnostics().sourceCreations, sourceCreations);
  assert.equal(runtime.getDiagnostics().smoothingRamps, smoothingRamps + 2);
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
    channelId: "channel-01", frequency: AUDIO_DEFAULT_FREQUENCY, level: AUDIO_DEFAULT_LEVEL, liveTrim: 0, effectiveLevel: AUDIO_DEFAULT_LEVEL, pan: 0, routable: true, active: false, availability: "error", message: "Audio device unavailable",
  });
  await runtime.startChannel("channel-01");
  assert.equal(runtime.getChannelSnapshot("channel-01").active, true);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
});
