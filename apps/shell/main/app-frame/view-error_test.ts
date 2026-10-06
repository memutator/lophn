import assert from "node:assert/strict";
import { test } from "node:test";

import type { BoundView } from "./registry.ts";
import {
  createViewErrors,
  reportIdOf,
  VIEW_ERROR_WINDOW_MS,
  VIEW_ERRORS_PER_WINDOW,
  type ViewErrorForward,
} from "./view-error.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const OTHER = "app_01j9yyyyyyyyyyyyyyyyyyyyyy";
const REL = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const REPORT = /^rpt_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

function viewOf(
  mode: "live" | "preview",
  view_session = "view-1",
): BoundView {
  const release = mode === "live" ? REL : null;
  return {
    view_session,
    generation: 3,
    target: { app: APP, mode, release, screen: "main", size: "panel" },
    binding: {
      endpoint: "/run/app.sock",
      authorization: '{"payload":{"app":"' + APP + '"},"signature":"sig"}',
      release,
      bundleHash: "1".repeat(64),
      processNonce: "nonce-1",
      expiresAtMs: null,
    },
  };
}

function world(sendOk = true) {
  const sent: ViewErrorForward[] = [];
  const logs: string[] = [];
  let now = 0;
  let serial = 0;
  const errors = createViewErrors({
    send(forward) {
      sent.push(forward);
      return Promise.resolve(sendOk);
    },
    ids: {
      reportId: () =>
        reportIdOf(1_700_000_000_000 + serial++, new Uint8Array(10)),
    },
    clock: {
      nowMs: () => now,
      nowIso: () => "2026-10-06T00:00:00.000Z",
    },
    log: (line) => logs.push(line),
  });
  return {
    errors,
    sent,
    logs,
    setNow(value: number) {
      now = value;
    },
  };
}

test("problems/reporting#R6, shell/app-frame#R12: view 오류에는 registry의 view_session·generation·앱·release·mode·binding을 붙이고 페이지 주장은 버린다", async () => {
  const w = world();
  // message 안에서 다른 앱을 말해도 귀속은 실제 view의 앱이다.
  await w.errors.observe(viewOf("live"), {
    observation: "error",
    name: "TypeError",
    message: `x is undefined (app ${OTHER}, mode preview)`,
  });
  assert.equal(w.sent.length, 1);
  const forward = w.sent[0]!;
  assert.deepEqual(forward.view, {
    view_session: "view-1",
    generation: 3,
    app: APP,
    release: REL,
    mode: "live",
    bundle_hash: "1".repeat(64),
    binding: viewOf("live").binding.authorization,
  });
  assert.match(forward.observation.report_id, REPORT);
  assert.deepEqual({ ...forward.observation, report_id: "" }, {
    report_id: "",
    observed_at: "2026-10-06T00:00:00.000Z",
    observation: "error",
    error: {
      name: "TypeError",
      message: `x is undefined (app ${OTHER}, mode preview)`,
      message_missing_reason: null,
      stack: null,
      stack_missing_reason: { reason: "view_stack_not_collected" },
    },
    error_missing_reason: null,
    invocation: null,
  });
  // preview view는 preview로만 간다.
  await w.errors.observe(viewOf("preview", "view-2"), {
    observation: "unhandledrejection",
    name: "Error",
    message: null,
  });
  assert.equal(w.sent[1]!.view.mode, "preview");
  assert.equal(w.sent[1]!.view.release, null);
  assert.deepEqual(w.sent[1]!.observation.error.message_missing_reason, {
    reason: "view_message_missing",
  });
  // 앱·release·mode·actor를 주장한 메시지와 모양이 다른 메시지는 보내지 않는다.
  for (
    const bad of [
      { observation: "error", name: "Error", message: null, app: OTHER },
      { observation: "error", name: "Error", message: null, mode: "live" },
      { observation: "error", name: "Error", message: null, release: REL },
      { observation: "process_exit", name: "Error", message: null },
      { observation: "error", name: " ", message: null },
      { observation: "error", name: "Error" },
      { observation: "error", name: "E".repeat(257), message: null },
      "boom",
      null,
    ]
  ) {
    await w.errors.observe(viewOf("live", "view-3"), bad);
  }
  assert.equal(w.sent.length, 2);
});

test("problems/reporting#R5: error·unhandledrejection·render_error를 앱이 따로 보고하지 않아도 collector로 넘기고 쏟아지면 view마다 창당 상한까지만 보낸다", async () => {
  const w = world();
  for (const observation of ["error", "unhandledrejection", "render_error"]) {
    await w.errors.observe(viewOf("live"), {
      observation,
      name: "Error",
      message: "failed",
    });
  }
  assert.deepEqual(w.sent.map((item) => item.observation.observation), [
    "error",
    "unhandledrejection",
    "render_error",
  ]);
  for (let index = 0; index < 100; index++) {
    await w.errors.observe(viewOf("live"), {
      observation: "error",
      name: "Error",
      message: "loop",
    });
  }
  assert.equal(w.sent.length, VIEW_ERRORS_PER_WINDOW);
  // 다른 view는 따로 센다. 창이 지나면 다시 보낸다.
  await w.errors.observe(viewOf("live", "view-2"), {
    observation: "error",
    name: "Error",
    message: "other",
  });
  assert.equal(w.sent.length, VIEW_ERRORS_PER_WINDOW + 1);
  w.setNow(VIEW_ERROR_WINDOW_MS);
  await w.errors.observe(viewOf("live"), {
    observation: "error",
    name: "Error",
    message: "later",
  });
  assert.equal(w.sent.length, VIEW_ERRORS_PER_WINDOW + 2);
  // log에는 원문 message가 없다.
  assert.equal(w.logs.some((line) => line.includes("loop")), false);
  // report id는 모두 다르다.
  assert.equal(
    new Set(w.sent.map((item) => item.observation.report_id)).size,
    w.sent.length,
  );
});

test("problems/reporting#R5: collector가 받지 못하면 unsent로 log에 남기고 view 동작은 막지 않는다", async () => {
  const w = world(false);
  await w.errors.observe(viewOf("live"), {
    observation: "error",
    name: "Error",
    message: "x",
  });
  assert.equal(w.sent.length, 1);
  assert.match(
    w.logs.at(-1)!,
    /view view-1 generation=3 view-error error .* unsent$/,
  );
  assert.match(reportIdOf(0, new Uint8Array(10).fill(255)), REPORT);
  assert.match(reportIdOf(2 ** 48 - 1, new Uint8Array(10)), REPORT);
});
