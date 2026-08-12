import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACES,
  getAdjacentWorkspace,
  getTransitionDirection,
  getWorkspace,
} from "../app/workspace-navigation.ts";

test("defines the approved directional workspace order", () => {
  assert.deepEqual(WORKSPACES.map(({ id, label }) => ({ id, label })), [
    { id: "threads", label: "Threads" },
    { id: "sound-desk", label: "Sound Desk" },
    { id: "visualiser", label: "Visualiser" },
  ]);
  assert.equal(getWorkspace("sound-desk").position, 2);
});

test("moves only between adjacent workspaces and stops at both boundaries", () => {
  assert.equal(getAdjacentWorkspace("threads", "previous"), null);
  assert.equal(getAdjacentWorkspace("threads", "next"), "sound-desk");
  assert.equal(getAdjacentWorkspace("sound-desk", "previous"), "threads");
  assert.equal(getAdjacentWorkspace("sound-desk", "next"), "visualiser");
  assert.equal(getAdjacentWorkspace("visualiser", "previous"), "sound-desk");
  assert.equal(getAdjacentWorkspace("visualiser", "next"), null);
});

test("derives restrained transition direction only for adjacent movement", () => {
  assert.equal(getTransitionDirection("threads", "sound-desk"), "forward");
  assert.equal(getTransitionDirection("visualiser", "sound-desk"), "backward");
  assert.equal(getTransitionDirection("threads", "visualiser"), null);
  assert.equal(getTransitionDirection("threads", "threads"), null);
});
