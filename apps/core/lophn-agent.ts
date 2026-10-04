import { z } from "zod";
import {
  defineSetting,
  type KindLaunchSpec,
} from "../../packages/contracts/platform/mod.ts";
import {
  createCatalogRead,
} from "../../packages/lophn-agent/harness/model/mod.ts";

// agent runtime 등록 뼈대. command·read·schema는 나중 작업이 이 객체에 더한다.
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

// core read는 derived catalog 상태를 읽는다(architecture §5.3). refresh는
// runtime 작업이므로 여기 read만 등록한다.
export const catalogReadDefinition = createCatalogRead();

export const lophnAgentDefinitions = {
  workers: [],
  reads: [catalogReadDefinition],
};
