import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import {
  DEFAULT_SHELL_RULES_SETTING,
  SHELL_RULES_SETTING_KEY,
  toolGateCheck,
  toolGateInputSchema,
  turnRequestDecide,
} from "../../../../protocol/approvals/mod.ts";
import { agentSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import type { TurnMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import {
  askAnswer,
  askRead,
  askWait,
} from "../../../../protocol/lophn-agent/ask-tool.ts";
import {
  createToolGate,
  type ToolGateDeps,
} from "../../../lophn-agent/tool-judgment/mod.ts";
import type {
  AgentRef,
  Place,
} from "../../../../protocol/lophn-agent/places.ts";
import { createQuestionWaits } from "../../../lophn-agent/tools/questions/mod.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { createApprovals } from "../../../approvals/mod.ts";
import { loadAssignment } from "../../../approvals/assignment/mod.ts";
import {
  shellRuleLayers,
  shellRulesSetting,
  withAlwaysRules,
} from "../../../approvals/shell-rules/mod.ts";
import type { Bus } from "../../../events/ports.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import type { WiringFactory } from "./context.ts";

// tool Gate가 session의 agent를 읽는 core 내부 machine 자격이다. 기동 때 ledger에 기록한다.
const APPROVALS_PRINCIPAL = "machine:approvals";

const APPROVALS_CONTEXT: AuthenticatedContext = {
  principal: APPROVALS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [agentSessionRead.name, turnRead.name],
    targets: {},
  },
  conditions: {},
  credential_ref: APPROVALS_PRINCIPAL,
};

const DROPPING_BUS: Bus = {
  publish() {},
  subscribe: () => () => {},
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

// runtime이 Gate가 걸리는 tool을 실행하기 직전에 부르는 입구다. 판정, 묻기, 사람 결정 기다리기를 모두 여기서 한다.
// mode는 그 turn 행의 mode다(시작 때 정해 바뀌지 않는다). 읽지 못하면 판정하지 않는다.
export function toolGateHandler(deps: {
  approvals: ToolGateDeps["approvals"];
  sessionOf(
    session: string,
  ): Promise<Result<{ agent: AgentRef; place: Place | null }>>;
  modeOf(turn: string): Promise<Result<TurnMode>>;
}): MemoryHandler {
  return async (who, body) => {
    const input = toolGateInputSchema.parse(body);
    const own = ownTurn(who, input);
    if (!own.ok) return own;
    const found = await deps.sessionOf(input.session);
    if (!found.ok) return found;
    const mode = await deps.modeOf(input.turn);
    if (!mode.ok) return mode;
    return await createToolGate({ approvals: deps.approvals }).check({
      session: input.session,
      turn: input.turn,
      toolCall: input.tool_call,
      agent: found.value.agent,
      place: found.value.place,
      mode: mode.value,
      tool: input.tool,
      call: input.call,
    });
  };
}

export const approvalsWiring: WiringFactory = () => {
  let stopWatching: (() => void) | undefined;
  // 내려갈 때 기다림을 모두 푼다. 풀지 않으면 기다리는 요청 때문에 서버가 멈추지 못한다.
  let releaseWaits: (() => void) | undefined;
  return {
    name: "approvals",
    records: () => [APPROVALS_CONTEXT],
    build(ctx) {
      // Bus는 events가 만들어 slot으로 낸다. slot이 비어 있으면 event를 버린다.
      const bus: Bus = ctx.peek.bus ?? DROPPING_BUS;
      // 할당은 ledger에서 그때그때 읽는다.
      const assignmentOf = (agent: AgentRef) => {
        const connection = openConnection(ctx.ledgerPath);
        if (!connection.ok) return Promise.resolve(connection);
        try {
          return Promise.resolve(loadAssignment(connection.value.sql, agent));
        } finally {
          connection.value.close();
        }
      };
      const shellRulesNow = () =>
        ctx.peek.settings?.get(shellRulesSetting) ??
        DEFAULT_SHELL_RULES_SETTING;
      const service = createApprovals({
        assignmentOf,
        // 판정마다 읽어 사람이 Settings에서 고친 값이 다음 호출부터 쓰인다.
        shellRules: (place) => shellRuleLayers(shellRulesNow(), place),
        bus,
        clock: ctx.clock,
        ids: createIdSource({ clock: ctx.clock, random: ctx.random }),
      });
      // `always`는 사람의 결정에서만 온다(decide는 사람 자격만 받는다). 규칙은 place로 고른 층에 더한다.
      service.remember("shell", (request, place) => {
        const next = withAlwaysRules(
          shellRulesNow(),
          place,
          request.always_patterns,
        );
        const written = ctx.settingsUpdate([
          { key: SHELL_RULES_SETTING_KEY, action: "set", value: next },
        ]);
        return Promise.resolve(
          !written.ok || written.value.rejected.length > 0
            ? err({
                code: "internal",
                message: "the shell rule could not be saved",
              })
            : ok(undefined),
        );
      });
      ctx.provide("approvals", service);

      // runtime의 Gate 입구와 ask 기다림이다. 기다림은 여기 main thread 메모리에 있고 runtime은 결과만 받는다.
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const waits = createQuestionWaits({ bus, clock: ctx.clock, ids });
      ctx.provide("questionWaits", waits);
      // turn이 끝나거나 session이 닫히면 기다리던 turn request와 질문을 cancelled로 푼다.
      // 사람이 기다리는 session에 메시지를 보내면 질문은 그 메시지로 풀린다.
      stopWatching = bus.subscribe(
        [
          {
            types: ["TurnEnded", "SessionEnded", "MessageReceived"],
          },
        ],
        {
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
        },
      );
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
          openTurnRequest(origin, subject) {
            gating.add(origin.session);
            return service.openTurnRequest(origin, subject);
          },
        },
        async sessionOf(session) {
          const found = await ctx.runtime.readers.read(
            agentSessionRead,
            APPROVALS_CONTEXT,
            { session },
          );
          if (!found.ok) return found;
          const { agent, place } = (
            found.value as {
              session: { agent: { role: string }; place: Place | null };
            }
          ).session;
          return agent.role === "coding_agent"
            ? err({ code: "forbidden", message: "not a lophn agent" })
            : ok({ agent: agent as AgentRef, place });
        },
        async modeOf(turn) {
          const found = await ctx.runtime.readers.read(
            turnRead,
            APPROVALS_CONTEXT,
            { turn },
          );
          if (!found.ok) return found;
          return ok((found.value as { turn: { mode: TurnMode } }).turn.mode);
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
          [key(turnRequestDecide), (who, body) => service.decide(who, body)],
          [key(toolGateCheck), toolGate],
          [key(askWait), askWaitHandler],
          [key(askRead), askReadHandler],
          [key(askAnswer), askAnswerHandler],
        ],
      });
    },
    closeIntake() {
      stopWatching?.();
      releaseWaits?.();
    },
  };
};
