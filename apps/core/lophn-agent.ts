import { z } from "zod";
import {
  defineSetting,
  type KindLaunchSpec,
} from "../../packages/contracts/platform/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";
import {
  createModelDefaultsCommands,
  createModelDefaultsReads,
  modelSchemaSteps,
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
const modelCommands = createModelDefaultsCommands();
const usage = createUsageCommands();
const reads = createProviderReads();
const modelReads = createModelDefaultsReads();
const usageReads = createUsageReads();

export const lophnAgentDefinitions = {
  schemaSteps: [
    ...providerSchemaSteps,
    ...modelSchemaSteps,
    ...usageSchemaSteps,
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
  ],
  // model.call 본문은 blob 참조만 남는다(R4). 용량 보존 종류는 plan blob 자리다.
  blobFields: [...modelCallBodyFields],
  workers: [],
};

// reader Worker가 이 등록 파일에서 팀 read를 다시 조립한다. provider·model read는
// event를 보지 않는다. usage read도 event를 보지 않는다.
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
    ],
    ports: new Map(),
  };
}
