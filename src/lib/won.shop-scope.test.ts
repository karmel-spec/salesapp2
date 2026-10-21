/**
 * 🏆 Shop notes → piano card lines (Mark 10/21). Run: npx tsx --test src/lib/won.shop-scope.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyHandoff, shopScopeLines } from "./won";

describe("shopScopeLines", () => {
  it("carries fix requests and the piano note under a dated header", () => {
    const h = emptyHandoff("Brigham");
    h.items.service = { v: "", note: "Look at missing/broken key" };
    h.piano.note = "mirror piano, legs will come detached.";
    const r = shopScopeLines(h, "2026-10-07T18:00:00Z");
    assert.equal(r.header, "From Brigham's sale 10/7");
    assert.deepEqual(r.lines, ["Fix requests: Look at missing/broken key", "Piano note: mirror piano, legs will come detached."]);
  });
  it("drops 'None stated' and empty notes, and never sends the pickup reminder", () => {
    const h = emptyHandoff("Brigham");
    h.items.service = { v: "", note: "None stated" };
    assert.deepEqual(shopScopeLines(h).lines, []);
  });
});
