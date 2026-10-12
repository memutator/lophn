// 배포 skill 본문의 절차 시험이다(coding-agent/guides#R6–R12, R22, R26). 본문이 가리키는 tool 이름과 op가
// 실제 contract에 있고(문제 tool은 contract 이름을 따른다) 순서와 금지가 본문에 있는지 읽는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  MCP_APP_TOOLS,
  MCP_CORE_TOOLS,
  MCP_DECISION_TOOLS,
  MCP_PROBLEM_TOOLS,
  MCP_SESSION_TOOLS,
} from "../../contracts/coding-agent/mod.ts";
import { loadDistribution } from "./distribution.ts";

async function bodyOf(name: string): Promise<string> {
  const loaded = await loadDistribution();
  assert(loaded.ok);
  const skill = loaded.value.skills.find((item) => item.name === name);
  assert(skill !== undefined, name);
  return flat(skill.body);
}

// deno fmt가 본문을 줄바꿈하므로 공백 차이는 무시하고 읽는다.
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

async function referenceOf(name: string, path: string): Promise<string> {
  const loaded = await loadDistribution();
  assert(loaded.ok);
  const file = loaded.value.skills.find((item) => item.name === name)?.files
    .find((item) => item.path === path);
  assert(file !== undefined, path);
  return flat(file.content);
}

// 본문 안 순서를 확인한다. 앞 조각이 뒤 조각보다 먼저 나와야 한다.
function inOrder(text: string, parts: readonly string[]): void {
  let at = -1;
  for (const part of parts) {
    const found = text.indexOf(part, at + 1);
    assert(found > at, `순서가 맞지 않거나 없다: ${part}`);
    at = found;
  }
}

const TOOLS = [
  ...MCP_CORE_TOOLS,
  ...MCP_DECISION_TOOLS,
  ...MCP_SESSION_TOOLS,
  ...MCP_APP_TOOLS,
  ...MCP_PROBLEM_TOOLS,
] as ReadonlyArray<{ name: string; ops: readonly string[] }>;

Deno.test("coding-agent/guides#R3: 본문이 가리키는 tool 이름과 `op …`는 모두 contract에 있는 것이다", async () => {
  const loaded = await loadDistribution();
  assert(loaded.ok);
  for (const skill of loaded.value.skills) {
    const body = flat(skill.body);
    for (const match of body.matchAll(/`(lophn_[a-z_]+)`/g)) {
      assert(
        TOOLS.some((tool) => tool.name === match[1]),
        `${skill.name}: 없는 tool ${match[1]}`,
      );
    }
    // tool 이름 뒤 다음 tool 이름 전까지 나온 op는 그 tool의 op여야 한다.
    for (const match of body.matchAll(/`(lophn_[a-z_]+)`/g)) {
      const known = TOOLS.find((item) => item.name === match[1]);
      if (known === undefined || known.ops.length === 0) continue;
      const rest = body.slice((match.index ?? 0) + match[0].length);
      const next = rest.search(/`lophn_[a-z_]+`/);
      const scope = next < 0 ? rest : rest.slice(0, next);
      for (const list of scope.matchAll(/op ((?:`[a-z_]+`(?:, ?)?)+)/g)) {
        for (const op of list[1].matchAll(/`([a-z_]+)`/g)) {
          assert(
            known.ops.includes(op[1]),
            `${skill.name}: ${known.name}에 없는 op ${op[1]}`,
          );
        }
      }
    }
  }
});

Deno.test("coding-agent/guides#R6: 탐색은 전체 목차에서 펼치고 context 통로를 안내하지 않는다", async () => {
  const body = await bodyOf("lophn-navigate");
  inOrder(body, ["op `root`", "op `place`", "lophn_read"]);
  assertFalse(body.includes("lophn_context"));
  assertFalse(body.includes("glossary"));
  // 읽기뿐이다: 쓰기 tool을 쓰라고 하지 않는다.
  assertFalse(body.includes("`lophn_save`로"));
});

Deno.test("coding-agent/guides#R7: 저장은 format 확인과 검사, 자리, 저장, 주소 보고 순서이고 원본 파일 편집을 안내하지 않는다", async () => {
  const body = await bodyOf("lophn-save");
  inOrder(body, [
    "`lophn_format` op `list`",
    "op `validate`",
    "자리를 고른다",
    "`lophn_save`에",
    "고정 주소",
  ]);
  assert(body.includes("자리 없음"));
  // 원본 편집·추적 통로 이름을 쓰라고 하지 않는다.
  for (const forbidden of ["files/read", "file-tracking", "edit-session"]) {
    assertFalse(body.includes(forbidden));
  }
  assert(body.includes("원본 파일로 놓거나"));
});

Deno.test("coding-agent/guides#R8: 앱 제작은 지정 ticket·claim 뒤 설계, SDK, 등록, source, blueprint 먼저, 구현, 테스트, preview, release 준비, 결과 순서다", async () => {
  const body = await bodyOf("lophn-build-app");
  inOrder(body, [
    "지정 ticket을 읽는다",
    "claim한다",
    "채택된 설계와 유지 제약",
    "설치 SDK와 재사용 재료",
    "앱을 준비한다",
    "source를 연결한다",
    "blueprint를 먼저 고친다",
    "구현한다",
    "실제 테스트를 돌린다",
    "preview로 확인한다",
    "release를 준비한다",
    "결과를 보고한다",
  ]);
  assert(body.includes("op `register`"));
  // 앱 하나 연결은 등록 대신 등록된 앱을 쓴다.
  assert(body.includes("앱 하나에 연결된 connection이면 등록하지 않고"));
  // app test 실패 뒤에는 release 준비를 시도하지 않는다.
  assert(body.includes("통과 전에 release 준비를 시도하지 않는다"));
});

Deno.test("coding-agent/guides#R9: 수리는 지정 ticket·claim, 수리 자료, 추가 근거, 수정, 테스트·preview, claim 재확인, release 준비, 결과 순서다", async () => {
  const body = await bodyOf("lophn-repair");
  inOrder(body, [
    "지정 ticket을 읽는다",
    "claim한다",
    "수리 자료를 읽는다",
    "필요한 근거를 더 조회한다",
    "고친다",
    "실제 테스트와 preview를 한다",
    "고친 기록을 남긴다",
    "claim을 다시 확인한다",
    "release를 준비한다",
    "결과를 보고한다",
  ]);
  // claim을 잃으면 release 준비와 보고를 멈춘다.
  assert(body.includes("release 준비와 보고를 멈추고"));
  // 조사만 요청받으면 수리에 착수하지 않는다.
  assert(body.includes("조사만 요청했으면 수리에 착수하지 않는다"));
  // 문제 tool은 contract 이름이고 연결 전에는 진행하지 않는다.
  assert(body.includes("tool 목록에 없으면"));
  assert(MCP_PROBLEM_TOOLS.some((tool) => tool.name === "lophn_problem"));
});

Deno.test("coding-agent/guides#R10: 직접 요청도 ticket으로 정리한 뒤 claim하고 ticket 없이 code를 시작하지 않으며 생성 근거가 없으면 담당 agent의 다음 행동을 안내한다", async () => {
  for (const name of ["lophn-build-app", "lophn-repair"]) {
    const body = await bodyOf(name);
    assert(body.includes("ticket 없이"), name);
    assert(body.includes("code를 시작하지 않는다"), name);
    assert(body.includes("App Engineer"), name);
    assert(body.includes("ticket이 만들어지지 않고"), name + " 무생성");
    assert(
      body.includes("coding credential로는 만들 수 없다") ||
        body.includes("coding credential로 할 수 없다"),
      name,
    );
  }
});

Deno.test("coding-agent/guides#R11: 제작·수리는 문제 code 선언·보고·예외 수집과 원래 증상 테스트를 포함하고 선언 삭제·기대값 완화로 숨기지 않는다", async () => {
  const build = await bodyOf("lophn-build-app");
  const repair = await bodyOf("lophn-repair");
  for (const body of [build, repair]) {
    assert(body.includes("problem_codes"));
    assert(body.includes("reportProblem"));
    assert(
      body.includes("선언한 문제 code를 지우거나 테스트 기대값을 낮춰") ||
        body.includes("선언한 문제 code를 지우거나 테스트 기대값을 낮춰서"),
    );
  }
  assert(build.includes("예외도 같은 통로로 모이게"));
  assert(repair.includes("원래 증상을 재현하는 테스트"));
  assert(repair.includes("기존 fixture"));
  // 매 수리 뒤 새 탐지 규칙을 반드시 더하라고 요구하지 않는다.
  assert(repair.includes("반드시 더하라는 뜻은 아니다"));
});

Deno.test("coding-agent/guides#R12: 결과 안내는 완료 주장·preview·실제 test result·release 준비·activation·문제 닫힘을 구별하고 미실행과 한계를 보고하게 한다", async () => {
  for (const name of ["lophn-build-app", "lophn-repair"]) {
    const body = await bodyOf(name);
    for (
      const term of [
        "완료 주장",
        "preview",
        "실제 test result",
        "release 준비",
        "activation",
        "문제 닫힘",
        "미실행",
        "한계",
      ]
    ) {
      assert(body.includes(term), `${name}: ${term}`);
    }
  }
});

Deno.test("coding-agent/guides#R22: 지정한 ticket만 claim하고 목록과 summary는 착수 지시가 아니며 지정 ticket을 다시 고르라고 묻지 않는다", async () => {
  for (const name of ["lophn-navigate", "lophn-build-app", "lophn-repair"]) {
    const body = await bodyOf(name);
    assert(
      body.includes("착수 지시가 아니다") || body.includes("claim하지 않는다"),
      name,
    );
  }
  for (const name of ["lophn-build-app", "lophn-repair"]) {
    const body = await bodyOf(name);
    assert(body.includes("지정된 ticket만 claim한다"), name);
    assert(body.includes("착수 지시가 아니다"), name);
    assert(
      body.includes("다시 묻지 않는다") ||
        body.includes("다시 고르라고 묻지 않는다"),
      name,
    );
    assert(body.includes("lophn_session"), name);
  }
  assert(MCP_SESSION_TOOLS.some((tool) => tool.name === "lophn_session"));
});

Deno.test("coding-agent/guides#R26: 수리 조사는 접수·당시 계약·invocation·증거와 누락·가설·변경안·재현과 검증·결론 제안 순서로 사실과 해석을 나눈다", async () => {
  const body = await bodyOf("lophn-repair");
  assert(body.includes("(references/investigation.md)"));
  const text = await referenceOf("lophn-repair", "references/investigation.md");
  inOrder(text, [
    "접수 내용",
    "당시 계약",
    "invocation",
    "증거와 누락",
    "원인 가설",
    "변경안",
    "재현과 검증",
    "결론 제안",
  ]);
  assert(text.includes("사실") && text.includes("해석"));
  // 별도의 수리 시도 상태를 만들지 않는다.
  assert(text.includes("별도의 수리 시도 상태를 만들지 않는다"));
  assertEquals(text.includes("record_attempt"), false);
});
