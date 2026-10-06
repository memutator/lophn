import { z } from "zod";
import { err, ok } from "../../packages/base/mod.ts";
import {
  defineSetting,
  type KindLaunchSpec,
  questionOption,
} from "../../packages/contracts/platform/mod.ts";
import {
  defineTxPort,
  type EventRegistration,
  type ReaderRegistration,
  runAdmission,
} from "../../packages/platform/ledger/mod.ts";
import {
  assignmentPaused,
  InstructionAttachments,
  questionCreated,
  runAccepted,
  runFinished,
  runStarted,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { notificationsOnlyVisibility } from "./platform.ts";
import type {
  CommandDefinition,
  EventDefinition,
  EventVisibilityDefinition,
  Tx,
} from "../../packages/contracts/platform/mod.ts";
import {
  approvalRunLineage,
  createApprovalCommands,
} from "../../packages/platform/approvals/mod.ts";
import {
  createModelDefaultsCommands,
  createModelDefaultsReads,
  modelSchemaSteps,
  snapshotCatalogEntry,
  snapshotModelListed,
} from "../../packages/lophn-agent/harness/model/mod.ts";
import {
  createProviderCommands,
  createProviderReads,
  createProviderSecretRefSource,
  providerSchemaSteps,
} from "../../packages/lophn-agent/harness/provider/mod.ts";
import {
  createUsageCommands,
  createUsageReads,
  modelCallBodyFields,
  usageSchemaSteps,
} from "../../packages/lophn-agent/harness/usage/mod.ts";
import {
  createPresetCommands,
  createPresetReads,
  instructionAttachmentsOf,
  presetSchemaSteps,
  ROLE_CAPS,
} from "../../packages/lophn-agent/presets/mod.ts";
import {
  assignmentSchemaSteps,
  createAssignmentCommands,
  createAssignmentReads,
} from "../../packages/lophn-agent/assignments/mod.ts";
import {
  createRunCommands,
  createRunReads,
  RUN_LIMIT_SETTING_KEYS,
  runBodyFields,
  runSchemaSteps,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import {
  createSchedulingCommands,
  createSchedulingReads,
  schedulingSchemaSteps,
} from "../../packages/lophn-agent/scheduling/mod.ts";
import {
  conversationSchemaSteps,
  createConversationCommands,
  createConversationReads,
  hasUnappliedSteering,
  type MessageBodyEnvironment,
  messageBodyFields,
  messageBodyRead,
} from "../../packages/lophn-agent/conversation/mod.ts";
import {
  chosenOptionCall,
  createApplyQuestionOption,
  createQuestionCommands,
  createQuestionReads,
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
  createRevertCommands,
  createRevertEventVisibility,
  createRevertReads,
  defaultRevertOwners,
  revertSchemaSteps,
} from "../../packages/lophn-agent/revert/mod.ts";
import {
  createToolCommands,
  createToolReads,
  TOOL_BUNDLES,
  toolCallBodyFields,
  toolsSchemaSteps,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import {
  createWaitCommands,
  runBodyRead,
  waitSchemaSteps,
} from "../../packages/lophn-agent/harness/waiting-and-recovery/mod.ts";
import {
  DEFAULT_RUN_LIMITS,
  type McpServerConfig,
  mcpServersSetting,
  TOOL_DOCUMENT_ROUTES,
} from "../../packages/contracts/lophn-agent/mod.ts";

// agent runtime 등록 뼈대. worker는 나중 작업이 이 객체에 더한다.
// 권한 목록은 architecture §2.3의 최소다. host·skill·MCP를 등록하면 core가 목록을 바꿔 재기동한다.
export function agentRuntimeLaunchSpec(input: {
  dataRoot: string;
  apiPort: number;
  // 사람이 등록한 provider의 목적지(`host:port`). 등록되면 core가 이 목록을 바꿔 재기동한다.
  hosts?: readonly string[];
}): KindLaunchSpec {
  return {
    kind: "lophn-agent/runtime",
    entry: new URL("../agent-runtime/main.ts", import.meta.url).pathname,
    allow_read: [input.dataRoot],
    // derived만 쓴다. ledger·blob·원본은 쓰지 않는다.
    allow_write: [`${input.dataRoot}/derived/lophn-agent`],
    // core loopback과 등록된 provider 목적지만. MCP host와 공개 models.dev는 등록될 때 더한다.
    allow_net: [`127.0.0.1:${input.apiPort}`, ...(input.hosts ?? [])],
    allow_run: [],
    allow_sys: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
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

// skill 발견 root 정의 등록(contracts#T24 settings registry, lophn-agent#T35).
// 사람이 등록한 절대 폴더를 등록 순서대로 발견한다(extensions R1). machine_local
// 이고 다음 run부터 적용한다(R8). 기본은 등록 폴더가 없는 빈 목록이다(R10).
export const skillFoldersSetting = defineSetting({
  key: "lophn-agent.extensions.skill_folders",
  owner: "lophn-agent/extensions",
  display_name_key: "settings.lophn-agent.skill_folders.name",
  description: "Registered absolute skill discovery roots in user order.",
  value_meaning_key: "settings.lophn-agent.skill_folders.value",
  default_meaning_key: "settings.lophn-agent.skill_folders.default",
  affected_features: ["lophn-agent/extensions"],
  risk_key: "settings.lophn-agent.skill_folders.risk",
  revert_key: "settings.lophn-agent.skill_folders.revert",
  constraints: {
    path: "absolute folder paths",
    max_entries: 64,
  },
  required: false,
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.lophn-agent.skill_folders.apply_at",
  machine_local: true,
  default_present: true,
  default: [],
  value_type: z.array(z.string().regex(/^(\/|[A-Za-z]:\\).+/)).max(64),
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
// harness/usage). 시작·마침·보완은 machine 전용이다. preset ledger는 같은
// wire에 더한다.
const commands = createProviderCommands();
const modelCommands = createModelDefaultsCommands();
// 수정 입력의 처음 반영은 ModelCall 시작과 같은 transaction이다(Q30).
const usage = createUsageCommands({
  applyMessages: (tx, ctx, input, compare) =>
    conversationCommands.apply.handle(tx, ctx, input, compare),
});
const reads = createProviderReads();
const modelReads = createModelDefaultsReads();
const usageReads = createUsageReads();

// preset 구성 검증 deps(R11). MCP server 설정은 extensions의 settings registry
// 값이므로 setting_choices 행을 펼친다(contracts#T24). tool 묶음은 T23이 정한 문서·format
// 묶음 판이다(TOOL_BUNDLES). 역할 상한은 T8이 고정한 ROLE_CAPS 표다. catalog는 동봉 snapshot에서 읽고(T4,
// harness/model R5), credential key와 provider 정의 key는 같은 Tx의 provider
// 표·provider_credentials 표에서 읽는다(R6, R10).
function presetValidateDeps(sql: Pick<Tx["sql"], "get" | "all">) {
  return {
    bundles: TOOL_BUNDLES,
    mcpServers: new Map<string, McpServerConfig>(),
    roleCaps: ROLE_CAPS,
    // provider 정의 key는 provider 표 definition_key다. 기록이 없으면
    // undefined로 fail-closed다(R6).
    definitionKey: (provider: string) => {
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
    },
    catalogEntry: (providerDefinition: string, modelName: string) =>
      snapshotCatalogEntry(providerDefinition, modelName),
    modelListed: (providerDefinition: string, modelName: string) =>
      snapshotModelListed(providerDefinition, modelName),
    // credential은 provider_credentials 표의 현재 key 목록이다. 조회에 실패한
    // provider는 빈 목록으로 not_found다(R6).
    credentialKeys: (provider: string) => {
      try {
        return sql
          .all(
            "select key from provider_credentials where provider = ? order by order_index",
            [provider],
          )
          .map((row) => String(row["key"]));
      } catch {
        return [] as const;
      }
    },
  } as const;
}

const presetCommands = createPresetCommands((tx) => presetValidateDeps(tx.sql));
const presetReads = createPresetReads();
const assignmentCommands = createAssignmentCommands();
const assignmentReads = createAssignmentReads();

// run ledger(concern harness/run-loop). 접수·시작·checkpoint·종료는 machine,
// 멈춤은 사람과 machine, 다음 일 확인은 사람이다. 미반영 steering 판정은
// 입력 표를 소유한 conversation의 messages 표를 같은 Tx에서 읽는다(run-loop R14).
const runCommands = createRunCommands({ hasUnappliedSteering });
const runReads = createRunReads();

// Operator 주기 회차(concern scheduling). 회차 접수는 run-loop의 AcceptRun handler를
// 같은 Tx에서 부르고, 접수·기록·last_due_at 이동이 한 transaction이다(scheduling R4).
// AcceptRun은 machine 전용 기록이고 이 명령도 machine만 부르므로 자격은 그대로다.
const schedulingCommands = createSchedulingCommands({
  acceptRun: (tx, ctx, input, compare) =>
    runCommands.accept.handle(tx, ctx, input, compare),
});
const schedulingReads = createSchedulingReads();

// 세션과 메시지(concern conversation). 사람 입력 접수는 담당 run 접수와 한
// transaction이므로 run-loop의 AcceptRun handler를 같은 Tx에서 부른다. AcceptRun은
// machine 전용 기록이라 이 접수에 한해 machine 자격으로 바꿔 넘기고, 입력은 항상
// message 출처의 run이다. 바깥 command의 actor·event 기록은 그대로다.
const conversationCommands = createConversationCommands({
  acceptRun: (tx, ctx, input, compare) =>
    runCommands.accept.handle(tx, { ...ctx, actor: "machine" }, input, compare),
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

// run revert(concern revert). 종료한 run의 event 전체를 owner별로 분류해 복원 가능한 변경을
// 소유 concern의 새 변경으로 되돌린다. 문서 복원은 documents가 dispatchable로 선언한
// `document.archive`·`document.restore`를 같은 Tx에서 부르고(`tx.call`), 과거 사실은 모두
// 유지한다. 요청은 사람만 하고 확인 handle이 필요하다. 앱 복원 단계는 lophn-agent#T48이 더한다.
const revertOwners = defaultRevertOwners();
const revertCommands = createRevertCommands({ owners: revertOwners });
const revertReads = createRevertReads({ owners: revertOwners });

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

// agent 자격의 command(CreateQuestion 같은)는 자격에 묶인 run이 진행 중일 때만 통과한다
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

// approval 거절 억제(platform/approvals#R16)가 쓰는 run 계보 판정이다. 사람 요청에서 시작한 run은
// 그 message, handoff run은 runs/read의 source.original_message다. AcceptRun이 handoff의 original_message가
// sender chain의 시작과 같은지 검사하므로 한 번의 조회로 계보가 정해진다. 주기 회차는 계보가 없다.
const approvalLineagePort = defineTxPort(approvalRunLineage, (tx) => ({
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

// documents가 document.save·update의 같은 Tx에서 묻는 지침 문서 판정이다(documents/versions#R20).
// 지금 preset 판의 지침 첨부가 그 문서를 가리키면 비어 있지 않은 목록이다. 분류는 현재 상태로만 한다.
const instructionAttachmentsPort = defineTxPort(
  InstructionAttachments,
  (tx) => ({
    attachments: (document: string) => {
      const found = instructionAttachmentsOf(tx.sql, document);
      return found.ok
        ? ok(found.value.map(({ preset, revision }) => ({ preset, revision })))
        : found;
    },
  }),
);

export const lophnAgentDefinitions = {
  // settings registry 출처의 항목이다(platform/settings#R31). core 조립의 settings.ts가 모은다.
  settings: [
    catalogAutoUpdateSetting,
    skillFoldersSetting,
    mcpServersSetting,
    runModelAttemptsSetting,
    runStallSetting,
    runActiveSetting,
  ],
  schemaSteps: [
    ...providerSchemaSteps,
    ...modelSchemaSteps,
    ...usageSchemaSteps,
    ...presetSchemaSteps,
    ...assignmentSchemaSteps,
    ...runSchemaSteps,
    ...schedulingSchemaSteps,
    ...conversationSchemaSteps,
    ...toolsSchemaSteps,
    ...questionSchemaSteps,
    ...waitSchemaSteps,
    ...revertSchemaSteps,
  ],
  commands: [
    commands.register,
    commands.change,
    commands.registerCredential,
    commands.changeCredentials,
    commands.refreshCredential,
    commands.recordAvailability,
    commands.recordCheck,
    modelCommands.change,
    usage.start,
    usage.finish,
    usage.supplement,
    presetCommands.registerDefault,
    presetCommands.create,
    presetCommands.revise,
    assignmentCommands.createBuiltin,
    assignmentCommands.createAppEngineer,
    assignmentCommands.applyOperator,
    assignmentCommands.changePreset,
    assignmentCommands.pause,
    assignmentCommands.resume,
    assignmentCommands.withdraw,
    runCommands.accept,
    runCommands.start,
    runCommands.checkpoint,
    runCommands.finish,
    runCommands.stop,
    runCommands.confirmNext,
    schedulingCommands.process,
    conversationCommands.open,
    conversationCommands.changeWorkPlace,
    conversationCommands.close,
    conversationCommands.receive,
    conversationCommands.executeStored,
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
    revertCommands.run,
  ],
  reads: [
    reads.read,
    reads.list,
    reads.credentialList,
    modelReads.defaults,
    modelReads.catalog,
    usageReads.read,
    usageReads.list,
    usageReads.usage,
    presetReads.read,
    presetReads.list,
    presetReads.instructionAttachments,
    assignmentReads.read,
    assignmentReads.list,
    assignmentReads.outputs,
    runReads.read,
    runReads.list,
    runReads.result,
    schedulingReads.list,
    conversationReads.session,
    conversationReads.sessions,
    conversationReads.messages,
    handoffReads.status,
    handoffReads.result,
    toolReads.read,
    toolReads.list,
    questionReads.read,
    questionReads.list,
    revertReads.preview,
    revertReads.list,
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
    instructionAttachmentsPort,
    questionOptionPort,
  ],
  workers: [],
  // 문서·format tool의 글 값 통로다. 서빙은 core 조립이 한다(apps/core/tool-documents.ts).
  workerRoutes: TOOL_DOCUMENT_ROUTES,
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

export function createLedgerRegistration(
  environment: { messageBody?: MessageBodyEnvironment } = {},
) {
  return {
    // ReadQuestionText도 같은 읽기 통로(ledger snapshot과 blob 바이트)를 쓴다.
    apiReads: [
      messageBodyRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      questionTextRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
      // 복구가 저장된 run basis·model 응답·tool 결과를 다시 읽는 같은 길이다(machine만).
      runBodyRead(environment.messageBody ?? UNATTACHED_MESSAGE_BODY),
    ],
    // provider credential의 secret 값도 core의 알려진 값 registry에 등록·회수된다
    // (platform/secrets#R1). 외부 MCP credential은 extensions의 참조가 생기면 더한다.
    secretRefs: [createProviderSecretRefSource()],
  };
}

// question·assignment 계기 event의 공개 정책(platform/notifications#R1)은 notifications
// 구독자에게만 연다. revert event는 사람과 그 run의 assignment agent에게 연다(revert/visibility.ts).
// 다른 lophn-agent event는 정책이 없어 계속 숨김이다.
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
      ...createRevertEventVisibility(),
    ],
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
      reads.credentialList,
      modelReads.defaults,
      modelReads.catalog,
      usageReads.read,
      usageReads.list,
      usageReads.usage,
      presetReads.read,
      presetReads.list,
      presetReads.instructionAttachments,
      assignmentReads.read,
      assignmentReads.list,
      assignmentReads.outputs,
      runReads.read,
      runReads.list,
      runReads.result,
      schedulingReads.list,
      conversationReads.session,
      conversationReads.sessions,
      conversationReads.messages,
      handoffReads.status,
      handoffReads.result,
      toolReads.read,
      toolReads.list,
      questionReads.read,
      questionReads.list,
      revertReads.preview,
      revertReads.list,
    ],
    ports: new Map(),
  };
}
