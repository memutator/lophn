import { assert, assertEquals } from "@std/assert";
import type { ScreenTestObservation } from "../../../contracts/shell/mod.ts";
import { fakeCollector, judgeWithScreens } from "../testing/view-checks.ts";
import type { ScreenHostResult } from "./mod.ts";

const URL_HASH = "e".repeat(64);

// fixtures/app-screens를 host가 돌려준 모양: main은 오류 셋, hang은 load가 멈춘다.
function fixtureObservation(
  patch: (value: ScreenTestObservation) => void = () => {},
): ScreenTestObservation {
  const value: ScreenTestObservation = {
    load: [
      { screen: "main", ok: true, reason: null },
      { screen: "hang", ok: false, reason: "timeout" },
    ],
    errors: [
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
    ],
    feedback_check: [
      { screen: "main", binding: true, capture: "captured", dialog: "opened" },
      { screen: "hang", binding: true, capture: "missing", dialog: "opened" },
    ],
    blocked_requests: [{ screen: "main", url_hash: URL_HASH }],
  };
  patch(value);
  return value;
}

const observed = (
  patch?: (value: ScreenTestObservation) => void,
): () => Promise<ScreenHostResult> =>
() =>
  Promise.resolve({
    kind: "observation",
    observation: fixtureObservation(patch),
  });

function status(
  result: Awaited<ReturnType<typeof judgeWithScreens>>,
  name: string,
) {
  return result.judgment.observations.checks.find((check) =>
    check.name === name
  );
}

Deno.test("problems/tests#R7, problem-codes#R8, reporting#R5: 화면 있는 fixture의 view 오류 셋과 깨진 view의 feedback이 test scope로 접수되면 app test가 pass다", async () => {
  const collector = fakeCollector();
  const result = await judgeWithScreens({ host: observed(), collector });
  assertEquals(result.judgment.result, "pass");
  assertEquals(status(result, "view_exception")?.status, "pass");
  assertEquals(status(result, "feedback")?.status, "pass");
  // 오류 셋과 깨진 화면(main의 오류·hang의 load 실패)마다 feedback 하나다.
  assertEquals(
    collector.received.filter((item) => item.kind === "exception").length,
    3,
  );
  assertEquals(
    collector.received.filter((item) => item.kind === "feedback").length,
    2,
  );
});

Deno.test("problems/tests#R7: host 관측은 runner가 그 요청의 mode=test·scope로 collector에 넘기고 test 진단 scope에만 남는다", async () => {
  const collector = fakeCollector();
  await judgeWithScreens({ host: observed(), collector });
  assert(collector.received.length > 0);
  for (const item of collector.received) {
    assertEquals(item.target, { mode: "test", scope: "app-test-scope-1" });
  }
  // 문제에 묶여 접수되면(test scope가 아니면) 받은 것으로 세지 않아 통과하지 못한다.
  const live = await judgeWithScreens({
    host: observed(),
    collector: fakeCollector({ as_problem: true }),
  });
  assertEquals(live.judgment.result, "fail");
  assertEquals(status(live, "view_exception")?.status, "fail");
});

Deno.test("problems/tests#R7, problem-codes#R8: view 예외 수집을 뺀 fixture는 fail이다", async () => {
  const rejected = await judgeWithScreens({
    host: observed(),
    collector: fakeCollector({ reject: ["exception"] }),
  });
  assertEquals(rejected.judgment.result, "fail");
  assertEquals(status(rejected, "view_exception")?.status, "fail");
  assertEquals(status(rejected, "feedback")?.status, "pass");

  // host가 아무 오류도 관측하지 못한 경우도 수집 경로를 확인하지 못한 것이다.
  const silent = await judgeWithScreens({
    host: observed((value) => {
      value.errors = [];
    }),
    collector: fakeCollector(),
  });
  assertEquals(status(silent, "view_exception")?.status, "fail");
});

Deno.test("problems/tests#R7, reporting#R5: 깨진 view의 feedback이 접수되지 않거나 dialog가 막히면 fail이다", async () => {
  const rejected = await judgeWithScreens({
    host: observed(),
    collector: fakeCollector({ reject: ["feedback"] }),
  });
  assertEquals(status(rejected, "feedback")?.status, "fail");
  assertEquals(status(rejected, "view_exception")?.status, "pass");

  const blocked = await judgeWithScreens({
    host: observed((value) => {
      value.feedback_check[1] = {
        screen: "hang",
        binding: true,
        capture: "missing",
        dialog: "blocked",
      };
    }),
    collector: fakeCollector(),
  });
  assertEquals(blocked.judgment.result, "fail");
  assertEquals(status(blocked, "feedback")?.status, "fail");
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
    host: observed(),
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
