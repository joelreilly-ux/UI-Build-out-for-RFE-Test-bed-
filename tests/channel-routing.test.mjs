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

test("placing a source visibly takes ownership of its legacy placeholder output route", () => {
  const initial = createInitialState();
  const placed = appReducer(initial, { type: "place-channel-source", channelId: "channel-01" });
  const source = placed.modules.find((module) => module.audioChannelId === "channel-01");
  assert.ok(source);
  assert.equal(placed.channelTerminalConnections.find((connection) => connection.channelId === "channel-01").fromModuleId, source.id);
  assert.equal(getIncomingChannels(placed).find((channel) => channel.id === "channel-01").status, "complete");
  assert.match(placed.statusMessage, /placed and routed/i);
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

test("a pitched generator can be placed once and can use any free Channel Out without changing source identity", () => {
  let state = appReducer(createInitialState(), { type: "add-channel" });
  state = appReducer(state, { type: "place-channel-source", channelId: "channel-02", generatorType: "triangle" });
  const source = state.modules.find((module) => module.audioChannelId === "channel-02");
  assert.ok(source);
  assert.equal(source.type, "pitched-generator");
  assert.equal(source.generatorType, "triangle");
  assert.equal(source.title, "CH 02 Triangle");
  assert.deepEqual(source.ports, { input: false, output: true });

  const once = state.modules.length;
  state = appReducer(state, { type: "place-channel-source", channelId: "channel-02" });
  assert.equal(state.modules.length, once);
  state = appReducer(state, { type: "remove-channel-output", channelId: "channel-01" });
  state = appReducer(state, { type: "begin-connection", fromModuleId: source.id });
  state = appReducer(state, { type: "commit-channel-output", channelId: "channel-01" });
  assert.equal(state.channelTerminalConnections.some((connection) => connection.channelId === "channel-01" && connection.fromModuleId === source.id), true);
  assert.equal(getIncomingChannels(state).find((channel) => channel.id === "channel-02").status, "complete");
  assert.equal(getIncomingChannels(state).find((channel) => channel.id === "channel-01").status, "incomplete");

  state = appReducer(state, { type: "begin-connection", fromModuleId: source.id });
  const secondRoute = appReducer(state, { type: "commit-channel-output", channelId: "channel-02" });
  assert.match(secondRoute.statusMessage, /already connected/i);
  assert.equal(secondRoute.channelTerminalConnections.filter((connection) => connection.fromModuleId === source.id).length, 1);
});

test("removing a placed source returns the channel to an unplaced/incomplete state and channel removal cleans its node", () => {
  let state = appReducer(createInitialState(), { type: "add-channel" });
  state = appReducer(state, { type: "place-channel-source", channelId: "channel-02" });
  const source = state.modules.find((module) => module.audioChannelId === "channel-02");
  assert.ok(source);
  state = appReducer(state, { type: "begin-connection", fromModuleId: source.id });
  state = appReducer(state, { type: "commit-channel-output", channelId: "channel-02" });
  state = appReducer(state, { type: "select-module", id: source.id });
  state = appReducer(state, { type: "delete-selection" });
  assert.equal(state.modules.some((module) => module.audioChannelId === "channel-02"), false);
  assert.equal(getIncomingChannels(state).find((channel) => channel.id === "channel-02").status, "incomplete");

  state = appReducer(state, { type: "place-channel-source", channelId: "channel-02" });
  state = appReducer(state, { type: "remove-channel", channelId: "channel-02" });
  assert.equal(state.modules.some((module) => module.audioChannelId === "channel-02"), false);
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

test("Clone and Duplicate creation preserve distinct lineage and deletion semantics", () => {
  let state = appReducer(createInitialState(), { type: "place-channel-source", channelId: "channel-01" });
  state = appReducer(state, { type: "clone-source", sourceChannelId: "channel-01" });
  const clone = state.threadChannels.find((channel) => channel.role === "clone");
  assert.ok(clone);
  assert.equal(clone.sourceId, "channel-01");
  assert.equal(state.modules.find((module) => module.audioChannelId === clone.id).eyebrow, "Clone of CH 01");

  state = appReducer(state, { type: "duplicate-source", sourceChannelId: "channel-01" });
  const duplicate = state.threadChannels.find((channel) => channel.role === "duplicate");
  assert.ok(duplicate);
  assert.equal(duplicate.sourceId, duplicate.id);
  assert.equal(duplicate.duplicatedFrom, "channel-01");

  const cloneModule = state.modules.find((module) => module.audioChannelId === clone.id);
  state = appReducer(state, { type: "select-module", id: cloneModule.id });
  state = appReducer(state, { type: "delete-selection" });
  assert.equal(state.threadChannels.some((channel) => channel.id === clone.id), false);
  assert.equal(state.threadChannels.some((channel) => channel.id === "channel-01"), true);
  assert.equal(state.threadChannels.some((channel) => channel.id === duplicate.id), true);
});

test("a root with Clones rejects quick delete and confirmed cascade removes only its family", () => {
  let state = appReducer(createInitialState(), { type: "place-channel-source", channelId: "channel-01" });
  state = appReducer(state, { type: "clone-source", sourceChannelId: "channel-01" });
  state = appReducer(state, { type: "duplicate-source", sourceChannelId: "channel-01" });
  const rootModule = state.modules.find((module) => module.audioChannelId === "channel-01");
  state = appReducer(state, { type: "select-module", id: rootModule.id });
  const protectedState = appReducer(state, { type: "delete-selection" });
  assert.equal(protectedState.threadChannels.length, 3);
  assert.match(protectedState.statusMessage, /confirm cascade deletion/i);

  const cascaded = appReducer(protectedState, { type: "delete-source-family", sourceChannelId: "channel-01" });
  assert.deepEqual(cascaded.threadChannels.map((channel) => channel.role), ["duplicate"]);
});

test("a Duplicate becomes a cascade-protected root when it later gains Clones", () => {
  let state = appReducer(createInitialState(), { type: "place-channel-source", channelId: "channel-01" });
  state = appReducer(state, { type: "duplicate-source", sourceChannelId: "channel-01" });
  const duplicate = state.threadChannels.find((channel) => channel.role === "duplicate");
  state = appReducer(state, { type: "clone-source", sourceChannelId: duplicate.id });
  const duplicateModule = state.modules.find((module) => module.audioChannelId === duplicate.id);
  state = appReducer(state, { type: "select-module", id: duplicateModule.id });
  const protectedState = appReducer(state, { type: "delete-selection" });
  assert.equal(protectedState.threadChannels.filter((channel) => channel.sourceId === duplicate.id).length, 2);
  assert.match(protectedState.statusMessage, /confirm cascade deletion/i);
});
