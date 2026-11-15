import assert from "node:assert/strict";
import { test } from "node:test";
import { readPageMessage } from "./bridge.ts";

test("the bridge keeps only call, watch and state from the page", () => {
  const kept = [
    {
      type: "call",
      id: "1",
      call: { kind: "read", resource: "sessions", method: "list", body: {} },
    },
    {
      type: "call",
      id: "2",
      call: {
        kind: "upload",
        resource: "files",
        method: "put",
        body: {},
        base64: "AA",
      },
    },
    { type: "watch", id: "3", conditions: [{ session: "s", types: ["x"] }] },
    { type: "state" },
  ];
  for (const message of kept) {
    assert.deepEqual(readPageMessage(JSON.stringify(message)), message);
  }

  const dropped = [
    "not json",
    "null",
    "[]",
    JSON.stringify({ type: "reply", id: "1", reply: { ok: true } }),
    JSON.stringify({ type: "event", message: { kind: "ready" } }),
    JSON.stringify({ type: "open", url: "https://example.com" }),
    JSON.stringify({ type: "state", extra: 1 }),
    JSON.stringify({ type: "watch", id: "1", conditions: [], more: true }),
    // A call may not carry fields the shell does not know, nor bytes outside an upload.
    JSON.stringify({
      type: "call",
      id: "1",
      call: { kind: "read", resource: "a", method: "b", body: 1, native: "x" },
    }),
    JSON.stringify({
      type: "call",
      id: "1",
      call: { kind: "read", resource: "a", method: "b", body: 1, base64: "AA" },
    }),
    JSON.stringify({
      type: "call",
      id: "1",
      call: { kind: "shell", resource: "a", method: "b", body: 1 },
    }),
    JSON.stringify({
      type: "call",
      id: "",
      call: { kind: "read", resource: "a", method: "b", body: 1 },
    }),
  ];
  for (const data of dropped) assert.equal(readPageMessage(data), undefined);
});
