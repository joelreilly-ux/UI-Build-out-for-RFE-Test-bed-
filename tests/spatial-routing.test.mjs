import assert from "node:assert/strict";
import test from "node:test";
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
  assert.ok(getCoordinateByKey("0,0"));
  assert.deepEqual(SPATIAL_COORDINATES.slice(0, 5).map(coordinateKey), ["-2,2", "-1,2", "0,2", "1,2", "2,2"]);
  assert.deepEqual(SPATIAL_COORDINATES.slice(-5).map(coordinateKey), ["-2,-2", "-1,-2", "0,-2", "1,-2", "2,-2"]);
});

test("five routable channels keep independent assignments with extensible unassigned capacity", () => {
  const state = createInitialSpatialRoutingState();
  assert.equal(state.channels.length, 6);
  assert.deepEqual(state.channels.map((channel) => [channel.label, channel.assignment && coordinateKey(channel.assignment)]), [
    ["CH 01", "0,0"],
    ["CH 02", "-2,-1"],
    ["CH 03", "1,2"],
    ["CH 04", "-1,1"],
    ["CH 05", "2,-2"],
    ["CH 06", null],
  ]);
  assert.equal(new Set(state.channels.slice(0, 5).map((channel) => channel.accentId)).size, 5);
});

test("reassignment replaces only the selected channel coordinate without stale placement", () => {
  const initial = createInitialSpatialRoutingState();
  const destination = getCoordinateByKey("2,-2");
  assert.ok(destination);
  const reassigned = spatialRoutingReducer(initial, { type: "assign-channel", channelId: "channel-02", coordinate: destination });
  assert.equal(getChannelsAtCoordinate(reassigned, getCoordinateByKey("-2,-1")).some((channel) => channel.id === "channel-02"), false);
  assert.equal(getChannelsAtCoordinate(reassigned, destination).filter((channel) => channel.id === "channel-02").length, 1);
  assert.equal(coordinateKey(reassigned.channels.find((channel) => channel.id === "channel-01").assignment), "0,0");
  assert.equal(coordinateKey(reassigned.channels.find((channel) => channel.id === "channel-03").assignment), "1,2");
});

test("unassignment retains channel identity while removing its spatial placement", () => {
  const initial = createInitialSpatialRoutingState();
  const unassigned = spatialRoutingReducer(initial, { type: "unassign-channel", channelId: "channel-03" });
  assert.equal(unassigned.channels.find((channel) => channel.id === "channel-03").assignment, null);
  assert.equal(getChannelsAtCoordinate(unassigned, getCoordinateByKey("1,2")).length, 0);
  assert.equal(unassigned.channels.length, 6);
});

test("channel-owned assignments permit future stacked routing without special collision state", () => {
  let state = createInitialSpatialRoutingState();
  const origin = getCoordinateByKey("0,0");
  assert.ok(origin);
  state = spatialRoutingReducer(state, { type: "assign-channel", channelId: "channel-02", coordinate: origin });
  assert.deepEqual(getChannelsAtCoordinate(state, origin).map((channel) => channel.id), ["channel-01", "channel-02"]);
});
