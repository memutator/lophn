import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  removeQueued,
  steerQueuedNow,
} from "../../../../protocol/lophn-agent/inputs.ts";
import { providerList, ROLES } from "../../../../protocol/lophn-agent/mod.ts";
import {
  agentConditions,
  roleOperations,
} from "../../../agent-roles/credentials.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import { FILE_HOOKS } from "../../../agent-roles/hooks.ts";
import { messageRemoveQueued } from "../../../lophn-agent/session/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
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
import { skillFoldersSetting } from "../../../lophn-agent/extensions/mod.ts";
import { appSocketRoot } from "../../../apps/control.ts";
import { agentTools } from "../../agent-tools.ts";
import type { WiringFactory } from "./context.ts";

// 입력함에서 뺀 메시지를 session 기록에서도 지우는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const SESSION_INPUTS_PRINCIPAL = "machine:session-inputs";

const SESSION_INPUTS_CONTEXT: AuthenticatedContext = {
  principal: SESSION_INPUTS_PRINCIPAL,
  actor: "machine",
  scope: { operations: [messageRemoveQueued.name], targets: {} },
  conditions: {},
  credential_ref: SESSION_INPUTS_PRINCIPAL,
};

export const lophnAgentRuntimeWiring: WiringFactory = () => {
  let agentRuntime: AgentRuntimeChild | undefined;
  // 입력함은 core 메모리 하나다. Router의 lophn 입력 transport가 같은 것에 넣는다.
  const inbox = createInbox();
  return {
    name: "lophn-agent-runtime",
    // Router가 같은 입력함에 넣는다.
    prepare(ctx) {
      ctx.provide("inbox", inbox);
      // io는 supervision wiring이 채우므로 호출 때 읽는다. 없거나 종료 뒤여도 던지지 않고 불가를 돌려준다.
      ctx.componentChecks.push({
        component: "agent-runtime",
        check: () =>
          Promise.resolve(
            ctx.peek.io?.observation(AGENT_RUNTIME_KIND).available
              ? { available: true }
              : { available: false, reason: "agent runtime이 준비되지 않았다" },
          ),
      });
    },
    records: () => [SESSION_INPUTS_CONTEXT],
    // 입력함의 사람 메시지를 지금 steer로 올리거나 뺀다. 입력함은 이 프로세스의 메모리다.
    build(ctx) {
      const humanOnly = (who: AuthenticatedContext): Result<void> =>
        who.actor === "user"
          ? ok(undefined)
          : err({ code: "forbidden", message: "only the user does this" });
      const taken = () =>
        err({
          code: "conflict" as const,
          message: "the turn already took this message",
        });
      const steerNow: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = steerQueuedNow.input.parse(body);
        return inbox.steerNow(input.session as Id<"ses">, input.message)
          ? ok({ message: input.message })
          : taken();
      };
      // 기록을 먼저 지운다. 이미 turn이 가져간 메시지는 거기서 conflict로 막힌다.
      const remove: MemoryHandler = async (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = removeQueued.input.parse(body);
        const done = await ctx.runtime.writer.command(SESSION_INPUTS_CONTEXT, {
          command: messageRemoveQueued.name,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        });
        if (!done.ok) return done;
        inbox.remove(input.session as Id<"ses">, input.message);
        return ok({ message: input.message });
      };
      const key = (route: { resource: string; method: string }) =>
        `${route.resource}/${route.method}`;
      return ok({
        memory: [[key(steerQueuedNow), steerNow], [key(removeQueued), remove]],
      });
    },
    // agent runtime(machine)과 turn의 agent 자격이 닿는 operation.
    operations: (ctx) =>
      agentRuntimePolicies(
        ctx.allRoutes,
        ROLES.flatMap((role) =>
          roleOperations(role, agentTools({ file: FILE_HOOKS }))
        ),
      ),
    // agent runtime child. API가 열린 뒤에 띄워 hello 직후의 읽기가 닿는다. 띄우지 못해도 core는
    // 계속 선다: agent는 돌지 않고 사람의 요청은 접수된 채 남는다.
    async afterReady(ctx) {
      const { runtime } = ctx;
      const started = await startAgentRuntimeChild({
        io: ctx.io,
        operationsFor: (role) =>
          roleOperations(role, agentTools({ file: FILE_HOOKS })),
        conditionsFor: agentConditions,
        diagnostic: (message) =>
          void ctx.diagnosticsWrite({
            ...message,
            payload: { ...message.payload, component: AGENT_RUNTIME_KIND },
          }).catch(() => {}),
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
        readSkillRoots: () =>
          Promise.resolve(ok(ctx.settings.get(skillFoldersSetting) ?? [])),
      });
      if (started.ok) agentRuntime = started.value;
      else console.error(`agent runtime: ${started.error.message}`);
    },
    closeIntake() {
      agentRuntime?.stop();
    },
  };
};
