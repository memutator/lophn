import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationTarget } from "../data/hooks.tsx";
import { sessionWaitAction } from "./session-wait.ts";

const TARGET: ConversationTarget = {
  session: "ses_01h455vb4pex5v6nkc6gd5f001",
  agent: "agt_lophn",
  workspace: null,
};

test("cold start waits without starting the fallback timer until the computer connects and its first session list settles", () => {
  assert.deepEqual(
    sessionWaitAction({
      target: null,
      status: "connecting",
      sessionsSettled: false,
    }),
    { kind: "wait" },
  );
  assert.deepEqual(
    sessionWaitAction({
      target: null,
      status: "connected",
      sessionsSettled: false,
    }),
    { kind: "wait" },
  );
  assert.deepEqual(
    sessionWaitAction({
      target: TARGET,
      status: "connected",
      sessionsSettled: true,
    }),
    { kind: "open", target: TARGET },
  );
});

test("starts the fallback timer once the first session list settles without the session, or when the computer is unreachable", () => {
  assert.deepEqual(
    sessionWaitAction({
      target: null,
      status: "connected",
      sessionsSettled: true,
    }),
    { kind: "timeout" },
  );
  for (const status of ["offline", "revoked", "update"] as const) {
    assert.deepEqual(
      sessionWaitAction({
        target: null,
        status,
        sessionsSettled: false,
      }),
      { kind: "timeout" },
    );
  }
});
