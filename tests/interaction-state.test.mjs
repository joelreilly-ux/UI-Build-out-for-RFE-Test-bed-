import assert from "node:assert/strict";
import test from "node:test";
import {
  appReducer,
  canConnect,
  createBenchmarkState,
  createInitialState,
  formatElapsed,
  getElapsedMs,
  getSelectedModuleIds,
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

test("modules can be added, renamed and deleted with attached Threads cleaned up", () => {
  const initial = createInitialState();
  const added = appReducer(initial, { type: "add-module", moduleType: "note-length" });
  const addedId = added.selection.id;
  assert.equal(added.modules.length, initial.modules.length + 1);
  assert.match(added.modules.find((module) => module.id === addedId).title, /Note Length 2/);
  const renamed = appReducer(added, { type: "rename-module", id: addedId, title: "Review Timing" });
  assert.equal(renamed.modules.find((module) => module.id === addedId).title, "Review Timing");
  const deleted = appReducer(renamed, { type: "delete-selection" });
  assert.equal(deleted.modules.length, initial.modules.length);
  assert.equal(deleted.selection, null);
});

test("additive selection supports group movement, internal Thread duplication and batch deletion", () => {
  let state = createInitialState();
  state = appReducer(state, { type: "select-module", id: "notes" });
  state = appReducer(state, { type: "select-module", id: "chord", additive: true });
  assert.deepEqual(getSelectedModuleIds(state.selection), ["notes", "chord"]);
  const originalChord = state.modules.find((module) => module.id === "chord").position;
  state = appReducer(state, { type: "move-module", id: "notes", position: { x: 9, y: 12 } });
  assert.deepEqual(state.modules.find((module) => module.id === "chord").position, { x: originalChord.x + 4, y: originalChord.y + 5 });
  const duplicated = appReducer(state, { type: "duplicate-selection" });
  const duplicateIds = getSelectedModuleIds(duplicated.selection);
  assert.equal(duplicated.modules.length, state.modules.length + 2);
  assert.equal(duplicated.connections.length, state.connections.length + 1);
  assert.equal(duplicateIds.length, 2);
  assert.equal(duplicated.connections.some((connection) => duplicateIds.includes(connection.fromModuleId) && duplicateIds.includes(connection.toModuleId)), true);
  const deleted = appReducer(duplicated, { type: "delete-selection" });
  assert.equal(deleted.modules.length, state.modules.length);
  assert.equal(deleted.connections.length, state.connections.length);
  assert.equal(deleted.connections.every((connection) => deleted.modules.some((module) => module.id === connection.fromModuleId) && deleted.modules.some((module) => module.id === connection.toModuleId)), true);
});

test("select all and clear workspace remove the patch atomically", () => {
  const selected = appReducer(createInitialState(), { type: "select-all-modules" });
  assert.equal(getSelectedModuleIds(selected.selection).length, selected.modules.length);
  const cleared = appReducer(selected, { type: "clear-workspace" });
  assert.deepEqual({ modules: cleared.modules, connections: cleared.connections, selection: cleared.selection, pan: cleared.pan }, { modules: [], connections: [], selection: null, pan: { x: 0, y: 0 } });
});

test("workspace width cycles through controlled extend and retract steps", () => {
  let state = createInitialState();
  state = appReducer(state, { type: "step-workspace-width" });
  assert.equal(state.workspaceWidth, 150);
  assert.equal(state.workspaceWidthDirection, "extend");
  state = appReducer(state, { type: "step-workspace-width" });
  assert.equal(state.workspaceWidth, 200);
  assert.equal(state.workspaceWidthDirection, "retract");
  state = appReducer(state, { type: "step-workspace-width" });
  assert.equal(state.workspaceWidth, 150);
  state = appReducer(state, { type: "step-workspace-width" });
  assert.equal(state.workspaceWidth, 100);
  assert.equal(state.workspaceWidthDirection, "extend");
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
  state = appReducer(state, { type: "play-session", now: 1_000 });
  assert.equal(getElapsedMs(state.session, 15_000), 14_000);
  assert.equal(formatElapsed(getElapsedMs(state.session, 15_000)), "00:00:14");
  state = appReducer(state, { type: "pause-session", now: 16_000 });
  assert.equal(getElapsedMs(state.session, 30_000), 15_000);
  state = appReducer(state, { type: "play-session", now: 40_000 });
  assert.equal(getElapsedMs(state.session, 45_000), 20_000);
  state = appReducer(state, { type: "stop-session", now: 45_000 });
  assert.equal(getElapsedMs(state.session, 80_000), 0);
  assert.equal(state.session.running, false);
});
