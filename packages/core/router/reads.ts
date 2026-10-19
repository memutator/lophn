import { err, ok } from "../../base/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import {
  type CallAgent,
  callRead,
  callSendable,
} from "../../protocol/lophn-agent/calls.ts";
import type { Place } from "../../protocol/lophn-agent/places.ts";
import type { ReadDefinition } from "../../protocol/server/mod.ts";
import { routerEnvironment } from "./environment.ts";
import { calId } from "./model.ts";
import { readCall } from "./store.ts";

// call을 누를 때 그때의 상태를 읽는다. 상태 구독은 없다. agent는 자기가 보냈거나 받은 call만 본다.
const readCallRead: ReadDefinition<typeof callRead> = {
  route: callRead,
  handle(snapshot, ctx, input) {
    const read = readCall(snapshot, calId(input.call));
    if (!read.ok) return read;
    const record = read.value;
    const actor = parseActor(ctx.actor);
    const involved = actor?.kind !== "agent" || (record !== null && (
      (record.from.kind === "agent" && record.from.session === actor.id) ||
      record.receiver_session === actor.id
    ));
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

// Project Manager와 App Engineer는 place가 곧 정체성이다. Operator의 place는 describe가 안다.
function placeOf(agent: CallAgent): Place | null {
  if (agent.role === "project_manager") {
    return { kind: "project", id: agent.project };
  }
  if (agent.role === "app_engineer") return { kind: "app", id: agent.app };
  return null;
}

// waiting은 coding session만 낸다. lophn session은 reader가 못 봐서 구별하지 않는다. 구별이 필요해지면 turn 행에 적는 쪽을 본다.
const STATES = ["running", "waiting", "idle", "unknown"] as const;

// 부를 수 있는 열린 session 목록. grant가 deny인 상대는 뺀다. 목록은 prompt에 넣지 않고 tool이 읽는다.
const sendableRead: ReadDefinition<typeof callSendable> = {
  route: callSendable,
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
    const { directory, gate, transport } = environment.value.deps(
      snapshot,
      () => "",
    );
    const sender = { kind: "agent" as const, session: actor.id };
    const sessions = [];
    for (const target of directory.listOpen()) {
      if (target.session === actor.id || !target.accepting) continue;
      if (!gate.visible(sender, target.agent)) continue;
      const described = environment.value.describe?.(snapshot, target);
      const state = STATES.find((one) => one === described?.state) ??
        "unknown";
      sessions.push({
        session: target.session,
        role: target.agent.role,
        place: described !== undefined
          ? (described.place as Place | null)
          : placeOf(target.agent),
        name: target.name,
        state,
      });
    }
    return ok({
      sessions,
      queued_coding: [...transport.queued()],
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

export const ROUTER_READS = [readCallRead, sendableRead] as const;
