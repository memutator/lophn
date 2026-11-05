import { err, ok } from "../../base/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import {
  agentCallRead,
  agentCallSendable,
} from "../../protocol/lophn-agent/calls.ts";
import type { ReadDefinition } from "../../protocol/server/mod.ts";
import { routerEnvironment } from "./environment.ts";
import { calId } from "./model.ts";
import { readCall } from "./store.ts";

// call을 누를 때 그때의 상태를 읽는다. 상태 구독은 없다. agent는 자기가 보냈거나 받은 call만 본다.
const readCallRead: ReadDefinition<typeof agentCallRead> = {
  route: agentCallRead,
  handle(snapshot, ctx, input) {
    const read = readCall(snapshot, calId(input.call));
    if (!read.ok) return read;
    const record = read.value;
    const actor = parseActor(ctx.actor);
    const involved =
      actor?.kind !== "agent" ||
      (record !== null &&
        ((record.from.kind === "agent" && record.from.session === actor.id) ||
          record.receiver_session === actor.id));
    if (record === null || !involved) {
      return err({ code: "not_found", message: "call not found" });
    }
    return ok({
      call: record,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

// waiting·unknown은 지금 내는 곳이 없다.
const STATES = ["running", "waiting", "idle", "unknown"] as const;

// 부를 수 있는 열린 session 목록. 목록은 prompt에 넣지 않고 tool이 읽는다.
const sendableRead: ReadDefinition<typeof agentCallSendable> = {
  route: agentCallSendable,
  handle(snapshot, ctx) {
    const actor = parseActor(ctx.actor);
    if (actor === undefined || actor.kind !== "agent") {
      return err({
        code: "forbidden",
        message: "only an agent lists sessions",
      });
    }
    const environment = routerEnvironment();
    if (!environment.ok) return environment;
    const { directory } = environment.value.deps(snapshot, () => "");
    const sessions = [];
    for (const target of directory.listOpen()) {
      if (target.session === actor.id || !target.accepting) continue;
      const described = environment.value.describe?.(snapshot, target);
      const state = STATES.find((one) => one === described?.state) ?? "unknown";
      sessions.push({
        session: target.session,
        agent: target.agent.agent,
        name: target.name,
        workspace: target.agent.workspace,
        state,
      });
    }
    return ok({
      sessions,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

export const ROUTER_READS = [readCallRead, sendableRead] as const;
