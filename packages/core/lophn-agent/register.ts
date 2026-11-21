import { fileURLToPath } from "node:url";
import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { declareSetting } from "../../protocol/config/mod.ts";
import {
  askAnswer,
  askRead,
  askWait,
} from "../../protocol/lophn-agent/ask-tool.ts";
import {
  agentProfileImageRead,
  agentProfileImageUpload,
  type AgentId,
  finishRewindSummary,
  instructionsGet,
  instructionsReadGlobal,
  instructionsWriteGlobal,
  issuerRequestDone,
  issuerRequestTake,
  type McpServer,
  mcpAuthBegin,
  mcpAuthCallback,
  mcpAuthCancel,
  mcpAuthComplete,
  mcpAuthState,
  mcpToolsList,
  mcpToolsRequestDone,
  mcpToolsRequestTake,
  messageImagePath,
  messageImagePrepare,
  messageImageRead,
  HARNESS_HOST_MEMORY_ROUTES,
  APP_CALL_ROUTES,
  SESSION_LIFECYCLE_ROUTES,
  messageImageUpload,
  providerConnectKey,
  providerConnectLocal,
  providerSignIn,
  providerSignInCallback,
  providerSignInState,
  type Workspace,
  workspaceKeyOf,
  workspaceKindOf,
  QUEUED_INPUT_ROUTES,
  readRewindSummary,
  recordRewindWrite,
  requestRewindSummary,
  stageRewindFile,
  takeRewindSummaryRequest,
} from "../../protocol/lophn-agent/mod.ts";
import { MAIL_ROUTES } from "../../protocol/lophn-agent/mail.ts";
import { type ReadDefinition, type Tx } from "../../protocol/server/mod.ts";
import type { KindLaunchSpec } from "../../protocol/supervision/mod.ts";
import { createFileSettingsReader } from "../config/mod.ts";
import {
  callSignals,
  failReceivedCall,
  failReceivedCalls,
  messageApp,
  messageDirectory,
  deleteAppCallsReceivedBy,
  messageRouter,
} from "../router/mod.ts";
import { eraseBlobRefs } from "../storage/blobs/mod.ts";
import {
  defineTxPort,
  type ReaderRegistration,
  turnAdmission,
} from "../storage/ledger/mod.ts";
import {
  type AgentDeps,
  type AgentFileSystem,
  type AgentLookups,
  createAgentCommands,
  createAgentReads,
  listAgents,
  loadAgent,
  openAgentContext,
  type WorkspaceLookups,
  type ProfileAssetDeps,
  type ProfileFileHandler,
  type ProfileImageFiles,
  type ProfileReaders,
  type ProfileUploadHandler,
  profileImageFileHandler,
  profileImageUploadHandler,
} from "./agents/mod.ts";
import { createCommandReads } from "./commands/mod.ts";
import type { AgentMcpEntry } from "./extensions/mcp-snapshot.ts";
import {
  commandSkillsOf,
  createExtensionRegistry,
  createProjectExtensionCommands,
  createProjectExtensionReads,
  createSkillsRead,
  dataRootOf,
  type ExtensionRegistry,
  extensionSettings,
  globalMcpServersSetting,
  type WorkspaceFiles,
  type ProjectLayer,
  readSharedHeads,
  runtimeServerOfLayer,
  sharedFor,
  type SkillFiles,
  type SkillSources,
  skillFoldersSetting,
  skillsOffSetting,
} from "./extensions/mod.ts";
import {
  type MessageImageDeps,
  type MessageImageFiles,
  messageImageFileHandler,
  messageImagePathHandler,
  messageImagePrepareHandler,
  messageImageUploadHandler,
} from "./message-images.ts";
import { CATALOG_AUTO_UPDATE_KEY } from "./models/catalog-refresh.ts";
import {
  bundledSnapshot,
  catalogBase,
  checkEntryOf,
  createModelCommands,
  createModelReads,
  type ModelCommandDeps,
  modelSchemaSteps,
} from "./models/mod.ts";
import { GLOBAL_SCOPE, loadChoice } from "./models/store.ts";
import { createTraceReads } from "./observability/mod.ts";
import {
  COMMIT_END_DEPS,
  openDepsOf,
  UNWIRED_END_DEPS,
} from "./workspaces/mod.ts";
import {
  createProviderCommands,
  createProviderDefinitionsRead,
  createProviderReads,
  providerSchemaSteps,
} from "./providers/mod.ts";
import {
  createTurnCommands,
  createTurnReads,
  deleteSessionTurns,
  interruptRunningTurns,
  interruptTurnsCommand,
  publishAfterCommit,
  turnBodyFields,
  turnBodyRead,
  turnBodyViewRead,
  turnLimitSettings,
  turnSchemaSteps,
} from "./run-loop/mod.ts";
import {
  conversationSchemaSteps,
  createConversationCommands,
  createConversationReads,
  editQueuedCommand,
  type MessageBodyEnvironment,
  messageBodyFields,
  messageBodyRead,
  messageSearchRead,
  moveQueuedCommand,
  removeQueuedCommand,
  sessionStatusReadDefinition,
  sessionSummaryRead,
  takeSteering,
} from "./session/mod.ts";
import {
  createRewindEffects,
  createSessionRewindCommands,
  createSessionRewindReads,
  revertSchemaSteps,
} from "./session/rewind/mod.ts";
import { createFileTools } from "./tools/bundles/file.ts";
import { SHELL_TOOLS } from "./tools/bundles/shell.ts";
import { WEB_TOOLS } from "./tools/bundles/web.ts";
import {
  createToolCommands,
  createToolReads,
  deleteSessionToolCalls,
  type ToolDefinition,
  toolCallBodyFields,
  toolCallListRead,
  toolsSchemaSteps,
} from "./tools/mod.ts";
import type { FileHooks } from "./tools/ports.ts";
import {
  createUsageCommands,
  createUsageReads,
  deleteSessionModelCalls,
  modelCallBodyFields,
  usageSchemaSteps,
} from "./usage/mod.ts";

// agent runtime 등록 뼈대. child는 lophn 자신의 process라 권한 flag 없이 돈다. 권한은 경계가 아니다
// (shell.run이 사용자 uid로 /bin/sh를 띄워 우회된다). file tool이 닿는 폴더는 `workspaceScope`와
// `resolveInWorkspace`가 지킨다.
export function agentRuntimeLaunchSpec(): KindLaunchSpec {
  return {
    kind: "lophn-agent/runtime",
    entry: fileURLToPath(
      new URL("../main/agent-runtime/main.ts", import.meta.url),
    ),
    policy: "always",
    memory_limit_bytes: 512 * 1024 * 1024,
  };
}

// catalog 자동 갱신 on/off. 사람이 끄면 정상본·snapshot만 쓴다. 다음 기동부터 적용한다.
const catalogAutoUpdateSetting = declareSetting({
  key: CATALOG_AUTO_UPDATE_KEY,
  type: z.boolean(),
  default: true,
  description:
    "Refresh the model catalog (model names, prices, limits) automatically. When off lophn uses the bundled catalog. Applies from the next start.",
});

// 이 module이 선언하는 설정 전부다. 조립이 settingDeclarations로 모은다.
export const lophnAgentSettings = [
  catalogAutoUpdateSetting,
  ...extensionSettings,
  ...Object.values(turnLimitSettings),
];

// provider·credential ledger. 값은 `secrets.json`에만 있고 이곳에는 이름만 남는다.
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
    const row = sql.get("select definition_key from providers where id = ?", [
      provider,
    ]);
    const key = row === undefined ? undefined : row["definition_key"];
    return typeof key === "string" && key.length > 0 ? key : undefined;
  } catch {
    return undefined;
  }
}

// derived catalog 파일의 동기 reader다. ledger 파일이 있는 폴더가 data root다.
function readDerived(
  sql: Pick<Tx["sql"], "get" | "all">,
  name: string,
): string | null {
  const root = dataRootOf(sql, undefined);
  if (!root.ok) return null;
  return createNodeAgentFiles().read(
    `${root.value}/derived/lophn-agent/${name}`,
  );
}

// 저장 검사가 보는 catalog. 화면이 읽는 catalog(ReadModelCatalog)와 같은 바탕이다.
function checkCatalog(tx: Tx) {
  return catalogBase({ readDerived, snapshot: bundledSnapshot }, tx.sql)
    .catalog;
}

// model 기본값 저장 검사 deps. 항목은 사람이 적은 정보(user 층)와 derived catalog에서 읽는다.
function modelCommandDeps(
  workspaces: WorkspaceLookups,
  tx: Tx,
): ModelCommandDeps {
  const base = checkCatalog(tx);
  return {
    workspaceExists: (workspace) =>
      workspaceExists(workspaces, tx.sql, workspace),
    definitionKey: (provider) => providerDefinitionKey(tx.sql, provider),
    catalogEntry: (providerDefinition, modelName) =>
      checkEntryOf(tx.sql, base, providerDefinition, modelName),
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
// 소유 concern이 지움을 내고 여기에 가리키는 쪽부터 놓는다: tool call, model 호출, 마지막으로 turn. 본문 참조는 소유 행보다
// 먼저 지워야 소유 ID를 찾는다. 문서·release·앱 변경은 이 목록에 없어 그대로 남는다.
function deleteSessionRecords(tx: Tx, session: string): Result<void> {
  const steps: (() => Result<void>)[] = [
    () => deleteSessionToolCalls(tx, session, eraseBlobRefs),
    () => deleteSessionModelCalls(tx, session, eraseBlobRefs),
    () => deleteSessionTurns(tx, session, eraseBlobRefs),
    // 앱이 받은 답 글은 받은 session의 기록과 함께 간다.
    () => deleteAppCallsReceivedBy(tx, session),
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
  send: {
    router: messageRouter,
    directory: { find: messageDirectory.find, app: messageApp },
    publish: publishAfterCommit,
  },
  deleteSessionRecords,
  catalog: checkCatalog,
  eraseBlobRefs,
  // project와 앱, agent 정의는 wiring이 놓는다(workspaces/environment.ts). 놓기 전에는 새 session을 열지 못한다.
  // SessionStarted는 commit 뒤에 Bus로 간다.
  open: openDepsOf,
  failCall: failReceivedCall,
  // 도는 turn은 session이 끝나는 같은 Tx에서 닫는다. queue 비우기와 Bus event는 commit 뒤에 main thread가 한다.
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
// 창 한도는 저장 검사와 같은 catalog 바탕에서 읽는다.
const sessionStatusRead = sessionStatusReadDefinition({
  catalog: (sql) =>
    catalogBase({ readDerived, snapshot: bundledSnapshot }, sql).catalog,
});

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
// 읽기는 파일을 읽는 preview 때문에 reader Worker의 별도 등록이 서빙한다: checkpoints·list는 rewind/reader.ts,
// preview는 AppWrites port와 같은 등록인 main의 wiring/rewind-registration.ts다. 여기 정의는
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

// 사람 화면의 tool 줄 제목을 만들 내장 정의다. core는 tool을 실행하지 않고 `display`만 읽으므로 hook은
// 부르지 않는 자리를 넘긴다. 다른 module의 tool과 앱·MCP tool은 display가 없어 표에 없어도 같은
// fallback(other, tool 이름)이다.
const CORE_FILE_HOOKS: FileHooks = {
  aroundWrite: () =>
    Promise.resolve(
      err({ code: "unavailable", message: "core does not run file tools" }),
    ),
};
const displayTools: ReadonlyMap<string, ToolDefinition> = new Map(
  [...createFileTools(CORE_FILE_HOOKS), ...SHELL_TOOLS, ...WEB_TOOLS].map(
    (definition) => [definition.name, definition],
  ),
);

// agent 자격의 command(tool call 기록 같은)는 자격에 묶인 turn이 진행 중일 때만 통과한다
// (platform/ledger). 판정은 이 concern의 turns 표를 같은 Tx에서 읽는다. 없는 turn은
// unknown이고 끝난 turn은 감사 보완만 통과한다. 이 port가 없으면 agent command는 막힌다.
const turnAdmissionPort = defineTxPort(turnAdmission, (tx) => ({
  status: (turn: string) => {
    const row = tx.sql.get("select state from turns where id = ?", [turn]);
    if (row === undefined) return "unknown" as const;
    return row["state"] === "finished"
      ? ("finished" as const)
      : ("active" as const);
  },
}));

// 설정 파일의 값을 읽는다. 읽지 못하면 기본값이다. data root는 ledger 파일이 있는 폴더다.
function settingsOf(sql: Pick<Tx["sql"], "get" | "all">) {
  const root = dataRootOf(sql, undefined);
  return root.ok ? createFileSettingsReader(root.value) : undefined;
}

// 전역에 등록된 외부 MCP server 전부다. 읽지 못하면 빈 목록이다.
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

// workspace 층이 정하는 skill 자리와 workspace 그릇을 읽는 길이다. 조립이 넘긴다.
type SkillLayers = {
  projectLayer: ProjectLayer;
  bundledSkillsRoot: string;
  lookups: WorkspaceLookups;
};

// 전역 층의 skill 출처다: 사람이 등록한 폴더, data root의 개인 보관소, 설치 묶음의 동봉 폴더.
function globalSkillSources(
  sql: Pick<Tx["sql"], "get" | "all">,
  layers: SkillLayers,
): Omit<SkillSources, "workspaceData" | "workspace"> {
  const root = dataRootOf(sql, undefined);
  return {
    registered: registeredSkillFolders(sql),
    personal: root.ok ? `${root.value}/skills` : null,
    bundled: layers.bundledSkillsRoot,
  };
}

// 동기 file 읽기는 writer·reader Worker 안의 handler가 한다. core 프로세스의 module graph에는 동기 file API를
// 두지 않으므로 adapter는 이 module이 올라올 때 URL로 연다.
const NODE_EXTENSION_FILES = new URL(
  "./extensions/adapters/node-fs.ts",
  import.meta.url,
).href;
const { createNodeWorkspaceFiles, createNodeSkillFiles } = (await import(
  NODE_EXTENSION_FILES
)) as {
  createNodeWorkspaceFiles(): WorkspaceFiles;
  createNodeSkillFiles(): SkillFiles;
};
const workspaceFiles = createNodeWorkspaceFiles();
const skillFiles = createNodeSkillFiles();

// 한 읽기에서 쓰는 동기 등록부다: 전역 층에 그 자리 층을 더한 skill·MCP 목록을 준다. data root를
// 모르면 null이다.
function extensionRegistry(
  sql: Pick<Tx["sql"], "get" | "all">,
  layers: SkillLayers,
): ExtensionRegistry | null {
  const root = dataRootOf(sql, undefined);
  if (!root.ok) return null;
  return createExtensionRegistry({
    root: root.value,
    projectLayer: layers.projectLayer,
    files: workspaceFiles,
    skillFiles,
    sourceFolder: (workspace) => layers.lookups.sourceFolder(sql, workspace),
    global: {
      servers: registeredMcpServers(sql),
      skills: globalSkillSources(sql, layers),
      skillsOff: registeredSkillsOff(sql),
    },
  });
}

function workspaceExists(
  workspaces: WorkspaceLookups,
  sql: Pick<Tx["sql"], "get" | "all">,
  workspace: Workspace,
): boolean {
  return workspace.kind === "project"
    ? workspaces.projectExists(sql, workspace.id)
    : workspaces.appExists(sql, workspace.id);
}

// agent 정의 저장소가 다른 concern에서 읽는 값이다. 읽기는 snapshot과 Tx가
// 같은 sql 모양이라 한 factory를 함께 쓴다. data root는 ledger 파일이 있는 폴더다.
function agentLookups(
  workspaces: WorkspaceLookups,
  sql: Pick<Tx["sql"], "get" | "all">,
  layers: SkillLayers,
): AgentLookups {
  let registry: ExtensionRegistry | null | undefined;
  const registryOf = (): ExtensionRegistry | null => {
    if (registry === undefined) registry = extensionRegistry(sql, layers);
    return registry;
  };
  return {
    workspaces: () => [
      ...workspaces
        .projectIds(sql)
        .map(
          (id): Workspace => ({ kind: "project", id: id as `prj_${string}` }),
        ),
      ...workspaces
        .appIds(sql)
        .map((id): Workspace => ({ kind: "app", id: id as `app_${string}` })),
    ],
    workspaceExists: (workspace) => workspaceExists(workspaces, sql, workspace),
    workspaceArchived: (workspace) =>
      workspace.kind === "app" && workspaces.appArchived(sql, workspace.id),
    // 이 workspace(null은 Home)의 agent가 쓸 수 있는 skill·MCP다: 전역 층에 그릇 자리의 workspace-data 층을 더한다. 한 읽기
    // 안에서 같은 workspace는 같은 목록이다.
    skills: (workspace) =>
      registryOf()
        ?.skills(workspace, workspaceKindOf(workspace))
        .entries.filter((entry) => entry.enabled) ?? [],
    // agent 정의가 MCP tool을 고르지 않는다. 쓸 tool은 agent 할당과 설정한 층이 정한다.
    mcp: () => [],
    // 할당한 앱의 public skill. 이름만 필요한 개수 계산이 쓴다.
    shared: (apps) =>
      sharedHeadsOf(workspaces, sql, apps).map((head) => ({
        name: head.name,
        can_disable: true,
      })),
    sharedCommands: (apps, deny) => workspaces.sharedCommands(sql, apps, deny),
    modelInfo: (model) => {
      const row = sql.get(
        "select name, definition_key from providers where id = ?",
        [model.provider],
      );
      if (row === undefined) return null;
      const { name, definition_key: definition } = row;
      if (typeof name !== "string" || typeof definition !== "string") {
        return null;
      }
      const { catalog } = catalogBase(
        { readDerived, snapshot: bundledSnapshot },
        sql,
      );
      const entry = checkEntryOf(sql, catalog, definition, model.model_name);
      // 구간별 요율이 여러 개여도 첫 요율이 비용 계산이 쓰는 기준이다(usage/cost.ts).
      const rate = entry?.price_basis?.rates[0];
      return {
        provider: name,
        inputMedia: entry?.input_media ?? null,
        price:
          rate === undefined
            ? null
            : { input: rate.input, output: rate.output },
      };
    },
    // 전역 기본 model.
    modelDefault: () => loadChoice(sql, GLOBAL_SCOPE),
    workspaceModel: (workspace) => loadChoice(sql, workspaceKeyOf(workspace)),
  };
}

// 할당한 앱의 public skill 목록이다(slug 순, 같은 이름은 앞의 것). data root를 모르면 없다.
function sharedHeadsOf(
  workspaces: WorkspaceLookups,
  sql: Pick<Tx["sql"], "get" | "all">,
  apps: readonly string[],
  workspace: Workspace | null = null,
) {
  const root = dataRootOf(sql, undefined);
  if (!root.ok || apps.length === 0) return [];
  return sharedFor(
    readSharedHeads(skillFiles, workspaces.sharedSkills(sql, root.value, apps)),
    workspace,
  );
}

// 정의 파일의 동기 읽기·쓰기는 writer·reader Worker 안의 handler가 한다. core 프로세스의 module graph에는
// 동기 file API를 두지 않으므로 adapter는 이 module이 올라올 때 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "./agents/adapters/node-fs.ts",
  import.meta.url,
).href;
const {
  createNodeAgentFiles,
  createNodeMessageImageFiles,
  createNodeProfileImageFiles,
} = (await import(NODE_AGENT_FILES)) as {
  createNodeAgentFiles(): AgentFileSystem;
  createNodeMessageImageFiles(): MessageImageFiles;
  createNodeProfileImageFiles(): ProfileImageFiles;
};

// profile 이미지 바이트의 upload·file 처리기다. core.ts가 route 이름으로 붙인다. 자리의 판정은
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

// 메시지에 싣는 이미지의 upload·prepare·file·path 처리기다. core.ts가 route 이름으로 붙인다.
export function messageImageHandlers(
  dataRoot: string,
  access: Pick<MessageImageDeps, "relay" | "referenced">,
) {
  const deps: MessageImageDeps = {
    root: dataRoot,
    files: createNodeMessageImageFiles(),
    ...access,
  };
  return {
    upload: messageImageUploadHandler(deps),
    prepare: messageImagePrepareHandler(deps),
    file: messageImageFileHandler(deps),
    path: messageImagePathHandler(deps),
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
    Promise.resolve(
      err({
        code: "unavailable",
        message: "blob 읽기 통로가 붙어 있지 않다",
      }),
    ),
};

// 사람이 turn 근거·tool 입력·tool 결과를 펼쳐 볼 때 지금의 redaction을 거치는 통로다. 알려진 secret 값은
// 기동 뒤에야 알려지므로 core가 늦게 채우는 함수로 준다. 붙이지 않은 등록은 끝내지 못한 것으로 답한다.
const UNATTACHED_REDACT = (): string | null => null;

// GetInstructions는 LOPHN.md와 agent 정의 본문을 파일에서 읽는 reader Worker의 read다. 동기 file API는 core module
// graph에 들일 수 없어 서빙은 instructions/files.ts의 reader 등록이 한다(core 조립의 팀 file
// `main/daemon/wiring/instructions-registration.ts`가 project·앱 조회와 workspace 종류 규칙을 꽂아 reader module로 붙인다). 여기
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

export function createLedgerRegistration(
  environment: {
    messageBody?: MessageBodyEnvironment;
    redactBody?: (text: string) => string | null;
  } = {},
) {
  return {
    apiReads: [
      messageBodyRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // session popover의 메시지 글 찾기. 같은 blob 읽기 통로를 쓴다.
      messageSearchRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // Compact가 session에 이은 요약의 본문도 같은 읽기 통로로 읽는다.
      sessionSummaryRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // 저장된 turn basis·model 응답·tool 결과를 다시 읽는 같은 길이다(machine만).
      turnBodyRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // 사람 화면이 같은 본문을 지금의 redaction을 거쳐 읽는 길이다(user만).
      turnBodyViewRead({
        ...(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
        redact: environment.redactBody ?? UNATTACHED_REDACT,
      }),
      // tool 줄 제목도 body view와 같은 지금의 redaction으로 만든다. pool read가 아니라 여기서
      // 저장된 tool 입력 blob을 읽는다.
      toolCallListRead({
        ...(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
        redact: environment.redactBody ?? UNATTACHED_REDACT,
        definitionOf: (tool) => displayTools.get(tool),
      }),
      // 연결 가능 provider의 내장 정의는 ledger row가 아니라 동봉
      // product catalog다. snapshot이 없어도 답하므로 api read 길이다.
      createProviderDefinitionsRead(),
    ],
  };
}

// 다른 module의 표와 workspace 층의 값은 이 port로 받는다. core/main의 팀 file(wiring/lophn-agent-team.ts)이 꽂는다.
// 값은 모두 Worker 안에서 팀 file을 import할 때 만들어진다.
export type LophnAgentPorts = {
  lookups: WorkspaceLookups;
  // 설정 층 규칙(project 층의 자리)과 내장 skill 폴더다. workspace 층의 값이다.
  projectLayer: ProjectLayer;
  bundledSkillsRoot: string;
};

// port에 묶인 command·read 정의와 reader 등록, 정의를 여는 길을 만든다.
export function createLophnAgent(ports: LophnAgentPorts) {
  const modelCommands = createModelCommands((tx) =>
    modelCommandDeps(ports.lookups, tx),
  );
  const modelReads = createModelReads({
    workspaceExists: (sql, workspace) =>
      workspaceExists(ports.lookups, sql, workspace),
    readDerived,
  });
  const agentDeps: AgentDeps = {
    files: createNodeAgentFiles(),
    lookups: (sql) => agentLookups(ports.lookups, sql, ports),
  };
  const agentCommands = createAgentCommands(agentDeps);
  const agentReads = createAgentReads(agentDeps);

  // sql로 agent 정의를 읽는 길이다. wiring이 이것으로 agent 조회를 만들어 workspaces 환경에 끼운다.
  function openAgents(sql: Pick<Tx["sql"], "get" | "all">) {
    return openAgentContext(agentDeps, sql);
  }

  // 모든 agent 정의 층의 MCP 서버다. `mcp.` secret 목적지가 이 목록을 읽는다. 정의 파일이
  // 틀린 agent는 건너뛴다(project 층이 틀린 파일을 건너뛰는 것과 같다).
  function agentMcpServers(
    sql: Pick<Tx["sql"], "get" | "all">,
  ): Result<AgentMcpEntry[]> {
    const context = openAgents(sql);
    if (!context.ok) return context;
    const listed = listAgents(context.value);
    if (!listed.ok) return listed;
    const found: AgentMcpEntry[] = [];
    for (const loaded of listed.value) {
      const { definition } = loaded;
      if (loaded.issues.length > 0 || definition === null) {
        continue;
      }
      for (const server of definition.mcp_servers ?? []) {
        found.push({
          agent: loaded.agent,
          server: runtimeServerOfLayer(server, null, loaded.agent),
        });
      }
    }
    return ok(found);
  }

  // skills·project extension 설정. project 층은 project의 lophn data 폴더 파일이다.
  const skillsReads = createSkillsRead({
    projectLayer: ports.projectLayer,
    files: workspaceFiles,
    skillFiles,
    lookups: (sql) => ({
      skillSources: () => globalSkillSources(sql, ports),
      skillsOff: () => registeredSkillsOff(sql),
      workspaceExists: (workspace) =>
        workspaceExists(ports.lookups, sql, workspace),
      sourceFolder: (workspace) => ports.lookups.sourceFolder(sql, workspace),
    }),
  });
  const workspaceExtensionDeps = {
    projectLayer: ports.projectLayer,
    files: workspaceFiles,
    lookups: (sql: Pick<Tx["sql"], "get" | "all">) => ({
      workspaceExists: (workspace: Workspace) =>
        workspaceExists(ports.lookups, sql, workspace),
    }),
  };
  const workspaceExtensionCommands = createProjectExtensionCommands(
    workspaceExtensionDeps,
  );
  const workspaceExtensionReads = createProjectExtensionReads(
    workspaceExtensionDeps,
  );

  // 그 agent 정의가 끈 skill 이름과 할당한 앱이다. 정의를 읽지 못하면 끈 skill이 없다.
  function ownOf(
    sql: Pick<Tx["sql"], "get" | "all">,
    agent: AgentId,
  ): {
    skills_off: readonly string[];
    apps: readonly string[];
  } {
    const none = { skills_off: [], apps: [] };
    const opened = openAgentContext(agentDeps, sql);
    if (!opened.ok) return none;
    const loaded = loadAgent(opened.value, agent);
    if (!loaded.ok || loaded.value === null) return none;
    return {
      skills_off: loaded.value.definition?.skills_off ?? [],
      apps: loaded.value.definition?.apps ?? [],
    };
  }

  // `/` 명령 목록. 목록은 저장하지 않고 session의 agent에서 열 때마다 계산한다. skill은 그 session
  // workspace에서 그 agent가 쓸 수 있는 것이다: 전역 층에 그릇 자리의 workspace-data 층을 더하고, agent 정의가 끈 것은 selected=false다.
  // 내장 skill은 발견이 workspace 종류로 거른다.
  const commandReads = createCommandReads({
    skills: (sql, session) => {
      const own = ownOf(sql, session.agent);
      const kind = workspaceKindOf(session.workspace);
      const shared = sharedHeadsOf(
        ports.lookups,
        sql,
        own.apps,
        session.workspace,
      );
      return commandSkillsOf(
        extensionRegistry(sql, ports)?.skills(session.workspace, kind, shared)
          .entries ?? [],
        own.skills_off,
      );
    },
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
      commands.connect,
      commands.addCredential,
      commands.activateCredential,
      commands.removeCredential,
      commands.disconnect,
      commands.refreshCredential,
      commands.recordAvailability,
      commands.recordModels,
      commands.refreshModels,
      commands.cancelLogin,
      modelCommands.changeDefault,
      modelCommands.changeWorkspace,
      modelCommands.changeShown,
      modelCommands.saveUserInfo,
      modelCommands.removeUserInfo,
      usage.start,
      usage.finish,
      usage.supplement,
      agentCommands.create,
      agentCommands.change,
      agentCommands.delete,
      workspaceExtensionCommands.change,
      turnCommands.start,
      turnCommands.checkpoint,
      turnCommands.finish,
      turnCommands.stop,
      interruptTurnsCommand(publishAfterCommit, callSignals),
      conversationCommands.open,
      conversationCommands.appOpen,
      conversationCommands.memberOpen,
      conversationCommands.memberFail,
      conversationCommands.rename,
      conversationCommands.aiTitle,
      conversationCommands.archive,
      conversationCommands.delete,
      conversationCommands.changeModel,
      conversationCommands.changeSkip,
      conversationCommands.fork,
      conversationCommands.requestCompact,
      conversationCommands.compact,
      conversationCommands.failCompact,
      conversationCommands.send,
      conversationCommands.record,
      conversationCommands.shell,
      conversationCommands.bind,
      conversationCommands.teamEnd,
      removeQueuedCommand({ eraseBlobRefs }),
      editQueuedCommand(),
      moveQueuedCommand(),
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
      modelReads.workspaceModel,
      modelReads.shown,
      modelReads.userInfo,
      modelReads.catalog,
      usageReads.read,
      usageReads.list,
      usageReads.usage,
      agentReads.list,
      agentReads.read,
      agentReads.card,
      agentReads.cards,
      skillsReads.read,
      workspaceExtensionReads.read,
      turnReads.read,
      turnReads.list,
      turnReads.result,
      conversationReads.session,
      conversationReads.sessions,
      conversationReads.messages,
      conversationReads.message,
      conversationReads.compactRequests,
      sessionStatusRead,
      commandReads.list,
      toolReads.read,
      traceReads.read,
      revertReads.preview,
      revertReads.checkpoints,
      revertReads.list,
      instructionsGetRoute(),
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
      mcpAuthCallback,
      mcpAuthCancel,
      issuerRequestTake,
      issuerRequestDone,
      // Grants의 MCP tool 목록. handler는 wiring/lophn-agent-extensions.ts가 붙인다.
      mcpToolsList,
      mcpToolsRequestTake,
      mcpToolsRequestDone,
      // ask 대기와 사람의 답. handler는 wiring/approvals.ts가 붙인다.
      askWait,
      askRead,
      askAnswer,
      // 받은 이미지의 파일 경로를 푸는 입구(image block의 hash와 `attachment:<id>`)와 agent가 이미지를 blob으로 올리는
      // 입구. handler는 wiring/lophn-agent.ts가 붙인다.
      messageImagePath,
      messageImagePrepare,
      // 전역 지침(LOPHN.md) 읽기와 쓰기. handler는 wiring/lophn-agent.ts가 붙인다.
      instructionsReadGlobal,
      instructionsWriteGlobal,
      // 대기 메시지의 지금 끼워 넣기와 지우기. handler는 wiring/lophn-agent-runtime.ts가 붙인다.
      ...QUEUED_INPUT_ROUTES,
      // core 안 extension host의 harness extension이 부르는 입구. handler는 wiring/harness.ts가 붙인다.
      ...HARNESS_HOST_MEMORY_ROUTES,
      // 앱이 보는 session 목록·상태·멈추기와 core가 아는 터미널 coding agent. handler는 wiring/session-lifecycle.ts가 붙인다.
      ...SESSION_LIFECYCLE_ROUTES,
      // 앱이 보내는 call과 읽기. handler는 wiring/app-calls.ts가 붙인다.
      ...APP_CALL_ROUTES,
      // 기계 사이 mail의 보내는 입구와 받는 입구. handler는 wiring/mail.ts가 붙인다.
      ...MAIL_ROUTES,
      // provider 잇기(이 기계의 주소)와 구독 로그인의 시작·상태. handler는 wiring/lophn-agent.ts의 provider login이 붙인다.
      providerConnectLocal,
      providerSignIn,
      providerSignInCallback,
      providerSignInState,
    ],
    // profile 이미지의 바이트 입구(upload)와 읽기(file)다. 바이트를 붙이는 처리기는 core 조립(core.ts)이 route 이름으로 붙인다.
    // provider key로 잇기의 입구도 upload다(handler는 wiring/lophn-agent.ts의 provider login).
    uploadRoutes: [
      agentProfileImageUpload,
      messageImageUpload,
      providerConnectKey,
    ],
    files: [agentProfileImageRead, messageImageRead],
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
        modelReads.workspaceModel,
        modelReads.shown,
        modelReads.userInfo,
        modelReads.catalog,
        usageReads.read,
        usageReads.list,
        usageReads.usage,
        agentReads.list,
        agentReads.read,
        agentReads.card,
        agentReads.cards,
        skillsReads.read,
        workspaceExtensionReads.read,
        turnReads.read,
        turnReads.list,
        turnReads.result,
        conversationReads.session,
        conversationReads.sessions,
        conversationReads.messages,
        conversationReads.message,
        conversationReads.compactRequests,
        sessionStatusRead,
        commandReads.list,
        toolReads.read,
        traceReads.read,
      ],
      ports: new Map(),
    };
  }

  return {
    lophnAgentDefinitions,
    createReaderRegistration,
    openAgents,
    agentMcpServers,
  };
}
