import { assert, assertEquals } from "@std/assert";
import type { ScreenTestObservation } from "../../../../protocol/shell/mod.ts";
import {
  fakeCollector,
  judgeWithScreens,
  PROBE_NONCE,
} from "../testing/view-checks.ts";
import { PROBE_KINDS, probeText, type ScreenHostResult } from "./mod.ts";

const URL_HASH = "e".repeat(64);

type Patch = (value: ScreenTestObservation) => void;

const probe = (
  screen: string,
  kind: ScreenTestObservation["errors"][number]["observation"],
) => ({
  screen,
  observation: kind,
  name: kind === "unhandledrejection"
    ? "TypeError"
    : kind === "render_error"
    ? "RenderError"
    : "Error",
  message: probeText(PROBE_NONCE, kind),
});

// 온전한 화면 하나뿐인 fixture 앱. 앱은 깨진 화면을 따로 두지 않았고 host의 probe 셋과
// 일부러 멈춘 화면(induced)이 관측에 있다.
function cleanObservation(patch: Patch = () => {}): ScreenTestObservation {
  const value: ScreenTestObservation = {
    load: [{ screen: "clean", ok: true, reason: null }],
    errors: PROBE_KINDS.map((kind) => probe("clean", kind)),
    feedback_check: [{
      screen: "clean",
      binding: true,
      capture: "missing",
      dialog: "opened",
      induced: true,
    }],
    blocked_requests: [],
  };
  patch(value);
  return value;
}

// 앱 화면 자신의 실제 오류 셋(fixtures/app-screens/main)과 load가 멈춘 화면(hang)이 더해진다.
function ownErrorsObservation(patch: Patch = () => {}): ScreenTestObservation {
  return cleanObservation((value) => {
    value.load.push(
      { screen: "main", ok: true, reason: null },
      { screen: "hang", ok: false, reason: "timeout" },
    );
    value.errors.push(
      {
        screen: "main",
        observation: "error",
        name: "Error",
        message: "screen fixture error",
      },
      {
        screen: "main",
        observation: "unhandledrejection",
        name: "TypeError",
        message: "rejected",
      },
      {
        screen: "main",
        observation: "render_error",
        name: "RenderError",
        message: null,
      },
      ...PROBE_KINDS.map((kind) => probe("main", kind)),
    );
    value.feedback_check.push(
      { screen: "main", binding: true, capture: "captured", dialog: "opened" },
      { screen: "hang", binding: true, capture: "missing", dialog: "opened" },
    );
    value.blocked_requests.push({ screen: "main", url_hash: URL_HASH });
    patch(value);
  });
}

const observed = (
  make: (patch?: Patch) => ScreenTestObservation,
  patch?: Patch,
): () => Promise<ScreenHostResult> =>
() => Promise.resolve({ kind: "observation", observation: make(patch) });

function status(
  result: Awaited<ReturnType<typeof judgeWithScreens>>,
  name: string,
) {
  return result.judgment.observations.checks.find((check) =>
    check.name === name
  );
}

Deno.test("problems/tests#R7, problem-codes#R8, reporting#R5: 깨진 화면을 따로 두지 않은 fixture 앱도 host probe 셋과 일부러 멈춘 화면의 feedback이 test scope로 접수되면 pass다", async () => {
  const collector = fakeCollector();
  const result = await judgeWithScreens({
    host: observed(cleanObservation),
    collector,
  });
  assertEquals(result.judgment.result, "pass");
  assertEquals(status(result, "view_exception")?.status, "pass");
  assertEquals(status(result, "feedback")?.status, "pass");
  assertEquals(
    collector.received.filter((item) => item.kind === "exception").length,
    3,
  );
  assertEquals(
    collector.received.filter((item) => item.kind === "feedback").length,
    1,
  );
});

Deno.test("reporting#R5: 화면 자신의 실제 오류와 load에 실패한 화면도 probe와 함께 접수되어 센다", async () => {
  const collector = fakeCollector();
  const result = await judgeWithScreens({
    host: observed(ownErrorsObservation),
    collector,
  });
  assertEquals(result.judgment.result, "pass");
  // clean의 probe 3 + main의 실제 오류 3 + main의 probe 3, 멈춘 화면(clean)과 load 실패(hang) feedback.
  assertEquals(
    collector.received.filter((item) => item.kind === "exception").length,
    9,
  );
  assertEquals(
    collector.received.filter((item) => item.kind === "feedback").length,
    2,
  );
  // 실제 오류 하나가 접수되지 않으면 수집 경로가 빠진 것이다.
  const lost = await judgeWithScreens({
    host: observed(ownErrorsObservation),
    collector: fakeCollector({ reject: ["exception"] }),
  });
  assertEquals(status(lost, "view_exception")?.status, "fail");
});

Deno.test("problems/tests#R7: host 관측은 runner가 그 요청의 mode=test·scope로 collector에 넘기고 test 진단 scope에만 남는다", async () => {
  const collector = fakeCollector();
  await judgeWithScreens({ host: observed(cleanObservation), collector });
  assert(collector.received.length > 0);
  for (const item of collector.received) {
    assertEquals(item.target, { mode: "test", scope: "app-test-scope-1" });
  }
  // 문제에 묶여 접수되면(test scope가 아니면) 받은 것으로 세지 않아 통과하지 못한다.
  const live = await judgeWithScreens({
    host: observed(cleanObservation),
    collector: fakeCollector({ as_problem: true }),
  });
  assertEquals(live.judgment.result, "fail");
  assertEquals(status(live, "view_exception")?.status, "fail");
});

Deno.test("problems/tests#R7, problem-codes#R8: view 예외 수집을 뺀 fixture(접수 거절, preload 캡처 없음, 오류 경계 없음)는 fail이다", async () => {
  const rejected = await judgeWithScreens({
    host: observed(cleanObservation),
    collector: fakeCollector({ reject: ["exception"] }),
  });
  assertEquals(rejected.judgment.result, "fail");
  assertEquals(status(rejected, "view_exception")?.status, "fail");
  assertEquals(status(rejected, "feedback")?.status, "pass");

  // preload 캡처가 꺼져 probe 오류가 하나도 관측되지 않았다.
  const silent = await judgeWithScreens({
    host: observed(cleanObservation, (value) => {
      value.errors = [];
    }),
    collector: fakeCollector(),
  });
  assertEquals(status(silent, "view_exception")?.status, "fail");

  // 한 갈래(unhandledrejection)만 캡처되지 않았다.
  const partial = await judgeWithScreens({
    host: observed(cleanObservation, (value) => {
      value.errors = value.errors.filter((error) =>
        error.observation !== "unhandledrejection"
      );
    }),
    collector: fakeCollector(),
  });
  assertEquals(status(partial, "view_exception")?.status, "fail");

  // nonce가 다른 오류는 probe가 아니다(화면이 꾸민 오류).
  const forged = await judgeWithScreens({
    host: observed(cleanObservation, (value) => {
      for (const error of value.errors) error.message = "lophn-probe:other:x";
    }),
    collector: fakeCollector(),
  });
  assertEquals(status(forged, "view_exception")?.status, "fail");

  // 화면 root에 오류 경계가 없어 render_error를 믿을 수 없다.
  const bare = await judgeWithScreens({
    host: observed(cleanObservation),
    has_boundary: () => false,
    collector: fakeCollector(),
  });
  assertEquals(bare.judgment.result, "fail");
  assertEquals(status(bare, "view_exception")?.status, "fail");
});

Deno.test("problems/tests#R7, reporting#R5: 일부러 멈춘 화면의 feedback이 접수되지 않거나 dialog가 막히거나 host가 멈추지 못했으면 fail이다", async () => {
  const rejected = await judgeWithScreens({
    host: observed(cleanObservation),
    collector: fakeCollector({ reject: ["feedback"] }),
  });
  assertEquals(status(rejected, "feedback")?.status, "fail");
  assertEquals(status(rejected, "view_exception")?.status, "pass");

  const blocked = await judgeWithScreens({
    host: observed(cleanObservation, (value) => {
      value.feedback_check[0] = {
        ...value.feedback_check[0]!,
        dialog: "blocked",
      };
    }),
    collector: fakeCollector(),
  });
  assertEquals(blocked.judgment.result, "fail");
  assertEquals(status(blocked, "feedback")?.status, "fail");

  const unbound = await judgeWithScreens({
    host: observed(cleanObservation, (value) => {
      value.feedback_check[0] = { ...value.feedback_check[0]!, binding: false };
    }),
    collector: fakeCollector(),
  });
  assertEquals(status(unbound, "feedback")?.status, "fail");

  // host가 renderer를 멈추지 못해 induced 화면이 없다.
  const none = await judgeWithScreens({
    host: observed(cleanObservation, (value) => {
      value.feedback_check = [];
    }),
    collector: fakeCollector(),
  });
  assertEquals(status(none, "feedback")?.status, "fail");
});

Deno.test("problems/tests#R7, problem-codes#R8: 화면 검사를 띄울 수 없으면 화면 있는 app test는 pass가 아니다", async () => {
  const result = await judgeWithScreens({
    host: () =>
      Promise.resolve({ kind: "unavailable", reason: "no executable" }),
    collector: fakeCollector(),
  });
  assertEquals(result.judgment.result, "fail");
  assertEquals(status(result, "view_exception")?.status, "fail");
  assertEquals(status(result, "feedback")?.status, "fail");
});

Deno.test("problems/tests#R7, R19: host가 판정하지 못하면(exit 2–4·기한·잘못된 관측) app test는 판정 불가다", async () => {
  const result = await judgeWithScreens({
    host: () =>
      Promise.resolve({ kind: "inconclusive", reason: "host가 exit 3" }),
    collector: fakeCollector(),
  });
  assertEquals(result.judgment.result, "inconclusive");
});

Deno.test("problem-codes#R8: 화면 없는 bundle만 이유 있는 not_applicable이고 host를 띄우지 않는다", async () => {
  const result = await judgeWithScreens({
    host: observed(cleanObservation),
    collector: fakeCollector(),
    has_view: false,
  });
  assertEquals(result.judgment.result, "pass");
  assertEquals(result.host_runs(), 0);
  const check = status(result, "view_exception");
  assertEquals(check?.status, "not_applicable");
  assert(check !== undefined && check.reason.trim() !== "");
  assertEquals(status(result, "feedback")?.status, "not_applicable");
});
