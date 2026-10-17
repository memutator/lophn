import { err, ok } from "../../../base/mod.ts";
import {
  type AgentRef,
  commandsList,
  type Place,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { agentRefOf, loadSession, placeOf } from "../session/model.ts";
import {
  buildRegistry,
  type RegistrySkill,
  type RoleCommands,
} from "./registry.ts";

// `/` 명령 목록 read. 목록은 저장하는 표가 아니라 session의 agent에서
// 열 때마다 계산한다.

type CommandSession = {
  role: Role;
  place: Place | null;
  agent: AgentRef;
};

type CommandReadDeps = {
  roleCommands: RoleCommands;
  // 그 agent가 그 place에서 쓸 수 있는 skill이다. skill 발견은 폴더를 훑는 일이라 조립이 맡는다
  // (lophn-agent/extensions). 끈 skill은 selected=false로 와서 registry가 거른다.
  skills(
    sql: ReadSnapshot["sql"],
    session: CommandSession,
  ): readonly RegistrySkill[];
};

export function createCommandReads(deps: CommandReadDeps): {
  list: ReadDefinition<typeof commandsList>;
} {
  return {
    list: {
      route: commandsList,
      handle(snapshot, ctx, input) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return err({
            code: "forbidden",
            message: "only a person reads the command list",
          });
        }
        const row = loadSession({ sql: snapshot.sql }, input.session);
        if (row === undefined) {
          return err({ code: "not_found", message: "session not found" });
        }
        const session: CommandSession = {
          role: row.role,
          place: placeOf(row),
          agent: agentRefOf(row),
        };
        const registry = buildRegistry({
          role: session.role,
          roleCommands: deps.roleCommands,
          skills: deps.skills(snapshot.sql, session),
        });
        return ok({
          commands: [...registry.entries],
          notices: [...registry.notices],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
