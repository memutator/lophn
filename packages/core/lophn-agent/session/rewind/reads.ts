import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type Checkpoint,
  type RevertItem,
  type RevertRecord,
  rewindCheckpoints,
  rewindList,
  sessionRewindPreview,
} from "../../../../protocol/lophn-agent/mod.ts";
import { definePort, type PortKey } from "../../../../protocol/base/ports.ts";
import type { ReadDefinition, Sql } from "../../../../protocol/server/mod.ts";
import type { AppWrites } from "../../ports.ts";
import {
  assertCheckpointVisible,
  hiddenFromSeq,
  hiddenRanges,
  inHiddenRange,
} from "./hidden.ts";
import { type PlanDeps, planRewind } from "./preview.ts";

// 되돌리기 읽기(lophn-agent/revert). preview는 저장된 목록이 아니라 지금의 기록과 파일 상태로 다시
// 만든 현재 판이고 command나 event를 만들지 않는다. 읽는 쪽은 사람과 machine뿐이다(agent·앱에는 내용도
// 경로도 주지 않는다). 숨김 구간은 reverts 행에서 읽는다(hidden.ts). 고른 시점 뒤 이 session이 앱에 한
// write invocation은 AppWrites(apps가 준다)로 받아 `app_writes`에 싣는다. reader Worker에서는 등록한 port를
// 쓴다. 앱 rewind의 계획(함께 되돌아갈 다른 변경, external 효과, 되돌릴 수 없는 write)은 여기서 만들지
// 않고 앱 rewind의 계획 route가 보인다.

export const appWritesPort: PortKey<AppWrites> = definePort<AppWrites>(
  "lophn-agent.AppWrites",
);

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
      typeof parsed.after !== "number" ||
      !Number.isSafeInteger(parsed.after) ||
      parsed.after < 0
    )
      throw new TypeError("cursor");
    return ok(parsed.after);
  } catch {
    return err({ code: "invalid_input", message: "invalid cursor" });
  }
}

const cursorOf = (after: number): string => btoa(JSON.stringify({ after }));

function sessionExists(lookup: Lookup, session: string): boolean {
  return (
    lookup.sql.get("select 1 as found from sessions where id = ?", [
      session,
    ]) !== undefined
  );
}

export function createSessionRewindReads(deps: PlanDeps): {
  preview: ReadDefinition<typeof sessionRewindPreview>;
  checkpoints: ReadDefinition<typeof rewindCheckpoints>;
  list: ReadDefinition<typeof rewindList>;
} {
  return {
    preview: {
      route: sessionRewindPreview,
      handle(snapshot, _ctx, input) {
        const visible = assertCheckpointVisible(
          snapshot,
          input.session,
          input.checkpoint,
        );
        if (!visible.ok) return visible;
        const planned = planRewind(snapshot, deps, input);
        if (!planned.ok) return planned;
        const { target, preview } = planned.value;
        // 앱 write는 파일과 같이 되돌리는 restore_all에서만 보인다.
        const boundary = snapshot.sql.get(
          "select created_seq from messages where id = ?",
          [input.checkpoint],
        );
        return ok({
          choice: target.choice,
          checkpoint: target.checkpoint,
          restore: preview.restore,
          skip: preview.skip,
          remain: preview.remain,
          app_writes:
            target.choice === "restore_all"
              ? snapshot
                  .port(appWritesPort)
                  .writesAfter(
                    input.session as never,
                    String(boundary!["created_seq"]) as never,
                  )
              : [],
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
        const hidden = hiddenRanges(snapshot, input.session);
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
            files_reason:
              row["files_reason"] === null
                ? null
                : (String(row["files_reason"]) as Checkpoint["files_reason"]),
            created_seq: String(row["created_seq"]),
            hidden: inHiddenRange(hidden, String(row["order_seq"])),
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            rows.length > PAGE && last !== undefined
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
          `select rowid as position, id, session, choice, checkpoint,
                  cast(boundary_seq as text) as boundary_seq, summary_call, outcome,
                  preview_hash, cast(result_seq as text) as result_seq
             from reverts where session = ? and rowid > ?
            order by rowid limit ?`,
          [input.session, after.value, PAGE + 1],
        );
        const page = rows.slice(0, PAGE);
        const last = page[page.length - 1];
        const text = (value: unknown) =>
          value === null ? null : String(value);
        return ok({
          reverts: page.map((row) => ({
            id: String(row["id"]),
            session: String(row["session"]),
            kind: "rewind" as const,
            choice: String(row["choice"]) as RevertRecord["choice"],
            checkpoint: String(row["checkpoint"]),
            boundary_seq: String(row["boundary_seq"]),
            summary_call: text(row["summary_call"]),
            outcome: String(row["outcome"]) as RevertRecord["outcome"],
            items: itemsOf(snapshot, String(row["id"])),
            apps: appsOf(snapshot, String(row["id"])),
            preview_hash: String(row["preview_hash"]),
            result_seq: text(row["result_seq"]),
          })),
          hidden_from_seq: hiddenFromSeq(snapshot, input.session),
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            rows.length > PAGE && last !== undefined
              ? cursorOf(Number(last["position"]))
              : null,
        });
      },
    },
  };
}

function itemsOf(lookup: Lookup, revert: string): RevertItem[] {
  return lookup.sql
    .all(
      `select ordinal, class, target, source, plan, result, reason
       from revert_items where revert = ? order by ordinal`,
      [revert],
    )
    .map((row) => ({
      ordinal: Number(row["ordinal"]),
      class: String(row["class"]) as RevertItem["class"],
      target: String(row["target"]),
      source: JSON.parse(String(row["source"])) as string[],
      plan: String(row["plan"]) as RevertItem["plan"],
      result: String(row["result"]) as RevertItem["result"],
      reason:
        row["reason"] === null
          ? null
          : (String(row["reason"]) as RevertItem["reason"]),
    }));
}

function appsOf(lookup: Lookup, revert: string): RevertRecord["apps"] {
  return lookup.sql
    .all(
      `select app, from_invocation, result, reason
       from rewind_apps where revert = ? order by rowid`,
      [revert],
    )
    .map((row) => ({
      app: String(row["app"]),
      from_invocation: String(row["from_invocation"]),
      result: String(row["result"]) as RevertRecord["apps"][number]["result"],
      reason: row["reason"] === null ? null : String(row["reason"]),
    }));
}
