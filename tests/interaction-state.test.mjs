import assert from "node:assert/strict";
import test from "node:test";
import {
  appReducer,
  canConnect,
  createBenchmarkState,
  createInitialState,
  formatElapsed,
  getElapsedMs,
  sanitizeRestoredState,
} from "../app/interaction-state.ts";

test("module instances have unique identity and independent parameter memory", () => {
  const initial = createBenchmarkState(32, 32);
  assert.equal(new Set(initial.modules.map((module) => module.id)).size, 32);
  const [first, second] = initial.modules;
  const edited = appReducer(initial, { type: "update-parameter", id: second.id, key: "duration", value: "1/2" });
  assert.notEqual(edited.modules.find((module) => module.id === first.id).parameters.duration, "1/2");
  assert.equal(edited.modules.find((module) => module.id === second.id).parameters.duration, "1/2");
});

test("selection, Inspector parameter updates, toggles and movement share canonical state", () => {
  const initial = createInitialState();
  const selected = appReducer(initial, { type: "select-module", id: "custom" });
  const tuned = appReducer(selected, { type: "update-parameter", id: "custom", key: "rootNote", value: "G3" });
  const toggled = appReducer(tuned, { type: "update-parameter", id: "custom", key: "randomizeSeed", value: false });
  const moved = appReducer(toggled, { type: "move-module", id: "custom", position: { x: 41, y: 52 } });
  const movedModule = moved.modules.find((item) => item.id === "custom");
  assert.deepEqual(moved.selection, { kind: "module", id: "custom" });
  assert.equal(movedModule.parameters.rootNote, "G3");
  assert.equal(movedModule.parameters.randomizeSeed, false);
  assert.deepEqual(movedModule.position, { x: 41, y: 52 });
});

test("valid Threads commit, duplicates and unavailable endpoints reject cleanly, and deletion cleans state", () => {
  const initial = createInitialState();
  const begun = appReducer(initial, { type: "begin-connection", fromModuleId: "attack" });
  assert.equal(canConnect(begun, "attack", "slots").valid, true);
  const connected = appReducer(begun, { type: "commit-connection", toModuleId: "slots" });
  assert.equal(connected.connections.length, initial.connections.length + 1);
  assert.equal(connected.selection.kind, "connection");
  const duplicateAttempt = appReducer(appReducer(connected, { type: "begin-connection", fromModuleId: "attack" }), { type: "commit-connection", toModuleId: "slots" });
  assert.equal(duplicateAttempt.connections.length, connected.connections.length);
  assert.match(duplicateAttempt.statusMessage, /already exists/i);
  const futureAttempt = appReducer(appReducer(connected, { type: "begin-connection", fromModuleId: "attack" }), { type: "commit-connection", toModuleId: "audio" });
  assert.equal(futureAttempt.connections.length, connected.connections.length);
  assert.match(futureAttempt.statusMessage, /future modules/i);
  const removed = appReducer(connected, { type: "delete-selection" });
  assert.equal(removed.connections.length, initial.connections.length);
  assert.equal(removed.selection, null);
});

test("benchmark preset provides the required 32 module / 32 Thread operating fixture", () => {
  const state = createBenchmarkState();
  assert.equal(state.modules.length, 32);
  assert.equal(state.connections.length, 32);
  assert.equal(state.connections.every((thread) => state.modules.some((module) => module.id === thread.fromModuleId) && state.modules.some((module) => module.id === thread.toModuleId)), true);
});

test("restoration removes orphaned Threads and rejects duplicate module identity", () => {
  const initial = createInitialState();
  const restored = sanitizeRestoredState({ ...initial, connections: [...initial.connections, { id: "orphan", fromModuleId: "missing", toModuleId: "notes", fromPort: "out", toPort: "in" }] });
  assert.equal(restored.connections.some((thread) => thread.id === "orphan"), false);
  assert.equal(sanitizeRestoredState({ ...initial, modules: [...initial.modules, initial.modules[0]] }), null);
});

test("elapsed session time uses monotonic timestamps rather than accumulated ticks", () => {
  let state = createInitialState();
  state = appReducer(state, { type: "toggle-session", now: 1_000 });
  assert.equal(getElapsedMs(state.session, 15_000), 14_000);
  assert.equal(formatElapsed(getElapsedMs(state.session, 15_000)), "00:00:14");
  state = appReducer(state, { type: "toggle-session", now: 16_000 });
  assert.equal(getElapsedMs(state.session, 30_000), 15_000);
  state = appReducer(state, { type: "reset-session", now: 30_000 });
  assert.equal(getElapsedMs(state.session, 80_000), 0);
});
