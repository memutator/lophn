import { err, ok, type Result } from "../../base/mod.ts";
import {
  type AppRevertBinding,
  type Checkpoint,
  type RevertItem,
  type RevertRecord,
  rewindCheckpoints,
  rewindList,
  rewindPreview,
} from "../../contracts/lophn-agent/mod.ts";
import type { ReadDefinition, Sql } from "../../contracts/platform/mod.ts";
import { type PlanDeps, planRewind } from "./preview.ts";

// 되돌리기 읽기(lophn-agent/revert). preview는 저장된 목록이 아니라 지금의 기록과 파일 상태로 다시
// 만든 현재 판이고 command나 event를 만들지 않는다. 읽는 쪽은 사람과 machine뿐이다(agent·앱에는 내용도
// 경로도 주지 않는다). 숨김 구간(hidden_from_seq, checkpoint의 hidden)은 agent-RW3d가 채운다: 그 전에는
// 숨긴 구간을 만드는 Rewind가 없다.

const PAGE = 50;

type Lookup = { sql: Pick<Sql, "get" | "all"> };

function notFound(message: string): Result<never> {
  return err({ code: "not_found", message });
}

function cursorAfter(cursor: string | undefined): Result<number> {
  if (cursor === undefined) return ok(0);
  try {
    const parsed = JSON.parse(atob(cursor)) as { after?: unknown };
    if (
      typeof parsed.after !== "number" || !Number.isSafeInteger(parsed.after) ||
      parsed.after < 0
    ) throw new TypeError("cursor");
    return ok(parsed.after);
  } catch {
    return err({ code: "invalid_input", message: "invalid cursor" });
  }
}

const cursorOf = (after: number): string => btoa(JSON.stringify({ after }));

function sessionExists(lookup: Lookup, session: string): boolean {
  return lookup.sql.get("select 1 as found from sessions where id = ?", [
    session,
  ]) !== undefined;
}

export function createRevertReads(deps: PlanDeps): {
  preview: ReadDefinition<typeof rewindPreview>;
  checkpoints: ReadDefinition<typeof rewindCheckpoints>;
  list: ReadDefinition<typeof rewindList>;
} {
  return {
    preview: {
      route: rewindPreview,
      handle(snapshot, _ctx, input) {
        const planned = planRewind(snapshot, deps, input);
        if (!planned.ok) return planned;
        const { target, preview } = planned.value;
        return ok({
          kind: target.kind,
          choice: target.kind === "rewind" ? target.choice : null,
          checkpoint: target.kind === "rewind" ? target.checkpoint : null,
          tool_call: target.kind === "undo" ? target.tool_call : null,
          restore: preview.restore,
          skip: preview.skip,
          remain: preview.remain,
          redo: preview.redo,
          preview_hash: preview.preview_hash,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    checkpoints: {
      route: rewindCheckpoints,
      handle(snapshot, _ctx, input) {
        if (!sessionExists(snapshot, input.session)) {
          return notFound("session not found");
        }
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const rows = snapshot.sql.all(
          `select c.message as message, c.session as session,
                  c.files_restorable as files_restorable, c.files_reason as files_reason,
                  cast(m.created_seq as text) as created_seq, m.created_seq as order_seq
             from checkpoints c join messages m on m.id = c.message
            where c.session = ? and m.created_seq > ?
            order by m.created_seq limit ?`,
          [input.session, after.value, PAGE + 1],
        );
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        return ok({
          checkpoints: page.map((row) => ({
            message: String(row["message"]),
            session: String(row["session"]),
            files_restorable: Number(row["files_restorable"]) === 1,
            files_reason: row["files_reason"] === null
              ? null
              : String(row["files_reason"]) as Checkpoint["files_reason"],
            created_seq: String(row["created_seq"]),
            hidden: false,
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > PAGE && last !== undefined
            ? cursorOf(Number(last["order_seq"]))
            : null,
        });
      },
    },
    list: {
      route: rewindList,
      handle(snapshot, _ctx, input) {
        if (!sessionExists(snapshot, input.session)) {
          return notFound("session not found");
        }
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        const rows = snapshot.sql.all(
          `select rowid as position, id, session, kind, choice, checkpoint, tool_call,
                  cast(boundary_seq as text) as boundary_seq, summary_call, outcome, redo,
                  preview_hash, cast(result_seq as text) as result_seq
             from reverts where session = ? and rowid > ?
            order by rowid limit ?`,
          [input.session, after.value, PAGE + 1],
        );
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        const text = (value: unknown) => value === null ? null : String(value);
        return ok({
          reverts: page.map((row) => ({
            id: String(row["id"]),
            session: String(row["session"]),
            kind: String(row["kind"]) as RevertRecord["kind"],
            choice: text(row["choice"]) as RevertRecord["choice"],
            checkpoint: text(row["checkpoint"]),
            tool_call: text(row["tool_call"]),
            boundary_seq: text(row["boundary_seq"]),
            summary_call: text(row["summary_call"]),
            outcome: String(row["outcome"]) as RevertRecord["outcome"],
            redo: String(row["redo"]) as RevertRecord["redo"],
            items: itemsOf(snapshot, String(row["id"])),
            preview_hash: String(row["preview_hash"]),
            result_seq: text(row["result_seq"]),
          })),
          hidden_from_seq: null,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: rows.length > PAGE && last !== undefined
            ? cursorOf(Number(last["position"]))
            : null,
        });
      },
    },
  };
}

function itemsOf(lookup: Lookup, revert: string): RevertItem[] {
  return lookup.sql.all(
    `select ordinal, class, target, source, plan, result, reason, app_revert
       from revert_items where revert = ? order by ordinal`,
    [revert],
  ).map((row) => ({
    ordinal: Number(row["ordinal"]),
    class: String(row["class"]) as RevertItem["class"],
    target: String(row["target"]),
    source: JSON.parse(String(row["source"])) as string[],
    plan: String(row["plan"]) as RevertItem["plan"],
    result: String(row["result"]) as RevertItem["result"],
    reason: row["reason"] === null
      ? null
      : String(row["reason"]) as RevertItem["reason"],
    app_revert: row["app_revert"] === null
      ? null
      : JSON.parse(String(row["app_revert"])) as AppRevertBinding,
  }));
}
