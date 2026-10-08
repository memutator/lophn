// roles/app-engineer#R16, R17, R22와 R6(ticket 부분): ticket 준비 검사(ticket.ts)와 AE의 ticket 제공
// 목록. 순수 함수와 목록 계산만 본다. 실제 core·provider·사람 데이터 root는 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import { ROLE_CAPS } from "../../presets/mod.ts";
import {
  appEngineerOffers,
  appEngineerToolNames,
  bundleRepairs,
  prepareTicket,
  type RepairCandidate,
  splitTicketUnits,
  TICKET_FORBIDDEN_TOOL_NAMES,
  TICKET_REQUIREMENT_MAX,
  ticketRoute,
} from "./mod.ts";

const PROBLEM_A = "prb_01h455vb4pex5v6nkc6gd5fdw1";
const PROBLEM_B = "prb_01h455vb4pex5v6nkc6gd5fdw2";
const PROBLEM_C = "prb_01h455vb4pex5v6nkc6gd5fdw3";

const COMPLETE = {
  kind: "implementation" as const,
  problems: [],
  references: [{ kind: "version" }],
  adoption_questions: ["qst_01h455vb4pex5v6nkc6gd5fdw1"],
  conditions: [{ kind: "app_test" }, { kind: "test_command" }],
  requirements: ["a", "b", "c"],
};

Deno.test("lophn-agent/roles/app-engineer#R17: 요구가 7개인 후보는 흐름 경계로 나뉘고 흐름 하나는 최대 6개 요구만 담는다", () => {
  assertEquals(TICKET_REQUIREMENT_MAX, 6);
  // 흐름 둘의 요구 7개: 흐름 경계로 나뉜다.
  const byFlow = splitTicketUnits([
    { flow: "add item", requirement: "r1" },
    { flow: "add item", requirement: "r2" },
    { flow: "add item", requirement: "r3" },
    { flow: "add item", requirement: "r4" },
    { flow: "list items", requirement: "r5" },
    { flow: "list items", requirement: "r6" },
    { flow: "list items", requirement: "r7" },
  ]);
  assertEquals(byFlow.map((unit) => [unit.flow, unit.requirements.length]), [
    ["add item", 4],
    ["list items", 3],
  ]);
  // 한 흐름이 6개를 넘으면 순서대로 6개씩 나뉜다.
  const long = splitTicketUnits(
    Array.from({ length: 7 }, (_, index) => ({
      flow: "one flow",
      requirement: `r${index + 1}`,
    })),
  );
  assertEquals(long.map((unit) => unit.requirements.length), [6, 1]);
  assertEquals(long.map((unit) => [unit.part, unit.parts]), [[1, 2], [2, 2]]);
  assertEquals(long[0]!.requirements[0], "r1");
  assertEquals(long[1]!.requirements, ["r7"]);
  // 6개까지는 한 ticket이다.
  assertEquals(
    splitTicketUnits(
      Array.from({ length: 6 }, (_, index) => ({
        flow: "f",
        requirement: `r${index}`,
      })),
    ).length,
    1,
  );
});

Deno.test("lophn-agent/roles/app-engineer#R17: 실행 준비는 채택한 고정 설계 근거·채택 질문·실행 가능한 acceptance check이 모두 있어야 하고 모자라면 확인 필요로 남는다", () => {
  assertEquals(prepareTicket(COMPLETE), { readiness: "ready", needs: [] });

  const noEvidence = prepareTicket({ ...COMPLETE, references: [] });
  assertEquals(noEvidence.readiness, "needs_confirmation");
  assertEquals(noEvidence.needs, ["fixed design evidence is missing"]);

  const noAdoption = prepareTicket({ ...COMPLETE, adoption_questions: [] });
  assertEquals(noAdoption.needs, ["an adopted decision question is missing"]);

  const noCheck = prepareTicket({ ...COMPLETE, conditions: [] });
  assertEquals(noCheck.needs, ["an executable acceptance check is missing"]);
  // app_test만 있고 실행할 test command가 없으면 실행 가능한 check이 아니다.
  const onlyApp = prepareTicket({
    ...COMPLETE,
    conditions: [{ kind: "app_test" }],
  });
  assertEquals(onlyApp.readiness, "needs_confirmation");

  // 근거가 하나도 없는 직접 요청도 버리지 않고 필요한 확인 셋을 남긴다.
  const bare = prepareTicket({
    ...COMPLETE,
    references: [],
    adoption_questions: [],
    conditions: [],
  });
  assertEquals(bare.needs.length, 3);

  // 한 ticket의 요구가 6개를 넘으면 실행 준비로 표시하지 않는다.
  const tooMany = prepareTicket({
    ...COMPLETE,
    requirements: ["1", "2", "3", "4", "5", "6", "7"],
  });
  assertEquals(tooMany.readiness, "needs_confirmation");
  assert(tooMany.needs.some((need) => need.includes("exceed 6")));
});

Deno.test("lophn-agent/roles/app-engineer#R16: 같은 원인 가설과 해결 조건의 문제는 한 수리 ticket으로 묶고 확인하지 못한 가설과 재현 불가는 필요한 확인을 남긴다", () => {
  const candidate = (
    problem: string,
    over: Partial<RepairCandidate> = {},
  ): RepairCandidate => ({
    problem,
    cause: "leaf is not redacted",
    resolution: "the snapshot has no raw leaf",
    cause_confirmed: true,
    reproduction: "test",
    ...over,
  });
  const bundles = bundleRepairs([
    candidate(PROBLEM_A),
    candidate(PROBLEM_B),
    candidate(PROBLEM_C, { cause: "the export drops rows" }),
  ]);
  assertEquals(bundles.map((bundle) => bundle.problems), [
    [PROBLEM_A, PROBLEM_B],
    [PROBLEM_C],
  ]);
  assertEquals(bundles.map((bundle) => bundle.needs), [[], []]);
  // 같은 원인이어도 해결 조건이 다르면 다른 묶음이다.
  assertEquals(
    bundleRepairs([
      candidate(PROBLEM_A),
      candidate(PROBLEM_B, { resolution: "the count matches" }),
    ]).length,
    2,
  );
  // 같은 문제를 두 번 넣어도 한 번만 묶는다.
  assertEquals(
    bundleRepairs([candidate(PROBLEM_A), candidate(PROBLEM_A)])[0]!.problems,
    [PROBLEM_A],
  );

  const unsure = bundleRepairs([
    candidate(PROBLEM_A, { cause_confirmed: false }),
    candidate(PROBLEM_B, { reproduction: "unknown" }),
  ]);
  assertEquals(unsure.length, 1);
  assertEquals(unsure[0]!.needs, [
    "the cause hypothesis is not confirmed",
    `no reproduction for ${PROBLEM_B}`,
  ]);
  // 사람 확인으로 대신하는 재현은 부족이 아니다.
  assertEquals(
    bundleRepairs([candidate(PROBLEM_A, { reproduction: "human" })])[0]!.needs,
    [],
  );
  // 한 묶음은 문제 12개까지다.
  const many = bundleRepairs(
    Array.from(
      { length: 13 },
      (_, index) => candidate(`prb_${String(index).padStart(26, "0")}`),
    ),
  );
  assertEquals(many.map((bundle) => bundle.problems.length), [12, 1]);
});

Deno.test("lophn-agent/roles/app-engineer#R16: 직접 요청·피드백·구현·수리는 모두 ticket이고 설정 변경만 필요한 일은 coding ticket이 아니다", () => {
  for (const origin of ["direct_request", "feedback", "design", "repair"]) {
    assertEquals(
      ticketRoute({ origin: origin as never, change: "code" }),
      "ticket",
      origin,
    );
  }
  assertEquals(
    ticketRoute({ origin: "direct_request", change: "setting_only" }),
    "setting",
  );
  assertEquals(
    ticketRoute({ origin: "feedback", change: "setting_only" }),
    "setting",
  );
});

Deno.test("lophn-agent/roles/app-engineer#R22: AE는 ticket을 만들고 읽고 준비 전환만 하며 claim·연장·보고·취소·[Start]를 제공하지 않는다", () => {
  const cap = ROLE_CAPS.get("app_engineer")!;
  const offered = appEngineerToolNames(cap.tools).filter((name) =>
    name.startsWith("ticket.")
  );
  assertEquals(offered.sort(), [
    "ticket.create",
    "ticket.list",
    "ticket.make_ready",
    "ticket.read",
  ]);
  for (const name of TICKET_FORBIDDEN_TOOL_NAMES) {
    assertEquals(cap.tools.includes(name), false, `${name} in the cap`);
    assertEquals(appEngineerOffers(name, cap.tools), false, name);
  }
  // 시작은 사람이 [Start]를 누르거나 자기 터미널에서 하는 coding-agent/sessions의 경로이고 이 역할
  // 어디에도 coding agent 시작 이름이 없다.
  assertEquals(
    cap.tools.filter((name) => /start|claim|spawn/.test(name)),
    [],
  );
});

Deno.test("lophn-agent/roles/app-engineer#R6: 선택이 고정되지 않은 AE는 ticket tool도 제공하지 않는다", () => {
  assertEquals(
    appEngineerToolNames(null).filter((name) => name.startsWith("ticket.")),
    [],
  );
});
