import { err, ok } from "../../base/mod.ts";
import {
  type AgentRole,
  agentRoleSchema,
  commandsList,
} from "../../protocol/lophn-agent/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type ReadSnapshot,
} from "../../protocol/platform/mod.ts";
import { buildRegistry, type RegistrySkill } from "./registry.ts";

// `/` 명령 목록 read(concern lophn-agent/commands). 목록은 저장하는 표가 아니라 session의 agent에서
// 열 때마다 계산한다(domain model 정책).

export type CommandSessionPlace = {
  assignment: string;
  role: AgentRole;
  work_place: { kind: "project" | "app"; id: string };
};

export type CommandReadDeps = {
  // 그 agent가 그 자리에서 쓸 수 있는 skill이다. skill 발견은 폴더를 훑는 일이라 조립이 맡는다
  // (lophn-agent/extensions). 끈 skill은 selected=false로 와서 registry가 거른다.
  skills(
    sql: ReadSnapshot["sql"],
    place: CommandSessionPlace,
  ): readonly RegistrySkill[];
};

function placeOf(
  sql: ReadSnapshot["sql"],
  session: string,
): CommandSessionPlace | undefined {
  const row = sql.get(
    `select s.assignment as assignment, a.role as role,
       s.work_place_kind as work_place_kind, s.work_place_id as work_place_id
     from sessions s join assignments a on a.id = s.assignment
     where s.id = ?`,
    [session],
  );
  if (row === undefined) return undefined;
  const role = agentRoleSchema.safeParse(row["role"]);
  if (!role.success) return undefined;
  return {
    assignment: String(row["assignment"]),
    role: role.data,
    work_place: {
      kind: row["work_place_kind"] === "app" ? "app" : "project",
      id: String(row["work_place_id"]),
    },
  };
}

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
        const place = placeOf(snapshot.sql, input.session);
        if (place === undefined) {
          return err({ code: "not_found", message: "session not found" });
        }
        const registry = buildRegistry({
          role: place.role,
          skills: deps.skills(snapshot.sql, place),
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
