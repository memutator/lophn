// feedback 접수 조립의 테스트. 이름은 요구 번호로 시작한다(dev/tasks.md). 실제 PNG
// bytes와 실제 SHA-256 준비 경계, 통과하지 못하면 null을 내는 redactor를 쓴다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { ok } from "../../base/mod.ts";
import {
  assembleFeedback,
  FEEDBACK_LIMITS,
  type FeedbackIntake,
  type FeedbackView,
} from "./mod.ts";
import {
  AT,
  feedbackHarness,
  intake,
  pngBytes,
  SECRET,
  sha256,
  view,
} from "./testing/mod.ts";
import { APP_A, rpt } from "../grouping/testing/mod.ts";
import { SCREEN_REASONS } from "../snapshots/mod.ts";
import { realPrepare } from "../snapshots/testing/mod.ts";

function newHarness(
  options: Omit<Parameters<typeof feedbackHarness>[0], "store"> = {},
) {
  return feedbackHarness({ ...options, store: realPrepare() });
}

const INVOCATION = "inv_01arz3ndektsv4rrffq69g5fav";
const OLDER = "inv_01arz3ndektsv4rrffq69g5faw";

async function accepted(
  h: ReturnType<typeof newHarness>,
  patch: Partial<FeedbackIntake>,
) {
  const result = await assembleFeedback(intake(patch), h.deps);
  assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
  return result.value;
}

async function rejected(
  h: ReturnType<typeof newHarness>,
  patch: Partial<FeedbackIntake>,
  code = "invalid_input",
) {
  const result = await assembleFeedback(intake(patch), h.deps);
  assert(!result.ok, "거절해야 한다");
  assertEquals(result.error.code, code);
  return result.error;
}

// view와 PNG를 함께 고른 제출. 미리보기에서 본 최종 이미지 hash가 binding에 묶인다.
async function withScreen(
  png: Uint8Array,
  patch: Partial<FeedbackView> = {},
): Promise<Partial<FeedbackIntake>> {
  return {
    view: view({ final_screenshot_hash: await sha256(png), ...patch }),
    facts: {
      tab: "Summary",
      url: "/orders?customer=ada#top",
      inputs: [{ name: "memo", value: "hello" }],
    },
    screenshot: png,
    selection: { screen: true, screenshot: true },
  };
}

Deno.test("problems/feedback#R1: app·agent 제출은 거절되고 아무 blob도 준비하지 않는다", async () => {
  for (
    const caller of [
      { actor: "app:app_x", surface: "shell" },
      { actor: "agent", surface: "shell" },
      { actor: "user", surface: "cli" },
    ]
  ) {
    const h = newHarness({ caller });
    await rejected(h, {}, "forbidden");
    assertEquals(h.prepared, []);
  }
});

Deno.test("problems/feedback#R1: 글은 redaction 뒤 저장되고 source=feedback code=_feedback 원주체 shell user로 접수된다", async () => {
  const h = newHarness();
  const value = await accepted(h, {
    text: `Save failed, my key was ${SECRET} sorry`,
  });
  const { report, origin } = value.input;
  assertEquals(report.source, "feedback");
  assertEquals(report.code, "_feedback");
  assertEquals(origin.context.origin, "shell_user");
  assertEquals(origin.context.authentication.actor, "user");
  // 원문 secret은 어떤 준비 바이트에도 없고, 저장한 글은 redaction 결과다.
  const stored = h.textOf("report_text")!;
  assertEquals(stored, "Save failed, my key was [REDACTED] sorry");
  for (const entry of h.prepared) {
    assertFalse(new TextDecoder().decode(entry.bytes).includes(SECRET));
  }
  assertEquals(report.text, value.input.blobs[0].hash);
});

Deno.test("problems/feedback#R1: 빈 글·공백 글·501자·redaction을 통과하지 못한 글은 거절되고 blob이 남지 않는다", async () => {
  for (
    const text of [
      "",
      " \n ",
      "a".repeat(501),
      "😀".repeat(501),
      "UNREDACTABLE",
    ]
  ) {
    const h = newHarness();
    await rejected(h, { text });
    assertEquals(h.prepared, []);
  }
  const h = newHarness();
  await accepted(h, { text: "😀".repeat(500) });
  assertEquals(h.prepared.length >= 1, true);
});

Deno.test("problems/feedback#R2: 명세도 invocation도 없는 틀린 결과 제보를 거절하지 않고 모른다고 남긴다", async () => {
  const h = newHarness();
  const text =
    "Expected 1,200 but the total shows 1,150. Period: Sept 2026, timezone: KST, source: weekly sheet.";
  const value = await accepted(h, { text });
  assertEquals(h.textOf("report_text"), text);
  assertEquals(value.input.snapshot.invocation, null);
  assert(value.input.snapshot.invocation_missing_reason !== null);
  // 알려진 invocation이 성공한 요청이어도(HTTP 200) 같은 접수다.
  const known = await accepted(newHarness(), {
    report_id: rpt(2),
    targets: {
      invocation: INVOCATION,
      automation: null,
      version: null,
      command_start: "started",
    },
  });
  assertEquals(known.input.snapshot.invocation?.id, INVOCATION);
});

Deno.test("problems/feedback#R3: 고정한 지목만 쓴다: 오래된 결과를 보고 있었으면 그 invocation, 모르면 임의 invocation을 붙이지 않는다", async () => {
  // shell이 버튼 시점에 고정한 결과가 OLDER다. 더 늦게 끝난 요청이 있어도 따라가지 않는다.
  const pinned = await accepted(newHarness({ arrived: true }), {
    view: view(),
    facts: { tab: null, url: null, inputs: [] },
    selection: { screen: true, screenshot: false },
    targets: {
      invocation: OLDER,
      automation: "nightly-sync",
      version: "ver_01arz3ndektsv4rrffq69g5fav",
      command_start: "started",
    },
  });
  assertEquals(pinned.input.snapshot.invocation, {
    id: OLDER,
    binding: "view_context",
    record_missing_reason: null,
  });
  // 연결을 모르면 invocation도 없고 이유가 "모른다"다.
  const h = newHarness();
  const unknown = await accepted(h, {});
  assertEquals(unknown.input.snapshot.invocation, null);
  assertEquals(
    unknown.input.snapshot.invocation_missing_reason,
    { reason: "연결된 invocation을 모른다" },
  );
  // ID는 알지만 기록이 아직 없으면 ID와 이유를 남기고 추정하지 않는다.
  const late = await accepted(newHarness({ arrived: false }), {
    targets: {
      invocation: INVOCATION,
      automation: null,
      version: null,
      command_start: "started",
    },
  });
  assertEquals(late.input.snapshot.invocation?.id, INVOCATION);
  assertEquals(
    late.input.snapshot.invocation?.record_missing_reason?.reason,
    "기록이 아직 도착하지 않았다",
  );
});

Deno.test("problems/feedback#R3: 지목한 automation·고정 판은 화면 상태에 known으로, 모르는 것은 unknown으로 남는다", async () => {
  const h = newHarness();
  await accepted(h, {
    view: view(),
    facts: { tab: null, url: null, inputs: [] },
    selection: { screen: true, screenshot: false },
    targets: {
      invocation: null,
      automation: "nightly-sync",
      version: "ver_01arz3ndektsv4rrffq69g5fav",
      command_start: "unknown",
    },
  });
  const state = JSON.parse(h.textOf("feedback_state")!);
  assertEquals(state.target.automation, {
    state: "known",
    id: "nightly-sync",
  });
  assertEquals(state.target.version.state, "known");
  assertEquals(state.target.invocation, { state: "unknown" });
});

Deno.test("problems/feedback#R4: 입력 검사로 시작하지 못한 제보는 실행 전이고 가짜 invocation이 없다", async () => {
  const h = newHarness();
  const value = await accepted(h, {
    view: view(),
    facts: { tab: null, url: null, inputs: [{ name: "amount", value: "" }] },
    selection: { screen: true, screenshot: false },
    targets: {
      // 이전 요청의 invocation이 남아 있어도 이 제보에는 붙지 않는다.
      invocation: INVOCATION,
      automation: null,
      version: null,
      command_start: "blocked_before_start",
    },
  });
  assertEquals(value.input.snapshot.invocation, null);
  assert(
    value.input.snapshot.invocation_missing_reason!.reason.startsWith(
      "실행 전",
    ),
  );
  const state = JSON.parse(h.textOf("feedback_state")!);
  assertEquals(state.target.command_start, "blocked_before_start");
  assertEquals(state.target.invocation, { state: "unknown" });
});

Deno.test("problems/feedback#R6: 상태만 기본이고 이미지는 선택하고 최종 hash가 맞을 때만 가리지 않은 그대로 저장한다", async () => {
  const png = pngBytes(1200, 800, 5000);
  // 상태만 선택: 이미지 bytes가 와도 저장하지 않는다.
  const stateOnly = newHarness();
  const base = await withScreen(png);
  const first = await accepted(stateOnly, {
    ...base,
    selection: { screen: true, screenshot: false },
  });
  assertEquals(stateOnly.bytesOf("feedback_screenshot"), undefined);
  assertEquals(first.input.snapshot.screen!.screenshot, null);
  assertEquals(
    first.input.snapshot.screen!.screenshot_missing_reason,
    { reason: SCREEN_REASONS.screenshotNotSelected },
  );
  assert(first.input.snapshot.screen!.state !== null);
  // 선택하고 hash가 맞으면 사람이 본 PNG bytes 그대로 저장한다.
  const chosen = newHarness();
  const second = await accepted(chosen, { ...base, report_id: rpt(2) });
  assertEquals(chosen.bytesOf("feedback_screenshot"), png);
  assertEquals(second.input.snapshot.screen!.screenshot, await sha256(png));
  assertEquals(
    second.input.blobs.map((blob) => blob.purpose).sort(),
    ["feedback_screenshot", "feedback_state", "report_text"],
  );
});

Deno.test("problems/feedback#R6: 선택한 이미지가 미리본 최종 hash와 다르면 저장하지 않고 글은 접수한다", async () => {
  const preview = pngBytes(800, 600, 3000);
  const swapped = pngBytes(800, 600, 3001);
  const h = newHarness();
  const value = await accepted(h, {
    ...(await withScreen(preview)),
    screenshot: swapped,
  });
  assertEquals(h.bytesOf("feedback_screenshot"), undefined);
  assertEquals(value.input.snapshot.screen!.screenshot, null);
  assertEquals(
    value.input.snapshot.screen!.screenshot_missing_reason,
    { reason: SCREEN_REASONS.hashMismatch },
  );
  assertEquals(h.textOf("report_text"), "The monthly total is wrong.");
  assertFalse(
    value.input.blobs.some((b) => b.purpose === "feedback_screenshot"),
  );
});

Deno.test("problems/feedback#R7: 저장된 화면 상태에는 query 값·업무 값·원입력이 없고 안전한 위치·모양·제외 이유만 있다", async () => {
  const h = newHarness();
  await accepted(h, {
    view: view(),
    facts: {
      tab: "Summary",
      url: `/orders/2026?customer=ada@example.test&key=${SECRET}`,
      inputs: [{ name: "memo", value: "private memo text" }],
      business_data: { rows: [{ card: "4111 1111 1111 1111" }] },
      command_input: { amount: 1200 },
      read_result: [{ total: 99 }],
    },
    selection: { screen: true, screenshot: false },
  });
  const raw = h.textOf("feedback_state")!;
  for (
    const leaked of [
      "ada@example.test",
      SECRET,
      "private memo text",
      "4111",
      "1200",
    ]
  ) {
    assertFalse(raw.includes(leaked), leaked);
  }
  const state = JSON.parse(raw);
  assertEquals(state.location, { path: "/orders/2026", hash: null });
  assertEquals(
    state.omitted.map((item: { item: string }) => item.item),
    ["url_query", "business_data", "command_input", "read_result"],
  );
});

Deno.test("problems/feedback#R8: PNG가 아니거나 2,097,152 bytes·긴 변 1,600px를 넘는 선택 이미지는 거절된다", async () => {
  const jpeg = new Uint8Array(500);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
  for (
    const png of [
      jpeg,
      pngBytes(800, 600, FEEDBACK_LIMITS.png_bytes + 1),
      pngBytes(1601, 100),
      pngBytes(100, 1601),
    ]
  ) {
    const h = newHarness();
    await rejected(h, await withScreen(png));
    assertEquals(h.prepared, []);
  }
  // 한도 안의 큰 정상 캡처는 받는다.
  const h = newHarness();
  const exact = pngBytes(1600, 1600, FEEDBACK_LIMITS.png_bytes);
  await accepted(h, await withScreen(exact));
  assertEquals(
    h.bytesOf("feedback_screenshot")!.length,
    FEEDBACK_LIMITS.png_bytes,
  );
  // 선택하지 않은 이미지는 PNG 검사에서도 저장에서도 빠진다.
  const unselected = newHarness();
  await accepted(unselected, {
    ...(await withScreen(jpeg)),
    selection: { screen: true, screenshot: false },
  });
  assertEquals(unselected.bytesOf("feedback_screenshot"), undefined);
});

Deno.test("problems/feedback#R9: 화면 상태 65,536 bytes와 전체 3,145,728 bytes 초과는 명시적으로 거절된다", async () => {
  // redaction된 상태가 한도를 넘는다: 입력 모양 이름이 많은 화면.
  const wide = Array.from({ length: 1500 }, (_, index) => ({
    name: `field-${index}-${"x".repeat(40)}`,
    value: "v",
  }));
  const tooBig = newHarness();
  const error = await rejected(tooBig, {
    view: view(),
    facts: { tab: null, url: null, inputs: wide },
    selection: { screen: true, screenshot: false },
  });
  assert(error.message.includes("65536"));
  assertEquals(tooBig.prepared, []);
  // 글(약 1.5KB)과 상태(~1MB)와 이미지(2 MiB)가 합쳐 3 MiB를 넘는다.
  const heavy = Array.from({ length: 10_000 }, (_, index) => ({
    name: `n${index}`,
    value: "x".repeat(100),
  }));
  const png = pngBytes(800, 600, FEEDBACK_LIMITS.png_bytes);
  const total = newHarness();
  const overall = await rejected(total, {
    ...(await withScreen(png)),
    facts: {
      tab: null,
      url: null,
      inputs: heavy,
      business_data: "y".repeat(1_100_000),
    },
  });
  assert(overall.message.includes("3145728"));
  assertEquals(total.prepared, []);
});

Deno.test("problems/feedback#R10 problems/snapshots#R15: 화면 없음은 화면 없음 이유로 남고 글은 접수된다", async () => {
  const h = newHarness();
  const value = await accepted(h, {
    selection: { screen: true, screenshot: true },
    // view가 없으면 상태·이미지를 보내도 쓰지 않는다.
    facts: { tab: null, url: "/x", inputs: [] },
    screenshot: pngBytes(),
  });
  assertEquals(value.input.snapshot.screen, null);
  assertEquals(value.input.snapshot.screen_missing_reason, {
    reason: SCREEN_REASONS.noScreen,
  });
  assertEquals(h.bytesOf("feedback_screenshot"), undefined);
  assertEquals(h.bytesOf("feedback_state"), undefined);
  assertEquals(value.input.report.release, null);
  assert(value.input.report.release_missing_reason !== null);
});

Deno.test("problems/feedback#R10 problems/snapshots#R15: 미선택·가려짐·보호 화면·캡처 실패·수집 꺼짐·redaction 제외·저장 실패가 각각 이유로 남고 글은 접수된다", async () => {
  const png = pngBytes(800, 600, 2000);
  const screenOf = async (
    harness: ReturnType<typeof newHarness>,
    patch: Partial<FeedbackIntake> = {},
    viewPatch: Partial<FeedbackView> = {},
  ) => {
    const value = await accepted(harness, {
      ...(await withScreen(png, viewPatch)),
      ...patch,
    });
    assertEquals(harness.textOf("report_text"), "The monthly total is wrong.");
    return value.input.snapshot.screen!;
  };
  // 사람이 아무것도 선택하지 않음.
  const none = await screenOf(newHarness(), {
    selection: { screen: false, screenshot: false },
  });
  assertEquals(
    none.state_missing_reason?.reason,
    SCREEN_REASONS.stateNotSelected,
  );
  assertEquals(
    none.screenshot_missing_reason?.reason,
    SCREEN_REASONS.screenshotNotSelected,
  );
  // 버튼 시점에 view가 가려졌거나 보호 화면이 떠 있거나 캡처가 실패했다: 이미지만 없다.
  for (
    const [capture, reason] of [
      ["hidden", SCREEN_REASONS.hidden],
      ["protected_window", SCREEN_REASONS.protectedWindow],
      ["capture_failed", SCREEN_REASONS.captureFailed],
    ] as const
  ) {
    const h = newHarness();
    const screen = await screenOf(h, {}, { capture });
    assertEquals(screen.screenshot, null);
    assertEquals(screen.screenshot_missing_reason?.reason, reason);
    assert(screen.state !== null);
    assertEquals(h.bytesOf("feedback_screenshot"), undefined);
  }
  // 진단 상세 수집이 꺼져 있다.
  for (const detailCollection of [false, null]) {
    const h = newHarness({ detailCollection });
    const screen = await screenOf(h);
    assertEquals(screen.state, null);
    assertEquals(screen.screenshot, null);
    assert(screen.state_missing_reason !== null);
    assert(screen.screenshot_missing_reason !== null);
    assertEquals(h.prepared.map((entry) => entry.purpose), ["report_text"]);
  }
  // redaction이 상태를 통과시키지 못한다: 상태만 빠지고 이미지는 그대로다.
  const redacting = newHarness({
    redact: (body, media) =>
      media === "application/json"
        ? Promise.resolve(null)
        : Promise.resolve(body),
  });
  const excluded = await screenOf(redacting);
  assertEquals(excluded.state, null);
  assertEquals(excluded.state_missing_reason?.reason, SCREEN_REASONS.redaction);
  assert(excluded.screenshot !== null);
  // 상태를 얻지 못했다.
  const missing = await screenOf(newHarness(), { facts: null });
  assertEquals(
    missing.state_missing_reason?.reason,
    SCREEN_REASONS.stateUnavailable,
  );
  // blob 저장 실패는 그 항목만 제외한다. 저장하지 못한 이미지는 첨부로 보이지 않는다.
  const storing = newHarness({ failPurpose: "feedback_screenshot" });
  const lost = await assembleFeedback(
    intake(await withScreen(png)),
    storing.deps,
  );
  assert(lost.ok);
  const lostScreen = lost.value.input.snapshot.screen!;
  assertEquals(lostScreen.screenshot, null);
  assertEquals(
    lostScreen.screenshot_missing_reason?.reason,
    SCREEN_REASONS.screenshotStorage,
  );
  assertFalse(
    lost.value.input.blobs.some((b) => b.purpose === "feedback_screenshot"),
  );
  assert(lostScreen.state !== null);
  const stateLost = newHarness({ failPurpose: "feedback_state" });
  const lostState = await screenOf(stateLost);
  assertEquals(
    lostState.state_missing_reason?.reason,
    SCREEN_REASONS.stateStorage,
  );
  assert(lostState.screenshot !== null);
});

Deno.test("problems/feedback#R10: 글 자체를 저장하지 못하면 성공이라고 하지 않고 unavailable이다", async () => {
  const h = newHarness({ failPurpose: "report_text" });
  await rejected(h, {}, "unavailable");
});

Deno.test("problems/feedback#R10 problems/snapshots#R4: 오류·로그·invocation·화면 네 항목 모두 값 또는 이유를 갖는다", async () => {
  const h = newHarness();
  const { snapshot } = (await accepted(h, {})).input;
  for (
    const [value, reason] of [
      [snapshot.invocation, snapshot.invocation_missing_reason],
      [snapshot.error, snapshot.error_missing_reason],
      [snapshot.logs, snapshot.logs_missing_reason],
      [snapshot.screen, snapshot.screen_missing_reason],
    ] as const
  ) {
    assertEquals(value === null, reason !== null);
    if (reason !== null) assert(/\S/.test(reason.reason));
  }
  assertEquals(snapshot.captured_at, "2026-10-04T12:00:05.000Z");
});

Deno.test("problems/feedback#R3: 다른 앱·시점의 view binding은 이 제보에 묶지 않는다", async () => {
  const wrongApp = newHarness();
  await rejected(wrongApp, {
    view: view({ app: "app_01arz3ndektsv4rrffq69g5faw" }),
  });
  const wrongTime = newHarness();
  await rejected(wrongTime, {
    view: view({ observed_at: "2026-10-04T12:00:01.000Z" }),
  });
  // 운영 view가 아니면 진단 범위가 필요하고, 운영은 진단 범위가 없다.
  await rejected(newHarness(), { view: view({ mode: "preview" }) });
  await rejected(newHarness(), { view: view({ diagnostic_scope: "s" }) });
  const preview = await accepted(newHarness(), {
    view: view({ mode: "preview", diagnostic_scope: "preview-1" }),
  });
  assertEquals(preview.input.report.mode, "preview");
  assertEquals(preview.input.report.diagnostic_scope, "preview-1");
  assertEquals(preview.input.report.app, APP_A);
  assertEquals(AT, preview.input.report.observed_at);
});

Deno.test("problems/grouping#R6: 존재하지 않는 선택과 다른 앱의 선택은 새 문제로 접수되고 같은 앱의 선택은 그 문제 key를 쓴다", async () => {
  const key = {
    kind: "declared" as const,
    code: "save_failed",
    discriminator: null,
  };
  const problem = "prb_01arz3ndektsv4rrffq69g5fav";
  const same = newHarness({
    lookup: () =>
      Promise.resolve(ok({ id: problem, app: APP_A, group_key: key })),
  });
  const joined = await accepted(same, { existing_problem: problem });
  assertEquals(joined.input.existing_problem, problem);
  assertEquals(joined.input.group_key, key);
  const other = newHarness({
    lookup: () =>
      Promise.resolve(ok({
        id: problem,
        app: "app_01arz3ndektsv4rrffq69g5faw",
        group_key: key,
      })),
  });
  const absent = newHarness();
  const fromOther = await accepted(other, { existing_problem: problem });
  const fromAbsent = await accepted(absent, { existing_problem: problem });
  assertEquals(fromOther.input.existing_problem, null);
  assertEquals(fromOther.input.group_key, fromAbsent.input.group_key);
  assertEquals(fromOther.input.group_key.discriminator, rpt(1));
  // 문제를 읽지 못하면 선택을 조용히 버리지 않고 unavailable이다.
  const unreadable = newHarness({
    lookup: () =>
      Promise.resolve({
        ok: false as const,
        error: { code: "unavailable" as const, message: "x" },
      }),
  });
  await rejected(unreadable, { existing_problem: problem }, "unavailable");
});
