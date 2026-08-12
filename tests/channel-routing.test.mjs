import assert from "node:assert/strict";
import test from "node:test";
import { getIncomingChannels, isChannelRoutable } from "../app/channel-routing.ts";
import { appReducer, createInitialState } from "../app/interaction-state.ts";
import { createInitialSpatialRoutingState, getCoordinateByKey, spatialRoutingReducer } from "../app/spatial-routing.ts";

test("five stable Thread outputs arrive as routable channels with additional unused capacity", () => {
  const state = createInitialState();
  const incoming = getIncomingChannels(state);
  assert.deepEqual(incoming.map((channel) => [channel.id, channel.status]), [
    ["channel-01", "complete"],
    ["channel-02", "complete"],
    ["channel-03", "complete"],
    ["channel-04", "complete"],
    ["channel-05", "complete"],
    ["channel-06", "unused"],
  ]);
  assert.equal(new Set(state.channelTerminalConnections.map((connection) => connection.channelId)).size, 5);
});

test("terminal connectivity derives incomplete state and gates plotting eligibility", () => {
  const initial = createInitialState();
  const incomplete = appReducer(initial, { type: "remove-channel-output", channelId: "channel-04" });
  assert.equal(getIncomingChannels(incomplete).find((channel) => channel.id === "channel-04").status, "incomplete");
  assert.equal(isChannelRoutable(incomplete, "channel-04"), false);
  assert.equal(getIncomingChannels(incomplete).find((channel) => channel.id === "channel-06").status, "unused");
  assert.equal(incomplete.threadChannels.some((channel) => channel.channelId === "channel-04"), true);
});

test("an incomplete channel becomes routable only through an actual terminal connection", () => {
  let state = appReducer(createInitialState(), { type: "remove-channel-output", channelId: "channel-04" });
  state = appReducer(state, { type: "begin-connection", fromModuleId: "chord" });
  state = appReducer(state, { type: "commit-channel-output", channelId: "channel-04" });
  assert.equal(isChannelRoutable(state, "channel-04"), true);
  assert.equal(state.channelTerminalConnections.filter((connection) => connection.channelId === "channel-04").length, 1);
});

test("deleting a terminal source makes its stable channel incomplete without affecting peers", () => {
  let state = createInitialState();
  state = appReducer(state, { type: "select-module", id: "chord" });
  state = appReducer(state, { type: "delete-selection" });
  assert.equal(getIncomingChannels(state).find((channel) => channel.id === "channel-01").status, "incomplete");
  assert.equal(getIncomingChannels(state).find((channel) => channel.id === "channel-02").status, "complete");
  assert.equal(state.threadChannels.some((channel) => channel.channelId === "channel-01"), true);
});

test("unplotting changes only Sound Desk routing and preserves the Thread source", () => {
  const threads = createInitialState();
  const initialRouting = createInitialSpatialRoutingState();
  const unplotted = spatialRoutingReducer(initialRouting, { type: "unassign-channel", channelId: "channel-05" });
  assert.equal(unplotted.channels.find((channel) => channel.id === "channel-05").assignment, null);
  assert.equal(isChannelRoutable(threads, "channel-05"), true);
  assert.equal(threads.channelTerminalConnections.some((connection) => connection.channelId === "channel-05"), true);
  const destination = getCoordinateByKey("2,1");
  assert.ok(destination);
  const replotted = spatialRoutingReducer(unplotted, { type: "assign-channel", channelId: "channel-05", coordinate: destination });
  assert.deepEqual(replotted.channels.find((channel) => channel.id === "channel-05").assignment, destination);
});
