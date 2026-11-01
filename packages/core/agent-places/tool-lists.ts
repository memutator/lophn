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
  "lophn",
  "call",
  "reply",
  "cancel",
  "session.list",
  "ask",
  "skill.read",
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

// home에는 작업 domain이 없어 kind 조회·검사를 실행할 수 없다.
const KIND_TOOL_NAMES = ["kind.list", "kind.check"] as const;

// place 종류가 더하는 tool이다. 정의가 전역이라 agent.create·agent.update는 셋 다 받는다.
const PLACE_TOOLS = {
  home: ["app.create", ...APP_TOOL_NAMES],
  project: [...WORK_TOOLS, ...KIND_TOOL_NAMES, "domain.create"],
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

// place 종류 고정 목록 = 공통 + 읽기 + agent 정의 tool + place 종류 몫. 명령(`lophn` tool로 부르는 job 등)은 여기 없고
// 명령 표의 place 종류 칸이 정한다.
// image.read를 vision 없는 model에서 빼는 일은 이 목록이 아니라 core registry가 한다.
export function placeToolNames(kind: PlaceKind): readonly string[] {
  return [
    ...COMMON_TOOLS,
    ...READ_TOOLS,
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
  "lophn",
] as const;
