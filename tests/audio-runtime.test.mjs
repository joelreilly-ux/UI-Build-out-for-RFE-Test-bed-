import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIO_DEFAULT_FREQUENCY,
  AUDIO_DEFAULT_LEVEL,
  ApplicationAudioRuntime,
  LIVE_ENDPOINT_FADE_SECONDS,
  LIVE_ENDPOINT_SETTLE_SECONDS,
  getDefaultChannelFrequency,
  liveTrimMultiplier,
  spatialXToPan,
} from "../app/audio-runtime.ts";

class FakeParam {
  value = 0;
  events = [];
  cancelScheduledValues(time) { this.events.push({ type: "cancel", time }); }
  setValueAtTime(value, time) { this.value = value; this.events.push({ type: "set", value, time }); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push({ type: "ramp", value, time }); }
  setValueCurveAtTime(values, time, duration) {
    this.value = values.at(-1);
    this.events.push({ type: "curve", values, time, duration });
  }
}

class FakeNode {
  connections = [];
  disconnected = false;
  connect(destination) { this.connections.push(destination); return destination; }
  disconnect() { this.disconnected = true; this.connections = []; }
}

class FakePort {
  onmessage = null;
  messages = [];
  closed = false;
  postMessage(message) { this.messages.push(message); }
  close() { this.closed = true; }
  emit(data) { this.onmessage?.({ data }); }
}

class FakeSafetyNode extends FakeNode { port = new FakePort(); }

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

function harness({ deferInsertions = false } = {}) {
  const contexts = [];
  const safetyNodes = [];
  const insertionTimers = [];
  const scheduleInsertion = (callback, delayMs) => {
    const timer = { callback, delayMs, cancelled: false };
    insertionTimers.push(timer);
    if (!deferInsertions) callback();
    return timer;
  };
  const cancelInsertion = (timer) => { timer.cancelled = true; };
  const runtime = new ApplicationAudioRuntime(() => {
    const context = new FakeContext();
    contexts.push(context);
    return context;
  }, async () => {
    const node = new FakeSafetyNode();
    safetyNodes.push(node);
    return node;
  }, scheduleInsertion, cancelInsertion);
  const flushInsertions = () => insertionTimers.splice(0).filter((timer) => !timer.cancelled).forEach((timer) => timer.callback());
  return { runtime, contexts, safetyNodes, insertionTimers, flushInsertions };
}

test("audio parameters can be prepared without creating application audio infrastructure", () => {
  const { runtime, contexts } = harness();
  runtime.setFrequency("channel-01", 156);
  runtime.setLevel("channel-01", 12);
  assert.equal(contexts.length, 0);
  assert.deepEqual(runtime.getChannelSnapshot("channel-01"), {
    channelId: "channel-01", frequency: 156, generatorType: "sine", level: 12, liveTrim: 0, effectiveLevel: 12, pan: 0, routable: true, active: false, availability: "unavailable", message: "Ready to start",
  });
});

test("dynamic channel identities receive recognisable defaults without a fixed five-channel object fixture", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((sequence) => getDefaultChannelFrequency(`channel-${String(sequence).padStart(2, "0")}`)),
    [78, 110, 156, 221, 312, 441],
  );
});

test("Clone endpoints share one oscillator and inherited programming while retaining independent endpoint controls", async () => {
  const { runtime, contexts } = harness();
  runtime.synchronizeTopology([
    { id: "channel-01", sourceId: "channel-01" },
    { id: "channel-02", sourceId: "channel-01" },
    { id: "channel-03", sourceId: "channel-01" },
  ]);
  runtime.setSpatialX("channel-01", -2);
  runtime.setSpatialX("channel-02", 2);
  runtime.setLiveTrim("channel-02", -50);
  await runtime.startChannel("channel-01");

  assert.equal(contexts[0].oscillators.length, 1);
  assert.equal(runtime.getDiagnostics().sourceCreations, 1);
  const familyGainValues = contexts[0].oscillators[0].connections[0].connections.map((gain) => gain.gain.value);
  assert.equal(familyGainValues.every((value) => Math.abs(value - (0.2 * 0.2 / 3)) < 0.000001), true);
  assert.deepEqual(runtime.getActiveChannelIds(), ["channel-01", "channel-02", "channel-03"]);
  runtime.setFrequency("channel-01", 155);
  runtime.setLevel("channel-01", 24);
  assert.deepEqual(["channel-01", "channel-02", "channel-03"].map((id) => [runtime.getChannelSnapshot(id).frequency, runtime.getChannelSnapshot(id).level]), [[155, 24], [155, 24], [155, 24]]);
  assert.equal(runtime.getChannelSnapshot("channel-01").pan, -1);
  assert.equal(runtime.getChannelSnapshot("channel-02").pan, 1);
  assert.equal(runtime.getChannelSnapshot("channel-02").liveTrim, -50);

  runtime.disposeChannel("channel-02");
  assert.equal(runtime.getChannelSnapshot("channel-01").active, true);
  assert.equal(runtime.getChannelSnapshot("channel-03").active, true);
  assert.equal(runtime.getDiagnostics().activeSources, 1);
});

test("Multi-Plot fan-out stays on one source and live movement never reconstructs its audio graph", async () => {
  const { runtime, contexts } = harness();
  const plotIds = ["channel-01", "channel-01-plot-1", "channel-01-plot-2"];
  runtime.synchronizeTopology(plotIds.map((id) => ({ id, sourceId: "channel-01" })));
  await runtime.startChannel("channel-01");
  const oscillator = contexts[0].oscillators[0];
  const graphBeforeDrag = runtime.getDiagnostics();
  assert.equal(contexts[0].oscillators.length, 1);
  assert.equal(graphBeforeDrag.sourceCreations, 1);
  assert.equal(graphBeforeDrag.channelCreations, 3);
  assert.equal(oscillator.connections[0].connections.every((gain) => Math.abs(gain.gain.value - (0.2 * 0.2 / 3)) < 0.000001), true);

  for (let index = 0; index < 120; index += 1) runtime.setSpatialX("channel-01-plot-1", -2 + index / 119 * 4, false);
  const graphAfterDrag = runtime.getDiagnostics();
  assert.equal(contexts[0].oscillators[0], oscillator);
  assert.equal(contexts[0].oscillators.length, 1);
  assert.equal(graphAfterDrag.sourceCreations, graphBeforeDrag.sourceCreations);
  assert.equal(graphAfterDrag.channelCreations, graphBeforeDrag.channelCreations);
  assert.equal(graphAfterDrag.analyserCreations, graphBeforeDrag.analyserCreations);
  assert.equal(graphAfterDrag.pannerCreations, graphBeforeDrag.pannerCreations);
  assert.equal(runtime.getChannelSnapshot("channel-01-plot-1").pan, 1);

  runtime.setLiveTrim("channel-01-plot-1", -100);
  runtime.setLiveTrim("channel-01-plot-2", 8);
  runtime.setFrequency("channel-01", 333);
  assert.deepEqual(plotIds.map((id) => runtime.getChannelSnapshot(id).frequency), [333, 333, 333]);
  assert.deepEqual(plotIds.map((id) => runtime.getChannelSnapshot(id).liveTrim), [0, -100, 8]);

  runtime.disposeChannel("channel-01-plot-1");
  assert.equal(runtime.getDiagnostics().activeSources, 1);
  assert.equal(runtime.getChannelSnapshot("channel-01").active, true);
  assert.equal(runtime.getChannelSnapshot("channel-01-plot-2").active, true);
  assert.equal(oscillator.connections[0].connections.every((gain) => Math.abs(gain.gain.value - (0.2 * 0.2 / 2)) < 0.000001), true);

  const context = runtime.getContextIdentity();
  runtime.synchronizeTopology([]);
  assert.equal(runtime.getDiagnostics().activeChannels, 0);
  assert.equal(runtime.getDiagnostics().activeSources, 0);
  assert.deepEqual(runtime.getSoundingChannelIds(), []);
  runtime.synchronizeTopology([{ id: "channel-01", sourceId: "channel-01" }]);
  await runtime.startChannel("channel-01");
  assert.equal(runtime.getContextIdentity(), context);
  assert.equal(runtime.getDiagnostics().contextCreations, 1);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().activeSources, 1);
});

test("a Multi-Plot added to a live source stages silently then uses a zero-slope family crossfade", async () => {
  const { runtime, contexts, insertionTimers, flushInsertions } = harness({ deferInsertions: true });
  runtime.synchronizeTopology([{ id: "channel-01", sourceId: "channel-01" }]);
  await runtime.startChannel("channel-01");
  const rampsBefore = runtime.getDiagnostics().smoothingRamps;

  runtime.synchronizeTopology([
    { id: "channel-01", sourceId: "channel-01" },
    { id: "channel-01-plot-1", sourceId: "channel-01" },
  ]);

  const newEndpointTrim = contexts[0].gains[6].gain;
  const existingEndpointProgrammedGain = contexts[0].gains[2].gain;
  assert.equal(insertionTimers.at(-1).delayMs, LIVE_ENDPOINT_SETTLE_SECONDS * 1_000);
  assert.equal(newEndpointTrim.value, 0);
  assert.equal(existingEndpointProgrammedGain.value, 0.2 * 0.2);
  flushInsertions();
  assert.deepEqual(newEndpointTrim.events.map((event) => [event.type, event.value]), [
    ["set", 0],
    ["cancel", undefined],
    ["set", 0],
    ["curve", undefined],
  ]);
  const newEndpointCurve = newEndpointTrim.events.at(-1);
  const existingEndpointCurve = existingEndpointProgrammedGain.events.at(-1);
  assert.equal(newEndpointCurve.time, contexts[0].currentTime);
  assert.equal(newEndpointCurve.duration, LIVE_ENDPOINT_FADE_SECONDS);
  assert.equal(existingEndpointCurve.time, contexts[0].currentTime);
  assert.equal(existingEndpointCurve.duration, LIVE_ENDPOINT_FADE_SECONDS);
  assert.equal(newEndpointCurve.values.length, 65);
  assert.equal(newEndpointCurve.values[0], 0);
  assert.equal(newEndpointCurve.values.at(-1), 1);
  assert.ok(newEndpointCurve.values[1] - newEndpointCurve.values[0] < newEndpointCurve.values[33] - newEndpointCurve.values[32]);
  assert.ok(newEndpointCurve.values.at(-1) - newEndpointCurve.values.at(-2) < newEndpointCurve.values[33] - newEndpointCurve.values[32]);
  const rampsAfterInsertion = runtime.getDiagnostics().smoothingRamps;
  runtime.setLiveTrim("channel-01-plot-1", 0);
  assert.equal(runtime.getDiagnostics().smoothingRamps, rampsAfterInsertion);
  assert.equal(newEndpointTrim.events.at(-1).time, contexts[0].currentTime);
  assert.equal(runtime.getDiagnostics().smoothingRamps, rampsBefore + 2);
  assert.equal(runtime.getDiagnostics().sourceCreations, 1);
});

test("rapid live additions debounce into one atomic family crossfade without temporary amplitude doubling", async () => {
  const { runtime, contexts, insertionTimers, flushInsertions } = harness({ deferInsertions: true });
  const baseGain = 0.2 * 0.2;
  runtime.synchronizeTopology([{ id: "channel-01", sourceId: "channel-01" }]);
  await runtime.startChannel("channel-01");
  runtime.synchronizeTopology([
    { id: "channel-01", sourceId: "channel-01" },
    { id: "channel-01-plot-1", sourceId: "channel-01" },
  ]);
  runtime.synchronizeTopology([
    { id: "channel-01", sourceId: "channel-01" },
    { id: "channel-01-plot-1", sourceId: "channel-01" },
    { id: "channel-01-plot-2", sourceId: "channel-01" },
  ]);

  const family = contexts[0].oscillators[0].connections[0].connections;
  assert.equal(insertionTimers.length, 2);
  assert.equal(insertionTimers[0].cancelled, true);
  assert.equal(insertionTimers[1].cancelled, false);
  assert.deepEqual(family.map((endpoint) => endpoint.gain.value), [baseGain, 0, 0]);
  assert.deepEqual(family.slice(1).map((endpoint) => endpoint.connections[0].gain.value), [0, 0]);

  flushInsertions();
  const originalCurve = family[0].gain.events.at(-1).values;
  const pendingCurves = family.slice(1).map((endpoint) => endpoint.connections[0].gain.events.at(-1).values);
  for (let index = 0; index < originalCurve.length; index += 1) {
    const summedGain = originalCurve[index] + baseGain / 3 * (pendingCurves[0][index] + pendingCurves[1][index]);
    assert.ok(Math.abs(summedGain - baseGain) < 0.000001);
  }
  assert.equal(family.every((endpoint) => Math.abs(endpoint.gain.value - baseGain / 3) < 0.000001), true);
  assert.equal(contexts[0].oscillators.length, 1);
});

test("coherent Clone family gain remains constant through successive live insertions", async () => {
  const { runtime, contexts } = harness();
  const baseGain = 0.2 * 0.2;
  const topology = [{ id: "channel-01", sourceId: "channel-01" }];
  runtime.synchronizeTopology(topology);
  await runtime.startChannel("channel-01");

  for (let endpointCount = 1; endpointCount <= 5; endpointCount += 1) {
    if (endpointCount > 1) {
      topology.push({ id: `channel-01-plot-${endpointCount - 1}`, sourceId: "channel-01" });
      runtime.synchronizeTopology(topology);
    }
    const endpointGains = contexts[0].oscillators[0].connections[0].connections.map((gain) => gain.gain.value);
    assert.equal(endpointGains.length, endpointCount);
    assert.equal(endpointGains.every((gain) => Math.abs(gain - baseGain / endpointCount) < 0.000001), true);
    assert.ok(Math.abs(endpointGains.reduce((sum, gain) => sum + gain, 0) - baseGain) < 0.000001);
  }

  assert.equal(contexts[0].oscillators.length, 1);
  assert.equal(runtime.getDiagnostics().sourceCreations, 1);
});

test("Duplicate sources copy programming once then own independent oscillator state", async () => {
  const { runtime, contexts } = harness();
  runtime.synchronizeTopology([
    { id: "channel-01", sourceId: "channel-01" },
    { id: "channel-02", sourceId: "channel-02" },
  ]);
  runtime.setFrequency("channel-01", 55);
  runtime.setGenerator("channel-01", "triangle");
  runtime.setLevel("channel-01", 20);
  runtime.copyProgramming("channel-01", "channel-02");
  await runtime.startChannel("channel-01");
  await runtime.startChannel("channel-02");
  assert.equal(contexts[0].oscillators.length, 2);
  assert.deepEqual(contexts[0].oscillators.map((oscillator) => oscillator.type), ["triangle", "triangle"]);
  runtime.setFrequency("channel-01", 70);
  runtime.setGenerator("channel-01", "saw");
  runtime.setLevel("channel-02", 12);
  assert.deepEqual([runtime.getChannelSnapshot("channel-01").frequency, runtime.getChannelSnapshot("channel-02").frequency], [70, 55]);
  assert.deepEqual([runtime.getChannelSnapshot("channel-01").level, runtime.getChannelSnapshot("channel-02").level], [20, 12]);
  assert.deepEqual([runtime.getChannelSnapshot("channel-01").generatorType, runtime.getChannelSnapshot("channel-02").generatorType], ["saw", "triangle"]);
});

test("one reusable pitch instruction drives Sine, Triangle, and Saw generators", async () => {
  const { runtime, contexts } = harness();
  const channelIds = ["channel-01", "channel-02", "channel-03"];
  const generatorTypes = ["sine", "triangle", "saw"];
  channelIds.forEach((channelId, index) => {
    runtime.setPitch(channelId, 261.6);
    runtime.setGenerator(channelId, generatorTypes[index]);
  });
  for (const channelId of channelIds) await runtime.startChannel(channelId);

  assert.deepEqual(channelIds.map((channelId) => runtime.getChannelSnapshot(channelId).frequency), [262, 262, 262]);
  assert.deepEqual(channelIds.map((channelId) => runtime.getChannelSnapshot(channelId).generatorType), generatorTypes);
  assert.deepEqual(contexts[0].oscillators.map((oscillator) => oscillator.type), ["sine", "triangle", "sawtooth"]);
  assert.deepEqual(contexts[0].oscillators.map((oscillator) => oscillator.frequency.value), [262, 262, 262]);
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
    safetyCreations: 1,
    safetyDisposals: 0,
    finalAnalyserCreations: 1,
    finalAnalyserDisposals: 0,
    knownSources: 5,
    runtimeListeners: 0,
    safetyListeners: 0,
  });
  assert.deepEqual(channelIds.map((channelId) => runtime.getChannelSnapshot(channelId).frequency), [78, 110, 156, 221, 312]);
  assert.equal(contexts[0].oscillators[0].connections[0], contexts[0].gains[4]);
  assert.equal(contexts[0].gains[4].connections[0], contexts[0].gains[2]);
  assert.equal(contexts[0].gains[2].connections[0], contexts[0].gains[3]);
  assert.equal(contexts[0].gains[3].connections[0], contexts[0].analysers[1]);
  assert.equal(contexts[0].analysers[1].connections[0], contexts[0].panners[0]);
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

test("every audible branch crosses one non-bypassable safety node and final analyser", async () => {
  const { runtime, contexts, safetyNodes } = harness();
  runtime.synchronizeTopology([
    { id: "channel-01", sourceId: "channel-01" },
    { id: "channel-02", sourceId: "channel-01" },
    { id: "channel-03", sourceId: "channel-03" },
  ]);
  await runtime.startChannel("channel-01");
  await runtime.startChannel("channel-03");
  const context = contexts[0];
  const finalAnalyser = context.analysers[0];
  assert.equal(safetyNodes.length, 1);
  assert.deepEqual(context.destination.connections, []);
  assert.equal(finalAnalyser.connections[0], context.destination);
  assert.equal(safetyNodes[0].connections[0], finalAnalyser);
  assert.equal(runtime.getDiagnostics().safetyCreations, 1);
  assert.equal(runtime.getDiagnostics().finalAnalyserCreations, 1);
  assert.equal(runtime.getDiagnostics().contextCreations, 1);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(context.panners.every((panner) => panner.connections.length === 1 && panner.connections[0] === context.gains[1]), true);
});

test("master safety reports are measured engine state and safety mute recovery is deliberate", async () => {
  const { runtime, safetyNodes } = harness();
  await runtime.startChannel("channel-01");
  let channelNotifications = 0;
  let meterNotifications = 0;
  const unsubscribeChannel = runtime.subscribe(() => { channelNotifications += 1; });
  const unsubscribeMeter = runtime.subscribeMasterSafety(() => { meterNotifications += 1; });
  safetyNodes[0].port.emit({
    type: "safety-meter",
    currentPeakDbfs: -8.4,
    peakHoldDbfs: -7.1,
    reductionDb: -1.2,
    inputPeakDbfs: -4.2,
    state: "LIMITING",
    muteReason: "",
  });
  assert.equal(channelNotifications, 0);
  assert.equal(meterNotifications, 1);
  assert.deepEqual(runtime.getMasterSafetySnapshot(), {
    currentPeakDbfs: -8.4,
    peakHoldDbfs: -7.1,
    reductionDb: -1.2,
    inputPeakDbfs: -4.2,
    state: "LIMITING",
    muteReason: "",
    available: true,
    meterRateHz: 30,
  });
  safetyNodes[0].port.emit({ type: "safety-meter", currentPeakDbfs: -Infinity, peakHoldDbfs: -7.1, reductionDb: -Infinity, inputPeakDbfs: -Infinity, state: "SAFETY MUTE", muteReason: "NON-FINITE AUDIO SAMPLE" });
  assert.equal(runtime.getMasterSafetySnapshot().state, "SAFETY MUTE");
  runtime.resetSafetyMute();
  const resetMessage = safetyNodes[0].port.messages.at(-1);
  assert.equal(resetMessage.type, "reset-safety-mute");
  assert.equal(Number.isInteger(resetMessage.requestId), true);
  assert.equal(runtime.getMasterSafetySnapshot().state, "RESET REQUESTED");
  safetyNodes[0].port.emit({ type: "safety-meter", currentPeakDbfs: -Infinity, peakHoldDbfs: -Infinity, reductionDb: 0, inputPeakDbfs: -Infinity, state: "NORMAL", muteReason: "" });
  assert.equal(runtime.getMasterSafetySnapshot().state, "RESET REQUESTED");
  safetyNodes[0].port.emit({ type: "safety-meter", currentPeakDbfs: -Infinity, peakHoldDbfs: -Infinity, reductionDb: 0, inputPeakDbfs: -Infinity, state: "NORMAL", muteReason: "", resetRequestId: resetMessage.requestId });
  assert.equal(runtime.getMasterSafetySnapshot().state, "NORMAL");
  unsubscribeChannel();
  unsubscribeMeter();
});

test("invalid parameter values never reach safety-critical AudioParams", async () => {
  const { runtime, contexts } = harness();
  await runtime.startChannel("channel-01");
  const before = runtime.getChannelSnapshot("channel-01");
  runtime.setFrequency("channel-01", Number.NaN);
  runtime.setFrequency("channel-01", "72");
  runtime.setFrequency("channel-01", undefined);
  runtime.setLevel("channel-01", Number.POSITIVE_INFINITY);
  runtime.setLevel("channel-01", null);
  runtime.setLiveTrim("channel-01", Number.NEGATIVE_INFINITY);
  runtime.setSpatialX("channel-01", Number.NaN);
  const after = runtime.getChannelSnapshot("channel-01");
  assert.equal(after.frequency, before.frequency);
  assert.equal(after.level, before.level);
  assert.equal(after.liveTrim, before.liveTrim);
  assert.equal(after.pan, 0);
  for (const gain of contexts[0].gains) assert.equal(Number.isFinite(gain.gain.value), true);
  for (const panner of contexts[0].panners) assert.equal(Number.isFinite(panner.pan.value), true);
  for (const oscillator of contexts[0].oscillators) assert.equal(Number.isFinite(oscillator.frequency.value), true);
});

test("rapid route, transport, and disposal churn never creates parallel safety paths", async () => {
  const { runtime, contexts, safetyNodes } = harness();
  await runtime.startChannel("channel-01");
  for (let index = 0; index < 30; index += 1) {
    runtime.setChannelRoutable("channel-01", index % 2 === 0);
    runtime.pauseSession();
    runtime.playSession();
  }
  runtime.stopSession();
  runtime.playSession();
  runtime.disposeChannel("channel-01");
  await runtime.startChannel("channel-01");
  assert.equal(contexts.length, 1);
  assert.equal(safetyNodes.length, 1);
  assert.equal(runtime.getDiagnostics().safetyCreations, 1);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().contextCreations, 1);
});

test("initialisation failure is visible and retryable without affecting unrelated state", async () => {
  let attempts = 0;
  const context = new FakeContext();
  const runtime = new ApplicationAudioRuntime(() => {
    attempts += 1;
    if (attempts === 1) throw new Error("Audio device unavailable");
    return context;
  }, async () => new FakeSafetyNode());
  await runtime.startChannel("channel-01");
  assert.deepEqual(runtime.getChannelSnapshot("channel-01"), {
    channelId: "channel-01", frequency: AUDIO_DEFAULT_FREQUENCY, generatorType: "sine", level: AUDIO_DEFAULT_LEVEL, liveTrim: 0, effectiveLevel: AUDIO_DEFAULT_LEVEL, pan: 0, routable: true, active: false, availability: "error", message: "Audio device unavailable",
  });
  await runtime.startChannel("channel-01");
  assert.equal(runtime.getChannelSnapshot("channel-01").active, true);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
});
