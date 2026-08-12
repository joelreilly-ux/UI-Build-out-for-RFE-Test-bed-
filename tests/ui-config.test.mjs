import assert from "node:assert/strict";
import test from "node:test";
import { BASELINE_UI_CONFIG, DARK_UI_CONFIG, UI_PRESETS } from "../app/ui-config.ts";

test("approved compact Thread geometry is shared by dark, bright, spacious and compact styles", () => {
  const styles = [
    BASELINE_UI_CONFIG,
    DARK_UI_CONFIG,
    UI_PRESETS["Light Utility"],
    UI_PRESETS["Dark Utility"],
    UI_PRESETS["Spacious Light"],
    UI_PRESETS.Compact,
  ];
  for (const style of styles) {
    assert.equal(style.nodes.nodeWidth, 135);
    assert.equal(style.layout.nodeMinHeight, 48);
    assert.equal(style.nodes.nodePadding, 8);
    assert.equal(style.spacing.workspacePadding, 12);
  }
});
