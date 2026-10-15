import { ok } from "../../../../base/mod.ts";
import { providerList } from "../../../../protocol/lophn-agent/mod.ts";
import { settingsGet } from "../../../../protocol/config/mod.ts";
import {
  AGENT_RUNTIME_KIND,
  AGENT_RUNTIME_TASK,
  type AgentRuntimeChild,
  agentRuntimePolicies,
  providerHost,
  startAgentRuntimeChild,
} from "../../../lophn-agent/run-loop/runtime.ts";
import {
  createInbox,
  createTurnSource,
  createTurnStarter,
} from "../../../lophn-agent/run-loop/mod.ts";
import { createAgentRuntimeSecrets } from "../../../lophn-agent/run-loop/runtime-secret.ts";
import { mcpServerSnapshot } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { skillFoldersSetting } from "../../../../protocol/lophn-agent/mod.ts";
import { appSocketRoot } from "../../../apps/control.ts";
import type { WiringFactory } from "./context.ts";

export const lophnAgentRuntimeWiring: WiringFactory = () => {
  let agentRuntime: AgentRuntimeChild | undefined;
  // 입력함은 core 메모리 하나다. Router의 lophn 입력 transport가 같은 것에 넣는다.
  const inbox = createInbox();
  return {
    name: "lophn-agent-runtime",
    // agent runtime(machine)과 run의 agent 자격이 닿는 operation(lophn-agent/harness/run-loop).
    operations: (ctx) => agentRuntimePolicies(ctx.allRoutes),
    // agent runtime child. API가 열린 뒤에 띄워 hello 직후의 읽기가 닿는다. 띄우지 못해도 core는
    // 계속 선다: agent는 돌지 않고 사람의 요청은 접수된 채 남는다.
    async afterReady(ctx) {
      const { runtime } = ctx;
      const started = await startAgentRuntimeChild({
        io: ctx.io,
        registry: ctx.registry,
        record: (context) => runtime.record(context),
        turns: createTurnSource({
          inbox,
          starter: createTurnStarter({ inbox }),
        }),
        publish: ctx.bus.publish,
        epoch: ctx.epoch,
        dataRoot: ctx.root.path,
        apiPort: ctx.server.port,
        socketRoot: appSocketRoot(),
        gauge: ctx.blobBuffer,
        prepareBlob: (call) => ctx.blobRelay.prepare(call),
        read: (route, context, input) =>
          runtime.readers.read(route, context, input),
        known: () => ctx.knownSecrets,
        secrets: createAgentRuntimeSecrets({
          ledgerPath: ctx.ledgerPath,
          keychain: () => ctx.options.codingKeychain,
          known: () => ctx.knownSecrets,
          process: AGENT_RUNTIME_KIND,
          task: AGENT_RUNTIME_TASK,
          mcpOAuth: ctx.mcpAuthControl.tokenUse,
        }),
        readMcpServers: () => mcpServerSnapshot(ctx.ledgerPath),
        readProviders: async (context) => {
          const hosts = new Set<string>();
          let cursor: string | undefined;
          for (;;) {
            const read = await runtime.readers.read(
              providerList,
              context,
              cursor === undefined ? {} : { cursor },
            );
            if (!read.ok) return read;
            const page = read.value as {
              providers: { endpoint: string }[];
              next_cursor?: string | null;
            };
            for (const provider of page.providers) {
              const host = providerHost(provider.endpoint);
              if (host !== undefined) hosts.add(host);
            }
            if (page.next_cursor === null || page.next_cursor === undefined) {
              return ok([...hosts].sort());
            }
            cursor = page.next_cursor;
          }
        },
        readSkillRoots: async (context) => {
          const read = await runtime.readers.read(settingsGet, context, {
            keys: [skillFoldersSetting.key],
          });
          if (!read.ok) return read;
          const setting = (read.value as {
            settings: { key: string; value: unknown }[];
          }).settings.find((each) => each.key === skillFoldersSetting.key);
          const shaped = skillFoldersSetting.value_type.safeParse(
            setting?.value ?? [],
          );
          return ok(shaped.success ? shaped.data : []);
        },
      });
      if (started.ok) agentRuntime = started.value;
      else console.error(`agent runtime: ${started.error.message}`);
    },
    closeIntake() {
      agentRuntime?.stop();
    },
  };
};
