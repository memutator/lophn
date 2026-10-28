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
  "workflow.list",
  "workflow.get",
  "workflow.report",
  "workflow.edit",
] as const;

// 작업 tool은 home이 빼고 project·app이 갖는다.
const WORK_TOOLS = ["file.write", "file.edit", "shell.run"] as const;

// 읽기 tool은 세 place 종류가 모두 갖는다.
const READ_TOOLS = [
  "app.list",
  "app.get",
  "declaration.check",
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

// home만. project·app은 project 지침을 prompt로 받는다.
const LOPHN_ONLY_READ_TOOLS = ["instructions.read"] as const;

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

// place 종류가 더하는 tool이다. 정의가 전역이라 agent.create·agent.update는 셋 다 받는다.
const PLACE_TOOLS = {
  home: [...LOPHN_ONLY_READ_TOOLS, "app.create", ...APP_TOOL_NAMES],
  project: [...WORK_TOOLS, "domain.create", "workflow.check"],
  app: [
    ...WORK_TOOLS,
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
  "declaration.check",
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
