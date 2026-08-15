import assert from "node:assert/strict";
import test from "node:test";
import { createChannelDefinition } from "../app/channel-routing.ts";
import {
  SPATIAL_AXIS,
  SPATIAL_COORDINATES,
  coordinateKey,
  createInitialSpatialRoutingState,
  getChannelsAtCoordinate,
  getCoordinateByKey,
  spatialRoutingReducer,
} from "../app/spatial-routing.ts";

test("canonical spatial model contains one oriented 5 by 5 coordinate definition", () => {
  assert.deepEqual(SPATIAL_AXIS, [-2, -1, 0, 1, 2]);
  assert.equal(SPATIAL_COORDINATES.length, 25);
  assert.equal(new Set(SPATIAL_COORDINATES.map(coordinateKey)).size, 25);
  assert.deepEqual(SPATIAL_COORDINATES.slice(0, 5).map(coordinateKey), ["-2,2", "-1,2", "0,2", "1,2", "2,2"]);
});

test("spatial state derives its channel population from authoritative Threads state", () => {
  const channels = [1, 2, 3, 4, 5, 6, 7].map(createChannelDefinition);
  const state = createInitialSpatialRoutingState(channels);
  assert.deepEqual(state.channels.map((channel) => channel.id), channels.map((channel) => channel.id));
  assert.equal(coordinateKey(state.channels[0].assignment), "0,0");
  assert.equal(state.channels.slice(1).every((channel) => channel.assignment === null), true);
  assert.equal(state.channels.every((channel) => channel.liveTrim === 0), true);
});

test("sync adds and removes identities while retaining surviving assignments", () => {
  const channels = [1, 2, 3].map(createChannelDefinition);
  const destination = getCoordinateByKey("2,-2");
  assert.ok(destination);
  let state = createInitialSpatialRoutingState(channels);
  state = spatialRoutingReducer(state, { type: "assign-channel", channelId: "channel-02", coordinate: destination });
  state = spatialRoutingReducer(state, { type: "set-live-trim", channelId: "channel-03", value: 16 });
  state = spatialRoutingReducer(state, { type: "sync-channels", channels: [channels[0], channels[2], createChannelDefinition(4)] });
  assert.deepEqual(state.channels.map((channel) => channel.id), ["channel-01", "channel-03", "channel-04"]);
  assert.equal(coordinateKey(state.channels[0].assignment), "0,0");
  assert.equal(state.channels[2].assignment, null);
  assert.equal(state.channels[1].liveTrim, 16);
  assert.equal(state.channels[2].liveTrim, 0);
});

test("Live Trim is channel-owned, bounded, and independent of programmed routing coordinates", () => {
  const channels = [createChannelDefinition(1), createChannelDefinition(2)];
  let state = createInitialSpatialRoutingState(channels);
  const originalCoordinate = state.channels[0].assignment;
  state = spatialRoutingReducer(state, { type: "set-live-trim", channelId: "channel-01", value: 50 });
  state = spatialRoutingReducer(state, { type: "set-live-trim", channelId: "channel-02", value: -150 });
  assert.equal(state.channels[0].liveTrim, 16);
  assert.equal(state.channels[1].liveTrim, -100);
  assert.equal(state.channels[0].assignment, originalCoordinate);
  assert.equal(state.channels[1].assignment, null);
});

test("invalid Live Trim control data preserves the previous finite value", () => {
  const channels = [createChannelDefinition(1)];
  let state = createInitialSpatialRoutingState(channels);
  state = spatialRoutingReducer(state, { type: "set-live-trim", channelId: "channel-01", value: 8 });
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, "16"]) {
    state = spatialRoutingReducer(state, { type: "set-live-trim", channelId: "channel-01", value });
    assert.equal(state.channels[0].liveTrim, 8);
  }
});

test("channel-owned assignments permit stacked routing without collision state", () => {
  const channels = [createChannelDefinition(1), createChannelDefinition(2)];
  let state = createInitialSpatialRoutingState(channels);
  const origin = getCoordinateByKey("0,0");
  assert.ok(origin);
  state = spatialRoutingReducer(state, { type: "assign-channel", channelId: "channel-02", coordinate: origin });
  assert.deepEqual(getChannelsAtCoordinate(state, origin).map((channel) => channel.id), ["channel-01", "channel-02"]);
  state = spatialRoutingReducer(state, { type: "unassign-channel", channelId: "channel-02" });
  assert.deepEqual(getChannelsAtCoordinate(state, origin).map((channel) => channel.id), ["channel-01"]);
});

test("Multi-Plot creates removable spatial endpoints without creating another source channel", () => {
  const channels = [createChannelDefinition(1), createChannelDefinition(2)];
  let state = createInitialSpatialRoutingState(channels);
  state = spatialRoutingReducer(state, { type: "add-multi-plot", channelId: "channel-01" });
  state = spatialRoutingReducer(state, { type: "add-multi-plot", channelId: "channel-01" });
  const family = state.channels.filter((plot) => plot.channelId === "channel-01");
  assert.equal(family.length, 3);
  assert.deepEqual(family.map((plot) => plot.sourceId), ["channel-01", "channel-01", "channel-01"]);
  assert.deepEqual(family.map((plot) => plot.plotNumber), [1, 2, 3]);
  assert.equal(family.slice(1).every((plot) => plot.isMultiPlot && plot.id.startsWith("channel-01-plot-")), true);
  assert.equal(channels.length, 2);

  state = spatialRoutingReducer(state, { type: "remove-multi-plot", plotId: family[1].id });
  assert.deepEqual(state.channels.filter((plot) => plot.channelId === "channel-01").map((plot) => plot.id), [family[0].id, family[2].id]);
  assert.equal(state.channels.some((plot) => plot.channelId === "channel-02"), true);
});

test("Multi-Plot position, mute, and trim are endpoint-owned while source programming identity stays shared", () => {
  let state = createInitialSpatialRoutingState([createChannelDefinition(1)]);
  state = spatialRoutingReducer(state, { type: "add-multi-plot", channelId: "channel-01" });
  const root = state.channels[0];
  const multiPlot = state.channels[1];
  state = spatialRoutingReducer(state, { type: "move-plot", plotId: multiPlot.id, position: { x: 1.375, y: -0.625 } });
  state = spatialRoutingReducer(state, { type: "set-live-trim", channelId: multiPlot.id, value: -100 });
  assert.deepEqual(state.channels.find((plot) => plot.id === multiPlot.id).assignment, { x: 1.375, y: -0.625 });
  assert.equal(state.channels.find((plot) => plot.id === multiPlot.id).liveTrim, -100);
  assert.deepEqual(state.channels.find((plot) => plot.id === root.id).assignment, root.assignment);
  assert.equal(state.channels.find((plot) => plot.id === root.id).liveTrim, 0);
  assert.equal(state.channels.every((plot) => plot.sourceId === "channel-01"), true);

  const beforeInvalidMove = state;
  state = spatialRoutingReducer(state, { type: "move-plot", plotId: multiPlot.id, position: { x: Number.NaN, y: 0 } });
  assert.equal(state, beforeInvalidMove);
});

test("channel synchronization preserves surviving Multi-Plots and clears them with their Channel Out", () => {
  const channels = [createChannelDefinition(1), createChannelDefinition(2)];
  let state = createInitialSpatialRoutingState(channels);
  state = spatialRoutingReducer(state, { type: "add-multi-plot", channelId: "channel-01" });
  state = spatialRoutingReducer(state, { type: "sync-channels", channels: [channels[0]] });
  assert.equal(state.channels.length, 2);
  assert.equal(state.channels.some((plot) => plot.isMultiPlot), true);
  state = spatialRoutingReducer(state, { type: "sync-channels", channels: [] });
  assert.deepEqual(state.channels, []);
});

test("plot-point layer order is explicit and changes presentation without changing routing ownership", () => {
  let state = createInitialSpatialRoutingState([createChannelDefinition(1)]);
  state = spatialRoutingReducer(state, { type: "add-multi-plot", channelId: "channel-01" });
  state = spatialRoutingReducer(state, { type: "add-multi-plot", channelId: "channel-01" });
  for (const plot of state.channels.slice(1)) state = spatialRoutingReducer(state, { type: "move-plot", plotId: plot.id, position: { x: 0, y: 0 } });
  const root = state.channels.find((plot) => !plot.isMultiPlot);
  const firstMultiPlot = state.channels.find((plot) => plot.plotNumber === 2);
  assert.ok(root && firstMultiPlot);
  const ownershipBefore = state.channels.map((plot) => [plot.id, plot.sourceId, plot.assignment, plot.liveTrim]);

  state = spatialRoutingReducer(state, { type: "move-plot-layer", plotId: root.id, direction: "forward" });
  const ordered = [...state.channels].sort((a, b) => a.layerOrder - b.layerOrder);
  assert.deepEqual(ordered.slice(0, 2).map((plot) => plot.id), [firstMultiPlot.id, root.id]);
  assert.deepEqual(state.channels.map((plot) => [plot.id, plot.sourceId, plot.assignment, plot.liveTrim]), ownershipBefore);
});

test("a plot-point folder moves its complete co-located stack atomically", () => {
  let state = createInitialSpatialRoutingState([createChannelDefinition(1)]);
  state = spatialRoutingReducer(state, { type: "add-multi-plot", channelId: "channel-01" });
  state = spatialRoutingReducer(state, { type: "add-multi-plot", channelId: "channel-01" });
  for (const plot of state.channels.slice(1)) state = spatialRoutingReducer(state, { type: "move-plot", plotId: plot.id, position: { x: 0, y: 0 } });
  const plotIds = state.channels.map((plot) => plot.id);
  const identityBefore = state.channels.map((plot) => [plot.id, plot.sourceId, plot.liveTrim, plot.layerOrder]);

  state = spatialRoutingReducer(state, { type: "move-plot-stack", plotIds, position: { x: 2, y: -1 } });
  assert.equal(state.channels.every((plot) => plot.assignment?.x === 2 && plot.assignment.y === -1), true);
  assert.deepEqual(state.channels.map((plot) => [plot.id, plot.sourceId, plot.liveTrim, plot.layerOrder]), identityBefore);

  state = spatialRoutingReducer(state, { type: "move-plot", plotId: plotIds[1], position: { x: -1, y: 2 } });
  assert.deepEqual(state.channels.find((plot) => plot.id === plotIds[1])?.assignment, { x: -1, y: 2 });
  assert.equal(state.channels.filter((plot) => plot.assignment?.x === 2 && plot.assignment.y === -1).length, 2);
  state = spatialRoutingReducer(state, { type: "remove-multi-plot", plotId: plotIds[2] });
  assert.equal(state.channels.some((plot) => plot.id === plotIds[2]), false);
  assert.deepEqual(state.channels.find((plot) => plot.id === plotIds[0])?.assignment, { x: 2, y: -1 });

  const unchanged = spatialRoutingReducer(state, { type: "move-plot-stack", plotIds: [plotIds[0], "missing-plot"], position: { x: -2, y: 2 } });
  assert.equal(unchanged, state);
});
