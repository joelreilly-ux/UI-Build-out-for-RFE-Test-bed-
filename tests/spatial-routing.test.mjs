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
