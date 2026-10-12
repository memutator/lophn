import { assert, assertEquals } from "@std/assert";
import type { AgentRole } from "@lophn/protocol/lophn-agent";
import {
  APP_COMMAND_EXPOSURE,
  type AppCommandExposure,
  DOCUMENT_READ_TOOLS,
  ROLE_CAPS,
  type RoleCap,
} from "../../agents/mod.ts";

const ROLES: readonly AgentRole[] = [
  "lophn",
  "app_engineer",
  "context_engineer",
  "operator",
];

function capOf(role: AgentRole): RoleCap {
  const cap = ROLE_CAPS.get(role);
  assert(cap !== undefined, `role cap is fixed for ${role}`);
  return cap;
}

function exposureOf(role: AgentRole): AppCommandExposure {
  const exposure = APP_COMMAND_EXPOSURE.get(role);
  assert(exposure !== undefined, `app command exposure is fixed for ${role}`);
  return exposure;
}

function namesStartWith(
  tools: readonly string[],
  prefixes: readonly string[],
): string[] {
  return tools.filter((tool) =>
    prefixes.some((prefix) => tool.startsWith(prefix))
  );
}

Deno.test("lophn-agent/roles/common#R1: no role has code, shell or arbitrary file tools", () => {
  for (const role of ROLES) {
    const outside = namesStartWith(capOf(role).tools, [
      "code",
      "shell",
      "bash",
      "exec",
      "file",
      "read_file",
      "write_file",
      "run_command",
    ]);
    assertEquals(outside, [], `${role} has code/shell/file tools`);
  }
});

Deno.test("lophn-agent/roles/common#R2: no role starts subagents or coding agents", () => {
  for (const role of ROLES) {
    const outside = namesStartWith(capOf(role).tools, [
      "subagent",
      "coding_agent",
      "session.start",
      "task.claim",
      "task.start",
      "task.complete",
    ]);
    assertEquals(outside, [], `${role} starts subagent or coding agent`);
  }
});

Deno.test("lophn-agent/roles/common#R3: no role has web, URL or browser tools", () => {
  for (const role of ROLES) {
    const outside = namesStartWith(capOf(role).tools, [
      "web",
      "fetch",
      "url",
      "browser",
      "http",
    ]);
    assertEquals(outside, [], `${role} has web/URL/browser tools`);
  }
});

Deno.test("lophn-agent/roles/common#R4: common read tool selection is fixed per role", () => {
  // 문서 읽기 묶음은 네 역할 공통이다(R4).
  for (const tool of DOCUMENT_READ_TOOLS) {
    for (const role of ROLES) {
      assert(
        capOf(role).tools.includes(tool),
        `${role} has common document read tool ${tool}`,
      );
    }
  }
});

Deno.test("lophn-agent/roles/common#R5: MCP and skill choices are preset items and direct source, app DB, secret reads are absent", () => {
  // 확장 선택은 상한 항목이 아니라 preset의 선택 항목이다(R5). MCP·skill tool
  // 이름은 상한에 두지 않는다.
  for (const role of ROLES) {
    const cap = capOf(role).tools;
    assertEquals(
      cap.filter((tool) => tool.startsWith("mcp")),
      [],
      `${role} fixes MCP choices in the cap`,
    );
    assertEquals(
      cap.filter((tool) => tool.startsWith("skill")),
      [],
      `${role} fixes skill choices in the cap`,
    );
  }
  // 소스·앱 업무 DB·secret 직접 읽기도 상한 어디에도 없다(R5).
  for (const role of ROLES) {
    const outside = namesStartWith(capOf(role).tools, [
      "secret",
      "source",
      "disk",
      "db",
      "sqlite",
    ]);
    assertEquals(outside, [], `${role} has direct source/DB/secret reads`);
  }
});

Deno.test("lophn-agent/roles/common#R11: app command exposure rules are fixed per role", () => {
  // lophn은 사람이 agent 사용을 허락한 앱의 read·write·external command다(R11).
  const lophn = exposureOf("lophn");
  assertEquals(lophn.effects, ["read", "write", "external"]);
  assertEquals(lophn.undo_write_only, false);
  assertEquals(lophn.execution, "permitted_apps");
  assertEquals(lophn.ask, true);
  // App Engineer는 담당 앱 하나의 read와 되돌리기를 지원하는 write다(R11).
  const ae = exposureOf("app_engineer");
  assertEquals(ae.effects, ["read", "write"]);
  assertEquals(ae.undo_write_only, true);
  assertEquals(ae.execution, "assigned_app");
  assertEquals(ae.ask, true);
  // Operator는 assignment에 승인된 read만이다(R11).
  const op = exposureOf("operator");
  assertEquals(op.effects, ["read"]);
  assertEquals(op.undo_write_only, false);
  assertEquals(op.execution, "approved_reads");
  assertEquals(op.ask, false);
  // Context Engineer는 실행 없이 목록·설명 조회로 한정한다(R11).
  const ce = exposureOf("context_engineer");
  assertEquals(ce.effects, []);
  assertEquals(ce.execution, "none");
  // 노출 상한 밖 tool은 상한 어디에도 없다. AE의 상한은 read 조회만이고
  // Operator의 상한은 approved read 호출과 metadata다(R11).
  const aeCap = capOf("app_engineer").tools;
  assert(aeCap.includes("app.read"));
  assert(aeCap.includes("app.commands"));
  const opCap = capOf("operator").tools;
  assert(opCap.includes("app.call_read_command"));
  assert(opCap.includes("app.command_metadata"));
  assertEquals(capOf("context_engineer").tools.includes("app.call"), false);
  assertEquals(capOf("context_engineer").tools.includes("app.read"), false);
});

Deno.test("lophn-agent/roles/common#R12: visual blocks do not widen write or command scope", () => {
  // 시각 tool은 읽기·보이기이고 문서 쓰기 대상이나 command 범위를 넓히지 않는다
  // (R12). CE의 시각 tool은 보이기만이고 command 실행이 없다.
  const ce = capOf("context_engineer").tools;
  assert(ce.includes("visual.show"));
  assert(ce.includes("visual.read"));
  assertEquals(namesStartWith(ce, ["app.call"]).length, 0);
  // Operator는 문서 승인 output 저장만이고 앱 command는 approved read뿐이다(R12).
  const op = capOf("operator").tools;
  assert(op.includes("document.save_version"));
  assertEquals(op.includes("document.create"), false);
  assertEquals(namesStartWith(op, ["app.call_write"]).length, 0);
});

Deno.test("lophn-agent/roles/common#R13: instruction file write tools are absent", () => {
  // 지침 파일과 그 version·preset 연결은 question 제안과 사람 편집 경로만 쓴다
  // (R13). 어느 role에도 지침 쓰기 tool이 없다.
  for (const role of ROLES) {
    const cap = capOf(role).tools;
    const instructionTools = cap.filter((tool) =>
      tool.startsWith("instruction") || tool.startsWith("guide.write") ||
      tool.startsWith("lophn.md")
    );
    assertEquals(instructionTools, [], `${role} has instruction write tools`);
  }
});

Deno.test("lophn-agent/roles/common#R8: judgment and organizing purposes are distinct model selections", () => {
  // 판 용도 구별은 preset의 model·organizing_model 두 선택 항목이다(R8). 상한은
  // model 이름을 고정하지 않는다.
  for (const role of ROLES) {
    const cap = capOf(role).tools;
    const modelTools = cap.filter((tool) =>
      tool.startsWith("model.") || tool.startsWith("claude") ||
      tool.startsWith("gpt")
    );
    assertEquals(modelTools, [], `${role} fixes model names in the cap`);
  }
});

Deno.test("lophn-agent/roles/common#R9: sums, due times and format checks need no model", () => {
  // 합계·다음 예정 시각·format 검사는 결정적 계산이다(R9). 상한은 model 호출
  // tool을 두지 않는다.
  for (const role of ROLES) {
    const cap = capOf(role).tools;
    assert(
      !cap.includes("summarize") && !cap.includes("compress"),
      `${role} routes deterministic sums through a model`,
    );
  }
  // format 검사 동작은 네 역할 상한에 있다(R9).
  for (const role of ROLES) {
    assert(
      capOf(role).tools.includes("format.validate"),
      `${role} validates format without a model`,
    );
  }
});
