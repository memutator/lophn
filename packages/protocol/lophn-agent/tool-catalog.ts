import type { Role } from "./places.ts";

// agent 내장 tool의 이름 목록과 이름 규칙이다. 입력 schema는 tool 정의가 자기 옆에 둔다.
// 정본 이름은 `<자원>.<동사>`이고 call, reply, cancel, ask만 한 단어다.
// 효과(read, write, external)는 여기 없다. core registry와 Gate에만 있다.
// 앱 app-api tool과 외부 MCP tool은 이름이 동적이라 접두사와 길이 상수만 둔다.

export const TOOL_NAME_MAX = 64;
export const WIRE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const APP_API_TOOL_PREFIX = "app__"; // app__<앱>__<api>
export const MCP_TOOL_PREFIX = "mcp__"; // mcp__<server>__<tool>

// 정본 `context.get`은 model에 `context_get`으로 보낸다. provider API가 `.`을 받지 않기 때문이다.
// 거꾸로 찾기는 core registry 표가 한다. 이름을 parse하지 않는다.
export function toWireToolName(canonical: string): string {
  return canonical.replaceAll(".", "_");
}

const COMMON_TOOLS = [
  "file.read",
  "file.glob",
  "file.grep",
  "pdf.read",
  "image.read",
  "web.search",
  "web.fetch",
  "call",
  "reply",
  "cancel",
  "session.list",
  "ask",
  "skill.read",
] as const;

// lophn을 뺀 세 role이 갖는다.
const WORK_TOOLS = ["file.write", "file.edit", "shell.run"] as const;

// 읽기 tool은 모든 role이 갖는다.
const READ_TOOLS = [
  "ticket.list",
  "ticket.get",
  "problem.list",
  "problem.get",
  "app.list",
  "app.get",
  "blueprint.check",
  "package.list",
  "package.get",
  "release.list",
  "release.get",
  "context.list",
  "context.get",
  "context.search",
  "context.test",
  "context.violations",
  "guide.read",
  "settings.get",
  "visual.show",
] as const;

// lophn만. 나머지 role은 project 지침을 prompt로 받는다.
const LOPHN_ONLY_READ_TOOLS = ["instructions.read"] as const;

const ROLE_WRITE_TOOLS = {
  lophn: ["app.create"],
  app_engineer: [
    "ticket.create",
    "ticket.update",
    "ticket.verify",
    "ticket.cancel",
    "problem.set_state",
    "app.link_source",
    "package.publish",
    "operator.create",
    "operator.update",
  ],
  operator: [],
  project_manager: [
    "context.draft",
    "context.submit",
    "glossary.set",
    "operator.create",
    "operator.update",
  ],
} as const satisfies Record<Role, readonly string[]>;

// role 고정 목록 = 공통 + 읽기 + (lophn이면 지침 읽기, 아니면 작업 tool) + role 쓰기.
// image.read를 vision 없는 model에서 빼는 일은 이 목록이 아니라 core registry가 한다.
export function builtinToolNames(role: Role): readonly string[] {
  return [
    ...COMMON_TOOLS,
    ...READ_TOOLS,
    ...(role === "lophn" ? LOPHN_ONLY_READ_TOOLS : WORK_TOOLS),
    ...ROLE_WRITE_TOOLS[role],
  ];
}

// model에 보이는 tool 순서다. 순서가 바뀌면 같은 재료가 같은 bytes가 아니게 된다.
export const TOOL_ORDER = [
  "file.read",
  "file.write",
  "file.edit",
  "file.glob",
  "file.grep",
  "pdf.read",
  "image.read",
  "shell.run",
  "web.search",
  "web.fetch",
  "call",
  "reply",
  "cancel",
  "session.list",
  "ask",
  "skill.read",
  "ticket.list",
  "ticket.get",
  "ticket.create",
  "ticket.update",
  "ticket.verify",
  "ticket.cancel",
  "problem.list",
  "problem.get",
  "problem.set_state",
  "app.list",
  "app.get",
  "app.create",
  "app.link_source",
  "blueprint.check",
  "package.list",
  "package.get",
  "package.publish",
  "release.list",
  "release.get",
  "context.list",
  "context.get",
  "context.search",
  "context.draft",
  "context.test",
  "context.submit",
  "context.violations",
  "glossary.set",
  "guide.read",
  "settings.get",
  "visual.show",
  "instructions.read",
  "operator.create",
  "operator.update",
] as const;
