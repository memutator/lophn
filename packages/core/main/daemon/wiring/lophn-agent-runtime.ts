import type { ContentBlock } from "../../../../protocol/lophn-agent/content-block.ts";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import {
  editQueued,
  moveQueued,
  removeQueued,
  steerQueuedNow,
} from "../../../../protocol/lophn-agent/inputs.ts";
import {
  editQueuedMessage,
  interruptTurns,
  moveQueuedMessage,
  OAUTH_REFRESH_LEAD_MS,
  WORKSPACE_KINDS,
  type ProviderRecord,
  providerList,
  providerRead,
  recordProviderModels,
  refreshProviderCredential,
} from "../../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { ParentMessage } from "../../../../protocol/supervision/mod.ts";
import {
  agentConditions,
  workspaceOperations,
} from "../../../agent-workspaces/credentials.ts";
import { FILE_HOOKS } from "../../../agent-workspaces/hooks.ts";
import { toolsCloseStuckSteps } from "../../../lophn-agent/tools/mod.ts";
import { createProviderRefresher } from "../../../lophn-agent/providers/oauth-refresh.ts";
import {
  createQueue,
  createTurnSource,
  createTurnStarter,
} from "../../../lophn-agent/run-loop/mod.ts";
import {
  AGENT_RUNTIME_KIND,
  AGENT_RUNTIME_TASK,
  type AgentRuntimeChild,
  agentRuntimePolicies,
  startAgentRuntimeChild,
} from "../../../lophn-agent/run-loop/runtime.ts";
import { createAgentRuntimeSecrets } from "../../../lophn-agent/run-loop/runtime-secret.ts";
import { messageRemoveQueued } from "../../../lophn-agent/session/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import { relayChildLine } from "../../../diagnostics/mod.ts";
import { agentTools } from "../../agent-tools.ts";
import type { WiringFactory } from "./context.ts";

// queue에서 뺀 메시지를 session 기록에서도 지우는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const SESSION_INPUTS_PRINCIPAL = "machine:session-inputs";

const SESSION_INPUTS_CONTEXT: AuthenticatedContext = {
  principal: SESSION_INPUTS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      messageRemoveQueued.name,
      editQueuedMessage.name,
      moveQueuedMessage.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: SESSION_INPUTS_PRINCIPAL,
};

// 구독 provider의 OAuth token을 runtime에 건네기 직전에 갱신하는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const PROVIDER_REFRESH_PRINCIPAL = "machine:provider-refresh";

const PROVIDER_REFRESH_CONTEXT: AuthenticatedContext = {
  principal: PROVIDER_REFRESH_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      providerRead.name,
      providerList.name,
      refreshProviderCredential.name,
      recordProviderModels.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: PROVIDER_REFRESH_PRINCIPAL,
};

// agent runtime child가 사라질 때 돌던 turn을 닫는 core 안 machine 자격이다. 기동 때 ledger에 기록한다.
const RUNTIME_END_PRINCIPAL = "machine:runtime-end";

const RUNTIME_END_CONTEXT: AuthenticatedContext = {
  principal: RUNTIME_END_PRINCIPAL,
  actor: "machine",
  scope: { operations: [interruptTurns.name], targets: {} },
  conditions: {},
  credential_ref: RUNTIME_END_PRINCIPAL,
};

export const lophnAgentRuntimeWiring: WiringFactory = () => {
  let agentRuntime: AgentRuntimeChild | undefined;
  let stopWatching: (() => void) | undefined;
  // queue는 core 메모리 하나다. Router의 lophn 입력 transport가 같은 것에 넣는다.
  const queue = createQueue();
  return {
    name: "lophn-agent-runtime",
    schemaStepsAfterTeams: toolsCloseStuckSteps,
    // Router가 같은 queue에 넣는다.
    prepare(ctx) {
      ctx.provide("queue", queue);
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
    records: () => [
      SESSION_INPUTS_CONTEXT,
      PROVIDER_REFRESH_CONTEXT,
      RUNTIME_END_CONTEXT,
    ],
    // queue의 사람 메시지를 지금 steer로 올리거나 뺀다. queue는 이 프로세스의 메모리다.
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
        if (!queue.steerNow(input.session as Id<"ses">, input.message)) {
          return taken();
        }
        // queue는 메모리라 화면이 알 길이 event뿐이다. 다음 turn 줄에서 대화로 옮긴다.
        ctx.bus.publish({
          session: input.session as Id<"ses">,
          type: "MessageSteered",
          at: ctx.clock.now(),
          payload: { message: input.message as Id<"msg"> },
        });
        return ok({ message: input.message });
      };
      // 기록을 먼저 지운다. 이미 turn이 가져간 메시지는 거기서 conflict로 막힌다.
      const remove: MemoryHandler = async (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = removeQueued.input.parse(body);
        const done = await ctx.writer.command(SESSION_INPUTS_CONTEXT, {
          command: messageRemoveQueued.name,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        });
        if (!done.ok) return done;
        queue.remove(input.session as Id<"ses">, input.message);
        ctx.bus.publish({
          session: input.session as Id<"ses">,
          type: "MessageRemoved",
          at: ctx.clock.now(),
          payload: { message: input.message as Id<"msg"> },
        });
        return ok({ message: input.message });
      };
      // 저장된 본문을 먼저 바꾼다. 이미 turn이 가져간 메시지는 거기서 conflict로 막힌다.
      const edit: MemoryHandler = async (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = editQueued.input.parse(body);
        const done = await ctx.writer.command(SESSION_INPUTS_CONTEXT, {
          command: editQueuedMessage.name,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        });
        if (!done.ok) return done;
        // command가 redaction을 거친 block을 돌려준다. queue도 그 본문으로 바꾼다.
        const { content } = done.value.result as { content: ContentBlock[] };
        queue.edit(input.session as Id<"ses">, input.message, content);
        return ok({ message: input.message });
      };
      // 표의 순서를 먼저 바꾼다. 켤 때 queue에 다시 넣는 순서도 같은 표를 따른다.
      const move: MemoryHandler = async (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = moveQueued.input.parse(body);
        const done = await ctx.writer.command(SESSION_INPUTS_CONTEXT, {
          command: moveQueuedMessage.name,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        });
        if (!done.ok) return done;
        queue.move(input.session as Id<"ses">, input.message, input.direction);
        return ok({ message: input.message });
      };
      const key = (route: { resource: string; method: string }) =>
        `${route.resource}/${route.method}`;
      return ok({
        memory: [
          [key(steerQueuedNow), steerNow],
          [key(removeQueued), remove],
          [key(editQueued), edit],
          [key(moveQueued), move],
        ],
      });
    },
    // agent runtime(machine)과 turn의 agent 자격이 닿는 operation.
    operations: (ctx) =>
      agentRuntimePolicies(
        ctx.allRoutes,
        WORKSPACE_KINDS.flatMap((kind) =>
          workspaceOperations(kind, agentTools({ file: FILE_HOOKS })),
        ),
      ),
    // agent runtime child. API가 열린 뒤에 띄워 hello 직후의 읽기가 닿는다. 띄우지 못해도 core는
    // 계속 선다: agent는 돌지 않고 사람의 요청은 접수된 채 남는다.
    async afterReady(ctx) {
      const { runtime } = ctx;
      const refresher = createProviderRefresher({
        async readProvider(provider) {
          const read = await runtime.readers.read(
            providerRead,
            PROVIDER_REFRESH_CONTEXT,
            { provider },
          );
          if (read.ok) {
            return ok((read.value as { provider: ProviderRecord }).provider);
          }
          return read.error.code === "not_found" ? ok(null) : read;
        },
        async listProviders() {
          const rows: ProviderRecord[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < 20; page += 1) {
            const read = await runtime.readers.read(
              providerList,
              PROVIDER_REFRESH_CONTEXT,
              cursor === undefined ? {} : { cursor },
            );
            if (!read.ok) return read;
            const value = read.value as {
              providers: ProviderRecord[];
              next_cursor: string | null;
            };
            rows.push(...value.providers);
            if (value.next_cursor === null) break;
            cursor = value.next_cursor;
          }
          return ok(rows);
        },
        secrets: ctx.secretStore,
        http: ctx.issuerRequests.fetch,
        record: (provider, result, credentialId) =>
          ctx.writer.command(PROVIDER_REFRESH_CONTEXT, {
            command: refreshProviderCredential.name,
            input: {
              provider: provider.id,
              ...(credentialId === undefined
                ? {}
                : { credential: credentialId }),
              expires_at: "expires_at" in result ? result.expires_at : null,
              unavailable_reason:
                "unavailable_reason" in result
                  ? result.unavailable_reason
                  : null,
            },
            idempotency_key: crypto.randomUUID(),
            compare: { revision: provider.revision },
            prepared: [],
          }),
        recordModels: (provider, roster, credentialId) =>
          ctx.writer.command(PROVIDER_REFRESH_CONTEXT, {
            command: recordProviderModels.name,
            input: {
              provider: provider.id,
              ...(credentialId === undefined
                ? {}
                : { credential: credentialId }),
              models: roster.models,
              model_limits: roster.limits,
            },
            idempotency_key: crypto.randomUUID(),
            compare: { revision: provider.revision },
            prepared: [],
          }),
        nowMs: () => ctx.clock.nowMs(),
        leadMs: OAUTH_REFRESH_LEAD_MS,
      });
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const started = await startAgentRuntimeChild({
        io: ctx.io,
        operationsFor: (kind) =>
          workspaceOperations(kind, agentTools({ file: FILE_HOOKS })),
        conditionsFor: agentConditions,
        diagnostic: (message) =>
          void ctx
            .diagnosticsWrite({
              ...message,
              payload: { ...message.payload, component: AGENT_RUNTIME_KIND },
            })
            .catch(() => {}),
        stderr: (line) =>
          relayChildLine(ctx.telemetry.logger, "agent-runtime", line),
        registry: ctx.registry,
        record: (context) => runtime.record(context),
        turns: createTurnSource({
          queue,
          starter: createTurnStarter({ queue }),
        }),
        publish: ctx.bus.publish,
        // child가 보낸 쓰는 중인 model 날 글. core가 redaction해 `ModelOutputStreamed`로 낸다. 칸은 부를 때 읽는다.
        output: (batch) => ctx.liveTurns.output(batch),
        onGiveUp: (reason, retry) =>
          ctx.telemetry.logger.error({
            component: "agent-runtime",
            event: reason === "retry_failed" ? "retry_failed" : "gave_up",
            fields: { reason, retry },
          }),
        queue,
        // TurnEnded는 commit 뒤에 Bus로 나가 권한 요청과 질문의 기다림을 푼다.
        interruptTurns: () =>
          ctx.writer.command(RUNTIME_END_CONTEXT, {
            command: interruptTurns.name,
            input: {},
            idempotency_key: ids.newId("idk"),
            compare: {},
            prepared: [],
          }),
        epoch: ctx.epoch,
        apiPort: ctx.server.port,
        gauge: ctx.blobBuffer,
        prepareBlob: (call) => ctx.blobRelay.prepare(call),
        read: (route, context, input) =>
          runtime.readers.read(route, context, input),
        known: () => ctx.knownSecrets,
        secrets: createAgentRuntimeSecrets({
          attach: ctx.secretAttach,
          known: () => ctx.knownSecrets,
          process: AGENT_RUNTIME_KIND,
          task: AGENT_RUNTIME_TASK,
          mcpOAuth: ctx.mcpAuthControl.prepareToken,
          providerOAuth: refresher.prepareToken,
        }),
      });
      if (started.ok) agentRuntime = started.value;
      else {
        ctx.telemetry.logger.error({
          component: "agent-runtime",
          event: "start_failed",
          message: started.error.message,
        });
      }
      // 사람의 멈춤이나 session 끝남(archive·delete)이 turn 행을 닫으면(TurnEnded) 그 뒤에 child에 알려 진행 중인 model 요청과 tool을 끊게 한다.
      // child가 다시 뜨는 중이라 못 보내면 버린다: 새 child는 닫힌 turn을 시작하지 않는다.
      stopWatching = ctx.bus.subscribe([{ types: ["TurnEnded"] }], {
        send(event) {
          if (event.type !== "TurnEnded") return;
          const { outcome } = event.payload;
          if (outcome.kind !== "interrupted") return;
          if (
            outcome.reason !== "user_stopped" &&
            outcome.reason !== "session_ended"
          )
            return;
          void ctx.io
            .send(AGENT_RUNTIME_KIND, {
              type: "turn_stop",
              turn: event.payload.turn,
              reason: outcome.reason,
            } satisfies ParentMessage)
            .catch(() => {});
        },
        close() {},
      });
    },
    closeIntake() {
      stopWatching?.();
      agentRuntime?.stop();
    },
  };
};
