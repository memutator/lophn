import type { KindLaunchSpec } from "../../packages/contracts/platform/mod.ts";
import type { ReaderRegistration } from "../../packages/platform/ledger/mod.ts";
import {
  createProviderCommands,
  createProviderReads,
  providerSchemaSteps,
} from "../../packages/lophn-agent/harness/provider/mod.ts";

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
    // core loopback만. provider·MCP host는 등록될 때 더한다.
    allow_net: [`127.0.0.1:${input.apiPort}`],
    allow_run: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
    policy: "always",
    memory_limit_bytes: 512 * 1024 * 1024,
  };
}

// provider·credential ledger. 값은 OS keychain에만 있고 이곳에는 참조만 남는다.
const commands = createProviderCommands();
const reads = createProviderReads();
export const lophnAgentDefinitions = {
  schemaSteps: providerSchemaSteps,
  commands: [
    commands.register,
    commands.change,
    commands.registerCredential,
    commands.changeCredentials,
    commands.refreshCredential,
    commands.recordAvailability,
    commands.recordCheck,
  ],
  reads: [reads.read, reads.list, reads.credentialList],
  workers: [],
};

// reader Worker가 이 등록 파일에서 팀 read를 다시 조립한다. provider read는 event를 보지 않는다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [reads.read, reads.list, reads.credentialList],
    ports: new Map(),
  };
}
