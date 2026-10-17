import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { declareSetting } from "../../protocol/config/mod.ts";
import { createFileSettingsReader } from "../config/mod.ts";
import type { KindLaunchSpec } from "../../protocol/supervision/mod.ts";
import { type ReadDefinition, type Tx } from "../../protocol/server/mod.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  turnAdmission,
} from "../storage/ledger/mod.ts";
import {
  finishRewindSummary,
  instructionPreview,
  instructionsGet,
  readRewindSummary,
  recordRewindWrite,
  requestRewindSummary,
  stageRewindFile,
  takeRewindSummaryRequest,
} from "../../protocol/lophn-agent/mod.ts";
import {
  askAnswer,
  askRead,
  askWait,
} from "../../protocol/lophn-agent/ask-tool.ts";
import { eraseBlobRefs } from "../storage/blobs/mod.ts";
import {
  createModelCommands,
  createModelReads,
  type ModelCommandDeps,
  modelSchemaSteps,
  snapshotCatalogEntry,
  snapshotModelListed,
} from "./models/mod.ts";
import { GLOBAL_SCOPE, loadChoice } from "./models/store.ts";
import {
  createProviderCommands,
  createProviderDefinitionsRead,
  createProviderReads,
  createProviderSecretRefSource,
  providerSchemaSteps,
} from "./providers/mod.ts";
import {
  createUsageCommands,
  createUsageReads,
  deleteSessionModelCalls,
  modelCallBodyFields,
  usageSchemaSteps,
} from "./usage/mod.ts";
import {
  COMMIT_END_DEPS,
  openDepsOf,
  type OperatorDirectory,
  type OperatorInfo,
  UNWIRED_END_DEPS,
} from "./places/mod.ts";
import {
  type AgentDeps,
  type AgentFileSystem,
  type AgentLookups,
  createAgentCommands,
  createAgentReads,
  listOperators,
  loadAgent,
  nameOf,
  openAgentContext,
  type PlaceLookups,
  type ProfileAssetDeps,
  type ProfileFileHandler,
  profileImageFileHandler,
  type ProfileImageFiles,
  profileImageUploadHandler,
  type ProfileReaders,
  type ProfileUploadHandler,
} from "./agents/mod.ts";
import {
  createTurnCommands,
  createTurnReads,
  deleteSessionTurns,
  interruptRunningTurns,
  publishAfterCommit,
  turnBodyFields,
  turnBodyRead,
  turnBodyViewRead,
  turnLimitSettings,
  turnSchemaSteps,
} from "./run-loop/mod.ts";
import {
  callSignals,
  failReceivedCalls,
  messageDirectory,
  messageRouter,
} from "../router/mod.ts";
import { createCommandReads, type RoleCommands } from "./commands/mod.ts";
import {
  conversationSchemaSteps,
  createConversationCommands,
  createConversationReads,
  type MessageBodyEnvironment,
  messageBodyFields,
  messageBodyRead,
  removeQueuedCommand,
  sessionSummaryRead,
  takeSteering,
} from "./session/mod.ts";
import { createTraceReads } from "./observability/mod.ts";
import {
  createRewindEffects,
  createSessionRewindCommands,
  createSessionRewindReads,
  revertSchemaSteps,
} from "./session/rewind/mod.ts";
import {
  createToolCommands,
  createToolReads,
  deleteSessionToolCalls,
  toolCallBodyFields,
  toolsSchemaSteps,
} from "./tools/mod.ts";
import {
  type AgentRef,
  mcpAuthBegin,
  mcpAuthCancel,
  mcpAuthComplete,
  mcpAuthRequestDone,
  mcpAuthRequestTake,
  mcpAuthState,
  type McpServer,
  mcpToolsList,
  mcpToolsRequestDone,
  mcpToolsRequestTake,
  type Place,
  profileImageRead,
  profileImageUpload,
} from "../../protocol/lophn-agent/mod.ts";
import {
  BUNDLED_SKILLS_ROOT,
  commandSkillsOf,
  createExtensionRegistry,
  createProjectExtensionCommands,
  createProjectExtensionReads,
  createSkillsRead,
  dataRootOf,
  type ExtensionRegistry,
  listSkillsSync,
  type McpRuntimeServer,
  type PlaceFiles,
  type SkillSources,
  type SyncSkillFiles,
} from "./extensions/mod.ts";
import type { Loaded } from "./agents/inspect.ts";
import { agentRuntimePermissions } from "./tools/runtime-permissions.ts";
import {
  createMcpSecretRefSource,
  extensionSettings,
  globalMcpServersSetting,
  skillFoldersSetting,
  skillsOffSetting,
} from "./extensions/mod.ts";

// agent runtime 등록 뼈대. 권한 목록은 `agentRuntimePermissions`가 계산한다.
// host·skill·MCP를 등록하면 core가 목록을 바꿔 재기동한다.
export function agentRuntimeLaunchSpec(input: {
  dataRoot: string;
  apiPort: number;
  // supervisor가 앱 direct socket을 두는 폴더(`appSocketRoot`). socket 경로는 그 폴더와 같다.
  socketRoot: string;
  // 등록된 MCP server 설정이다(settings registry의 행).
  mcpServers?: readonly McpRuntimeServer[];
  // 사람이 등록한 provider의 목적지(`host:port`). 등록되면 core가 이 목록을 바꿔 재기동한다.
  hosts?: readonly string[];
  // 사람이 등록한 skill 폴더다. 읽기 허락에 더하고 등록이 바뀌면 core가 다시 띄운다.
  skillRoots?: readonly string[];
  // file tool과 shell이 닿는 place 폴더들(절대 경로)이다. 쓰기 폴더는 읽기 폴더 안에 있다.
  placeFolders: { read: readonly string[]; write: readonly string[] };
}): KindLaunchSpec {
  const permissions = agentRuntimePermissions({
    ...input,
    bundledSkillRoots: [BUNDLED_SKILLS_ROOT],
  });
  return {
    kind: "lophn-agent/runtime",
    entry: new URL("../main/agent-runtime/main.ts", import.meta.url).pathname,
    ...permissions,
    allow_sys: [],
    policy: "always",
    memory_limit_bytes: 512 * 1024 * 1024,
  };
}

// catalog 자동 갱신 on/off. 사람이 끄면 정상본·snapshot만 쓴다. 다음 기동부터 적용한다.
const catalogAutoUpdateSetting = declareSetting({
  key: "lophn-agent.model.catalog_auto_update",
  type: z.boolean(),
  default: true,
});

// 이 module이 선언하는 설정 전부다. 조립이 settingDeclarations로 모은다.
export const lophnAgentSettings = [
  catalogAutoUpdateSetting,
  ...extensionSettings,
  ...Object.values(turnLimitSettings),
];

// derived catalog read는 model leaf의 read 정의로 reader worker 등록에 붙는다.
// pool read handler는 동기 Result를 돌려주므로 파일 읽기도
// 동기여야 하는데, core module graph의 동기 file API는 platform/responsiveness
// 검사가 막는다. 그래서 정의는 leaf의 createCatalogRead에 두고 파일 reader는
// 조립이 끼운다. reader가 없으면 read는 unavailable이다. apiRead 경로는 snapshot을
// 받지 않아 as_of_seq를 만들 수 없어 pool read로 둔다.

// provider·credential ledger. 값은 OS keychain에만 있고 이곳에는 참조만 남는다.
// model 기본값과 model call 기록·사용량 읽기. 시작·마침·보완은 machine 전용이다.
const commands = createProviderCommands();
// 수정 입력의 처음 반영은 ModelCall 시작과 같은 transaction이다.
const usage = createUsageCommands({
  applyMessages: takeSteering,
});
const reads = createProviderReads();
const usageReads = createUsageReads();

// provider 기록의 provider 정의 key다(providers 표 definition_key). 기록이 없으면 undefined로
// fail-closed다.
function providerDefinitionKey(
  sql: Pick<Tx["sql"], "get">,
  provider: string,
): string | undefined {
  try {
    const row = sql.get(
      "select definition_key from providers where id = ?",
      [provider],
    );
    const key = row === undefined ? undefined : row["definition_key"];
    return typeof key === "string" && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

// model 기본값 저장 검사 deps. 목록과 catalog는 동봉 snapshot에서 읽는다.
function modelCommandDeps(places: PlaceLookups, tx: Tx): ModelCommandDeps {
  return {
    projectExists: (id) => places.projectExists(tx.sql, id),
    definitionKey: (provider) => providerDefinitionKey(tx.sql, provider),
    modelListed: (providerDefinition, modelName) =>
      snapshotModelListed(providerDefinition, modelName),
    catalogEntry: (providerDefinition, modelName) =>
      snapshotCatalogEntry(providerDefinition, modelName),
  };
}

// turn ledger. 접수·시작·checkpoint·종료는 machine,
// 멈춤은 사람과 machine, 다음 일 확인은 사람이다. 미반영 steering 판정은
// 입력 표를 소유한 conversation의 messages 표를 같은 Tx에서 읽는다.
const turnCommands = createTurnCommands({
  publish: publishAfterCommit,
  calls: callSignals,
});
const turnReads = createTurnReads();

// DeleteSession이 같은 Tx에서 지우는 그 세션의 turn 기록이다. turn을 가리키는 표마다
// 소유 concern이 지움을 내고 여기에 가리키는 쪽부터 놓는다: approval request, tool call, model 호출, 마지막으로 turn. 본문 참조는 소유 행보다
// 먼저 지워야 소유 ID를 찾는다. 문서·release·앱 변경은 이 목록에 없어 그대로 남는다.
function deleteSessionRecords(tx: Tx, session: string): Result<void> {
  const steps: (() => Result<void>)[] = [
    () => deleteSessionToolCalls(tx, session, eraseBlobRefs),
    () => deleteSessionModelCalls(tx, session, eraseBlobRefs),
    () => deleteSessionTurns(tx, session, eraseBlobRefs),
  ];
  for (const step of steps) {
    const erased = step();
    if (!erased.ok) return erased;
  }
  return ok(undefined);
}

// 세션과 메시지. 사람 입력 접수는 담당 turn 접수와 한
// transaction이므로 run-loop의 StartTurn handler를 같은 Tx에서 부른다. StartTurn은
// machine 전용 기록이라 이 접수에 한해 machine 자격으로 바꿔 넘기고, 입력은 항상
// message 출처의 turn이다. 바깥 command의 actor·event 기록은 그대로다.
const conversationCommands = createConversationCommands({
  // Router와 session 목록은 wiring이 놓는다. 놓기 전에는 사람 메시지를 받지 못한다.
  send: { router: messageRouter, directory: messageDirectory },
  deleteSessionRecords,
  eraseBlobRefs,
  // project와 앱, Operator 정의는 wiring이 놓는다(places/environment.ts). 놓기 전에는 새 session을 열지 못한다.
  // SessionStarted는 commit 뒤에 Bus로 간다.
  open: openDepsOf,
  // 도는 turn은 session이 끝나는 같은 Tx에서 닫는다. 입력함 비우기와 Bus event는 commit 뒤에 main thread가 한다.
  end: {
    ...UNWIRED_END_DEPS,
    ...COMMIT_END_DEPS,
    effects: { ...UNWIRED_END_DEPS.effects, failReceivedCalls },
    interruptRunningTurns: (tx, session) => {
      const done = interruptRunningTurns(
        tx,
        publishAfterCommit,
        "session_ended",
        session,
      );
      return done.ok ? ok(undefined) : done;
    },
  },
});
const conversationReads = createConversationReads();

// session 되돌리기. file tool의 쓰기 기록(RecordRewindFile), Rewind, 설치 정정
// (AmendRevertInstall), 앱 rewind 요청 결과(RecordRewindApps)를 올린다. checkpoint는 메시지를 접수하는 Tx가,
// 기록 지움은 DeleteSession이 같은 Tx에서 한다. 파일 관측·준비·설치와 앱 rewind 요청은 ledger transaction
// 밖의 일이라 command는 받은 준비로 판정만 한다. 그 흐름은 writer queue 앞 처리기(rewind/files.ts)가 잇는다.
// 대기 중인 권한 요청과 질문의 취소는 session을 끝낼 때와 같은 port다.
const revertDeps = {
  effects: createRewindEffects({
    cancelPendingRequests: UNWIRED_END_DEPS.effects.cancelPendingRequests,
  }),
};
const revertCommands = createSessionRewindCommands(revertDeps);
// 읽기는 파일을 읽는 preview 때문에 reader Worker의 별도 등록(rewind/reader.ts)이 서빙한다. 여기 정의는
// core의 route 등록이고 core에서는 실행되지 않는다.
const revertReads = createSessionRewindReads({});

// turn·session·독립 호출의 trace 조회. trace는 저장하지 않고
// 조회 때 turn·event·ModelCall·ToolCall·message 참조에서 조립한다. 쓰는 표가 없어 command·schema
// step이 없다.
const traceReads = createTraceReads();

// tool call ledger. 기록은 machine 전용이다. 입력·출력
// 원문은 blob 참조만 남긴다.
const toolCommands = createToolCommands();
const toolReads = createToolReads();

// agent 자격의 command(tool call 기록 같은)는 자격에 묶인 turn이 진행 중일 때만 통과한다
// (platform/ledger). 판정은 이 concern의 turns 표를 같은 Tx에서 읽는다. 없는 turn은
// unknown이고 끝난 turn은 감사 보완만 통과한다. 이 port가 없으면 agent command는 막힌다.
const turnAdmissionPort = defineTxPort(turnAdmission, (tx) => ({
  status: (turn: string) => {
    const row = tx.sql.get("select state from turns where id = ?", [turn]);
    if (row === undefined) return "unknown" as const;
    return row["state"] === "finished"
      ? "finished" as const
      : "active" as const;
  },
}));

// 설정 파일의 값을 읽는다. 읽지 못하면 기본값이다. data root는 ledger 파일이 있는 폴더다.
function settingsOf(sql: Pick<Tx["sql"], "get" | "all">) {
  const root = dataRootOf(sql, undefined);
  return root.ok ? createFileSettingsReader(root.value) : undefined;
}

// 전역(Workspace)에 등록된 외부 MCP server 전부다. 읽지 못하면 빈 목록이다.
function registeredMcpServers(
  sql: Pick<Tx["sql"], "get" | "all">,
): McpServer[] {
  return settingsOf(sql)?.get(globalMcpServersSetting) ?? [];
}

function registeredSkillFolders(sql: Pick<Tx["sql"], "get" | "all">): string[] {
  return settingsOf(sql)?.get(skillFoldersSetting) ?? [];
}

// 전역에서 끈 skill의 정확한 이름이다. 읽지 못하면 끈 것이 없다.
function registeredSkillsOff(sql: Pick<Tx["sql"], "get" | "all">): string[] {
  return settingsOf(sql)?.get(skillsOffSetting) ?? [];
}

// 전역 층의 skill 출처다: 사람이 등록한 폴더, data root의 개인 보관소, 설치 묶음의 동봉 폴더.
function globalSkillSources(
  sql: Pick<Tx["sql"], "get" | "all">,
): Omit<SkillSources, "project"> {
  const root = dataRootOf(sql, undefined);
  return {
    registered: registeredSkillFolders(sql),
    personal: root.ok ? `${root.value}/skills` : null,
    bundled: BUNDLED_SKILLS_ROOT,
  };
}

// 동기 file 읽기는 writer·reader Worker 안의 handler가 한다. core 프로세스의 module graph에는 동기 file API를
// 두지 않으므로 adapter는 이 module이 올라올 때 URL로 연다.
const NODE_EXTENSION_FILES = new URL(
  "./extensions/adapters/node-fs.ts",
  import.meta.url,
).href;
const { createNodePlaceFiles, createNodeSkillFiles } = await import(
  NODE_EXTENSION_FILES
) as {
  createNodePlaceFiles(): PlaceFiles;
  createNodeSkillFiles(): SyncSkillFiles;
};
const placeFiles = createNodePlaceFiles();
const skillFiles = createNodeSkillFiles();

// 한 읽기에서 쓰는 동기 등록부다: 전역 층에 그 자리 층을 더한 skill·MCP 목록을 준다. data root를
// 모르면 null이다.
function extensionRegistry(
  sql: Pick<Tx["sql"], "get" | "all">,
): ExtensionRegistry | null {
  const root = dataRootOf(sql, undefined);
  if (!root.ok) return null;
  return createExtensionRegistry({
    root: root.value,
    files: placeFiles,
    skillFiles,
    global: {
      servers: registeredMcpServers(sql),
      skills: globalSkillSources(sql),
      skillsOff: registeredSkillsOff(sql),
    },
  });
}

function placeExists(
  places: PlaceLookups,
  sql: Pick<Tx["sql"], "get" | "all">,
  place: Place,
): boolean {
  return place.kind === "project"
    ? places.projectExists(sql, place.id)
    : places.appExists(sql, place.id);
}

// agent 정의 저장소가 다른 concern에서 읽는 값이다. 읽기는 snapshot과 Tx가
// 같은 sql 모양이라 한 factory를 함께 쓴다. data root는 ledger 파일이 있는 폴더다.
function agentLookups(
  places: PlaceLookups,
  sql: Pick<Tx["sql"], "get" | "all">,
): AgentLookups {
  let registry: ExtensionRegistry | null | undefined;
  const registryOf = (): ExtensionRegistry | null => {
    if (registry === undefined) registry = extensionRegistry(sql);
    return registry;
  };
  return {
    placeExists: (place) => placeExists(places, sql, place),
    places: () => [
      ...places.projectIds(sql).map((id) => ({ kind: "project" as const, id })),
      ...places.appIds(sql).map((id) => ({ kind: "app" as const, id })),
    ],
    // context는 project 안에만 있다(documents/contexts). 만드는 중(drafting)인 context도 실제 context다.
    contextStatus: (id) => places.contextStatus(sql, id) ?? null,
    contextProject: (id) => places.contextProjectOf(sql, id),
    // project place는 그 project의 active context 전부이고 그 밖에는 없다.
    activeContexts: (place) =>
      place === null || place.kind !== "project"
        ? []
        : places.activeContextIds(sql, place.id),
    // 이 place의 agent가 쓸 수 있는 skill·MCP다: 전역 층에 project 층을 더한다. 한 읽기 안에서 같은
    // place는 같은 목록이다. lophn(place 없음)은 전역 층만이다.
    skills: (place) =>
      place === null
        ? globalSkillNames(sql)
        : registryOf()?.skills(place).entries.map((entry) => entry.name) ?? [],
    // agent 정의가 MCP tool을 고르지 않는다. 쓸 tool은 agent grant가 정한다.
    mcp: () => [],
    // 전역 기본 model.
    modelDefault: () => loadChoice(sql, GLOBAL_SCOPE),
  };
}

// 전역 층에서 발견하는 skill 이름이다. 전역에서 끈 것은 뺀다.
function globalSkillNames(sql: Pick<Tx["sql"], "get" | "all">): string[] {
  return listSkillsSync(
    skillFiles,
    { ...globalSkillSources(sql), project: null },
    { role: null, off: registeredSkillsOff(sql) },
  ).entries.filter((entry) => entry.enabled).map((entry) => entry.name);
}

// 정의 파일의 동기 읽기·쓰기는 writer·reader Worker 안의 handler가 한다. core 프로세스의 module graph에는
// 동기 file API를 두지 않으므로 adapter는 이 module이 올라올 때 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "./agents/adapters/node-fs.ts",
  import.meta.url,
).href;
const { createNodeAgentFiles, createNodeProfileImageFiles } = await import(
  NODE_AGENT_FILES
) as {
  createNodeAgentFiles(): AgentFileSystem;
  createNodeProfileImageFiles(): ProfileImageFiles;
};

// profile 이미지 바이트의 upload·file 처리기다. core.ts가 route 이름으로 붙인다. 자리·역할의 판정은
// runtime의 reader가 하고, 파일은 이 adapter로 core 프로세스에서 비동기로 읽고 쓴다.
export function agentProfileHandlers(
  readers: ProfileReaders,
  dataRoot: string,
): { upload: ProfileUploadHandler; file: ProfileFileHandler } {
  const deps: ProfileAssetDeps = {
    root: dataRoot,
    files: createNodeProfileImageFiles(),
    readers,
  };
  return {
    upload: profileImageUploadHandler(deps),
    file: profileImageFileHandler(deps),
  };
}

// ReadMessageBody는 ledger snapshot 없이 blob 바이트를 기다리는 core read다. core가 기동
// 때 environment로 읽기 통로를 넣고, 넣지 않은 등록(harness)은 unavailable이다.
const UNATTACHED_MESSAGE_BODY: MessageBodyEnvironment = {
  snapshot: () =>
    err({
      code: "unavailable",
      message: "message 읽기 통로가 붙어 있지 않다",
    }),
  bytes: () =>
    Promise.resolve(err({
      code: "unavailable",
      message: "blob 읽기 통로가 붙어 있지 않다",
    })),
};

// 사람이 turn 근거·tool 입력·tool 결과를 펼쳐 볼 때 지금의 redaction을 거치는 통로다. 알려진 secret 값은
// 기동 뒤에야 알려지므로 core가 늦게 채우는 함수로 준다. 붙이지 않은 등록은 끝내지 못한 것으로 답한다.
const UNATTACHED_REDACT = (): string | null => null;

// GetInstructions는 LOPHN.md와 agent 정의 본문을 파일에서 읽는 reader Worker의 read다. 동기 file API는 core module
// graph에 들일 수 없어 서빙은 instructions/files.ts의 reader 등록이 한다(core 조립이 reader module로 붙인다). 여기
// handler는 route를 registry에 올릴 뿐 실행되지 않는다.
function instructionsGetRoute(): ReadDefinition<typeof instructionsGet> {
  return {
    route: instructionsGet,
    handle() {
      return err({
        code: "unavailable" as const,
        message: "지침 읽기는 reader Worker가 서빙한다",
      });
    },
  };
}

// PreviewGlobalInstructions도 같은 reader Worker가 서빙한다(instruction-files.ts). 사람 화면의 읽기다.
function instructionPreviewRoute(): ReadDefinition<typeof instructionPreview> {
  return {
    route: instructionPreview,
    handle() {
      return err({
        code: "unavailable" as const,
        message: "지침 미리보기는 reader Worker가 서빙한다",
      });
    },
  };
}

export function createLedgerRegistration(
  environment: {
    messageBody?: MessageBodyEnvironment;
    redactBody?: (text: string) => string | null;
    // OAuth token 보관(core 조립이 만든다)이 가진 알려진 값 참조다. 없는 등록은 설정이 가리키는 참조만 읽는다.
    mcpOAuthRefs?: () => readonly { name: string; sealedRef: string }[];
  } = {},
) {
  return {
    apiReads: [
      messageBodyRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // Compact가 session에 이은 요약의 본문도 같은 읽기 통로로 읽는다.
      sessionSummaryRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // 저장된 turn basis·model 응답·tool 결과를 다시 읽는 같은 길이다(machine만).
      turnBodyRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // 사람 화면이 같은 본문을 지금의 redaction을 거쳐 읽는 길이다(user만).
      turnBodyViewRead({
        ...(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
        redact: environment.redactBody ?? UNATTACHED_REDACT,
      }),
      // 연결 가능 provider의 내장 정의는 ledger row가 아니라 동봉
      // product catalog다. snapshot이 없어도 답하므로 api read 길이다.
      createProviderDefinitionsRead(),
    ],
    // provider credential과 외부 MCP credential의 secret 값도 core의 알려진 값
    // registry에 등록·회수된다. MCP 참조는 extensions
    // secret-refs의 통로다(#294).
    secretRefs: [
      createProviderSecretRefSource(),
      createMcpSecretRefSource(environment.mcpOAuthRefs),
    ],
  };
}

// 다른 module의 표와 role 층의 값은 이 port로 받는다. core/main의 팀 file(wiring/lophn-agent-team.ts)이 꽂는다.
// 값은 모두 Worker 안에서 팀 file을 import할 때 만들어진다.
export type LophnAgentPorts = {
  lookups: PlaceLookups;
  roleCommands: RoleCommands;
  operatorPlaceAllowed: AgentDeps["operatorPlaceAllowed"];
};

// port에 묶인 command·read 정의와 reader 등록, Operator 조회를 만든다.
export function createLophnAgent(ports: LophnAgentPorts) {
  const modelCommands = createModelCommands((tx) =>
    modelCommandDeps(ports.lookups, tx)
  );
  const modelReads = createModelReads({
    projectExists: (sql, id) => ports.lookups.projectExists(sql, id),
  });
  const agentDeps: AgentDeps = {
    files: createNodeAgentFiles(),
    lookups: (sql) => agentLookups(ports.lookups, sql),
    operatorPlaceAllowed: ports.operatorPlaceAllowed,
  };
  const agentCommands = createAgentCommands(agentDeps);
  const agentReads = createAgentReads(agentDeps);

  // Operator 조회. session을 열 때와 Router의 session 목록이 읽는다. wiring이 places 환경에 끼운다.
  function operatorDirectory(
    sql: Pick<Tx["sql"], "get" | "all">,
  ): OperatorDirectory {
    const opened = openAgentContext(agentDeps, sql);
    const toInfo = (loaded: Loaded): OperatorInfo | null =>
      loaded.ref.role === "operator" && loaded.place !== null
        ? {
          id: loaded.ref.agent as OperatorInfo["id"],
          name: nameOf(loaded),
          place: loaded.place,
        }
        : null;
    return {
      operator(id) {
        if (!opened.ok) return null;
        const loaded = loadAgent(opened.value, {
          role: "operator",
          agent: id as never,
        });
        return loaded.ok && loaded.value !== null ? toInfo(loaded.value) : null;
      },
      operators() {
        if (!opened.ok) return [];
        const listed = listOperators(opened.value);
        return listed.ok
          ? listed.value.flatMap((loaded) => toInfo(loaded) ?? [])
          : [];
      },
    };
  }

  // skills·project extension 설정. project 층은 project의 lophn data 폴더 파일이다.
  const skillsReads = createSkillsRead({
    files: placeFiles,
    skillFiles,
    lookups: (sql) => ({
      skillSources: () => globalSkillSources(sql),
      skillsOff: () => registeredSkillsOff(sql),
      projectExists: (id) =>
        placeExists(ports.lookups, sql, { kind: "project", id }),
    }),
  });
  const projectExtensionDeps = {
    files: placeFiles,
    lookups: (sql: Pick<Tx["sql"], "get" | "all">) => ({
      projectExists: (id: string) =>
        placeExists(ports.lookups, sql, { kind: "project", id }),
    }),
  };
  const projectExtensionCommands = createProjectExtensionCommands(
    projectExtensionDeps,
  );
  const projectExtensionReads = createProjectExtensionReads(
    projectExtensionDeps,
  );

  // 그 agent 정의가 끈 skill 이름이다. 정의를 읽지 못하면 끈 것이 없다.
  function skillsOffOf(
    sql: Pick<Tx["sql"], "get" | "all">,
    agent: AgentRef,
  ): readonly string[] {
    const opened = openAgentContext(agentDeps, sql);
    if (!opened.ok) return [];
    const loaded = loadAgent(opened.value, agent);
    if (!loaded.ok || loaded.value === null) return [];
    return loaded.value.definition?.skills_off ?? [];
  }

  // `/` 명령 목록. 목록은 저장하지 않고 session의 agent에서 열 때마다 계산한다. skill은 그 session
  // place에서 그 agent가 쓸 수 있는 것이다: 전역 층에 project 층을 더하고, agent 정의가 끈 것은 selected=false다.
  // 내장 skill은 선언한 role의 메뉴에만 보인다.
  const commandReads = createCommandReads({
    roleCommands: ports.roleCommands,
    skills: (sql, session) =>
      commandSkillsOf(
        session.place === null
          ? listSkillsSync(
            skillFiles,
            { ...globalSkillSources(sql), project: null },
            { role: null, off: registeredSkillsOff(sql) },
          ).entries
          : extensionRegistry(sql)?.skills(session.place).entries ?? [],
        skillsOffOf(sql, session.agent),
        session.role,
      ),
  });

  const lophnAgentDefinitions = {
    schemaSteps: [
      ...providerSchemaSteps,
      ...modelSchemaSteps,
      ...usageSchemaSteps,
      ...turnSchemaSteps,
      ...conversationSchemaSteps,
      ...toolsSchemaSteps,
      ...revertSchemaSteps,
    ],
    commands: [
      commands.register,
      commands.disconnect,
      commands.refreshCredential,
      commands.recordAvailability,
      commands.beginLogin,
      commands.completeLogin,
      commands.cancelLogin,
      modelCommands.changeDefault,
      modelCommands.changeProject,
      modelCommands.changeFavorites,
      usage.start,
      usage.finish,
      usage.supplement,
      agentCommands.create,
      agentCommands.change,
      agentCommands.delete,
      agentCommands.changeBuiltin,
      projectExtensionCommands.change,
      turnCommands.start,
      turnCommands.checkpoint,
      turnCommands.finish,
      turnCommands.stop,
      conversationCommands.open,
      conversationCommands.rename,
      conversationCommands.archive,
      conversationCommands.delete,
      conversationCommands.changeModel,
      conversationCommands.fork,
      conversationCommands.requestCompact,
      conversationCommands.compact,
      conversationCommands.failCompact,
      conversationCommands.send,
      conversationCommands.record,
      removeQueuedCommand({ eraseBlobRefs }),
      toolCommands.request,
      toolCommands.decide,
      toolCommands.start,
      toolCommands.finish,
      toolCommands.recordRead,
      toolCommands.supplement,
      revertCommands.record,
      revertCommands.rewind,
      revertCommands.amend,
      revertCommands.apps,
    ],
    reads: [
      reads.read,
      reads.list,
      modelReads.modelDefault,
      modelReads.projectModel,
      modelReads.favorites,
      modelReads.catalog,
      usageReads.read,
      usageReads.list,
      usageReads.usage,
      agentReads.list,
      agentReads.read,
      skillsReads.read,
      projectExtensionReads.read,
      turnReads.read,
      turnReads.list,
      turnReads.result,
      conversationReads.session,
      conversationReads.sessions,
      conversationReads.messages,
      conversationReads.message,
      conversationReads.compactRequests,
      commandReads.list,
      toolReads.read,
      toolReads.list,
      traceReads.read,
      revertReads.preview,
      revertReads.checkpoints,
      revertReads.list,
      instructionsGetRoute(),
      instructionPreviewRoute(),
    ],
    // model.call 본문은 blob 참조만 남는다. tool call 입력·출력도 같은 종류다.
    // 메시지 본문은 영구 참조다.
    blobFields: [
      ...modelCallBodyFields,
      ...toolCallBodyFields,
      ...turnBodyFields,
      ...messageBodyFields,
    ],
    ports: [turnAdmissionPort],
    workers: [],
    // file tool의 쓰기 기록, "Summarize from here" 요청과 MCP OAuth 입구인 core 메모리 route다.
    memoryRoutes: [
      stageRewindFile,
      recordRewindWrite,
      requestRewindSummary,
      readRewindSummary,
      takeRewindSummaryRequest,
      finishRewindSummary,
      mcpAuthBegin,
      mcpAuthComplete,
      mcpAuthState,
      mcpAuthCancel,
      mcpAuthRequestTake,
      mcpAuthRequestDone,
      // Grants의 MCP tool 목록. handler는 wiring/lophn-agent-extensions.ts가 붙인다.
      mcpToolsList,
      mcpToolsRequestTake,
      mcpToolsRequestDone,
      // ask 대기와 사람의 답. handler는 wiring/approvals.ts가 붙인다.
      askWait,
      askRead,
      askAnswer,
    ],
    // profile 이미지의 바이트 입구(upload)와 읽기(file)다. 바이트를 붙이는 처리기는 core 조립(core.ts)이 route 이름으로 붙인다.
    uploadRoutes: [profileImageUpload],
    files: [profileImageRead],
    // MCP OAuth의 시작·완료·상태·취소 입구다. handler는 core 조립(packages/core/lophn-agent/register.ts)이
    // createMcpAuthControl(mcp-auth.ts)로 붙인다. route만 등록한다.
  };

  // reader Worker가 이 등록 파일에서 팀 read를 다시 조립한다. provider·model read는
  // event를 보지 않는다. usage·preset read도 event를 보지 않는다.
  function createReaderRegistration(): ReaderRegistration {
    return {
      reads: [
        reads.read,
        reads.list,
        modelReads.modelDefault,
        modelReads.projectModel,
        modelReads.favorites,
        modelReads.catalog,
        usageReads.read,
        usageReads.list,
        usageReads.usage,
        agentReads.list,
        agentReads.read,
        skillsReads.read,
        projectExtensionReads.read,
        turnReads.read,
        turnReads.list,
        turnReads.result,
        conversationReads.session,
        conversationReads.sessions,
        conversationReads.messages,
        conversationReads.message,
        conversationReads.compactRequests,
        commandReads.list,
        toolReads.read,
        toolReads.list,
        traceReads.read,
      ],
      ports: new Map(),
    };
  }

  return { lophnAgentDefinitions, createReaderRegistration, operatorDirectory };
}
