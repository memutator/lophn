import { z } from "zod";
import {
  defineSetting,
  type KindLaunchSpec,
} from "../../packages/contracts/platform/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";
import type { Tx } from "../../packages/contracts/platform/mod.ts";
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
  presetSchemaSteps,
  ROLE_CAPS,
} from "../../packages/lophn-agent/presets/mod.ts";
import {
  createToolCommands,
  createToolReads,
  toolCallBodyFields,
  toolsSchemaSteps,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import type { McpServerConfig } from "../../packages/contracts/lophn-agent/mod.ts";

// agent runtime 등록 뼈대. worker는 나중 작업이 이 객체에 더한다.
// 권한 목록은 architecture §2.3의 최소다. host·skill·MCP를 등록하면 core가 목록을 바꿔 재기동한다.
export function agentRuntimeLaunchSpec(input: {
  dataRoot: string;
  apiPort: number;
}): KindLaunchSpec {
  return {
    kind: "lophn-agent/runtime",
    entry: new URL("../agent-runtime/main.ts", import.meta.url).pathname,
    allow_read: [input.dataRoot],
    // derived만 쓴다. ledger·blob·원본은 쓰지 않는다.
    allow_write: [`${input.dataRoot}/derived/lophn-agent`],
    // core loopback만. provider·MCP host와 공개 models.dev는 등록될 때 더한다.
    allow_net: [`127.0.0.1:${input.apiPort}`],
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
const usage = createUsageCommands();
const reads = createProviderReads();
const modelReads = createModelDefaultsReads();
const usageReads = createUsageReads();

// preset 구성 검증 deps(R11). MCP server 설정은 extensions의 settings registry
// 값이므로 setting_choices 행을 펼친다(contracts#T24). tool 묶음은 T23이다. 역할
// 상한은 T8이 고정한 ROLE_CAPS 표다. catalog는 동봉 snapshot에서 읽고(T4,
// harness/model R5), credential key와 provider 정의 key는 같은 Tx의 provider
// 표·provider_credentials 표에서 읽는다(R6, R10).
function presetValidateDeps(sql: Pick<Tx["sql"], "get" | "all">) {
  return {
    bundles: new Map<string, readonly string[]>(),
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

// tool call ledger(concern harness/tools). 기록은 machine 전용이다. 입력·출력
// 원문은 blob 참조만 남긴다.
const toolCommands = createToolCommands();
const toolReads = createToolReads();

export const lophnAgentDefinitions = {
  schemaSteps: [
    ...providerSchemaSteps,
    ...modelSchemaSteps,
    ...usageSchemaSteps,
    ...presetSchemaSteps,
    ...toolsSchemaSteps,
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
    toolCommands.request,
    toolCommands.decide,
    toolCommands.start,
    toolCommands.finish,
    toolCommands.recordRead,
    toolCommands.supplement,
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
    toolReads.read,
    toolReads.list,
  ],
  // model.call 본문은 blob 참조만 남는다(R4). tool call 입력·출력도 같은 종류다.
  blobFields: [...modelCallBodyFields, ...toolCallBodyFields],
  workers: [],
};

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
      toolReads.read,
      toolReads.list,
    ],
    ports: new Map(),
  };
}
