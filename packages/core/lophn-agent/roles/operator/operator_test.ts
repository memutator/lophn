import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  executeTool,
  listTools,
  type RunCredential,
  runOperations,
} from "../../tools/mod.ts";
import { APP_COMMAND_EXPOSURE, ROLE_CAPS } from "../../agents/mod.ts";
import { handoffAllowed, runSourceSchema } from "@lophn/protocol/lophn-agent";
import { type OperatorRunOutcome, type OutcomePoint, update } from "./mod.ts";
import { operatorOffers, operatorTools } from "./mod.ts";

// roles/operator의 시작 계기·범위·tool 선택·결과 판정 규칙(R1–R10)을 본다. 순수
// 규칙이므로 model 호출이 없고 실제 core·provider·사람 데이터 root는 부르지 않는다.
// tool 선택은 ROLE_CAPS 표와 내장 정의의 교집합으로, 결과 판정은 사실·판단·불확실함의
// 세 구분과 갱신 조건 미충족의 무변화로 본다.

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const RUN = id("run", 1);
const ASSIGNMENT = id("asg", 1);
const CALL = id("tcl", 1);

// --- R1: 주기 또는 그 assignment 사람 요청으로만 일한다 ----------------------------

Deno.test("lophn-agent/roles/operator#R1: 사람 요청만 Operator를 시작하고 다른 계기는 run 출처가 아니다", () => {
  // 사람 요청은 run 출처 schema 그대로다(R1). 주기 실행은 보류라 출처가 아니다.
  assertEquals(
    runSourceSchema.safeParse({
      kind: "schedule",
      assignment_revision: 1,
      scheduled_at: "2026-01-01T00:00:00.000Z",
    }).success,
    false,
  );
  assert(
    runSourceSchema.safeParse({ kind: "message", message: id("msg", 1) })
      .success,
  );
  // 문제 발생·release activation 같은 자료 변화와 자체 정의 계기는 없다(R1 확인).
  for (
    const source of [
      { kind: "problem_opened", problem: id("prb", 1) },
      { kind: "release_activated", release: id("rel", 1) },
      { kind: "ticket_changed", ticket: id("tkt", 1) },
      { kind: "defining" },
    ]
  ) {
    assertEquals(
      runSourceSchema.safeParse(source).success,
      false,
      source.kind,
    );
  }
});

Deno.test("lophn-agent/roles/operator#R1: Operator 상한에는 주기 접수 tool이 없고 접수 계기는 scheduling·assignments의 것이다", () => {
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  assertEquals(
    cap.tools.filter((tool) =>
      tool.startsWith("schedule.") || tool.includes("subscribe") ||
      tool.startsWith("assignment.apply") || tool.startsWith("run.accept")
    ),
    [],
  );
});

// --- R2: 사람이 고른 preset 하나의 고정 판 ---------------------------------------

Deno.test("lophn-agent/roles/operator#R2: 승인 전 실행할 assignment 등록은 없고 등록은 approval 경유의 Assignments 몫이다", () => {
  // assignment 등록(approvals/apply 경유)은 assignments의 몫이다(R2). Operator
  // 상한에는 assignment 적용 tool이 없다.
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  assertEquals(
    cap.tools.filter((tool) =>
      tool.startsWith("assignment.") || tool.startsWith("approval.submit")
    ),
    [],
  );
});

// --- R3: 맡지 않는 일 ------------------------------------------------------------

const NOT_OWNED_TOOLS = [
  // 기획·앱 설계·수리 티켓·코드. 컨텍스트·용어 변경은 내장 묶음(CE 상한)에
  // 정의가 있지만 Operator 상한 교집합 밖이라 목록에 남지 않는다(R5).
  "app.create",
  "app.adopt",
  "sdk.plan_reuse",
  "code.write",
  "code.edit",
  "code.run",
  "test.run",
  "build.run",
  // 자기 역할·assignment 변경.
  "assignment.create",
  "assignment.pause",
  "assignment.resume",
  "assignment.withdraw",
  "assignment.change_preset",
  // 개별 앱 작업의 판단 담당.
  "app.call_write",
  "app.run_automation",
  // 티켓·역할·assignment 관리.
  "ticket.update",
  "operator.create",
];

function rig() {
  const calls: string[] = [];
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  const listed = listTools(
    { builtin: BUILTIN_TOOLS, app: [], external: [] },
    { presetTools: cap.tools, roleTools: cap.tools },
  );
  const handlers = createBuiltinToolHandlers({
    call: (contract: string): Promise<Result<unknown>> => {
      calls.push(contract);
      return Promise.resolve(err({ code: "not_found", message: contract }));
    },
    newId: () => id("qst", 9),
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "operator" as const,
        original_message: null,
        assignment: ASSIGNMENT,
      })),
  });
  const operations = new Set(runOperations(listed));
  const run = (tool: string, input: unknown) => {
    const credential: RunCredential = {
      run: RUN,
      targets: new Set(),
      operations,
      call: CALL,
    };
    return executeTool({ listed, handlers, credential }, tool, input);
  };
  return { calls, listed, run };
}

Deno.test("lophn-agent/roles/operator#R3: 기획·설계·티켓·코드·컨텍스트·역할·assignment 관리 tool은 상한과 내장 정의 어디에도 없다", async () => {
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  const { listed, run, calls } = rig();
  const builtin = new Set(BUILTIN_TOOLS.map((tool) => tool.name));
  const listedNames = new Set(listed.map((tool) => tool.name));
  for (const name of NOT_OWNED_TOOLS) {
    assert(!cap.tools.includes(name), `${name} in role cap`);
    assert(!listedNames.has(name), `${name} listed`);
    assert(!builtin.has(name), `${name} builtin`);
  }
  // 목록에 없는 tool의 실행은 없는 tool과 같은 결과이고 소유 contract까지 가지 않는다.
  for (const name of NOT_OWNED_TOOLS) {
    const outcome = await run(name, {});
    assertEquals(outcome.outcome.kind, "failure", name);
    assertEquals(outcome.outcome.code, "not_found", name);
  }
  assertEquals(calls, []);
});

// --- R4–R5: 읽을 자료와 제품 상한 안 동작 ---------------------------------------

const OPERATOR_CAP_TOOL_NAMES = ROLE_CAPS.get("operator")?.tools ?? [];

Deno.test("lophn-agent/roles/operator#R4: Operator 상한은 preset context 읽기와 승인된 앱 read·문서 새 version·질문으로 한정된다", () => {
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  const listed = operatorTools(cap.tools);
  assert(listed.length > 0);
  // 목록 자체는 상한과 preset 선택의 교집합이다(R5).
  assertEquals(
    listTools(
      { builtin: BUILTIN_TOOLS, app: [], external: [] },
      { presetTools: cap.tools, roleTools: cap.tools },
    ),
    operatorTools(cap.tools),
  );
  // 승인된 앱 read의 결과는 app.call_read_command·app.command_metadata다(R4).
  assert(OPERATOR_CAP_TOOL_NAMES.includes("app.call_read_command"));
  assert(OPERATOR_CAP_TOOL_NAMES.includes("app.command_metadata"));
  // 문서 새 version과 질문·승인 read도 있다(R5).
  assert(OPERATOR_CAP_TOOL_NAMES.includes("document.save_version"));
  assert(OPERATOR_CAP_TOOL_NAMES.includes("question.submit"));
  assert(OPERATOR_CAP_TOOL_NAMES.includes("approval.read_decision"));
});

Deno.test("lophn-agent/roles/operator#R5: 새 문서 생성·앱 write·external·confirm은 상한과 정의 어디에도 없다", () => {
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  const listed = operatorTools(cap.tools);
  const listedNames = new Set(listed.map((tool) => tool.name));
  for (const absent of NOT_OWNED_TOOLS) {
    assertEquals(
      listedNames.has(absent),
      false,
      `${absent} in the listed set`,
    );
  }
  // 상한 밖 이름은 제공하지 않는다(fail closed).
  assertEquals(operatorOffers("subagent"), false);
  assertEquals(operatorOffers("shell"), false);
  assertEquals(operatorOffers("document.create"), false);
});

Deno.test("lophn-agent/roles/operator#R5: Operator의 preset 선택이 고정되지 않으면 목록은 빈다", () => {
  assertEquals(operatorTools(null), []);
  assertEquals(operatorTools([]), []);
});

Deno.test("lophn-agent/roles/operator#R4: 앱 command 노출 상한은 승인된 read뿐이고 실행은 approved_reads 한정이다", () => {
  const exposure = APP_COMMAND_EXPOSURE.get("operator");
  assert(exposure !== undefined);
  assertEquals(exposure.effects, ["read"]);
  assertEquals(exposure.undo_write_only, false);
  assertEquals(exposure.execution, "approved_reads");
  assertEquals(exposure.ask, false);
});

// --- R6–R8: 결과 갱신과 사람 요청 -----------------------------------------------

const point = (over: Partial<OutcomePoint> = {}): OutcomePoint => ({
  fact: "watch index count moved from 42 to 57",
  judgment: "the gap since the last check exceeds the declared threshold",
  uncertainty: "source totals lag an hour behind the index",
  ...over,
});

const evidence = [
  { document: id("doc", 1), version: id("ver", 1), section: "watch" },
  { document: id("doc", 2), version: id("ver", 3), section: null },
];

Deno.test("lophn-agent/roles/operator#R6: 결과는 확인한 사실·판단·불확실함·고정 근거 주소·선언한 판단 항목을 구분해 남긴다", () => {
  const produced = update({
    points: point(),
    evidence,
    declared_items: ["watch index", "count gap"],
    update_condition: "count gap exceeds the threshold",
  });
  assert(produced.ok);
  assertEquals(produced.value.kind, "update");
  assertEquals(produced.value.points.fact !== "", true);
  assertEquals(produced.value.points.judgment !== "", true);
  assertEquals(produced.value.points.uncertainty !== "", true);
  assertEquals(produced.value.evidence, evidence);
  assertEquals(produced.value.declared_items, ["watch index", "count gap"]);
  // 세 구분 중 하나라도 비면 결과가 되지 않는다(R6).
  for (const blank of ["fact", "judgment", "uncertainty"] as const) {
    const failed = update({
      points: point({ [blank]: " " }),
      evidence,
      declared_items: ["watch index"],
      update_condition: "the condition",
    });
    assertEquals(failed.ok, false, blank);
  }
  // 근거 주소 없는 결과도 아니다(없는 근거를 성공 보고로 채우지 않는다).
  assertEquals(
    update({
      points: point(),
      evidence: [],
      declared_items: ["watch index"],
      update_condition: "the condition",
    }).ok,
    false,
  );
  // 선언한 판단 항목이 없어도 아니다.
  assertEquals(
    update({
      points: point(),
      evidence,
      declared_items: [],
      update_condition: "the condition",
    }).ok,
    false,
  );
});

Deno.test("lophn-agent/roles/operator#R6: 갱신 결과는 사실·판단·불확실함 셋과 근거를 갖춰야 새 version이 된다", () => {
  const refreshed = update({
    points: point(),
    evidence,
    declared_items: ["watch index"],
    update_condition: "the condition",
  });
  assert(refreshed.ok);
  assertEquals(refreshed.value.kind, "update");
});

Deno.test("lophn-agent/roles/operator#R6: 부분 결과는 실제 저장된 문서와 실패 내용을 나눠 남긴다", () => {
  // 부분 결과는 일부 저장을 전체 성공이나 전체 취소로 표시하지 않는다(R6 표).
  const partial: OperatorRunOutcome = {
    kind: "partial",
    points: point(),
    evidence,
    saved: [{ document: id("doc", 1), version: id("ver", 4) }],
    failed: [{ document: id("doc", 3), reason: "version conflicted" }],
  };
  assertEquals(partial.kind, "partial");
  assertEquals(partial.saved.length, 1);
  assertEquals(partial.failed.length, 1);
});

Deno.test("lophn-agent/roles/operator#R8: 사람 대화의 오래 남길 답은 승인한 문서의 새 version으로만 남고 정의·범위·주기·tool 변경으로 이어지지 않는다", () => {
  // 지속할 사람 답은 승인된 판단 항목에 필요한 답·결과 해석이고(R8 표) 선언한
  // 기존 문서 새 Version에만 저장한다.
  const held: OperatorRunOutcome = {
    kind: "person_answer",
    points: point(),
    evidence: evidence.slice(0, 1),
    document: id("doc", 1),
  };
  assertEquals(held.kind, "person_answer");
  // 사람 답 후의 변경은 정의 변경이 아니라 documents의 몫이다: Operator 상한에는
  // 정의·범위·주기·tool 변경 tool이 없다(R8 확인).
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  assertEquals(
    cap.tools.filter((tool) =>
      tool.startsWith("assignment.") || tool.startsWith("approval.submit") ||
      tool.startsWith("preset.revise")
    ),
    [],
  );
});

Deno.test("lophn-agent/roles/operator#R8: T53의 receiver roles 화면은 사람 답으로 정의를 바꾸지 않고 operator 상한 어디에도 역할 관리 tool이 없다", () => {
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  for (
    const outside of [
      "operator.create",
      "assignment.change_preset",
      "preset.create",
      "preset.copy",
    ]
  ) {
    assertEquals(
      cap.tools.includes(outside),
      false,
      `${outside} should stay out of the operator cap`,
    );
  }
  // T53 계획 블록의 문장을 따라 operator 상한은 승인된 read와 outputs 새 version뿐이다.
  assertStringIncludes(
    ROLE_CAPS.get("operator")!.tools.join(" "),
    "document.save_version",
  );
});

// --- R9: 해석·판단·본문·제목은 preset model과 organizing 선택 ---------------------

Deno.test("lophn-agent/roles/operator#R9: Operator 상한은 model 이름을 고정하지 않고 실제 provider 계정·model은 판이 고른다", () => {
  // 상한은 model 이름을 고정하지 않는다(roles/common#R8). 계정·model은 판(preset
  // selection)의 몫이다(R9).
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  assertEquals(
    cap.tools.filter((tool) => tool.includes("api") || tool.includes("token")),
    [],
  );
});

// --- R7: 승인한 기존 문서의 새 version -----------------------------------------------

Deno.test("lophn-agent/roles/operator#R7 [agent-R10]: 문서 새 version tool은 run마다 승인을 다시 묻지 않고 정의의 권한에 있을 때만 제공되며 출력 선언 같은 별도 제한은 없다", () => {
  // save_version은 builtin definition 그대로다: run마다 approval을 다시 묻는 confirm이 없다(R7).
  // 쓸 수 있는 자리는 담당 자리이고 쓰기마다의 판정은 tool-judgment가 한다.
  const defined = BUILTIN_TOOLS.find((tool) =>
    tool.name === "document.save_version"
  );
  assert(defined !== undefined);
  assertEquals(defined.confirm, false);
  assertEquals(defined.effect, "write");
  assertEquals(defined.reversible, true);
  // 정의의 권한에 있으면 제공된다.
  const granted = ROLE_CAPS.get("operator")!.tools;
  assert(operatorOffers("document.save_version", granted));
  // 정의의 권한에서 뺀 Operator에는 제공되지 않는다. 읽기 tool은 그대로다.
  const withheld = granted.filter((name) => name !== "document.save_version");
  assertEquals(operatorOffers("document.save_version", withheld), false);
  assertEquals(
    operatorTools(withheld).some((tool) =>
      tool.name === "document.save_version"
    ),
    false,
  );
  assert(operatorOffers("document.read_version", withheld));
  // 읽기만 고른 정의는 문서에 쓰는 tool을 하나도 받지 않는다.
  const readOnly = granted.filter((name) =>
    !["document.save_version", "document.create"].includes(name)
  );
  assertEquals(
    operatorTools(readOnly).filter((tool) => tool.effect !== "read")
      .map((tool) => tool.name),
    ["question.submit"],
  );
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  // 새 문서·자리 이동·형식 선언 쓰기는 역할 밖이다(R5, R7).
  for (
    const outside of [
      "document.create",
      "document.move",
      "document.rename",
    ]
  ) {
    assertEquals(
      cap.tools.includes(outside),
      false,
      `${outside} should stay out of the operator cap`,
    );
  }
});

// --- R10: 반복 실패와 대기 중 run ----------------------------------------------

Deno.test("lophn-agent/roles/operator#R10: Operator에게는 실패를 무시하는 선택이나 handoff 송수신 tool이 없다", () => {
  const cap = ROLE_CAPS.get("operator");
  assert(cap !== undefined);
  // handoff 방향 자체가 Operator로/에서 열려 있지 않다	R10.
  for (
    const role of [
      "lophn",
      "app_engineer",
      "context_engineer",
      "operator",
    ]
  ) {
    assertEquals(handoffAllowed("operator", role), false);
    assertEquals(handoffAllowed(role, "operator"), false);
  }
  assertEquals(
    cap.tools.filter((tool) => tool.startsWith("handoff.")),
    [],
  );
});
