import { err, ok, type Result } from "../../base/mod.ts";
import { revertList, revertPreview } from "../../contracts/lophn-agent/mod.ts";
import {
  parseActor,
  type ReadDefinition,
  type RequestContext,
  type SqlRow,
} from "../../contracts/platform/mod.ts";
import {
  bindingHash,
  buildGroups,
  loadRunRef,
  type Lookup,
  revertColumns,
  type RevertOwner,
  revertRowOf,
} from "./model.ts";

// read는 pool read다. handler는 동기 Result를 돌려준다. preview는 저장된 diff를 합산하는 것이
// 아니라 지금의 event와 owner 판정으로 다시 만든 현재 판이다(R3, R4). 사람과 machine은 모든
// run을 보고 agent는 자기 assignment의 run만 본다. 그 밖의 자격과 범위 밖 run은 없는 run과
// 똑같이 답한다.

const PAGE = 50;

export type RevertReadDeps = { owners: readonly RevertOwner[] };

function notFound(): Result<never> {
  return err({ code: "not_found", message: "run not found" });
}

// null은 제한 없음, 문자열은 그 assignment만, undefined는 아무것도 보지 못함.
function visibleAssignment(ctx: RequestContext): string | null | undefined {
  const actor = parseActor(ctx.actor);
  if (actor === undefined) return undefined;
  if (actor.kind === "user" || actor.kind === "machine") return null;
  if (actor.kind === "agent") return actor.id;
  return undefined;
}

function cursorAfter(cursor: string | undefined): Result<bigint | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after?: unknown };
    if (
      typeof parsed.after !== "string" || !/^[1-9][0-9]*$/.test(parsed.after)
    ) {
      throw new TypeError("cursor");
    }
    return ok(BigInt(parsed.after));
  } catch {
    return err({ code: "invalid_input", message: "invalid cursor" });
  }
}

function cursorOf(after: string): string {
  return btoa(JSON.stringify({ after }));
}

function changesOf(lookup: Lookup, revert: string) {
  const rows = lookup.sql.all(
    `select ordinal, owner, target, capability, result, reason_blob
       from revert_changes where revert = ? order by ordinal`,
    [revert],
  );
  return rows.map((row: SqlRow) => {
    const ordinal = Number(row["ordinal"]);
    const seqs = (query: string) =>
      lookup.sql.all(query, [revert, ordinal]).map((item) =>
        String(item["seq"])
      );
    return {
      ordinal,
      owner: String(row["owner"]),
      target: row["target"] === null ? null : String(row["target"]),
      source_seqs: seqs(
        `select cast(source_seq as text) as seq from revert_change_sources
          where revert = ? and ordinal = ? order by source_seq`,
      ),
      capability: String(row["capability"]) as "reversible",
      result: String(row["result"]) as "restored",
      reason_blob: row["reason_blob"] === null
        ? null
        : String(row["reason_blob"]),
      restored_seqs: seqs(
        `select cast(restored_seq as text) as seq from revert_change_compensations
          where revert = ? and ordinal = ? order by restored_seq`,
      ),
      app_revert: null,
    };
  });
}

export function createRevertReads(deps: RevertReadDeps): {
  preview: ReadDefinition<typeof revertPreview>;
  list: ReadDefinition<typeof revertList>;
} {
  return {
    preview: {
      route: revertPreview,
      handle(snapshot, ctx, input) {
        const scope = visibleAssignment(ctx);
        if (scope === undefined) return notFound();
        const run = loadRunRef(snapshot, input.run);
        if (run === undefined) return notFound();
        if (scope !== null && run.assignment !== scope) return notFound();
        // 기다리는 run은 먼저 멈춰야 한다. 끝나지 않은 run의 변경은 아직 확정이 아니다(R1).
        if (run.state !== "finished") {
          return err({
            code: "invalid_input",
            message: "the run has not finished",
          });
        }
        const groups = buildGroups(snapshot, input.run, deps.owners);
        return ok({
          run: input.run,
          groups,
          binding_hash: bindingHash(input.run, groups),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: revertList,
      handle(snapshot, ctx, input) {
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const scope = visibleAssignment(ctx);
        const empty = ok({
          reverts: [],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
        if (scope === undefined) return empty;
        const clauses = ["v.created_seq > ?"];
        const params: (string | bigint)[] = [after.value ?? 0n];
        if (scope !== null) {
          clauses.push("r.assignment = ?");
          params.push(scope);
        }
        if (input.run !== undefined) {
          clauses.push("v.run = ?");
          params.push(input.run);
        }
        const rows = snapshot.sql.all(
          `select ${
            revertColumns("v")
          } from reverts v join runs r on r.id = v.run
            where ${clauses.join(" and ")} order by v.created_seq limit ?`,
          [...params, PAGE + 1],
        ).map(revertRowOf);
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          reverts: page.map((row) => ({
            id: row.id,
            run: row.run,
            allow_partial: row.allow_partial,
            outcome: row.outcome,
            changes: changesOf(snapshot, row.id),
            result_seq: row.result_seq,
            preview_hash: row.preview_hash,
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > PAGE && last !== undefined
            ? cursorOf(last.created_seq)
            : null,
        });
      },
    },
  };
}
