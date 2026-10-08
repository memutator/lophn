import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import type { FeedbackPreview, FeedbackReply } from "../../ipc/feedback.ts";
import {
  type CallerContents,
  type CallerFrame,
  ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import {
  createFeedback,
  type FeedbackDialog,
  type SubmitFeedbackRequest,
} from "./feedback.ts";
import type { FeedbackViewSnapshot } from "./view-model.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const REL = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function contents(id: number, url: string): CallerContents {
  const main: CallerFrame = { url, parent: null };
  return { id, isDestroyed: () => false, mainFrame: main };
}

function eventOf(sender: CallerContents): IpcEvent {
  return { sender, senderFrame: sender.mainFrame };
}

interface WorldOptions {
  capture?: () => Promise<Uint8Array>;
  visible?: boolean;
  protectedWindow?: boolean;
  dialogOpen?: boolean;
  submit?: (
    input: SubmitFeedbackRequest,
    png: Uint8Array | null,
  ) => Promise<FeedbackReply<{ report: string; problem: string | null }>>;
  commandStart?: () => "blocked_before_start" | "unknown";
  lookup?: (
    report: string,
  ) => Promise<
    | { ok: true; value: { report: string; problem: string | null } | null }
    | { ok: false }
  >;
}

function world(options: WorldOptions = {}) {
  const desk = contents(1, "lophn-shell://desktop/index.html");
  const overlay = contents(2, "lophn-shell://overlay/index.html");
  const otherDesk = contents(3, "lophn-shell://desktop/index.html");
  const otherOverlay = contents(4, "lophn-shell://overlay/index.html");
  const registry = new ContentsRegistry();
  for (
    const [item, host] of [
      [desk, "desktop"],
      [overlay, "overlay"],
      [otherDesk, "desktop"],
      [otherOverlay, "overlay"],
    ] as const
  ) {
    registry.register({
      contents: item,
      origin: { scheme: "lophn-shell", host, path: "/index.html" },
    });
  }
  const steps: string[] = [];
  const previews: FeedbackPreview[] = [];
  const submitted: { input: SubmitFeedbackRequest; png: Uint8Array | null }[] =
    [];
  const issues: unknown[] = [];
  const timers: (() => void)[] = [];
  let current = true;
  let opened = false;
  const view = (
    window: string,
    view_session: string,
  ): FeedbackViewSnapshot => ({
    view_session,
    window,
    generation: 3,
    app: APP,
    release: REL,
    mode: "live",
    screen: "orders",
    bundleHash: "a".repeat(64),
    processNonce: "nonce",
    visible: options.visible ?? true,
    url: `lophn-app://app-x/orders/index.html?customer=kim#row`,
    capture() {
      steps.push("capture");
      return options.capture ? options.capture() : Promise.resolve(PNG);
    },
    current: () => current,
  });
  const dialogOf = (window: string): FeedbackDialog => ({
    open(draftRef) {
      steps.push(`open ${window} ${draftRef}`);
      opened = true;
      return true;
    },
    close(draftRef) {
      steps.push(`close ${window} ${draftRef}`);
      opened = false;
    },
    preview(preview) {
      previews.push(preview);
    },
    dialogOpen: () => options.dialogOpen ?? false,
  });
  let drafts = 0;
  const feedback = createFeedback({
    registry,
    windowOfShell: (sender) =>
      sender === desk
        ? "window-1"
        : sender === otherDesk
        ? "window-2"
        : undefined,
    windowOfOverlay: (sender) =>
      sender === overlay
        ? "window-1"
        : sender === otherOverlay
        ? "window-2"
        : undefined,
    view: (session) =>
      session === "view-1"
        ? view("window-1", session)
        : session === "view-2"
        ? view("window-2", session)
        : undefined,
    dialog: dialogOf,
    protectedWindow: () => options.protectedWindow ?? false,
    submit(input, png) {
      steps.push(`submit ${input.report_id}`);
      submitted.push({ input, png });
      return options.submit ? options.submit(input, png) : Promise.resolve({
        ok: true,
        value: {
          report: input.report_id,
          problem: "prb_01j9zzzzzzzzzzzzzzzzzzzzzz",
        },
      });
    },
    openIssue: (window, target) => issues.push([window, target]),
    ...(options.commandStart ? { commandStart: options.commandStart } : {}),
    lookup(report) {
      steps.push(`lookup ${report}`);
      return options.lookup
        ? options.lookup(report)
        : Promise.resolve({ ok: true, value: null });
    },
    ids: {
      draft: () => `draft-${++drafts}`,
      report: () => "rpt_01j9zzzzzzzzzzzzzzzzzzzzzz",
    },
    clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
    timer: {
      set(callback) {
        timers.push(callback);
        return timers.length;
      },
      clear() {},
    },
  });
  return {
    feedback,
    desk: eventOf(desk),
    overlay: eventOf(overlay),
    otherDesk: eventOf(otherDesk),
    otherOverlay: eventOf(otherOverlay),
    steps,
    previews,
    submitted,
    issues,
    timers,
    get opened() {
      return opened;
    },
    changeView() {
      current = false;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const pending = () => new Promise<Uint8Array>(() => {});

test("shell/app-frame#R31, problems/feedback#R5: 버튼 시점 view의 캡처를 먼저 요청한 뒤 overlay dialog를 열고 같은 PNG를 가리지 않고 미리보기에 보인다", async () => {
  const w = world();
  const begun = w.feedback.begin(w.desk, { view_session: "view-1" });
  assert.deepEqual(begun, { ok: true, value: { draftRef: "draft-1" } });
  // 캡처를 먼저 요청하고 dialog를 연다. 앱 view를 숨기거나 떼는 단계는 없다.
  assert.deepEqual(w.steps, ["capture", "open window-1 draft-1"]);
  assert.equal(w.previews[0]?.screenshot_block, "pending");
  await settle();
  const ready = w.previews.at(-1)!;
  assert.equal(ready.screenshot_block, null);
  assert.equal(
    ready.screenshot,
    createHash("sha256").update(PNG).digest("hex"),
  );
  assert.equal(
    ready.screenshot_png,
    `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`,
  );
  // 화면 상태는 화면 이름과 URL path뿐이다. query 값·fragment는 없다(R7).
  assert.deepEqual(ready.screen_summary, {
    name: "orders",
    path: "/orders/index.html",
  });
});

test("problems/feedback#R5: 보호 창이나 lophn dialog가 떠 있거나 view가 숨겨졌으면 캡처하지 않고 이유만 남긴다", () => {
  for (
    const [options, block] of [
      [{ protectedWindow: true }, "protected_window"],
      [{ dialogOpen: true }, "protected_window"],
      [{ visible: false }, "hidden"],
    ] as const
  ) {
    const w = world(options);
    const begun = w.feedback.begin(w.desk, { view_session: "view-1" });
    assert.equal(begun.ok, true);
    assert.equal(w.steps.includes("capture"), false, block);
    assert.equal(w.previews.at(-1)?.screenshot_block, block);
    assert.equal(w.previews.at(-1)?.screenshot_png, null);
  }
});

test("problems/feedback#R5: 다른 창의 view는 없는 view와 같은 답이고 캡처도 dialog도 없다", () => {
  const w = world();
  const other = w.feedback.begin(w.desk, { view_session: "view-2" });
  const missing = w.feedback.begin(w.desk, { view_session: "view-9" });
  assert.deepEqual(other, missing);
  assert.equal(other.ok, false);
  assert.deepEqual(w.steps, []);
  // overlay·앱 view는 버튼 통로를 부를 수 없다.
  assert.equal(
    w.feedback.begin(w.overlay, { view_session: "view-1" }).ok,
    false,
  );
});

test("shell/app-frame#R31: 캡처는 1,500ms까지 기다리고 늦거나 그 사이 view가 바뀌면 이미지를 버린다", async () => {
  const late = world({ capture: pending });
  late.feedback.begin(late.desk, { view_session: "view-1" });
  assert.equal(late.timers.length, 1);
  late.timers[0]!();
  await settle();
  assert.equal(late.previews.at(-1)?.screenshot_block, "capture_failed");

  const changed = world();
  changed.feedback.begin(changed.desk, { view_session: "view-1" });
  changed.changeView();
  await settle();
  assert.equal(changed.previews.at(-1)?.screenshot_block, "capture_failed");
  assert.equal(changed.previews.at(-1)?.screenshot, null);
});

test("shell/app-frame#R32, problems/feedback#R10: crash한 view에서도 dialog가 열리고 이미지 없이 글만 보낼 수 있다", async () => {
  const w = world({ capture: () => Promise.reject(new Error("crashed")) });
  const begun = w.feedback.begin(w.desk, { view_session: "view-1" });
  assert.equal(begun.ok, true);
  assert.equal(w.opened, true);
  await settle();
  assert.equal(w.previews.at(-1)?.screenshot_block, "capture_failed");
  // 저장되지 않은 screenshot은 첨부로 고를 수 없다.
  const attach = await w.feedback.submit(w.overlay, {
    draftRef: "draft-1",
    text: "The page froze.",
    selection: { screen: true, screenshot: true },
  });
  assert.equal(attach.ok, false);
  const sent = await w.feedback.submit(w.overlay, {
    draftRef: "draft-1",
    text: "The page froze.",
    selection: { screen: true, screenshot: false },
  });
  assert.equal(sent.ok, true);
  const request = w.submitted[0]!;
  assert.equal(request.png, null);
  assert.equal(request.input.screenshot, null);
  assert.equal(request.input.view.capture, "capture_failed");
  assert.equal(request.input.view.final_screenshot_hash, null);
});

test("problems/feedback#R6: screenshot은 사람이 고른 때만 같은 바이트와 최종 hash로 보내고 화면 상태는 빼면 보내지 않는다", async () => {
  const w = world();
  w.feedback.begin(w.desk, { view_session: "view-1" });
  await settle();
  await w.feedback.submit(w.overlay, {
    draftRef: "draft-1",
    text: "Totals are wrong.",
    selection: { screen: false, screenshot: true },
  });
  const request = w.submitted[0]!;
  assert.deepEqual(request.png, PNG);
  assert.deepEqual(request.input.screenshot, { size_bytes: PNG.length });
  assert.equal(
    request.input.view.final_screenshot_hash,
    createHash("sha256").update(PNG).digest("hex"),
  );
  assert.equal(request.input.facts, null);
  // 버튼 시점 binding: 같은 view·generation·관측 시각.
  assert.equal(request.input.view.binding, "view-1#3");
  assert.equal(request.input.view.observed_at, request.input.observed_at);
  assert.equal(request.input.existing_problem, null);
});

test("problems/feedback#R11: 접수 실패는 초안을 남겨 다시 보낼 수 있고 접수 뒤에는 같은 Report를 돌려주며 다시 보내지 않는다", async () => {
  let fail = true;
  const w = world({
    submit: (input) =>
      Promise.resolve(
        fail
          ? { ok: false, error: { code: "unavailable", message: "down" } }
          : { ok: true, value: { report: input.report_id, problem: null } },
      ),
  });
  w.feedback.begin(w.desk, { view_session: "view-1" });
  const body = {
    draftRef: "draft-1",
    text: "Saving does nothing.",
    selection: { screen: true, screenshot: false },
  };
  const first = await w.feedback.submit(w.overlay, body);
  assert.equal(first.ok, false);
  fail = false;
  const second = await w.feedback.submit(w.overlay, body);
  const third = await w.feedback.submit(w.overlay, body);
  assert.deepEqual(second, third);
  assert.equal(w.submitted.length, 2);
  // 다시 보내도 같은 Report ID다.
  assert.equal(
    w.submitted[0]!.input.report_id,
    w.submitted[1]!.input.report_id,
  );
});

test("problems/feedback#R12, R13: 취소는 초안을 버리고 접수한 뒤에는 묶인 Issue로 간다", async () => {
  const cancelled = world();
  cancelled.feedback.begin(cancelled.desk, { view_session: "view-1" });
  assert.deepEqual(
    cancelled.feedback.cancel(cancelled.overlay, { draftRef: "draft-1" }),
    { ok: true, value: null },
  );
  assert.equal(cancelled.feedback.size, 0);
  assert.equal(cancelled.submitted.length, 0);
  assert.equal(cancelled.steps.at(-1), "close window-1 draft-1");

  const w = world();
  w.feedback.begin(w.desk, { view_session: "view-1" });
  // 접수 전에는 갈 Issue가 없다.
  assert.equal(
    w.feedback.openIssue(w.overlay, { draftRef: "draft-1" }).ok,
    false,
  );
  await w.feedback.submit(w.overlay, {
    draftRef: "draft-1",
    text: "Wrong total.",
    selection: { screen: true, screenshot: false },
  });
  // 다른 창 overlay는 이 초안을 다룰 수 없다.
  assert.equal(
    w.feedback.openIssue(w.otherOverlay, { draftRef: "draft-1" }).ok,
    false,
  );
  assert.equal(
    w.feedback.openIssue(w.overlay, { draftRef: "draft-1" }).ok,
    true,
  );
  assert.deepEqual(w.issues, [[
    "window-1",
    { app: APP, problem: "prb_01j9zzzzzzzzzzzzzzzzzzzzzz" },
  ]]);
  assert.equal(w.feedback.size, 0);
});

test("problems/feedback#R4: 마지막 앱 호출이 시작 전에 막혔으면 버튼 시점에 고정해 blocked_before_start로 보내고 invocation은 만들지 않는다", async () => {
  let start: "blocked_before_start" | "unknown" = "blocked_before_start";
  const w = world({ commandStart: () => start });
  w.feedback.begin(w.desk, { view_session: "view-1" });
  // 버튼 뒤에 다른 호출이 시작돼도 이 제보가 본 것은 바뀌지 않는다.
  start = "unknown";
  const body = {
    draftRef: "draft-1",
    text: "Save did nothing.",
    selection: { screen: true, screenshot: false },
  };
  assert.equal((await w.feedback.submit(w.overlay, body)).ok, true);
  assert.deepEqual(w.submitted[0]!.input.targets, {
    invocation: null,
    automation: null,
    version: null,
    command_start: "blocked_before_start",
  });
});

test("problems/feedback#R3, R4: 막힌 호출을 모르면 command_start는 unknown이다", async () => {
  const w = world();
  w.feedback.begin(w.desk, { view_session: "view-1" });
  await w.feedback.submit(w.overlay, {
    draftRef: "draft-1",
    text: "Save did nothing.",
    selection: { screen: true, screenshot: false },
  });
  assert.equal(w.submitted[0]!.input.targets.command_start, "unknown");
});

const TEXT = {
  draftRef: "draft-1",
  text: "Saving does nothing.",
  selection: { screen: true, screenshot: false },
};
const LOST = {
  ok: false as const,
  error: { code: "unavailable" as const, message: "lost" },
};
const REPORT = "rpt_01j9zzzzzzzzzzzzzzzzzzzzzz";
const ACCEPTED = { report: REPORT, problem: "prb_01j9zzzzzzzzzzzzzzzzzzzzzz" };

test("problems/reporting#R9, problems/feedback#R11: 응답을 잃은 제출은 다시 보내기 전에 최신 상태를 읽고 접수 전이면 같은 Report ID로 한 번만 다시 보낸다", async () => {
  let reply: FeedbackReply<{ report: string; problem: string | null }> = LOST;
  const w = world({ submit: () => Promise.resolve(reply) });
  w.feedback.begin(w.desk, { view_session: "view-1" });
  assert.equal((await w.feedback.submit(w.overlay, TEXT)).ok, false);
  reply = { ok: true, value: ACCEPTED };
  const second = await w.feedback.submit(w.overlay, TEXT);
  assert.deepEqual(second, { ok: true, value: ACCEPTED });
  // 읽기가 두 번째 전송보다 먼저다. 첫 전송 전에는 읽지 않는다.
  assert.deepEqual(w.steps.slice(2), [
    `submit ${REPORT}`,
    `lookup ${REPORT}`,
    `submit ${REPORT}`,
  ]);
  assert.equal(w.submitted.length, 2);
  assert.equal(
    w.submitted[1]!.input.report_id,
    w.submitted[0]!.input.report_id,
  );
  // 접수된 뒤에는 읽지도 보내지도 않는다.
  assert.deepEqual(await w.feedback.submit(w.overlay, TEXT), second);
  assert.equal(w.submitted.length, 2);
});

test("problems/reporting#R9: 읽어 보니 이미 접수됐으면 다시 보내지 않고 그 접수를 돌려준다", async () => {
  const w = world({
    submit: () => Promise.resolve(LOST),
    lookup: () => Promise.resolve({ ok: true, value: ACCEPTED }),
  });
  w.feedback.begin(w.desk, { view_session: "view-1" });
  await w.feedback.submit(w.overlay, TEXT);
  const again = await w.feedback.submit(w.overlay, TEXT);
  assert.deepEqual(again, { ok: true, value: ACCEPTED });
  assert.equal(w.submitted.length, 1);
  // 묶인 Issue로 갈 수 있다.
  assert.equal(
    w.feedback.openIssue(w.overlay, { draftRef: "draft-1" }).ok,
    true,
  );
  assert.equal(w.issues.length, 1);
});

test("problems/reporting#R9: 최신 상태를 읽지 못하면 다시 보내지 않고 접수 전 초안으로 남는다", async () => {
  let readable = false;
  const w = world({
    submit: () => Promise.resolve(LOST),
    lookup: () =>
      Promise.resolve(
        readable ? { ok: true as const, value: null } : { ok: false as const },
      ),
  });
  w.feedback.begin(w.desk, { view_session: "view-1" });
  await w.feedback.submit(w.overlay, TEXT);
  const blocked = await w.feedback.submit(w.overlay, TEXT);
  assert.equal(blocked.ok, false);
  assert.equal(w.submitted.length, 1);
  // 읽을 수 있게 되면 그때 같은 Report ID로 다시 보낸다.
  readable = true;
  await w.feedback.submit(w.overlay, TEXT);
  assert.equal(w.submitted.length, 2);
  assert.equal(w.submitted[1]!.input.report_id, REPORT);
});

test("problems/reporting#R9: 입력·권한 거절은 접수된 적이 없어 읽지 않고, 충돌은 같은 Report ID의 접수를 읽어 돌려받는다", async () => {
  const rejected = world({
    submit: () =>
      Promise.resolve({
        ok: false,
        error: { code: "invalid_input", message: "no" },
      }),
  });
  rejected.feedback.begin(rejected.desk, { view_session: "view-1" });
  await rejected.feedback.submit(rejected.overlay, TEXT);
  await rejected.feedback.submit(rejected.overlay, TEXT);
  assert.equal(rejected.steps.some((step) => step.startsWith("lookup")), false);

  const conflicted = world({
    submit: () =>
      Promise.resolve({
        ok: false,
        error: { code: "conflict", message: "same id, other content" },
      }),
    lookup: () => Promise.resolve({ ok: true, value: ACCEPTED }),
  });
  conflicted.feedback.begin(conflicted.desk, { view_session: "view-1" });
  await conflicted.feedback.submit(conflicted.overlay, TEXT);
  const second = await conflicted.feedback.submit(conflicted.overlay, TEXT);
  assert.deepEqual(second, { ok: true, value: ACCEPTED });
  assert.equal(conflicted.submitted.length, 1);
});
