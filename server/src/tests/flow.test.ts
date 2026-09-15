import assert from "node:assert/strict";
import { test } from "node:test";
import { topoSort } from "../flow-engine.js";
import { templateFlow } from "../flow-store.js";

test("image-to-video template is a valid DAG", () => {
  const flow = templateFlow("image-to-video");
  const order = topoSort(flow);
  assert.equal(order[0], "prompt");
  assert.ok(order.indexOf("gen") < order.indexOf("vid"));
  assert.equal(order[order.length - 1], "out");
});

test("cycle is rejected", () => {
  const flow = templateFlow("image");
  flow.edges.push({ id: "loop", from: "out", to: "prompt" });
  assert.throws(() => topoSort(flow), /cycle/i);
});
