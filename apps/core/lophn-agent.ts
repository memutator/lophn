import { z } from "zod";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  defineSetting,
  type KindLaunchSpec,
  questionOption,
  type ReadDefinition,
} from "../../packages/contracts/platform/mod.ts";
import {
  defineTxPort,
  type EventRegistration,
  type ReaderRegistration,
  runAdmission,
} from "../../packages/platform/ledger/mod.ts";
import {
  agentProfilesRead,
  agentProfilesUpload,
  assignmentPaused,
  createOperatorAssignment,
  finishRewindSummary,
  instructionPreview,
  instructionRead,
  providerDisconnected,
  questionCreated,
  readRewindSummary,
  requestRewindSummary,
  REVERT_EVENTS,
  runAccepted,
  runAppRevert,
  runFinished,
  runStarted,
  takeRewindSummaryRequest,
  withdrawAssignment,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { notificationsOnlyVisibility } from "./platform.ts";
import type {
  CommandDefinition,
  EventDefinition,
  EventVisibilityDefinition,
  SqlRow,
  Tx,
} from "../../packages/contracts/platform/mod.ts";
import {
  approvalRunLineage,
  createApprovalCommands,
  eraseApprovalRequests,
} from "../../packages/platform/approvals/mod.ts";
import { eraseBlobRefs } from "../../packages/platform/blob-store/mod.ts";
import {
  createModelCommands,
  createModelReads,
  loadWorkspaceModels,
  type ModelCommandDeps,
  modelSchemaSteps,
  snapshotCatalogEntry,
  snapshotModelListed,
} from "../../packages/lophn-agent/harness/model/mod.ts";
import {
  createProviderCommands,
  createProviderDefinitionsRead,
  createProviderReads,
  createProviderSecretRefSource,
  providerSchemaSteps,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import {
  createUsageCommands,
  createUsageReads,
  deleteSessionModelCalls,
  modelCallBodyFields,
  usageSchemaSteps,
} from "../../packages/lophn-agent/harness/usage/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../../packages/lophn-agent/assignments/mod.ts";
import {
  type AgentDeps,
  agentFileName,
  type AgentFileSystem,
  type AgentLookups,
  type AssignmentRef,
  type AssignmentWriter,
  createAgentCommands,
  createAgentReads,
  createAgentStore,
  parseAgentFile,
  type ProfileAssetDeps,
  type ProfileFileHandler,
  profileImageFileHandler,
  type ProfileImageFiles,
  profileImageUploadHandler,
  type ProfileReaders,
  type ProfileUploadHandler,
  roleCapsOf,
} from "../../packages/lophn-agent/agents/mod.ts";
import {
  createRunCommands,
  createRunReads,
  deleteSessionRuns,
  RUN_LIMIT_SETTING_KEYS,
  runBodyFields,
  runSchemaSteps,
  sessionRunIds,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { createCommandReads } from "../../packages/lophn-agent/commands/mod.ts";
import {
  conversationSchemaSteps,
  createConversationCommands,
  createConversationReads,
  hasUnappliedSteering,
  type MessageBodyEnvironment,
  messageBodyFields,
  messageBodyRead,
  recordFactMessage,
  sessionSummaryRead,
} from "../../packages/lophn-agent/conversation/mod.ts";
import {
  chosenOptionCall,
  createApplyQuestionOption,
  createQuestionCommands,
  createQuestionReads,
  deleteSessionQuestions,
  OPTION_ACTION_OWNERS,
  type OptionOwnerHandlers,
  questionBodyFields,
  questionSchemaSteps,
  questionTextRead,
} from "../../packages/lophn-agent/questions/mod.ts";
import {
  createHandoffCommands,
  createHandoffReads,
  handoffBodyFields,
} from "../../packages/lophn-agent/handoff/mod.ts";
import {
  createTraceReads,
  traceExportCommand,
} from "../../packages/lophn-agent/observability/mod.ts";
import {
  createRevertCommands,
  createRevertReads,
  latestAppRevision,
  revertSchemaSteps,
} from "../../packages/lophn-agent/revert/mod.ts";
import { createRewindEffects } from "./rewind-effects.ts";
import { answeredFacts } from "./rewind-facts.ts";
import { projectRootOf } from "./rewind-root.ts";
import {
  createToolCommands,
  createToolReads,
  deleteSessionToolCalls,
  toolCallBodyFields,
  toolsSchemaSteps,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import {
  createWaitCommands,
  deleteSessionWaitResolutions,
  runBodyRead,
  runBodyViewRead,
  waitSchemaSteps,
} from "../../packages/lophn-agent/harness/waiting-and-recovery/mod.ts";
import {
  appDirectSocketPaths,
  SOCKET_HOST,
} from "../../packages/contracts/apps/mod.ts";
import {
  type AgentPlace,
  type AgentRole,
  DEFAULT_RUN_LIMITS,
  mcpAuthBegin,
  mcpAuthCancel,
  mcpAuthComplete,
  mcpAuthRequestDone,
  mcpAuthRequestTake,
  mcpAuthState,
  type McpServerConfig,
  mcpServersSetting,
  skillFoldersSetting,
  skillsOffSetting,
  TOOL_DOCUMENT_ROUTES,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  allowNetList,
  allowRunList,
  commandSkillsOf,
  createExtensionRegistry,
  createGlobalSkillReads,
  createPlaceExtensionCommands,
  createPlaceExtensionReads,
  dataRootOf,
  type ExtensionRegistry,
  mcpToolsOf,
  type PlaceExtensionDeps,
  type PlaceFiles,
  type SkillSources,
  type SyncSkillFiles,
} from "../../packages/lophn-agent/extensions/mod.ts";
import { contextStatusOf } from "../../packages/documents/contexts/mod.ts";
import { createMcpSecretRefSource } from "../../packages/lophn-agent/extensions/mod.ts";

// 설치 묶음에 동봉된 skill 폴더다(extensions R1). runtime의 skill 발견(apps/agent-runtime/skill-folders.ts)이
// 같은 위치를 연다. 폴더가 없으면 동봉 skill이 없는 것이라 읽기 허락도 더하지 않는다.
const BUNDLED_SKILLS_ROOT = new URL("../../assets/skills", import.meta.url)
  .pathname;

// 동봉 skill 폴더가 있으면 그 경로만 돌려준다. core graph에는 동기 file API를 두지 않으므로
// async로 확인하고, 결과를 `agentRuntimeLaunchSpec`의 `bundledSkillRoots`로 넘긴다.
export async function readBundledSkillRoots(): Promise<string[]> {
  try {
    return (await Deno.stat(BUNDLED_SKILLS_ROOT)).isDirectory
      ? [BUNDLED_SKILLS_ROOT]
      : [];
  } catch {
    return [];
  }
}

// agent runtime 등록 뼈대. worker는 나중 작업이 이 객체에 더한다.
// 권한 목록은 architecture §2.3의 최소다. host·skill·MCP를 등록하면 core가 목록을 바꿔 재기동한다.
export function agentRuntimeLaunchSpec(input: {
  dataRoot: string;
  apiPort: number;
  // supervisor가 앱 direct socket을 두는 폴더(`appSocketRoot`). 자리 경로는 그 폴더와 같다.
  socketRoot: string;
  // 등록된 MCP server 설정이다(contracts#T24 settings registry의 행). 없으면
  // `--allow-run`은 빈 목록이다(architecture §2.3).
  mcpServers?: readonly McpServerConfig[];
  // 사람이 등록한 provider의 목적지(`host:port`). 등록되면 core가 이 목록을 바꿔 재기동한다.
  hosts?: readonly string[];
  // 사람이 등록한 skill 폴더다. 읽기 허락에 더하고 등록이 바뀌면 core가 다시 띄운다.
  skillRoots?: readonly string[];
  // `readBundledSkillRoots()`가 확인한 동봉 skill 폴더다. 읽기 허락에 더한다.
  bundledSkillRoots?: readonly string[];
}): KindLaunchSpec {
  // confirm proof의 direct call은 이 프로세스가 앱 socket으로 보낸다. Deno는 자리마다
  // read·write·`unix:<경로>`와 가상 host를 요구하고 폴더 prefix는 받지 않는다.
  const sockets = appDirectSocketPaths(input.socketRoot);
  return {
    kind: "lophn-agent/runtime",
    entry: new URL("../agent-runtime/main.ts", import.meta.url).pathname,
    // 개인 skill 보관소(<dataRoot>/skills)는 dataRoot 안이고, 동봉 skill 폴더는 설치 묶음의 assets/skills다.
    allow_read: [
      input.dataRoot,
      ...(input.bundledSkillRoots ?? []),
      ...(input.skillRoots ?? []),
      ...sockets,
    ],
    // derived만 쓴다. ledger·blob·원본은 쓰지 않는다. socket 쓰기는 연결에 필요한 허락이다.
    allow_write: [`${input.dataRoot}/derived/lophn-agent`, ...sockets],
    // core loopback, 앱 direct socket, 등록된 provider 목적지, enabled로 등록한 MCP HTTP server의 정확한
    // `host:port`. 공개 models.dev는 등록될 때 더한다.
    allow_net: [
      `127.0.0.1:${input.apiPort}`,
      SOCKET_HOST,
      ...sockets.map((path) => `unix:${path}`),
      ...(input.hosts ?? []),
      ...allowNetList(input.mcpServers ?? []),
    ],
    // 사람이 enabled로 등록한 MCP stdio executable만이다(architecture §2.3).
    allow_run: allowRunList(input.mcpServers ?? []),
    allow_sys: [],
    // MCP 최소 환경을 구성하는 네 이름이다(architecture §2.3).
    allow_env: [
      "LOPHN_HOME",
      "LOPHN_WORKER_KIND",
      "PATH",
      "HOME",
      "TEMP",
      "LC_ALL",
    ],
    policy: "always",
    memory_limit_bytes: 512 * 1024 * 1024,
  };
}

// catalog 자동 갱신 on/off 정의 등록(contracts#T24 settings registry). 사람이
// 끄면 정상본·snapshot만 쓴다(R6). machine_local이고 다음 기동부터 적용한다.
export const catalogAutoUpdateSetting = defineSetting({
  key: "lophn-agent.model.catalog_auto_update",
  owner: "lophn-agent/harness/model",
  display_name_key: "settings.lophn-agent.catalog_auto_update.name",
  description: "Automatic public model catalog refresh.",
  value_meaning_key: "settings.lophn-agent.catalog_auto_update.value",
  default_meaning_key: "settings.lophn-agent.catalog_auto_update.default",
  affected_features: ["lophn-agent/harness/model"],
  risk_key: "settings.lophn-agent.catalog_auto_update.risk",
  revert_key: "settings.lophn-agent.catalog_auto_update.revert",
  constraints: {},
  required: false,
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.lophn-agent.catalog_auto_update.apply_at",
  machine_local: true,
  default_present: true,
  default: true,
  value_type: z.boolean(),
});

// run 한도 정의 등록(contracts#T24 settings registry, lophn-agent#T12). 공통 설정
// 하나씩이고 양의 정수만 받는다(run-loop R20). 0·무제한·역할의 인상은 없다. 사람이
// 바꾸고 다음 run부터 적용하며 run은 시작할 때 값을 고정한다.
function runLimitSetting(
  key: keyof typeof RUN_LIMIT_SETTING_KEYS,
  fallback: number,
  unit: string,
) {
  return defineSetting({
    key: RUN_LIMIT_SETTING_KEYS[key],
    owner: "lophn-agent/harness/run-loop",
    display_name_key: `settings.lophn-agent.run_${key}.name`,
    description: `Run limit: ${key} (${unit}).`,
    value_meaning_key: `settings.lophn-agent.run_${key}.value`,
    default_meaning_key: `settings.lophn-agent.run_${key}.default`,
    affected_features: ["lophn-agent/harness/run-loop"],
    risk_key: `settings.lophn-agent.run_${key}.risk`,
    revert_key: `settings.lophn-agent.run_${key}.revert`,
    constraints: { minimum: 1, type: "positive integer", unit },
    required: false,
    layers: ["common"],
    apply_at: "next_run",
    apply_at_key: `settings.lophn-agent.run_${key}.apply_at`,
    machine_local: false,
    default_present: true,
    default: fallback,
    value_type: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  });
}

export const runModelAttemptsSetting = runLimitSetting(
  "model_attempts",
  DEFAULT_RUN_LIMITS.model_attempts,
  "attempts",
);
export const runStallSetting = runLimitSetting(
  "stall_ms",
  DEFAULT_RUN_LIMITS.stall_ms,
  "ms",
);
export const runActiveSetting = runLimitSetting(
  "active_ms",
  DEFAULT_RUN_LIMITS.active_ms,
  "ms",
);

// derived catalog read는 model leaf의 read 정의로 reader worker 등록에 붙는다
// (plan/lophn-agent Q28). pool read handler는 동기 Result를 돌려주므로 파일 읽기도
// 동기여야 하는데, core module graph의 동기 file API는 platform/responsiveness#R1
// 검사가 막는다. 그래서 정의는 leaf의 createCatalogRead에 두고 파일 reader는
// 조립이 끼운다. reader가 없으면 read는 unavailable이다. apiRead 경로는 snapshot을
// 받지 않아 as_of_seq를 만들 수 없어 pool read로 둔다.

// provider·credential ledger. 값은 OS keychain에만 있고 이곳에는 참조만 남는다.
// model 기본값(concern harness/model)과 model call 기록·사용량 읽기(concern
// harness/usage). 시작·마침·보완은 machine 전용이다.
const commands = createProviderCommands();
const modelCommands = createModelCommands(modelCommandDeps);
// 수정 입력의 처음 반영은 ModelCall 시작과 같은 transaction이다(Q30).
const usage = createUsageCommands({
  applyMessages: (tx, ctx, input, compare) =>
    conversationCommands.apply.handle(tx, ctx, input, compare),
});
const reads = createProviderReads();
const modelReads = createModelReads();
const usageReads = createUsageReads();

// provider 기록의 provider 정의 key다(providers 표 definition_key). 기록이 없으면 undefined로
// fail-closed다(R6, harness/model#R10).
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

// model 기본값 저장 검사 deps(harness/model#R10, R24). 목록과 catalog는 동봉 snapshot에서 읽는다.
function modelCommandDeps(tx: Tx): ModelCommandDeps {
  return {
    definitionKey: (provider) => providerDefinitionKey(tx.sql, provider),
    modelListed: (providerDefinition, modelName) =>
      snapshotModelListed(providerDefinition, modelName),
    catalogEntry: (providerDefinition, modelName) =>
      snapshotCatalogEntry(providerDefinition, modelName),
  };
}

const assignmentCommands = createAssignmentCommands();
const assignmentReads = createAssignmentReads();

// run ledger(concern harness/run-loop). 접수·시작·checkpoint·종료는 machine,
// 멈춤은 사람과 machine, 다음 일 확인은 사람이다. 미반영 steering 판정은
// 입력 표를 소유한 conversation의 messages 표를 같은 Tx에서 읽는다(run-loop R14).
const runCommands = createRunCommands({ hasUnappliedSteering });
const runReads = createRunReads();

// DeleteSession이 같은 Tx에서 지우는 그 세션의 run 기록이다(conversation#R20). run을 가리키는 표마다
// 소유 concern이 지움을 내고 여기에 가리키는 쪽부터 놓는다: approval request, 기다림 결과(tool call을
// 가리킨다), 질문 묶음, tool call, model 호출, 마지막으로 run. 본문 참조는 소유 행보다
// 먼저 지워야 소유 ID를 찾는다. 문서·release·앱 변경은 이 목록에 없어 그대로 남는다.
function deleteSessionRecords(tx: Tx, session: string): Result<void> {
  const steps: (() => Result<void>)[] = [
    () => eraseApprovalRequests(tx, sessionRunIds(tx, session)),
    () => deleteSessionWaitResolutions(tx, session),
    () => deleteSessionQuestions(tx, session, eraseBlobRefs),
    () => deleteSessionToolCalls(tx, session, eraseBlobRefs),
    () => deleteSessionModelCalls(tx, session, eraseBlobRefs),
    () => deleteSessionRuns(tx, session, eraseBlobRefs),
  ];
  for (const step of steps) {
    const erased = step();
    if (!erased.ok) return erased;
  }
  return ok(undefined);
}

// 세션과 메시지(concern conversation). 사람 입력 접수는 담당 run 접수와 한
// transaction이므로 run-loop의 AcceptRun handler를 같은 Tx에서 부른다. AcceptRun은
// machine 전용 기록이라 이 접수에 한해 machine 자격으로 바꿔 넘기고, 입력은 항상
// message 출처의 run이다. 바깥 command의 actor·event 기록은 그대로다.
const conversationCommands = createConversationCommands({
  acceptRun: (tx, ctx, input, compare) =>
    runCommands.accept.handle(tx, { ...ctx, actor: "machine" }, input, compare),
  deleteSessionRecords,
  eraseBlobRefs,
});
const conversationReads = createConversationReads();

// handoff(concern handoff). SubmitHandoff는 AcceptRun의 출처 검사 wrapper라서 run-loop의
// AcceptRun handler를 같은 Tx에서 부른다. AcceptRun은 machine 전용 기록이라 이 접수에 한해
// machine 자격으로 바꿔 넘기고(command 안에서 보낸 run·방향·원래 요청을 먼저 검사한다) 바깥
// command의 actor·event 기록은 그대로다. 내용 blob은 core가 준비한다(apps/core/handoff-body.ts).
const handoffCommands = createHandoffCommands({
  acceptRun: (tx, ctx, input, compare) =>
    runCommands.accept.handle(tx, { ...ctx, actor: "machine" }, input, compare),
});
// 받는 run이 저장한 가장 최근 문서 고정 version은 documents/versions의 표에서 읽는다. 표를
// 소유한 concern이 다르므로 lophn-agent leaf는 표를 모르고 이 조립이 조회를 넣는다. 문서 표가
// 없는 등록(문서 concern 없는 harness)에서는 version이 없는 것이다.
const handoffReads = createHandoffReads({
  savedVersion: (snapshot, run) => {
    try {
      const row = snapshot.sql.get(
        `select id from versions where run = ?
         order by rowid desc limit 1`,
        [run],
      );
      return row === undefined ? null : String(row["id"]);
    } catch {
      return null;
    }
  },
});

// session 되돌리기(concern revert). 쓰기 직전 기록(RecordRewindFile), Rewind·UndoEdit·Redo, 설치 정정
// (AmendRevertInstall)을 올린다. checkpoint는 ReceiveMessage가, 기록 지움은 DeleteSession이 같은 Tx에서 한다.
// 파일 관측·준비·설치는 ledger transaction 밖의 일이라 command는 받은 준비로 판정만 한다. 그 흐름은 writer
// queue 앞 처리기(rewind-files.ts)가 잇는다. 숨긴 구간의 대화 효과(질문·approval 취소, 읽은 상태)는
// rewind-effects.ts가 조립하고 질문 답·승인 결정은 rewind-facts.ts가 남는 사실로 알린다. 앱 단계가 있는
// Rewind는 applying 접수까지만 command가 하고, 이어 실행(RunAppRevert, app-revert.ts)이 CheckpointRevert·
// FinishRevert를 낸다.
const revertDeps = {
  rootOf: projectRootOf,
  appRevision: latestAppRevision,
  recordFact: recordFactMessage,
  answeredFacts,
  effects: createRewindEffects(),
};
const revertCommands = createRevertCommands(revertDeps);
// 읽기는 파일을 읽는 preview 때문에 reader Worker의 별도 등록(rewind-reader.ts)이 서빙한다. 여기 정의는
// core의 route 등록이고 core에서는 실행되지 않는다.
const revertReads = createRevertReads(revertDeps);

// run·session·독립 호출의 trace 조회와 export(concern observability). trace는 저장하지 않고
// 조회 때 run·event·ModelCall·ToolCall·message 참조에서 조립한다. 쓰는 표가 없어 command·schema
// step이 없다. export는 ledger event가 없는 runtime 접수라 writer queue 앞 처리기가 실행한다.
const traceReads = createTraceReads();

// tool call ledger(concern harness/tools). 기록은 machine 전용이다. 입력·출력
// 원문은 blob 참조만 남긴다.
const toolCommands = createToolCommands();
const toolReads = createToolReads();

// 질문(concern questions). 질문은 agent가 만들고 사람이 답한다. 만료는 machine이
// 닫는다. 고정 action이 있는 선택지의 답(AnswerQuestionAction)만 사람 확인
// (confirmation)이 필요하다. 본문·이유·선택지 설명·자유 답·취소 이유는 값으로 받아 core가
// blob으로 준비하고(apps/core/question-text.ts) blob 참조만 남는다.
const questionCommands = createQuestionCommands();
const questionReads = createQuestionReads();

// 사람이 고른 선택지의 고정 action을 소유 command로 적용한다(ApplyQuestionOption). 소유 command의
// handler는 다른 팀 등록에 있으므로 writer가 모든 등록을 모은 뒤 묶는다(bindQuestionOptionOwners).
// 묶기 전에는 비어 있어 어느 동작도 적용하지 않는다. writer Worker마다 이 module 상태가 따로
// 있다(platform.ts의 approval owner 목록과 같다).
let optionOwners: OptionOwnerHandlers = new Map();

export function bindQuestionOptionOwners(
  commands: readonly CommandDefinition[],
): void {
  const handlers = new Map<string, CommandDefinition["handle"]>();
  for (const owner of OPTION_ACTION_OWNERS) {
    const found = commands.find((command) =>
      command.route.name === owner.route.name
    );
    if (found !== undefined) handlers.set(owner.route.name, found.handle);
  }
  optionOwners = handlers;
}

const questionApply = createApplyQuestionOption({
  handlers: () => optionOwners,
});

// 사람 기다림(concern harness/waiting-and-recovery). 기다림 연결(WaitRun)은 요청 생성과
// waiting_on 연결, 결정 반영(ResolveRunWait)은 run 재개·종료와 반영 기록을 한 transaction에서
// 확정한다. approval 생성은 platform의 create handler를, 수정 입력 보존은 run 접수와 메시지
// 이동의 handler를 같은 Tx에서 부른다. 두 command는 machine 전용 기록이라 이 연결에 한해 자격을
// 바꿔 넘기고 바깥 command의 actor와 event 기록은 그대로다.
const approvalCommands = createApprovalCommands();
const waitCommands = createWaitCommands({
  createApproval: (tx, ctx, input, compare) =>
    approvalCommands.create.handle(tx, ctx, input, compare),
  acceptRun: (tx, ctx, input, compare) =>
    runCommands.accept.handle(tx, ctx, input, compare),
  assignMessage: (tx, ctx, input, compare) =>
    conversationCommands.assign.handle(tx, ctx, input, compare),
});

// agent 자격의 command(CreateQuestionGroup 같은)는 자격에 묶인 run이 진행 중일 때만 통과한다
// (platform/ledger#R11). 판정은 이 concern의 runs 표를 같은 Tx에서 읽는다. 없는 run은
// unknown이고 끝난 run은 감사 보완만 통과한다. 이 port가 없으면 agent command는 막힌다.
// platform/ledger의 callChosenOption이 대조하는 질문 정본(identity R14). 사람이 고른 option의
// 고정 action이 내는 소유 command 호출을 같은 Tx에서 읽어 준다.
const questionOptionPort = defineTxPort(questionOption, (tx) => ({
  chosen: (question: string) => chosenOptionCall(tx, question),
}));

const runAdmissionPort = defineTxPort(runAdmission, (tx) => ({
  status: (run: string) => {
    const row = tx.sql.get("select state from runs where id = ?", [run]);
    if (row === undefined) return "unknown" as const;
    return row["state"] === "finished"
      ? "finished" as const
      : "active" as const;
  },
}));

// approval이 쓰는 run 사실이다. 거절 억제(platform/approvals#R16)의 계보 판정: 사람 요청에서 시작한 run은
// 그 message, handoff run은 runs/read의 source.original_message다. AcceptRun이 handoff의 original_message가
// sender chain의 시작과 같은지 검사하므로 한 번의 조회로 계보가 정해진다. 주기 회차는 계보가 없다.
// session 허락(platform/approvals#R19)의 session은 run이 속한 session이다.
const approvalLineagePort = defineTxPort(approvalRunLineage, (tx) => ({
  session: (run: string) => {
    const row = tx.sql.get("select session from runs where id = ?", [run]);
    return row === undefined || row["session"] === null
      ? null
      : String(row["session"]);
  },
  origin: (run: string) => {
    const row = tx.sql.get(
      `select source_kind, source_message, source_original_message
         from runs where id = ?`,
      [run],
    );
    if (row === undefined) return null;
    if (row["source_kind"] === "message") return String(row["source_message"]);
    if (row["source_kind"] === "handoff") {
      return String(row["source_original_message"]);
    }
    return null;
  },
}));

// agent 정의 저장소(concern lophn-agent/agents)가 다른 concern에서 읽는 값이다. 읽기는 snapshot과 Tx가
// 같은 sql 모양이라 한 factory를 함께 쓴다. data root는 ledger 파일이 있는 폴더다.
function agentAssignmentRef(row: SqlRow): AssignmentRef {
  return {
    id: String(row["id"]),
    role: String(row["role"]) as AssignmentRef["role"],
    scope: row["scope_kind"] === "all" ? { kind: "all" } : {
      kind: String(row["scope_kind"]) as "project" | "app",
      id: String(row["scope_id"]),
    },
    state: String(row["state"]) as AssignmentRef["state"],
    revision: Number(row["revision"]),
  };
}

const ASSIGNMENT_COLUMNS =
  "id, role, scope_kind, scope_id, state, revision from assignments";

// settings registry 값을 읽는다. 없거나 형식이 틀리면 undefined다(fail closed).
function settingValue(
  sql: Pick<Tx["sql"], "all">,
  key: string,
): unknown {
  try {
    const rows = sql.all(
      "select value from setting_choices where key = ?",
      [key],
    );
    if (rows.length === 0) return undefined;
    return JSON.parse(String(rows[0]["value"]));
  } catch {
    return undefined;
  }
}

// 전역(Workspace)에 등록된 외부 MCP server 전부다. 읽지 못하면 빈 목록이다.
function registeredMcpServers(
  sql: Pick<Tx["sql"], "all">,
): McpServerConfig[] {
  const shaped = mcpServersSetting.value_type.safeParse(
    settingValue(sql, mcpServersSetting.key),
  );
  return shaped.success ? shaped.data : [];
}

function registeredSkillFolders(sql: Pick<Tx["sql"], "all">): string[] {
  const shaped = skillFoldersSetting.value_type.safeParse(
    settingValue(sql, skillFoldersSetting.key),
  );
  return shaped.success ? shaped.data : [];
}

// 전역에서 끈 skill의 정확한 이름이다(open-issues shell/desktop#Q22). 읽지 못하면 끈 것이 없다.
function registeredSkillsOff(sql: Pick<Tx["sql"], "all">): string[] {
  const shaped = skillsOffSetting.value_type.safeParse(
    settingValue(sql, skillsOffSetting.key),
  );
  return shaped.success ? shaped.data : [];
}

// 전역 층의 skill 출처다: 사람이 등록한 폴더, data root의 개인 보관소, 설치 묶음의 동봉 폴더(extensions R1).
function globalSkillSources(
  sql: Pick<Tx["sql"], "get" | "all">,
): Omit<SkillSources, "place"> {
  const root = dataRootOf(sql, undefined);
  return {
    registered: registeredSkillFolders(sql),
    personal: root.ok ? `${root.value}/skills` : null,
    bundled: BUNDLED_SKILLS_ROOT,
  };
}

// 동기 file 읽기는 writer·reader Worker 안의 handler가 한다. core 프로세스의 module graph에는 동기 file API를
// 두지 않으므로(platform/responsiveness#R1) adapter는 이 module이 올라올 때 URL로 연다.
const NODE_EXTENSION_FILES = new URL(
  "../../packages/lophn-agent/extensions/adapters/node-fs.ts",
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

// 한 읽기에서 쓰는 동기 등록부다(extensions R32): 전역 층에 그 자리 층을 더한 skill·MCP 목록을 준다. data root를
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
  sql: Pick<Tx["sql"], "get">,
  place: AgentPlace,
): boolean {
  return sql.get(
    place.kind === "project"
      ? "select 1 as found from projects where id = ?"
      : "select 1 as found from apps where id = ?",
    [place.id],
  ) !== undefined;
}

export function agentLookups(
  sql: Pick<Tx["sql"], "get" | "all">,
): AgentLookups {
  let registry: ExtensionRegistry | null | undefined;
  const registryOf = (): ExtensionRegistry | null => {
    if (registry === undefined) registry = extensionRegistry(sql);
    return registry;
  };
  return {
    placeExists: (place) => placeExists(sql, place),
    assignments: (place) =>
      sql.all(
        `select ${ASSIGNMENT_COLUMNS} where state != 'withdrawn'
           and (scope_kind = 'all' or (scope_kind = ? and scope_id = ?))
         order by id`,
        [place.kind, place.id],
      ).map(agentAssignmentRef),
    assignment: (id) => {
      const row = sql.get(`select ${ASSIGNMENT_COLUMNS} where id = ?`, [id]);
      return row === undefined ? null : agentAssignmentRef(row);
    },
    // context는 project 안에만 있다(documents/contexts). 만드는 중(drafting)인 context도 실제 context다.
    contextStatus: (id) => contextStatusOf(sql, id) ?? null,
    contextProject: (id) => {
      const row = sql.get("select project from contexts where id = ?", [id]);
      return row === undefined ? null : String(row["project"]);
    },
    // project 자리는 그 project의 active context 전부이고, App Engineer가 앱 자리에 있으면 적용된 판이 그 앱을
    // app-data source로 읽는 active context 전부다(context.list의 app 거르기와 같다). context_app_data는 앱
    // slug를 담는다. 그 밖의 앱 자리는 없다.
    activeContexts: (place, role) =>
      (place.kind === "project"
        ? sql.all(
          "select id from contexts where project = ? and status = 'active' order by id",
          [place.id],
        )
        : role === "app_engineer"
        ? sql.all(
          `select c.id from contexts c where c.status = 'active' and exists (
             select 1 from context_app_data d join apps a on a.slug = d.app
             where d.context = c.id and a.id = ?
           ) order by c.id`,
          [place.id],
        )
        : []).map((row) => String(row["id"])),
    // 이 자리의 agent가 쓸 수 있는 skill·MCP다: 전역 층에 그 자리 층을 더한다(extensions R32). 한 읽기 안에서
    // 같은 자리는 같은 목록이다.
    skills: (place) =>
      registryOf()?.skills(place).entries.map((entry) => entry.name) ?? [],
    mcp: (place) =>
      mcpToolsOf(
        registryOf()?.mcpServers(place) ?? registeredMcpServers(sql),
      ),
    // Workspace 층: 역할별 기본 model(agent_model_defaults의 role slot). 기본 권한 설정은 아직 없어
    // 권한 층은 비어 있다.
    workspace: () => ({ models: loadWorkspaceModels(sql) }),
  };
}

// 정의 파일의 동기 읽기·쓰기는 writer·reader Worker 안의 handler가 한다. core 프로세스의 module graph에는
// 동기 file API를 두지 않으므로(platform/responsiveness#R1) adapter는 이 module이 올라올 때 URL로 연다.
const NODE_AGENT_FILES = new URL(
  "../../packages/lophn-agent/agents/adapters/node-fs.ts",
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

// 새 Operator 저장(SaveAgent)과 Operator 삭제(DeleteAgent)가 같은 transaction에서 assignment command를
// 부른다(lophn-agent/assignments#R4, R9). 파일 쓰기가 실패하면 SaveAgent가 err를 돌려 방금 만든
// assignment와 event까지 되돌아간다.
function operatorAssignmentWriter(tx: Tx): AssignmentWriter {
  return {
    createOperator(place) {
      const id = tx.newId("asg");
      const created = tx.call(
        createOperatorAssignment,
        { id, scope: place },
        {},
      );
      return created.ok ? ok(id) : created;
    },
    withdraw(assignment) {
      const row = tx.sql.get(
        `select ${ASSIGNMENT_COLUMNS} where id = ?`,
        [assignment],
      );
      if (row === undefined) {
        return err({ code: "not_found", message: "assignment not found" });
      }
      const ref = agentAssignmentRef(row);
      const withdrawn = tx.call(
        withdrawAssignment,
        { assignment },
        { revision: ref.revision, state: ref.state as "enabled" | "paused" },
      );
      return withdrawn.ok ? ok(undefined) : withdrawn;
    },
  };
}

const agentDeps: AgentDeps = {
  files: createNodeAgentFiles(),
  lookups: agentLookups,
  assignmentWriter: operatorAssignmentWriter,
  roleCaps: roleCapsOf,
};
const agentCommands = createAgentCommands(agentDeps);
const agentReads = createAgentReads(agentDeps);

// skill·MCP의 자리 층(concern extensions R32, R33): 자리 data 폴더의 MCP 서버 목록을 저장하고 읽는다.
// 사람이 전역에 등록한 서버와 이름이 겹치면 거절한다.
const placeExtensionDeps: PlaceExtensionDeps = {
  files: placeFiles,
  skillFiles,
  lookups: (sql) => ({
    placeExists: (place) => placeExists(sql, place),
    globalServers: () => registeredMcpServers(sql),
    skillSources: () => globalSkillSources(sql),
  }),
};
const placeExtensionCommands = createPlaceExtensionCommands(placeExtensionDeps);
const placeExtensionReads = createPlaceExtensionReads(placeExtensionDeps);

// 전역 층의 skill 목록을 사람 화면에 준다(Settings › Agents). 끄고 켜기는 skills_off 설정을 settings apply로 바꾼다.
const globalSkillReads = createGlobalSkillReads({
  skillFiles,
  lookups: (sql) => ({
    skillSources: () => globalSkillSources(sql),
    skillsOff: () => registeredSkillsOff(sql),
  }),
});

// 그 agent 정의가 끈 skill 이름이다(agents R18, extensions R30). 정의를 읽지 못하면 끈 것이 없다.
function skillsOffOf(
  sql: Pick<Tx["sql"], "get" | "all">,
  session: { assignment: string; role: AgentRole; work_place: AgentPlace },
): readonly string[] {
  const root = dataRootOf(sql, undefined);
  if (!root.ok) return [];
  const file = createAgentStore(agentDeps.files, root.value).read(
    session.work_place,
    agentFileName(session.role, session.assignment),
  );
  if (!file.ok || file.value === null) return [];
  const parsed = parseAgentFile(file.value.text, {
    role: session.role,
    place: session.work_place.kind,
  });
  return parsed.ok ? parsed.value.skills_off ?? [] : [];
}

// `/` 명령 목록(concern commands). 목록은 저장하지 않고 session의 agent에서 열 때마다 계산한다. skill은 그 session
// 자리에서 그 agent가 쓸 수 있는 것이다: 전역 층에 자리 층을 더하고, agent 정의가 끈 것은 selected=false다(commands R7).
const commandReads = createCommandReads({
  skills: (sql, session) =>
    commandSkillsOf(
      extensionRegistry(sql)?.skills(session.work_place).entries ?? [],
      skillsOffOf(sql, session),
    ),
});

export const lophnAgentDefinitions = {
  // settings registry 출처의 항목이다(platform/settings#R31). core 조립의 settings.ts가 모은다.
  settings: [
    catalogAutoUpdateSetting,
    skillFoldersSetting,
    skillsOffSetting,
    mcpServersSetting,
    runModelAttemptsSetting,
    runStallSetting,
    runActiveSetting,
  ],
  schemaSteps: [
    ...providerSchemaSteps,
    ...modelSchemaSteps,
    ...usageSchemaSteps,
    ...assignmentSchemaSteps,
    ...runSchemaSteps,
    ...conversationSchemaSteps,
    ...toolsSchemaSteps,
    ...questionSchemaSteps,
    ...waitSchemaSteps,
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
    modelCommands.changeDefaults,
    modelCommands.changeFavorites,
    usage.start,
    usage.finish,
    usage.supplement,
    assignmentCommands.createBuiltin,
    assignmentCommands.createAppEngineer,
    assignmentCommands.createOperator,
    assignmentCommands.pause,
    assignmentCommands.resume,
    assignmentCommands.withdraw,
    agentCommands.save,
    agentCommands.delete,
    agentCommands.changeSettings,
    placeExtensionCommands.change,
    runCommands.accept,
    runCommands.start,
    runCommands.checkpoint,
    runCommands.finish,
    runCommands.stop,
    runCommands.confirmNext,
    conversationCommands.open,
    conversationCommands.rename,
    conversationCommands.archive,
    conversationCommands.unarchive,
    conversationCommands.delete,
    conversationCommands.changeModel,
    conversationCommands.fork,
    conversationCommands.requestCompact,
    conversationCommands.compact,
    conversationCommands.failCompact,
    conversationCommands.close,
    conversationCommands.receive,
    conversationCommands.record,
    conversationCommands.apply,
    conversationCommands.assign,
    handoffCommands.submit,
    toolCommands.request,
    toolCommands.decide,
    toolCommands.start,
    toolCommands.finish,
    toolCommands.recordRead,
    toolCommands.supplement,
    questionCommands.create,
    questionCommands.answer,
    questionCommands.answerAction,
    questionCommands.defer,
    questionCommands.cancel,
    questionCommands.expire,
    questionApply,
    waitCommands.wait,
    waitCommands.resolve,
    waitCommands.correct,
    waitCommands.recover,
    revertCommands.record,
    revertCommands.rewind,
    revertCommands.undo,
    revertCommands.redo,
    revertCommands.checkpoint,
    revertCommands.finish,
    revertCommands.amend,
    traceExportCommand,
  ],
  reads: [
    reads.read,
    reads.list,
    modelReads.defaults,
    modelReads.favorites,
    modelReads.catalog,
    usageReads.read,
    usageReads.list,
    usageReads.usage,
    assignmentReads.read,
    assignmentReads.list,
    agentReads.list,
    agentReads.read,
    agentReads.settings,
    placeExtensionReads.read,
    globalSkillReads.read,
    runReads.read,
    runReads.list,
    runReads.result,
    conversationReads.session,
    conversationReads.sessions,
    conversationReads.messages,
    conversationReads.compactRequests,
    commandReads.list,
    handoffReads.status,
    handoffReads.result,
    toolReads.read,
    toolReads.list,
    questionReads.read,
    questionReads.list,
    traceReads.read,
    revertReads.preview,
    revertReads.checkpoints,
    revertReads.list,
    instructionReadRoute(),
    instructionPreviewRoute(),
  ],
  // model.call 본문은 blob 참조만 남는다(R4). tool call 입력·출력도 같은 종류다.
  // 메시지 본문은 영구 참조다(conversation#R2).
  blobFields: [
    ...modelCallBodyFields,
    ...toolCallBodyFields,
    ...runBodyFields,
    ...questionBodyFields,
    ...messageBodyFields,
    ...handoffBodyFields,
  ],
  ports: [
    runAdmissionPort,
    approvalLineagePort,
    questionOptionPort,
  ],
  workers: [],
  // 확인한 rewind의 앱 단계를 이어 실행하는 core 메모리 route와 MCP OAuth 입구다.
  memoryRoutes: [
    runAppRevert,
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
  ],
  // 문서·format tool의 글 값 통로다. 서빙은 core 조립이 한다(apps/core/tool-documents.ts).
  workerRoutes: TOOL_DOCUMENT_ROUTES,
  // profile 이미지의 바이트 입구(upload)와 읽기(file)다. 바이트를 붙이는 처리기는 core 조립(core.ts)이 route 이름으로 붙인다.
  uploadRoutes: [agentProfilesUpload],
  files: [agentProfilesRead],
  // MCP OAuth의 시작·완료·상태·취소 입구다(extensions R16, R17). handler는 core 조립(apps/core)이
  // createMcpAuthControl(mcp-auth.ts)로 붙인다. route만 등록한다.
};

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

// 사람이 run 근거·tool 입력·tool 결과를 펼쳐 볼 때 지금의 redaction을 거치는 통로다. 알려진 secret 값은
// 기동 뒤에야 알려지므로 core가 늦게 채우는 함수로 준다. 붙이지 않은 등록은 끝내지 못한 것으로 답한다.
const UNATTACHED_REDACT = (): string | null => null;

// ReadInstructionFile은 LOPHN.md와 agent 정의 본문을 파일에서 읽는 reader Worker의 read다. 동기 file API는
// core module graph에 들일 수 없어 서빙은 instruction-files.ts의 reader 등록이 한다(core.ts가 reader module로
// 붙인다). 여기 handler는 route를 registry에 올리는 자리이고 실행되지 않는다.
function instructionReadRoute(): ReadDefinition<typeof instructionRead> {
  return {
    route: instructionRead,
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
    // ReadQuestionText도 같은 읽기 통로(ledger snapshot과 blob 바이트)를 쓴다.
    apiReads: [
      messageBodyRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // Compact가 session에 이은 요약의 본문도 같은 읽기 통로로 읽는다.
      sessionSummaryRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      questionTextRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // 복구가 저장된 run basis·model 응답·tool 결과를 다시 읽는 같은 길이다(machine만).
      runBodyRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // 사람 화면이 같은 본문을 지금의 redaction을 거쳐 읽는 길이다(user만).
      runBodyViewRead({
        ...(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
        redact: environment.redactBody ?? UNATTACHED_REDACT,
      }),
      // 연결 가능 provider의 내장 정의(provider#R1)는 ledger row가 아니라 동봉
      // product catalog다. snapshot이 없어도 답하므로 api read 길이다.
      createProviderDefinitionsRead(),
    ],
    // provider credential과 외부 MCP credential의 secret 값도 core의 알려진 값
    // registry에 등록·회수된다(platform/secrets#R1). MCP 참조는 extensions
    // secret-refs의 통로다(#294).
    secretRefs: [
      createProviderSecretRefSource(),
      createMcpSecretRefSource(environment.mcpOAuthRefs),
    ],
  };
}

// question·assignment 계기 event의 공개 정책(platform/notifications#R1)은 notifications
// 구독자에게만 연다. 다른 lophn-agent event는 정책이 없어 계속 숨김이다.
export function createEventRegistration(): EventRegistration {
  return {
    visibility: [
      notificationsOnlyVisibility(questionCreated),
      notificationsOnlyVisibility(assignmentPaused),
      // agent runtime(machine 자격)만 run의 접수·시작·끝남을 따라 읽는다. selector가 RunStarted를 훑고
      // 감독 pipe의 credential 발급이 StartRun이 확정한 scope를 대조한다. 사람·agent·app은 못 본다.
      machineOnlyVisibility(runAccepted),
      machineOnlyVisibility(runStarted),
      machineOnlyVisibility(runFinished),
      // 되돌리기 결과는 session을 보는 사람(shell)과 machine(observability·prompt 조립)이 읽는다. agent는
      // 읽지 않는다: Undo는 사실 메시지로, 숨김 구간은 입력 조립으로 전해지고 event 자체는 필요 없다.
      ...REVERT_EVENTS.map((event) => userAndMachineVisibility(event)),
      // Disconnect한 provider로 진행 중인 run의 호출을 멈추려고 runtime이 따라 읽는다(provider#R4).
      machineOnlyVisibility(providerDisconnected),
    ],
  };
}

function userAndMachineVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return {
    event,
    handle: (_snapshot, ctx) =>
      ok(ctx.actor === "user" || ctx.actor === "machine"),
  };
}

function machineOnlyVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return { event, handle: (_snapshot, ctx) => ok(ctx.actor === "machine") };
}

// reader Worker가 이 등록 파일에서 팀 read를 다시 조립한다. provider·model read는
// event를 보지 않는다. usage·preset read도 event를 보지 않는다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [
      reads.read,
      reads.list,
      modelReads.defaults,
      modelReads.favorites,
      modelReads.catalog,
      usageReads.read,
      usageReads.list,
      usageReads.usage,
      assignmentReads.read,
      assignmentReads.list,
      agentReads.list,
      agentReads.read,
      agentReads.settings,
      placeExtensionReads.read,
      runReads.read,
      runReads.list,
      runReads.result,
      conversationReads.session,
      conversationReads.sessions,
      conversationReads.messages,
      conversationReads.compactRequests,
      commandReads.list,
      handoffReads.status,
      handoffReads.result,
      toolReads.read,
      toolReads.list,
      questionReads.read,
      questionReads.list,
      traceReads.read,
    ],
    ports: new Map(),
  };
}
