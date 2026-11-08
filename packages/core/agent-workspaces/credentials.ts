import {
  agentCallSendable,
  agentList,
  WORKSPACE_KINDS,
  type WorkspaceKind,
  recordRewindWrite,
  stageRewindFile,
} from "../../protocol/lophn-agent/mod.ts";
import { projectApi } from "../../protocol/projects/mod.ts";
import { annotationsGet } from "../../protocol/apps/annotation.ts";
import { appGet, appList } from "../../protocol/apps/mod.ts";
import {
  appToolIndex,
  appTools,
} from "../../protocol/apps/declaration/read.ts";
import { appUsage } from "../../protocol/apps/usage.ts";
import { packagesList } from "../../protocol/apps/mod.ts";
import { commandsForWorkspace } from "../../cli/commands/mod.ts";
import { AGENT_BASE_OPERATIONS } from "../lophn-agent/run-loop/mod.ts";
import {
  runOperations,
  selectTools,
  type ToolDefinition,
} from "../lophn-agent/tools/mod.ts";
import { workspaceToolNames } from "../../protocol/lophn-agent/tool-lists.ts";

// prompt의 workspace 정보(project·앱·부를 수 있는 agent)를 읽는 route의 operation이다. turn의 agent
// 자격으로 읽으므로 모든 workspace 종류의 상한에 읽기로만 더한다. 어느 대상을 보는지는 core가 credential의 scope로 정한다.
// `workspace/workspace-data.ts`가 읽는 route와 같아야 한다.
const WORKSPACE_READS: readonly string[] = [
  projectApi.get.name,
  projectApi.list.name,
  appGet.name,
  appList.name,
  appTools.name,
  // lophn의 앱 목록: 공개 tool, 사용 관계, 앱이 주인인 package 목록. 사용 관계는 lophn session만 받는다.
  appToolIndex.name,
  appUsage.name,
  packagesList.name,
  agentCallSendable.name,
  // 아직 session이 없는 상대도 부를 수 있는 목록의 후보(agent 목록).
  agentList.name,
];

const REWIND_WRITE_TOOLS: readonly string[] = [
  "file.write",
  "file.edit",
  "agent.memory",
];

function isWorkspaceKind(kind: string): kind is WorkspaceKind {
  return (WORKSPACE_KINDS as readonly string[]).includes(kind);
}

// workspace 종류가 닿을 수 있는 operation의 상한. workspace 종류가 고정한 tool 목록이 부르는 route와 보조 operation이다.
// runtime은 turn마다 이 안에서 agent credential을 청하고, core는 같은 상한으로 요청을 대조한다.
export function workspaceOperations(
  kind: string,
  definitions: readonly ToolDefinition[],
): readonly string[] {
  if (!isWorkspaceKind(kind)) return [];
  const tools = selectTools(
    workspaceToolNames(kind),
    {
      input_media: ["image"],
    },
    definitions,
  );
  return [
    ...new Set([
      ...runOperations(tools),
      // `lophn` tool이 그 workspace 종류에서 부를 수 있는 명령의 route다. 명령이 정의한 route만 더해 binary 전용 명령의 route는 닿지 않는다.
      ...commandsForWorkspace(kind).flatMap((command) =>
        command.routes.map((route) => route.name),
      ),
      // 쓰는 tool(file.write, file.edit, agent.memory)이 쓰기 전후에 core에 pre-image를 남기는 route다.
      ...(tools.some((tool) => REWIND_WRITE_TOOLS.includes(tool.name))
        ? [stageRewindFile.name, recordRewindWrite.name]
        : []),
      ...WORKSPACE_READS,
      // image.read가 annotation screenshot 경로를 읽는다. workspace 종류만으로는 그릇 id를 알 수 없어 범위는
      // 읽기 쪽이 자격의 app·project 조건으로 닫는다(둘 다 없으면 forbidden).
      ...(kind === "app" || kind === "project" ? [annotationsGet.name] : []),
      ...AGENT_BASE_OPERATIONS,
    ]),
  ];
}

// harness가 자기 shell에서 부르는 `lophn` CLI의 상한이다. 그 workspace 종류의 `lophn` 명령이 정의한 route뿐이다:
// harness가 쓰는 file·shell은 harness 자신의 도구라 lophn의 tool route(file, rewind, gate)가 닿을 이유가 없다.
export function harnessOperations(kind: string): readonly string[] {
  if (!isWorkspaceKind(kind)) return [];
  return [
    ...new Set(
      commandsForWorkspace(kind).flatMap((command) =>
        command.routes.map((route) => route.name),
      ),
    ),
  ];
}

// agent credential의 고정 조건이다. session과 turn에 묶인다. app workspace는 그 앱을 `app` 조건으로 고정한다: 다른 앱·project와
// 그 앱이 아닌 release·앱 log·invocation 같은 자료는 요청 범위 밖이라 없는 자료와 같은 답이다. project workspace는 그 project를
// `project` 조건으로 고정한다(annotation 읽기가 이 조건을 읽는다). home은 조건이 없다. 앱 호출을 해도 되는지는
// Gate와 agent 할당이 가른다.
export function agentConditions(input: {
  session: string;
  turn: string;
  process: string;
  workspace: { kind: string; id: string } | null;
}): {
  session: string;
  turn: string;
  process: string;
  app?: string;
  project?: string;
} {
  const base = {
    session: input.session,
    turn: input.turn,
    process: input.process,
  };
  if (input.workspace?.kind === "app") {
    return { ...base, app: input.workspace.id };
  }
  if (input.workspace?.kind === "project") {
    return { ...base, project: input.workspace.id };
  }
  return base;
}
