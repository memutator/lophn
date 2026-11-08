import { err, ok } from "../../base/mod.ts";
import { parseActor } from "../../protocol/base/mod.ts";
import {
  agentCallRead,
  agentCallSendable,
} from "../../protocol/lophn-agent/calls.ts";
import { teamRead } from "../../protocol/lophn-agent/team.ts";
import type { ReadDefinition } from "../../protocol/server/mod.ts";
import { routerEnvironment } from "./environment.ts";
import { calId, sesId, teamMayReach } from "./model.ts";
import { openCallsSentBy, readCall } from "./store.ts";

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
    // 팀 member에게는 부모, 형제, 자기 밑 전체만 보인다(규칙 2).
    const me = directory.find(sesId(actor.id));
    const sessions = [];
    for (const target of directory.listOpen()) {
      if (target.session === actor.id || !target.accepting) continue;
      if (me !== null && !teamMayReach(directory.find, me, target)) continue;
      const described = environment.value.describe?.(snapshot, target);
      const state = STATES.find((one) => one === described?.state) ?? "unknown";
      sessions.push({
        session: target.session,
        handle: target.handle,
        name: target.name,
        title: target.title,
        workspace: target.agent.workspace,
        state,
        last_active_at: target.last_active_at,
      });
    }
    return ok({
      sessions,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

// caller의 부모, 형제, 자식(열린 것). 팀 밖 session은 모두 빈 목록이다. 팀원마다 내가 보내고 답을 못 받은 call(open_calls)을 싣는다.
const readTeam: ReadDefinition<typeof teamRead> = {
  route: teamRead,
  handle(snapshot, ctx) {
    const actor = parseActor(ctx.actor);
    if (actor === undefined || actor.kind !== "agent") {
      return err({
        code: "forbidden",
        message: "only an agent reads its team",
      });
    }
    const environment = routerEnvironment();
    if (!environment.ok) return environment;
    const { directory } = environment.value.deps(snapshot, () => "");
    const me = directory.find(sesId(actor.id));
    if (me === null) {
      return err({ code: "not_found", message: "session not found" });
    }
    const open = directory
      .listOpen()
      .filter((target) => target.accepting && target.session !== me.session);
    const sent = openCallsSentBy(snapshot, me.session);
    const memberOf = (target: (typeof open)[number]) => {
      const described = environment.value.describe?.(snapshot, target);
      return {
        session: target.session,
        agent: target.handle,
        name: target.name,
        description: target.description,
        runtime: target.runtime,
        state: STATES.find((one) => one === described?.state) ?? "unknown",
        open_calls: sent
          .filter((one) => one.receiver_session === target.session)
          .map((one) => ({
            call: one.call,
            reply: one.reply,
            created_at: one.created_at,
          })),
      };
    };
    const parent = open.find((target) => target.session === me.spawned_by);
    return ok({
      parent: parent === undefined ? null : memberOf(parent),
      siblings:
        me.spawned_by === null
          ? []
          : open
              .filter((target) => target.spawned_by === me.spawned_by)
              .map(memberOf),
      children: open
        .filter((target) => target.spawned_by === me.session)
        .map(memberOf),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

export const ROUTER_READS = [readCallRead, sendableRead, readTeam] as const;
