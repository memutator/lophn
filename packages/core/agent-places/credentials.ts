import {
  agentCallSendable,
  agentList,
  PLACE_KINDS,
  type PlaceKind,
  recordRewindWrite,
  stageRewindFile,
} from "../../protocol/lophn-agent/mod.ts";
import { projectApi } from "../../protocol/projects/mod.ts";
import { domainGet, domainList } from "../../protocol/domains/mod.ts";
import { annotationsGet } from "../../protocol/apps/annotation.ts";
import { appGet, appList } from "../../protocol/apps/mod.ts";
import {
  appToolIndex,
  appTools,
} from "../../protocol/apps/declaration/read.ts";
import { appUsage } from "../../protocol/apps/usage.ts";
import { packagesList } from "../../protocol/apps/mod.ts";
import { commandsForPlace } from "../../cli/commands/mod.ts";
import { AGENT_BASE_OPERATIONS } from "../lophn-agent/run-loop/mod.ts";
import {
  runOperations,
  selectTools,
  type ToolDefinition,
} from "../lophn-agent/tools/mod.ts";
import { placeToolNames } from "./tool-lists.ts";

// prompt의 place 정보(project·앱·부를 수 있는 agent)를 읽는 route의 operation이다. turn의 agent
// 자격으로 읽으므로 모든 place 종류의 상한에 읽기로만 더한다. 어느 대상을 보는지는 core가 credential의 scope로 정한다.
// `place/place-data.ts`가 읽는 route와 같아야 한다.
const PLACE_READS: readonly string[] = [
  domainList.name,
  domainGet.name,
  projectApi.get.name,
  projectApi.list.name,
  appGet.name,
  appList.name,
  appTools.name,
  // lophn의 domain 지도: 공개 tool, 사용 관계, 앱이 주인인 package 목록. 사용 관계는 lophn session만 받는다.
  appToolIndex.name,
  appUsage.name,
  packagesList.name,
  agentCallSendable.name,
  // 아직 session이 없는 상대도 부를 수 있는 목록의 후보(agent 목록).
  agentList.name,
];

const REWIND_WRITE_TOOLS: readonly string[] = ["file.write", "file.edit"];

function isPlaceKind(kind: string): kind is PlaceKind {
  return (PLACE_KINDS as readonly string[]).includes(kind);
}

// place 종류가 닿을 수 있는 operation의 상한. place 종류가 고정한 tool 목록이 부르는 route와 보조 operation이다.
// runtime은 turn마다 이 안에서 agent credential을 청하고, core는 같은 상한으로 요청을 대조한다.
export function placeOperations(
  kind: string,
  definitions: readonly ToolDefinition[],
): readonly string[] {
  if (!isPlaceKind(kind)) return [];
  const tools = selectTools(
    placeToolNames(kind),
    {
      input_media: ["image"],
    },
    definitions,
  );
  return [
    ...new Set([
      ...runOperations(tools),
      // `lophn` tool이 그 place 종류에서 부를 수 있는 명령의 route다. 명령이 정의한 route만 더해 binary 전용 명령의 route는 닿지 않는다.
      ...commandsForPlace(kind).flatMap((command) =>
        command.routes.map((route) => route.name),
      ),
      // 쓰는 tool(file.write, file.edit)이 쓰기 전후에 core에 pre-image를 남기는 route다.
      ...(tools.some((tool) => REWIND_WRITE_TOOLS.includes(tool.name))
        ? [stageRewindFile.name, recordRewindWrite.name]
        : []),
      ...PLACE_READS,
      // image.read가 annotation screenshot 경로를 읽는다. place 종류만으로는 그릇 id를 알 수 없어 범위는
      // 읽기 쪽이 자격의 app·project 조건으로 닫는다(둘 다 없으면 forbidden).
      ...(kind === "app" || kind === "project" ? [annotationsGet.name] : []),
      ...AGENT_BASE_OPERATIONS,
    ]),
  ];
}

// agent credential의 고정 조건이다. session과 turn에 묶인다. app place는 그 앱을 `app` 조건으로 고정한다: 다른 앱·project와
// 그 앱이 아닌 release·앱 log·invocation 같은 자료는 요청 범위 밖이라 없는 자료와 같은 답이다. project place는 그 project를
// `project` 조건으로 고정한다(kind·annotation 읽기와 domain 범위가 이 조건을 읽는다). home은 조건이 없다. 앱 호출을 해도 되는지는
// Gate와 agent 할당이 가른다.
export function agentConditions(input: {
  session: string;
  turn: string;
  process: string;
  place: { kind: string; id: string } | null;
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
  if (input.place?.kind === "app") {
    return { ...base, app: input.place.id };
  }
  if (input.place?.kind === "project") {
    return { ...base, project: input.place.id };
  }
  return base;
}
