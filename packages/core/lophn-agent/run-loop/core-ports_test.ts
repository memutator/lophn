import assert from "node:assert/strict";
import { test } from "node:test";
import { err, ok } from "../../../base/mod.ts";
import { createCorePorts } from "./core-ports.ts";

test("when StartModelCall fails the steering stays queued and the model is not called", async () => {
  let invoked = 0;
  let settled = 0;
  const ports = createCorePorts({
    seat: { turn: "trn_t1", session: "ses_s1" },
    clock: { now: () => "2026-11-06T00:00:00.000Z", nowMs: () => 0 },
    ids: { newId: (prefix: string) => `${prefix}_x` },
    // StartModelCall만 거절한다.
    machine: () =>
      Promise.resolve(err({ code: "unavailable", message: "no ledger" })),
    blobs: {
      prepare: (_purpose: string, bytes: Uint8Array) =>
        Promise.resolve(ok({ hash: "h".repeat(64), size_bytes: bytes.length })),
    },
    redact: (text: string) => text,
    model: {
      call: {},
      endpoint: "",
      usageRevision: "1",
      invoke: () => {
        invoked += 1;
        return Promise.resolve(
          err({ code: "internal", message: "unreachable" }),
        );
      },
    },
    turnInputs: {
      settled: () => {
        settled += 1;
        return Promise.resolve(ok(undefined));
      },
    },
    tools: { listed: [] },
    events: { publish() {}, output() {} },
  } as never);

  const result = await ports.model.call(
    {
      prompt: {
        basis: {},
        diff: null,
        cache_boundaries: [],
        input_budget: 1,
        measured_tokens: null,
      },
      body: { messages: [] },
      applied: ["msg_steer"],
      kind: "initial",
      retry_of: null,
    } as never,
    new AbortController().signal,
  );
  assert.equal(result.ok, false);
  assert.equal(invoked, 0);
  assert.equal(settled, 0);
});
