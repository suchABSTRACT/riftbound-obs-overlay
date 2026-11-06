import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLayout } from "../public/shared/layout.js";

test("normalizeLayout preserves portrait slot aspect ratio", () => {
  const normalized = normalizeLayout({
    "p1.card": { x: 0, y: 0, width: 10, height: 1, visible: true },
  });
  assert.equal(normalized["p1.card"].height, 24.8);
});

