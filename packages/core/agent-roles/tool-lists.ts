import type { Role } from "../../protocol/lophn-agent/mod.ts";

// role이 보는 내장 tool의 이름 목록과 model에 보이는 순서다. 정의는 각 tool file이 갖는다.

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

// 모든 앱의 app-api 목록은 사람이 lophn과 App Engineer로만 좁혔다.
const APP_API_TOOLS = ["app.app_api"] as const;

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
    ...(role === "lophn" || role === "app_engineer" ? APP_API_TOOLS : []),
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
  "app.app_api",
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
