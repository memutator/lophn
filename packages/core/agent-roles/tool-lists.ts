import type { Role } from "../../protocol/lophn-agent/mod.ts";

// role이 보는 내장 tool의 이름 목록과 model에 보이는 순서다. 정의는 각 tool file이 갖는다.

const COMMON_TOOLS = [
  "file.read",
  "file.glob",
  "file.grep",
  "file.outline",
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
  "workflow.list",
  "workflow.get",
  "workflow.report",
  "workflow.edit",
] as const;

// lophn을 뺀 세 role이 갖는다.
const WORK_TOOLS = ["file.write", "file.edit", "shell.run"] as const;

// 읽기 tool은 모든 role이 갖는다.
const READ_TOOLS = [
  "app.list",
  "app.get",
  "blueprint.check",
  "package.list",
  "package.get",
  "release.list",
  "release.get",
  "kind.list",
  "kind.check",
  "domain.list",
  "domain.get",
  "settings.get",
  "visual.show",
] as const;

// lophn만. 나머지 role은 project 지침을 prompt로 받는다.
const LOPHN_ONLY_READ_TOOLS = ["instructions.read"] as const;

// 모든 앱의 tool 목록은 사람이 lophn과 App Engineer로만 좁혔다. 앱 상태·log·invocation 읽기도 앱을 진단하는
// lophn과 App Engineer만 갖는다.
const APP_TOOL_NAMES = [
  "app.tools",
  "app.status",
  "app.logs",
  "app.invocations",
] as const;

// Operator는 job이 부르는 쪽이라 job tool을 받지 않는다.
const JOB_TOOL_NAMES = [
  "job.create",
  "job.update",
  "job.delete",
  "job.list",
] as const;

const ROLE_WRITE_TOOLS = {
  lophn: ["app.create"],
  app_engineer: [
    "app.link_source",
    "package.publish",
    "release.prepare",
    "release.activate",
    "preview.start",
    "preview.call",
    "preview.stop",
    "operator.create",
    "operator.update",
    "domain.create",
  ],
  operator: [],
  project_manager: [
    "operator.create",
    "operator.update",
    "domain.create",
    "workflow.check",
  ],
} as const satisfies Record<Role, readonly string[]>;

// role 고정 목록 = 공통 + 읽기 + (lophn이면 지침 읽기, 아니면 작업 tool) + role 쓰기.
// image.read를 vision 없는 model에서 빼는 일은 이 목록이 아니라 core registry가 한다.
export function builtinToolNames(role: Role): readonly string[] {
  return [
    ...COMMON_TOOLS,
    ...READ_TOOLS,
    ...(role === "lophn" ? LOPHN_ONLY_READ_TOOLS : WORK_TOOLS),
    ...(role === "lophn" || role === "app_engineer" ? APP_TOOL_NAMES : []),
    ...(role === "operator" ? [] : JOB_TOOL_NAMES),
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
  "file.outline",
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
  "app.list",
  "app.get",
  "app.tools",
  "app.status",
  "app.logs",
  "app.invocations",
  "domain.list",
  "domain.get",
  "domain.create",
  "app.create",
  "app.link_source",
  "blueprint.check",
  "package.list",
  "package.get",
  "package.publish",
  "release.list",
  "release.get",
  "release.prepare",
  "release.activate",
  "preview.start",
  "preview.call",
  "preview.stop",
  "kind.list",
  "kind.check",
  "settings.get",
  "visual.show",
  "instructions.read",
  "operator.create",
  "operator.update",
  "workflow.list",
  "workflow.get",
  "workflow.report",
  "workflow.edit",
  "workflow.check",
  "job.create",
  "job.update",
  "job.delete",
  "job.list",
] as const;
