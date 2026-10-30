import type { PlaceKind } from "../../protocol/lophn-agent/mod.ts";

// place 종류가 보는 내장 tool의 이름 목록과 model에 보이는 순서다. 정의는 각 tool file이 갖는다.

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
  "tool.load",
  "tool.call",
  "workflow.list",
  "workflow.get",
  "workflow.report",
  "workflow.edit",
] as const;

// 작업 tool은 home이 빼고 project·app이 갖는다.
const WORK_TOOLS = ["file.write", "file.edit", "shell.run"] as const;

// 읽기 tool은 세 place 종류가 모두 갖는다.
const READ_TOOLS = [
  "app.read",
  "declaration.check",
  "package.read",
  "release.list",
  "release.get",
  "domain.read",
  "settings.get",
  "visual.show",
] as const;

// 모든 앱의 tool 목록은 사람이 home과 app 종류로만 좁혔다. 앱 상태·log·invocation 읽기도 앱을 진단하는
// home과 app 종류만 갖는다.
const APP_TOOL_NAMES = [
  "app.tools",
  "app.status",
  "app.logs",
  "app.invocations",
] as const;

// job tool은 세 place 종류가 모두 받는다.
const JOB_TOOL_NAMES = [
  "job.create",
  "job.update",
  "job.delete",
  "job.list",
] as const;

// home에는 작업 domain이 없어 kind 조회·검사를 실행할 수 없다.
const KIND_TOOL_NAMES = ["kind.list", "kind.check"] as const;

// place 종류가 더하는 tool이다. 정의가 전역이라 agent.create·agent.update는 셋 다 받는다.
const PLACE_TOOLS = {
  home: ["app.create", ...APP_TOOL_NAMES],
  project: [
    ...WORK_TOOLS,
    ...KIND_TOOL_NAMES,
    "domain.create",
    "workflow.check",
  ],
  app: [
    ...WORK_TOOLS,
    ...KIND_TOOL_NAMES,
    ...APP_TOOL_NAMES,
    "app.link_source",
    "package.publish",
    "release.prepare",
    "release.activate",
    "preview.start",
    "preview.call",
    "preview.stop",
    "domain.create",
  ],
} as const satisfies Record<PlaceKind, readonly string[]>;

// place 종류 고정 목록 = 공통 + 읽기 + job + agent 정의 tool + place 종류 몫.
// image.read를 vision 없는 model에서 빼는 일은 이 목록이 아니라 core registry가 한다.
export function placeToolNames(kind: PlaceKind): readonly string[] {
  return [
    ...COMMON_TOOLS,
    ...READ_TOOLS,
    ...JOB_TOOL_NAMES,
    "agent.create",
    "agent.update",
    ...PLACE_TOOLS[kind],
  ];
}

// 첫 요청부터 정의를 싣는 tool이다. 처음부터 쓰는 작업·질문·협업·완료 보고와 tool 발견만 둔다. place 목록의 나머지와
// 앱·MCP tool은 tool.load 설명에 이름과 짧은 안내만 싣고, 정의는 tool.load가 읽는다. 목록 밖 이름은 무시된다:
// 이 정책은 보이는 방식만 정하고 쓸 수 있는 tool은 위 place 목록과 할당이 정한다.
const EXPOSED_COMMON = [
  "file.read",
  "file.glob",
  "file.grep",
  "file.outline",
  "image.read",
  "web.search",
  "web.fetch",
  "ask",
  "call",
  "reply",
  "cancel",
  "workflow.report",
  "skill.read",
  "tool.load",
  "tool.call",
] as const;

const EXPOSED = {
  home: [...EXPOSED_COMMON, "app.read", "app.tools"],
  project: [...EXPOSED_COMMON, ...WORK_TOOLS, "kind.list"],
  app: [...EXPOSED_COMMON, ...WORK_TOOLS, "kind.list"],
} as const satisfies Record<PlaceKind, readonly string[]>;

export function exposedToolNames(kind: PlaceKind): readonly string[] {
  return EXPOSED[kind];
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
  "tool.load",
  "tool.call",
  "app.read",
  "app.tools",
  "app.status",
  "app.logs",
  "app.invocations",
  "domain.read",
  "domain.create",
  "app.create",
  "app.link_source",
  "declaration.check",
  "package.read",
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
  "agent.create",
  "agent.update",
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
