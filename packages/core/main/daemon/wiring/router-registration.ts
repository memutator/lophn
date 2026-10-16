// Router의 writer·reader Worker 쪽 등록 file이다. Worker가 팀 등록 file로 import하면 Router가 쓸 바깥 구현
// (session 목록, 입력 transport, Gate)을 이 file이 끼운다. main thread의 wiring은 router.ts다.
import { err, ok } from "../../../../base/mod.ts";
import type { AgentRef } from "../../../../protocol/lophn-agent/places.ts";
import type {
  CallAgent,
  CallFrom,
} from "../../../../protocol/lophn-agent/calls.ts";
import type { Intent } from "../../../../protocol/approvals/mod.ts";
import { gate } from "../../../approvals/gate/mod.ts";
import { loadAgentGrant } from "../../../approvals/grants/mod.ts";
import {
  createReceivedRecorder,
  createSessionDirectory,
  placeDepsOf,
} from "../../../lophn-agent/places/mod.ts";
import { loadSession, placeOf } from "../../../lophn-agent/session/model.ts";
import {
  createLophnInputTransport,
  interruptRunningTurns,
  publishAfterCommit,
} from "../../../lophn-agent/run-loop/mod.ts";
import {
  createCallStore,
  createRouterReaderRegistration,
  createRouterRegistration,
  installRouterEnvironment,
  type RouterEnvironment,
} from "../../../router/mod.ts";
import type { CallGate, InputTransport } from "../../../router/ports.ts";
import { afterCommit } from "../../../storage/ledger/after-commit.ts";
import { AGENT_EVENT_TOPIC } from "../../../lophn-agent/run-loop/topics.ts";

function agentRefOf(agent: CallAgent): AgentRef | null {
  return agent.role === "coding_agent" ? null : agent;
}

const ASK_IN_TX = {
  code: "forbidden" as const,
  message: "the grant asks, and a call cannot wait for an answer here",
};

// 보낸 agent의 agent grant로 받는 agent를 판정한다. command는 tx 안이라 사람의 답을 기다릴 수 없다. 묻는 grant는
// 보낸 turn이 ToolGate에서 이미 허락을 받았을 때만 통과하고 아니면 거절이다(fail-closed). deny는 늘 거절이다.
export function callGate(
  sql: Parameters<typeof loadAgentGrant>[0],
  senderAgent: (session: string) => CallAgent | null,
): CallGate {
  function verdict(sender: CallFrom, target: CallAgent) {
    if (sender.kind !== "agent") return null;
    const own = senderAgent(sender.session);
    const ref = own === null ? null : agentRefOf(own);
    if (ref === null) return null;
    const grant = loadAgentGrant(sql, ref);
    if (!grant.ok) return null;
    const intent: Intent = {
      kind: "agent_call",
      actor: { kind: "agent", agent: ref, session: sender.session },
      target: { kind: "agent_call", agent: target },
      effect: "read",
      input: {},
      origin: { kind: "event", seq: "0" },
    };
    return gate(intent, { app: [], agent: grant.value, reaction: {} as never });
  }
  return {
    authorize(sender, target, gateAllowed) {
      const decided = verdict(sender, target);
      if (decided === null) {
        return err({ code: "forbidden", message: "no grant to call" });
      }
      if (decided.verdict === "run") return ok(undefined);
      if (decided.verdict === "ask" && gateAllowed) return ok(undefined);
      return err(
        decided.verdict === "ask"
          ? ASK_IN_TX
          : { code: "forbidden", message: "the grant denies this call" },
      );
    },
    visible(sender, target) {
      const decided = verdict(sender, target);
      return decided !== null && decided.verdict !== "deny";
    },
  };
}

const environment: RouterEnvironment = {
  deps(view, who) {
    const directory = createSessionDirectory({
      ...placeDepsOf(view.sql),
      // 새 session의 SessionStarted는 commit 뒤에 Bus로 낸다.
      publish: (event) => view.port(afterCommit).push(AGENT_EVENT_TOPIC, event),
      sql: () => view.sql,
    });
    const lophn = createLophnInputTransport({
      record: (tx, session, input) =>
        createReceivedRecorder({ principal: who }).record(tx, session, input),
    });
    // coding agent의 transport는 coding-agent 단위가 끼운다.
    const transport: InputTransport = {
      deliver: (tx, target, input, options) =>
        target.transport === "lophn"
          ? lophn.deliver(tx, target, input, options)
          : err({
            code: "unavailable",
            message: "the coding agent transport is not wired",
          }),
      cancel: (tx, target, call) => lophn.cancel(tx, target, call),
      queued: () => [],
    };
    return {
      directory,
      transport,
      store: createCallStore(),
      gate: callGate(view.sql, (session) => {
        const target = directory.find(session as never);
        return target === null ? null : target.agent;
      }),
    };
  },
  interruptRunningTurns: (tx) =>
    interruptRunningTurns(tx, publishAfterCommit, "restarted"),
  describe(view, target) {
    const row = loadSession(view, target.session as never);
    const running = view.sql.get(
      "select 1 as found from turns where session = ? and state = 'running'",
      [target.session],
    ) !== undefined;
    return {
      place: row === undefined ? null : placeOf(row),
      state: running ? "running" : "idle",
    };
  },
};

installRouterEnvironment(environment);

export const createCoreRegistration = createRouterRegistration;
export const createReaderRegistration = createRouterReaderRegistration;
