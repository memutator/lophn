import { AsyncLocalStorage } from "node:async_hooks";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import {
  agentGrantsSet,
  approvalsDecide,
  approvalsDecideTurn,
  approvalsPending,
  toolGateCheck,
  toolGateInputSchema,
} from "../../../../protocol/approvals/mod.ts";
import { agentSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import {
  askAnswer,
  askRead,
  askWait,
} from "../../../../protocol/lophn-agent/ask-tool.ts";
import {
  createToolGate,
  type ToolGateDeps,
} from "../../../lophn-agent/tool-judgment/mod.ts";
import type { AgentRef } from "../../../../protocol/lophn-agent/places.ts";
import { createQuestionWaits } from "../../../lophn-agent/tools/questions/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  APPROVAL_INTERNAL_COMMANDS,
  approvalsRequest,
  approvalsUnapplied,
  createApprovalLedger,
  createApprovals,
  createGrants,
  createSessionAllowances,
  gate,
  loadAgentGrant,
} from "../../../approvals/mod.ts";
import { appGrantsList } from "../../../../protocol/apps/grants.ts";
import { APPS_CONTROL_CONTEXT } from "../../../apps/control.ts";
import type { Bus } from "../../../events/ports.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { Writer } from "../../../storage/ledger/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";
import type { SettingsReader } from "../../../../protocol/config/mod.ts";

// Approvals가 request 표에 쓰고 읽는 core 내부 machine 자격이다. 기동 때 ledger에 기록한다.
const APPROVALS_PRINCIPAL = "machine:approvals";

const APPROVALS_CONTEXT: AuthenticatedContext = {
  principal: APPROVALS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      ...APPROVAL_INTERNAL_COMMANDS.map((route) => route.name),
      approvalsUnapplied.name,
      approvalsRequest.name,
      approvalsPending.name,
      // tool Gate가 호출자 agent를 session으로 읽는다.
      agentSessionRead.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: APPROVALS_PRINCIPAL,
};

const DROPPING_BUS: Bus = {
  publish() {},
  subscribe: () => () => {},
};

const DEFAULT_SETTINGS: SettingsReader = {
  get: (setting) =>
    setting.default === undefined
      ? undefined
      : setting.type.parse(setting.default),
};

// 호출한 agent의 credential이 묶인 session·turn과 입력이 같을 때만 받는다.
function ownTurn(
  who: AuthenticatedContext,
  input: { session: string; turn: string },
): Result<void> {
  return who.actor === `agent:${input.session}` &&
      who.conditions.session === input.session &&
      who.conditions.turn === input.turn
    ? ok(undefined)
    : err({
      code: "forbidden",
      message: "the credential belongs to another session or turn",
    });
}

// runtime이 Gate가 걸리는 tool을 실행하기 직전에 부르는 입구다. 묻기, 사람 결정 기다리기, 허락 소비를 모두 여기서 한다.
export function toolGateHandler(deps: {
  approvals: ToolGateDeps["approvals"];
  agentOf(session: string): Promise<Result<AgentRef>>;
}): MemoryHandler {
  return async (who, body) => {
    const input = toolGateInputSchema.parse(body);
    const own = ownTurn(who, input);
    if (!own.ok) return own;
    const agent = await deps.agentOf(input.session);
    if (!agent.ok) return agent;
    const { kind, target, effect } = input.intent;
    const gate = createToolGate({
      approvals: deps.approvals,
      resolve: () => ok({ kind, target, effect }),
    });
    return ok(
      await gate.check({
        session: input.session as Id<"ses">,
        turn: input.turn as Id<"trn">,
        toolCall: input.tool_call as Id<"tcl">,
        agent: agent.value,
        tool: input.tool,
        input: input.intent.input,
      }),
    );
  };
}

export const approvalsWiring: WiringFactory = () => {
  let approvals: ReturnType<typeof createApprovals> | undefined;
  let stopWatching: (() => void) | undefined;
  // 내려갈 때 기다림을 모두 푼다. 풀지 않으면 기다리는 요청 때문에 서버가 멈추지 못한다.
  let releaseWaits: (() => void) | undefined;
  // "항상" 결정은 결정한 사람의 자격으로 agent grant를 쓴다. 결정 handler 안에서만 부른다.
  const human = new AsyncLocalStorage<AuthenticatedContext>();
  return {
    name: "approvals",
    records: () => [APPROVALS_CONTEXT],
    build(ctx) {
      // Bus는 events가 만들어 slot으로 낸다. slot이 비어 있으면 event를 버린다.
      const bus: Bus = ctx.peek.bus ?? DROPPING_BUS;
      // 설정은 config가 낸다. slot이 비어 있으면 선언의 기본값을 쓴다.
      const settings: SettingsReader = ctx.peek.settings ?? DEFAULT_SETTINGS;
      const writer = () => ctx.runtime.writer;
      const send = (
        who: AuthenticatedContext,
        command: string,
        input: unknown,
      ): Promise<Result<unknown>> =>
        writer().command(who, {
          command,
          input,
          idempotency_key: crypto.randomUUID(),
          compare: {},
          prepared: [],
        }).then((done) => done.ok ? ok(done.value.result) : done);
      const read =
        (path: string) => (agent: Parameters<typeof loadAgentGrant>[1]) => {
          const connection = openConnection(path);
          if (!connection.ok) return Promise.resolve(connection);
          try {
            return Promise.resolve(loadAgentGrant(connection.value.sql, agent));
          } finally {
            connection.value.close();
          }
        };
      const service = createApprovals({
        gate,
        grants: createGrants({
          async appGrantsOf(app) {
            const listed = await ctx.runtime.readers.read(
              appGrantsList,
              APPS_CONTROL_CONTEXT,
              { app, limit: 200 },
            );
            if (!listed.ok) return listed;
            return ok((listed.value as { grants: never[] }).grants);
          },
          readAgentGrant: read(ctx.ledgerPath),
          async writeAgentGrant(agent, entries) {
            const who = human.getStore();
            if (who === undefined) {
              return err({
                code: "forbidden",
                message: "only the user changes an agent grant",
              });
            }
            const done = await send(who, agentGrantsSet.name, {
              agent,
              entries,
            });
            if (!done.ok) return done;
            return ok((done.value as { grant: never }).grant);
          },
          settings,
        }),
        allowances: createSessionAllowances(),
        bus,
        ledger: createApprovalLedger({
          command: (name, input) => send(APPROVALS_CONTEXT, name, input),
          read: (route, input) =>
            ctx.runtime.readers.read(route, APPROVALS_CONTEXT as never, input),
        }),
        clock: ctx.clock,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
      });
      approvals = service;
      ctx.provide("approvals", service);
      const decideTurn: MemoryHandler = (who, body) =>
        human.run(who, () => service.decideTurn(who, body));

      // runtime의 Gate 입구와 ask 기다림이다. 기다림은 여기 main thread 메모리에 있고 runtime은 결과만 받는다.
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const waits = createQuestionWaits({ bus, clock: ctx.clock, ids });
      // turn이 끝나거나 session이 닫히면 기다리던 권한 물음과 질문을 cancelled로 푼다.
      // 사람이 기다리는 session에 메시지를 보내면 질문은 그 메시지로 풀린다.
      stopWatching = bus.subscribe([{
        types: ["TurnEnded", "SessionEnded", "MessageReceived"],
      }], {
        send(event) {
          if (!("session" in event)) return;
          if (event.type === "TurnEnded") {
            service.cancelTurnRequests(event.session, "turn_ended");
            waits.cancel(event.session, event.payload.turn);
          } else if (event.type === "SessionEnded") {
            service.cancelTurnRequests(event.session, "session_closed");
            waits.cancel(event.session);
          } else if (
            event.type === "MessageReceived" &&
            event.payload.from.kind === "human"
          ) {
            waits.humanMessage(event.session, event.payload.body);
          }
        },
        close() {},
      });
      const gating = new Set<string>();
      releaseWaits = () => {
        waits.cancelAll();
        for (const session of gating) {
          service.cancelTurnRequests(session, "restart");
        }
      };
      const toolGate = toolGateHandler({
        approvals: {
          ...service,
          openTurnRequest(intent) {
            if (intent.origin.kind === "turn") {
              gating.add(intent.origin.session);
            }
            return service.openTurnRequest(intent);
          },
        },
        async agentOf(session) {
          const found = await ctx.runtime.readers.read(
            agentSessionRead,
            APPROVALS_CONTEXT,
            { session },
          );
          if (!found.ok) return found;
          const { agent } = (found.value as {
            session: { agent: { role: string } };
          }).session;
          return agent.role === "coding_agent"
            ? err({ code: "forbidden", message: "not a lophn agent" })
            : ok(agent as AgentRef);
        },
      });
      const askWaitHandler: MemoryHandler = (who, body) => {
        const input = askWait.input.parse(body);
        const own = ownTurn(who, input);
        if (!own.ok) return own;
        return waits.ask(input, input.questions).then((result) => ok(result));
      };
      const humanOnly = (who: AuthenticatedContext): Result<void> =>
        who.actor === "user"
          ? ok(undefined)
          : err({ code: "forbidden", message: "only the user answers" });
      const askReadHandler: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = askRead.input.parse(body);
        return waits.read(input.session, input.tool_call);
      };
      const askAnswerHandler: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = askAnswer.input.parse(body);
        return waits.answer(input.session, input.tool_call, input.answers);
      };
      const key = (route: { resource: string; method: string }) =>
        `${route.resource}/${route.method}`;
      return ok({
        memory: [
          [key(approvalsDecideTurn), decideTurn],
          [key(toolGateCheck), toolGate],
          [key(askWait), askWaitHandler],
          [key(askRead), askReadHandler],
          [key(askAnswer), askAnswerHandler],
        ],
        // 사람이 허락하면 commit된 뒤 적용한다. 결과는 recordApplied가 남기고 그때 ApprovalDecided가 나간다.
        writer: (inner: Writer): Writer => ({
          async command(who, envelope) {
            const done = await inner.command(who, envelope);
            if (
              done.ok && !done.value.replayed &&
              envelope.command === approvalsDecide.name
            ) {
              const out = approvalsDecide.output.safeParse(done.value.result);
              if (out.success && out.data.request.status === "allow") {
                void service.applyAllowed(out.data.request).then((applied) => {
                  if (!applied.ok) {
                    console.error(
                      `approvals: could not record the apply result (${applied.error.code})`,
                    );
                  }
                });
              }
            }
            return done;
          },
          readResult: (who, key) => inner.readResult(who, key),
          close: () => inner.close(),
        }),
      });
    },
    closeIntake() {
      stopWatching?.();
      releaseWaits?.();
    },
    // 허락됐는데 결과를 남기기 전에 꺼진 request를 다시 적용한다. applier는 다른 wiring이 build에서 등록했다.
    async afterReady() {
      const resumed = await approvals?.resume();
      if (resumed !== undefined && !resumed.ok) {
        console.error(
          `approvals: could not resume applying (${resumed.error.code})`,
        );
      }
    },
  };
};
