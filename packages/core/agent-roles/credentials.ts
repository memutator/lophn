import {
  agentDefinitionList,
  callSendable,
  recordRewindWrite,
  type Role,
  ROLES,
  stageRewindFile,
} from "../../protocol/lophn-agent/mod.ts";
import {
  contextContractRoute,
  contextGetRoute,
  contextListRoute,
  glossaryListRoute,
  projectApi,
} from "../../protocol/projects/mod.ts";
import { agentGrantsGet } from "../../protocol/approvals/mod.ts";
import { annotationsGet } from "../../protocol/apps/annotation.ts";
import { appGet, appList } from "../../protocol/apps/mod.ts";
import { appAppApi } from "../../protocol/apps/blueprint/read.ts";
import { AGENT_BASE_OPERATIONS } from "../lophn-agent/run-loop/mod.ts";
import {
  runOperations,
  selectTools,
  type ToolDefinition,
} from "../lophn-agent/tools/mod.ts";
import { builtinToolNames } from "./tool-lists.ts";

// prompt의 place 정보(project·앱·context 글·부를 수 있는 agent)를 읽는 route의 operation이다. turn의 agent
// 자격으로 읽으므로 모든 역할의 상한에 읽기로만 더한다. 어느 대상을 보는지는 core가 credential의 scope로 정한다.
// `place/place-data.ts`가 읽는 route와 같아야 한다.
const PLACE_READS: readonly string[] = [
  contextListRoute.name,
  contextGetRoute.name,
  contextContractRoute.name,
  glossaryListRoute.name,
  projectApi.get.name,
  projectApi.list.name,
  appGet.name,
  appList.name,
  appAppApi.name,
  callSendable.name,
  // 아직 session이 없는 상대도 부를 수 있는 목록: 후보(Operator 정의)와 자기 grant의 excluded 줄.
  agentDefinitionList.name,
  agentGrantsGet.name,
];

const REWIND_WRITE_TOOLS: readonly string[] = ["file.write", "file.edit"];

function isRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

// 역할이 닿을 수 있는 operation의 상한. 역할이 고정한 tool 목록이 부르는 route와 보조 operation이다.
// runtime은 turn마다 이 안에서 agent credential을 청하고, core는 같은 상한으로 요청을 대조한다.
export function roleOperations(
  role: string,
  definitions: readonly ToolDefinition[],
): readonly string[] {
  if (!isRole(role)) return [];
  const tools = selectTools(builtinToolNames(role), {
    input_media: ["image"],
  }, definitions);
  return [
    ...new Set([
      ...runOperations(tools),
      // 쓰는 tool(file.write, file.edit)이 쓰기 전후에 core에 pre-image를 남기는 route다.
      ...(tools.some((tool) => REWIND_WRITE_TOOLS.includes(tool.name))
        ? [stageRewindFile.name, recordRewindWrite.name]
        : []),
      ...PLACE_READS,
      // image.read가 annotation screenshot 경로를 읽는다. 앱 범위는 App Engineer 자격의 app 조건이 정하므로
      // 앱에 묶이지 않는 다른 역할에는 주지 않는다.
      ...(role === "app_engineer" ? [annotationsGet.name] : []),
      ...AGENT_BASE_OPERATIONS,
    ]),
  ];
}

// agent credential의 고정 조건이다. session과 turn에 묶인다. App Engineer는 담당 앱 하나에 묶이므로 그 앱을
// `app` 조건으로 고정한다: 다른 앱·project와 담당 앱이 아닌 문제·ticket 같은 자료는 요청 범위 밖이라 없는 자료와
// 같은 답이다. 다른 역할은 앱 조건이 없다. 앱 호출을 해도 되는지는 Gate와 agent grant가 가른다.
export function agentConditions(input: {
  session: string;
  turn: string;
  process: string;
  role: string;
  place: { kind: string; id: string } | null;
}): {
  session: string;
  turn: string;
  process: string;
  app?: string;
} {
  const base = {
    session: input.session,
    turn: input.turn,
    process: input.process,
  };
  if (input.role !== "app_engineer" || input.place?.kind !== "app") return base;
  return { ...base, app: input.place.id };
}
