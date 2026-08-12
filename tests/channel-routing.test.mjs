import assert from "node:assert/strict";
import test from "node:test";
import { getIncomingChannels, isChannelRoutable } from "../app/channel-routing.ts";
import { appReducer, createInitialState } from "../app/interaction-state.ts";
import { createInitialSpatialRoutingState, getCoordinateByKey, spatialRoutingReducer } from "../app/spatial-routing.ts";

test("default Threads state contains one active, routable channel", () => {
  const state = createInitialState();
  assert.deepEqual(getIncomingChannels(state).map((channel) => [channel.id, channel.status]), [["channel-01", "complete"]]);
  assert.equal(state.threadChannels.length, 1);
  assert.equal(state.channelTerminalConnections.length, 1);
});

test("dynamic channels follow the highest active identity with no five-channel ceiling", () => {
  let state = createInitialState();
  for (let index = 0; index < 7; index += 1) state = appReducer(state, { type: "add-channel" });
  assert.equal(state.threadChannels.length, 8);
  assert.deepEqual(state.threadChannels.map((channel) => channel.id), ["channel-01", "channel-02", "channel-03", "channel-04", "channel-05", "channel-06", "channel-07", "channel-08"]);
  state = appReducer(state, { type: "remove-channel", channelId: "channel-03" });
  state = appReducer(state, { type: "add-channel" });
  assert.deepEqual(state.threadChannels.map((channel) => channel.id), ["channel-01", "channel-02", "channel-04", "channel-05", "channel-06", "channel-07", "channel-08", "channel-09"]);
});

test("channel numbering resets only when no active channels remain", () => {
  let state = createInitialState();
  for (let index = 0; index < 8; index += 1) state = appReducer(state, { type: "add-channel" });
  for (const channelId of ["channel-02", "channel-03", "channel-04", "channel-06", "channel-07", "channel-08"]) {
    state = appReducer(state, { type: "remove-channel", channelId });
  }
  assert.deepEqual(state.threadChannels.map((channel) => channel.id), ["channel-01", "channel-05", "channel-09"]);
  state = appReducer(state, { type: "add-channel" });
  assert.deepEqual(state.threadChannels.map((channel) => channel.id), ["channel-01", "channel-05", "channel-09", "channel-10"]);

  for (const channel of [...state.threadChannels]) state = appReducer(state, { type: "remove-channel", channelId: channel.id });
  assert.equal(state.threadChannels.length, 0);
  assert.equal(state.nextChannelSequence, 1);
  state = appReducer(state, { type: "add-channel" });
  assert.deepEqual(state.threadChannels.map((channel) => channel.id), ["channel-01"]);
});

test("terminal connectivity derives incomplete state and gates plotting eligibility", () => {
  let state = appReducer(createInitialState(), { type: "add-channel" });
  assert.equal(getIncomingChannels(state).find((channel) => channel.id === "channel-02").status, "incomplete");
  assert.equal(isChannelRoutable(state, "channel-02"), false);
  state = appReducer(state, { type: "begin-connection", fromModuleId: "attack" });
  state = appReducer(state, { type: "commit-channel-output", channelId: "channel-02" });
  assert.equal(isChannelRoutable(state, "channel-02"), true);
});

test("removing one channel preserves peers and removes only its terminal and downstream route", () => {
  let threads = createInitialState();
  threads = appReducer(threads, { type: "add-channel" });
  threads = appReducer(threads, { type: "begin-connection", fromModuleId: "attack" });
  threads = appReducer(threads, { type: "commit-channel-output", channelId: "channel-02" });
  threads = appReducer(threads, { type: "add-channel" });

  let routing = createInitialSpatialRoutingState(threads.threadChannels);
  const destination = getCoordinateByKey("2,1");
  assert.ok(destination);
  routing = spatialRoutingReducer(routing, { type: "assign-channel", channelId: "channel-02", coordinate: destination });

  const remainingIds = threads.threadChannels.filter((channel) => channel.id !== "channel-02").map((channel) => channel.id);
  threads = appReducer(threads, { type: "remove-channel", channelId: "channel-02" });
  routing = spatialRoutingReducer(routing, { type: "sync-channels", channels: threads.threadChannels });

  assert.deepEqual(threads.threadChannels.map((channel) => channel.id), remainingIds);
  assert.equal(threads.channelTerminalConnections.some((connection) => connection.channelId === "channel-02"), false);
  assert.equal(routing.channels.some((channel) => channel.id === "channel-02"), false);
  assert.equal(routing.channels.find((channel) => channel.id === "channel-01").assignment && true, true);
});

test("deleting a terminal source makes only its stable channel incomplete", () => {
  let state = createInitialState();
  state = appReducer(state, { type: "add-channel" });
  state = appReducer(state, { type: "begin-connection", fromModuleId: "attack" });
  state = appReducer(state, { type: "commit-channel-output", channelId: "channel-02" });
  state = appReducer(state, { type: "select-module", id: "chord" });
  state = appReducer(state, { type: "delete-selection" });
  assert.equal(getIncomingChannels(state).find((channel) => channel.id === "channel-01").status, "incomplete");
  assert.equal(getIncomingChannels(state).find((channel) => channel.id === "channel-02").status, "complete");
});
