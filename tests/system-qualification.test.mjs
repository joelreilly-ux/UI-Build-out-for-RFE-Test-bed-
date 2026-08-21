import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationAudioRuntime } from "../app/audio-runtime.ts";
import { SPATIAL_COORDINATES, coordinateKey, createInitialSpatialRoutingState, spatialRoutingReducer } from "../app/spatial-routing.ts";
import { createChannelDefinition } from "../app/channel-routing.ts";

class FakeParam {
  value = 0;
  ramps = 0;
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; this.ramps += 1; }
}

class FakeNode {
  connections = [];
  disconnected = false;
  connect(destination) { this.connections.push(destination); return destination; }
  disconnect() { this.connections = []; this.disconnected = true; }
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
class FakePanner extends FakeNode { pan = new FakeParam(); }
class FakeAnalyser extends FakeNode {
  fftSize = 512;
  smoothingTimeConstant = 0;
  frequencyBinCount = 256;
  getFloatTimeDomainData(data) { data.fill(0); }
}
class FakeOscillator extends FakeNode {
  type = "sine";
  frequency = new FakeParam();
  onended = null;
  started = false;
  stopped = false;
  start() { this.started = true; }
  stop() { if (this.stopped) throw new Error("oscillator stopped twice"); this.stopped = true; this.onended?.(new Event("ended")); }
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
  createStereoPanner() { const node = new FakePanner(); this.panners.push(node); return node; }
  async resume() { this.state = "running"; }
  async close() { this.closed = true; this.state = "closed"; }
}

function harness() {
  const contexts = [];
  const safetyNodes = [];
  const runtime = new ApplicationAudioRuntime(() => {
    const context = new FakeContext();
    contexts.push(context);
    return context;
  }, async () => {
    const node = new FakeSafetyNode();
    safetyNodes.push(node);
    return node;
  }, (callback) => { callback(); return 0; }, () => {});
  return { runtime, contexts, safetyNodes };
}

function sourceEnvelope(oscillator) {
  return oscillator.connections[0].connections[0];
}

function id(sequence) {
  return `channel-${String(sequence).padStart(2, "0")}`;
}

function qualificationTopology() {
  return Array.from({ length: 25 }, (_, index) => {
    const sequence = index + 1;
    if (sequence >= 2 && sequence <= 5) return { id: id(sequence), sourceId: id(1) };
    return { id: id(sequence), sourceId: id(sequence) };
  });
}

const QUALIFICATION_FREQUENCIES = [
  50, 53, 56, 78, 110, 220, 221, 330, 440, 441,
  550, 660, 880, 1_000, 1_250, 1_750, 2_000, 2_750, 3_500, 4_400,
  5_500, 6_600, 7_500, 8_800, 10_000,
];

test("25-position fixture preserves 21 source families, one five-endpoint Clone family, and five independent Duplicate-family oscillators", async () => {
  const { runtime, contexts } = harness();
  const topology = qualificationTopology();
  runtime.synchronizeTopology(topology);
  topology.forEach((channel, index) => {
    if (channel.id === channel.sourceId) {
      runtime.setFrequency(channel.id, QUALIFICATION_FREQUENCIES[index]);
      runtime.setLevel(channel.id, 4 + index % 5);
    }
    runtime.setSpatialX(channel.id, (index % 5) - 2);
    runtime.setLiveTrim(channel.id, [-100, -50, 0, 8, 16][index % 5]);
    runtime.setChannelRoutable(channel.id, true);
  });
  const sourceIds = [...new Set(topology.map((channel) => channel.sourceId))];
  for (const sourceId of sourceIds) await runtime.startChannel(sourceId);

  assert.equal(topology.length, 25);
  assert.equal(sourceIds.length, 21);
  assert.equal(contexts[0].oscillators.length, 21);
  assert.equal(runtime.getDiagnostics().activeSources, 21);
  assert.equal(runtime.getDiagnostics().activeChannels, 25);
  assert.equal(runtime.getDiagnostics().knownSources, 21);
  assert.equal(runtime.getActiveChannelIds().length, 25);
  assert.equal(runtime.getSoundingChannelIds().length, 20);
  assert.deepEqual(runtime.getDiagnostics(), {
    ...runtime.getDiagnostics(),
    contextCreations: 1,
    masterCreations: 1,
    sessionGateCreations: 1,
    safetyCreations: 1,
    finalAnalyserCreations: 1,
  });

  const cloneEnvelope = sourceEnvelope(contexts[0].oscillators[0]);
  assert.equal(cloneEnvelope.connections.length, 5);
  const expectedFiveEndpointGain = 0.008 / 5;
  assert.equal(cloneEnvelope.connections.every((gain) => Math.abs(gain.gain.value - expectedFiveEndpointGain) < 1e-9), true);
  assert.deepEqual([1, 2, 3, 4, 5].map((sequence) => runtime.getChannelSnapshot(id(sequence)).frequency), [50, 50, 50, 50, 50]);

  const duplicateFrequenciesBefore = [6, 7, 8, 9, 10].map((sequence) => runtime.getChannelSnapshot(id(sequence)).frequency);
  runtime.setFrequency(id(6), 777);
  assert.deepEqual([6, 7, 8, 9, 10].map((sequence) => runtime.getChannelSnapshot(id(sequence)).frequency), [777, ...duplicateFrequenciesBefore.slice(1)]);
  assert.equal(contexts[0].oscillators.slice(1, 6).every((oscillator) => oscillator.started), true);
});

test("dense movement, routing, trim, and transport torture preserves ownership and singular infrastructure", async () => {
  const { runtime, contexts, safetyNodes } = harness();
  const topology = qualificationTopology();
  runtime.synchronizeTopology(topology);
  const sourceIds = [...new Set(topology.map((channel) => channel.sourceId))];
  for (const sourceId of sourceIds) await runtime.startChannel(sourceId);
  const sourceCreations = runtime.getDiagnostics().sourceCreations;

  for (let cycle = 0; cycle < 200; cycle += 1) {
    const channelId = id(cycle % 25 + 1);
    runtime.setSpatialX(channelId, (cycle % 5) - 2);
    runtime.setLiveTrim(channelId, [-100, -50, 0, 8, 16][cycle % 5]);
    runtime.setChannelRoutable(channelId, cycle % 3 !== 0);
    if (cycle % 4 === 0) runtime.pauseSession();
    else if (cycle % 4 === 1) runtime.playSession();
    else if (cycle % 4 === 2) runtime.stopSession();
    else runtime.playSession();
  }
  runtime.playSession();
  topology.forEach((channel) => runtime.setChannelRoutable(channel.id, true));

  const diagnostics = runtime.getDiagnostics();
  assert.equal(diagnostics.sourceCreations, sourceCreations);
  assert.equal(diagnostics.activeSources, 21);
  assert.equal(diagnostics.activeChannels, 25);
  assert.equal(diagnostics.contextCreations, 1);
  assert.equal(diagnostics.masterCreations, 1);
  assert.equal(diagnostics.safetyCreations, 1);
  assert.equal(diagnostics.sessionGateCreations, 1);
  assert.equal(safetyNodes.length, 1);
  assert.equal(contexts[0].destination.connections.length, 0);
  assert.equal(contexts[0].panners.every((panner) => panner.connections.length === 1), true);
  assert.equal(contexts[0].gains.every((gain) => Number.isFinite(gain.gain.value)), true);
  assert.equal(contexts[0].panners.every((panner) => Number.isFinite(panner.pan.value)), true);
});

test("Clone mutation renormalises without restart while Duplicate mutation remains independent", async () => {
  const { runtime, contexts } = harness();
  let topology = qualificationTopology();
  runtime.synchronizeTopology(topology);
  await runtime.startChannel(id(1));
  for (let sequence = 6; sequence <= 10; sequence += 1) await runtime.startChannel(id(sequence));
  const sourceCreations = runtime.getDiagnostics().sourceCreations;
  runtime.disposeChannel(id(5));
  const cloneEnvelope = sourceEnvelope(contexts[0].oscillators[0]);
  assert.equal(cloneEnvelope.connections.length, 4);
  assert.equal(cloneEnvelope.connections.every((gain) => Math.abs(gain.gain.value - 0.04 / 4) < 1e-9), true);
  topology = qualificationTopology();
  runtime.synchronizeTopology(topology);
  assert.equal(cloneEnvelope.connections.length, 5);
  assert.equal(cloneEnvelope.connections.every((gain) => Math.abs(gain.gain.value - 0.04 / 5) < 1e-9), true);
  assert.equal(runtime.getDiagnostics().sourceCreations, sourceCreations);

  runtime.setFrequency(id(6), 600);
  runtime.setFrequency(id(7), 701);
  runtime.disposeSource(id(6));
  assert.equal(runtime.getChannelSnapshot(id(7)).active, true);
  assert.equal(runtime.getChannelSnapshot(id(7)).frequency, 701);
  assert.equal(runtime.getDiagnostics().activeSources, 5);
});

test("delete while sounding removes Clone families without ghost audio and preserves unrelated Duplicates", async () => {
  const { runtime, contexts } = harness();
  const topology = qualificationTopology().slice(0, 10);
  runtime.synchronizeTopology(topology);
  for (const sourceId of new Set(topology.map((channel) => channel.sourceId))) await runtime.startChannel(sourceId);
  assert.equal(runtime.getSoundingChannelIds().length, 10);
  const cloneOscillator = contexts[0].oscillators[0];
  runtime.disposeChannel(id(5));
  assert.equal(runtime.getChannelSnapshot(id(1)).active, true);
  assert.equal(runtime.getSoundingChannelIds().includes(id(5)), false);
  assert.equal(runtime.getSoundingChannelIds().length, 9);
  runtime.disposeSource(id(1));
  assert.equal(cloneOscillator.stopped, true);
  assert.equal(runtime.getSoundingChannelIds().some((channelId) => [1, 2, 3, 4, 5].map(id).includes(channelId)), false);
  assert.deepEqual(runtime.getSoundingChannelIds(), [6, 7, 8, 9, 10].map(id));
  assert.equal(runtime.getDiagnostics().activeSources, 5);
  assert.equal(runtime.getDiagnostics().knownSources, 5);
  runtime.disposeSource(id(7));
  assert.deepEqual(runtime.getSoundingChannelIds(), [6, 8, 9, 10].map(id));
  assert.equal(runtime.getChannelSnapshot(id(6)).active, true);
});

test("loaded session returns to one, zero, and a rebuilt session without poisoned runtime state", async () => {
  const { runtime, contexts, safetyNodes } = harness();
  const fullTopology = qualificationTopology();
  runtime.synchronizeTopology(fullTopology);
  for (const sourceId of new Set(fullTopology.map((channel) => channel.sourceId))) await runtime.startChannel(sourceId);
  const infrastructure = runtime.getDiagnostics();

  runtime.synchronizeTopology([{ id: id(25), sourceId: id(25) }]);
  assert.deepEqual(runtime.getActiveChannelIds(), [id(25)]);
  assert.deepEqual(runtime.getSoundingChannelIds(), [id(25)]);
  assert.equal(runtime.getDiagnostics().activeChannels, 1);
  assert.equal(runtime.getDiagnostics().activeSources, 1);
  assert.equal(runtime.getDiagnostics().knownSources, 1);

  runtime.synchronizeTopology([]);
  assert.deepEqual(runtime.getActiveChannelIds(), []);
  assert.deepEqual(runtime.getSoundingChannelIds(), []);
  assert.equal(runtime.getDiagnostics().activeChannels, 0);
  assert.equal(runtime.getDiagnostics().activeSources, 0);
  assert.equal(runtime.getDiagnostics().knownSources, 0);

  runtime.synchronizeTopology([{ id: id(1), sourceId: id(1) }]);
  await runtime.startChannel(id(1));
  assert.deepEqual(runtime.getSoundingChannelIds(), [id(1)]);
  assert.equal(runtime.getDiagnostics().activeChannels, 1);
  assert.equal(runtime.getDiagnostics().activeSources, 1);
  assert.equal(runtime.getDiagnostics().knownSources, 1);
  assert.equal(runtime.getDiagnostics().contextCreations, infrastructure.contextCreations);
  assert.equal(runtime.getDiagnostics().masterCreations, infrastructure.masterCreations);
  assert.equal(runtime.getDiagnostics().safetyCreations, infrastructure.safetyCreations);
  assert.equal(contexts.length, 1);
  assert.equal(safetyNodes.length, 1);
});

test("three populate-mutate-delete-rebuild cycles show balanced endpoint resources and no listener growth", async () => {
  const { runtime } = harness();
  const unsubscribeRuntime = runtime.subscribe(() => {});
  const unsubscribeSafety = runtime.subscribeMasterSafety(() => {});
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const offset = cycle * 30;
    const topology = qualificationTopology().map((channel, index) => ({
      id: id(offset + index + 1),
      sourceId: channel.sourceId === id(1) ? id(offset + 1) : id(offset + index + 1),
    }));
    runtime.synchronizeTopology(topology);
    for (const sourceId of new Set(topology.map((channel) => channel.sourceId))) await runtime.startChannel(sourceId);
    topology.forEach((channel, index) => {
      runtime.setChannelRoutable(channel.id, index % 2 === 0);
      runtime.setLiveTrim(channel.id, index % 3 === 0 ? -100 : 16);
    });
    runtime.synchronizeTopology([]);
    const diagnostics = runtime.getDiagnostics();
    assert.equal(diagnostics.activeChannels, 0);
    assert.equal(diagnostics.activeSources, 0);
    assert.equal(diagnostics.knownSources, 0);
    assert.equal(diagnostics.channelCreations, diagnostics.channelDisposals);
    assert.equal(diagnostics.analyserCreations, diagnostics.analyserDisposals);
    assert.equal(diagnostics.pannerCreations, diagnostics.pannerDisposals);
    assert.equal(diagnostics.runtimeListeners, 1);
    assert.equal(diagnostics.safetyListeners, 1);
    assert.equal(diagnostics.contextCreations, 1);
    assert.equal(diagnostics.masterCreations, 1);
    assert.equal(diagnostics.safetyCreations, 1);
  }
  unsubscribeRuntime();
  unsubscribeSafety();
  assert.equal(runtime.getDiagnostics().runtimeListeners, 0);
  assert.equal(runtime.getDiagnostics().safetyListeners, 0);
});

test("all 25 canonical grid positions retain one intended identity through movement and cleanup", () => {
  const channels = Array.from({ length: 25 }, (_, index) => createChannelDefinition(index + 1));
  let state = createInitialSpatialRoutingState(channels);
  channels.forEach((channel, index) => {
    state = spatialRoutingReducer(state, { type: "assign-channel", channelId: channel.id, coordinate: SPATIAL_COORDINATES[index] });
  });
  assert.equal(new Set(state.channels.map((channel) => coordinateKey(channel.assignment))).size, 25);
  const moved = state.channels[0];
  state = spatialRoutingReducer(state, { type: "assign-channel", channelId: moved.id, coordinate: SPATIAL_COORDINATES[24] });
  assert.equal(state.channels.filter((channel) => channel.id === moved.id).length, 1);
  assert.equal(coordinateKey(state.channels.find((channel) => channel.id === moved.id).assignment), coordinateKey(SPATIAL_COORDINATES[24]));
  state = spatialRoutingReducer(state, { type: "sync-channels", channels: channels.slice(1) });
  assert.equal(state.channels.some((channel) => channel.id === moved.id), false);
});

test("M14 mixed-density fixture distinguishes persistent Arpeggio performers from endpoints", async () => {
  const { runtime, contexts, safetyNodes } = harness();
  const topology = [
    ...Array.from({ length: 6 }, (_, index) => ({ id: id(index + 1), sourceId: id(index + 1) })),
    { id: "channel-04-plot-1", sourceId: id(4) },
    { id: "channel-04-plot-2", sourceId: id(4) },
    { id: "channel-05-plot-1", sourceId: id(5) },
    { id: "channel-05-plot-2", sourceId: id(5) },
    { id: "channel-05-plot-3", sourceId: id(5) },
  ];
  runtime.synchronizeTopology(topology);
  ["sine", "triangle", "saw", "sine", "saw", "square"].forEach((generator, index) => runtime.setGenerator(id(index + 1), generator));
  runtime.setArpeggioPattern(id(4), "major");
  runtime.setArpeggioPattern(id(5), "minor");
  runtime.setArpeggioPattern(id(6), "fifths");
  [4, 5, 6].forEach((sequence) => { runtime.setArpeggioPitchCount(id(sequence), sequence - 1); runtime.setArpeggioEnabled(id(sequence), true); });
  for (let sequence = 1; sequence <= 6; sequence += 1) await runtime.startChannel(id(sequence));

  assert.equal(contexts.length, 1);
  assert.equal(safetyNodes.length, 1);
  assert.equal(runtime.getDiagnostics().activeSources, 6);
  assert.equal(runtime.getDiagnostics().activeChannels, 11);
  assert.equal(runtime.getDiagnostics().activeGeneratorVoices, 6);
  assert.equal(runtime.getDiagnostics().activeArpeggioPerformers, 3);
  assert.equal(runtime.getDiagnostics().generatorVoiceCreations, 6);
  assert.equal(contexts[0].oscillators.length, 6);
  assert.equal(runtime.getChannelSnapshot("channel-05-plot-3").activeGeneratorVoices, 1);

  runtime.setPitch(id(6), 330);
  runtime.setArpeggioRate(id(4), 1_200);
  assert.equal(runtime.getDiagnostics().activeSources, 6);
  assert.equal(runtime.getDiagnostics().activeGeneratorVoices, 6);
  runtime.synchronizeTopology([]);
  assert.equal(runtime.getDiagnostics().activeSources, 0);
  assert.equal(runtime.getDiagnostics().activeGeneratorVoices, 0);
  assert.equal(runtime.getDiagnostics().knownSources, 0);

  runtime.synchronizeTopology([{ id: id(1), sourceId: id(1) }]);
  runtime.setGenerator(id(1), "square");
  runtime.setArpeggioPattern(id(1), "octaves");
  runtime.setArpeggioPitchCount(id(1), 2);
  runtime.setArpeggioEnabled(id(1), true);
  await runtime.startChannel(id(1));
  assert.equal(runtime.getDiagnostics().contextCreations, 1);
  assert.equal(runtime.getDiagnostics().masterCreations, 1);
  assert.equal(runtime.getDiagnostics().safetyCreations, 1);
  assert.equal(runtime.getDiagnostics().activeSources, 1);
  assert.equal(runtime.getDiagnostics().activeGeneratorVoices, 1);
  assert.equal(runtime.getDiagnostics().activeArpeggioPerformers, 1);
  runtime.stopChannel(id(1));
});

test("safety processor creation failure is fail-closed with no destination connection", async () => {
  const contexts = [];
  const runtime = new ApplicationAudioRuntime(() => {
    const context = new FakeContext();
    contexts.push(context);
    return context;
  }, async () => { throw new Error("Output safety processor failed to load"); });
  await runtime.startChannel(id(1));
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].closed, true);
  assert.equal(contexts[0].destination.connections.length, 0);
  assert.equal(runtime.getDiagnostics().masterCreations, 0);
  assert.equal(runtime.getDiagnostics().safetyCreations, 0);
  assert.equal(runtime.getChannelSnapshot(id(1)).availability, "error");
  assert.match(runtime.getChannelSnapshot(id(1)).message, /safety processor failed/i);
});

test("shutdown clears MessagePort handler and repeated recreation owns one live handler", async () => {
  const { runtime, safetyNodes } = harness();
  await runtime.startChannel(id(1));
  assert.equal(typeof safetyNodes[0].port.onmessage, "function");
  await runtime.shutdownApplication();
  assert.equal(safetyNodes[0].port.onmessage, null);
  assert.equal(safetyNodes[0].port.closed, true);
  await runtime.startChannel(id(1));
  assert.equal(safetyNodes.length, 2);
  assert.equal(typeof safetyNodes[1].port.onmessage, "function");
  assert.equal(runtime.getDiagnostics().contextCreations, 2);
  assert.equal(runtime.getDiagnostics().safetyCreations, 2);
  assert.equal(runtime.getDiagnostics().safetyDisposals, 1);
});
