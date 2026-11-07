import { err, ok, type Result } from "../../../base/mod.ts";
import {
  NOTICE_EPHEMERAL_PER_APP_MAX,
  NOTICE_PERSISTENT_PER_APP_MAX,
  type Notice,
  type NoticeAction,
  type NoticeKind,
  noticeDismiss,
  noticeMarkRead,
  noticePost,
  type NoticeRecordInput,
  noticeRecord,
  noticesObserveVersion,
} from "../../../protocol/apps/notice.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { loadApp } from "../registration/store.ts";
import { programNoticeText } from "./program-text.ts";
import { loadNotice } from "./store.ts";

// 남지 않는 event를 commit 뒤 Bus로 내는 topic이다. 데이터는 Bus event 모양 그대로다.
export const NOTICE_TOPIC = "notice";

type Pushing = Pick<Tx, "port" | "now">;

function push(tx: Pushing, app: string | null, type: string, payload: unknown) {
  tx.port(afterCommit).push(NOTICE_TOPIC, {
    type,
    subject: app,
    at: tx.now(),
    payload,
  });
}

const pushPosted = (tx: Pushing, notice: Notice) =>
  push(tx, notice.app, "NoticePosted", notice);
const pushClosed = (tx: Pushing, app: string | null, id: string) =>
  push(tx, app, "NoticeClosed", { id });
const pushRead = (tx: Pushing, app: string | null, id: string, at: string) =>
  push(tx, app, "NoticeRead", { id, read_at: at });

// 앱을 보관하면 그 앱의 휘발 알림은 지우고 영구 기록은 남긴다. 열린 Inbox가 줄을 뺄 수 있게 안 읽은 줄마다 Closed를 낸다
// (남긴 영구 기록은 읽는 쪽이 보관한 앱 줄을 열린 목록에서 뺀다).
export function clearAppNotices(
  tx: Pick<Tx, "sql" | "port" | "now">,
  app: string,
): void {
  const rows = tx.sql.all(
    `select id, persistent from notices
     where source = 'app' and app = ? and (persistent = 0 or read_at is null)`,
    [app],
  );
  if (rows.length === 0) return;
  tx.sql.run(
    "delete from notices where source = 'app' and app = ? and persistent = 0",
    [app],
  );
  for (const row of rows) pushClosed(tx, app, String(row["id"]));
}

type Write = {
  source: "app" | "program";
  app: string | null;
  project: string | null;
  kind: NoticeKind;
  key: string | null;
  title: string;
  body: string;
  persistent: boolean;
  action: NoticeAction | null;
};

// 같은 (source, app, key)의 줄이 있으면 id를 두고 내용·시각을 바꾸고 안 읽음으로 되돌린다(toast도 다시 뜬다).
function writeNotice(
  tx: Pick<Tx, "sql" | "now" | "newId" | "port">,
  row: Write,
): string {
  const at = tx.now();
  const found =
    row.key === null
      ? undefined
      : tx.sql.get(
          "select id from notices where source = ? and coalesce(app, '') = ? and key = ?",
          [row.source, row.app ?? "", row.key],
        );
  const id = found === undefined ? tx.newId("ntc") : String(found["id"]);
  const action = row.action === null ? null : JSON.stringify(row.action);
  if (found === undefined) {
    tx.sql.run(
      `insert into notices (id, source, app, project, kind, key, title, body, persistent, action, created_at, read_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`,
      [
        id,
        row.source,
        row.app,
        row.project,
        row.kind,
        row.key,
        row.title,
        row.body,
        row.persistent ? 1 : 0,
        action,
        at,
      ],
    );
  } else {
    tx.sql.run(
      `update notices set project = ?, title = ?, body = ?, persistent = ?, action = ?, created_at = ?, read_at = null
       where id = ?`,
      [
        row.project,
        row.title,
        row.body,
        row.persistent ? 1 : 0,
        action,
        at,
        id,
      ],
    );
  }
  return id;
}

// 앱의 줄은 휘발과 영구가 따로 상한까지다. 넘친 것을 오래된 것부터 지운다. program 줄은 상한이 없다.
function trimApp(
  tx: Pick<Tx, "sql" | "now" | "port">,
  app: string,
  persistent: boolean,
): void {
  const cap = persistent
    ? NOTICE_PERSISTENT_PER_APP_MAX
    : NOTICE_EPHEMERAL_PER_APP_MAX;
  const overflow = tx.sql.all(
    `select id from notices where source = 'app' and app = ? and persistent = ?
     order by created_at desc, id desc limit -1 offset ?`,
    [app, persistent ? 1 : 0, cap],
  );
  for (const row of overflow) {
    tx.sql.run("delete from notices where id = ?", [row["id"]]);
    pushClosed(tx, app, String(row["id"]));
  }
}

// 다른 command가 자기 transaction 안에서 program 기록을 남기는 길이다. 상태 변경과 같이 commit되어 한 번만 남는다.
// 글(title·body)은 template과 매개변수로만 만든다. `lophn_updated`만 앱이 없고 나머지는 있는 앱이어야 한다.
export function recordProgramNotice(
  tx: Pick<Tx, "sql" | "now" | "newId" | "port">,
  input: NoticeRecordInput,
): Result<{ id: Notice["id"] }> {
  const appless =
    input.kind === "lophn_updated" || input.kind === "sdk_update_needed";
  if (appless !== (input.app === undefined)) {
    return err({
      code: "invalid_input",
      message: appless ? `${input.kind} has no app` : "this kind needs an app",
    });
  }
  if (input.app !== undefined) {
    const app = loadApp(tx.sql, input.app);
    if (!app.ok) return app;
    if (app.value === null) {
      return err({ code: "not_found", message: "app not found" });
    }
  }
  const text = programNoticeText(input);
  const id = writeNotice(tx, {
    source: "program",
    app: input.app ?? null,
    project: input.project ?? null,
    kind: input.kind,
    key: input.key ?? null,
    title: text.title,
    body: text.body,
    persistent: true,
    action: input.action ?? null,
  });
  const written = loadNotice(tx.sql, id);
  if (written !== undefined) pushPosted(tx, written);
  return ok({ id: id as Notice["id"] });
}

// release 행의 사람이 아는 이름(Version 탭과 같은 `r<number>`)이다. 없으면 id를 그대로 쓴다.
export function releaseNameOf(tx: Pick<Tx, "sql">, release: string): string {
  const row = tx.sql.get("select number from releases where id = ?", [release]);
  return row === undefined ? release.slice(0, 40) : `r${String(row["number"])}`;
}

export function createNoticeCommands(): {
  post: CommandDefinition<typeof noticePost>;
  record: CommandDefinition<typeof noticeRecord>;
  observeVersion: CommandDefinition<typeof noticesObserveVersion>;
  dismiss: CommandDefinition<typeof noticeDismiss>;
  markRead: CommandDefinition<typeof noticeMarkRead>;
} {
  return {
    // 앱 자식만 연다. 앱은 credential이 고정한 앱이다(다른 앱의 줄도 program 줄도 못 쓴다). 권한(notify.send)은 broker가 요청마다 판정했다.
    post: {
      route: noticePost,
      handle(tx, ctx, input): Result<{ id: Notice["id"] }> {
        const actor = parseActor(ctx.actor);
        if (actor?.kind !== "app") {
          return err({
            code: "forbidden",
            message: "only an app posts its own notice",
          });
        }
        const app = loadApp(tx.sql, actor.id);
        if (!app.ok) return app;
        if (app.value === null) {
          return err({ code: "not_found", message: "app not found" });
        }
        if (app.value.status !== "active") {
          return err({ code: "conflict", message: "app is archived" });
        }
        const persistent = input.persistent ?? false;
        const id = writeNotice(tx, {
          source: "app",
          app: actor.id,
          project: null,
          kind: "app",
          key: input.key ?? null,
          title: input.title,
          body: input.body ?? "",
          persistent,
          action: null,
        });
        // 교체로 영구 여부가 바뀌면 다른 쪽 상한은 그대로라 쓴 쪽만 센다.
        trimApp(tx, actor.id, persistent);
        const written = loadNotice(tx.sql, id);
        if (written !== undefined) pushPosted(tx, written);
        return ok({ id: id as Notice["id"] });
      },
    },
    // core 안 machine만 연다. 글은 template이 만들고 입력에는 매개변수만 있다. 영구 줄이고 지우지 않는다.
    record: {
      route: noticeRecord,
      handle(tx, ctx, input): Result<{ id: Notice["id"] }> {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return err({
            code: "forbidden",
            message: "only the program records a program notice",
          });
        }
        return recordProgramNotice(tx, input);
      },
    },
    // 제품 판의 marker와 lophn_updated 행을 한 transaction에서 쓴다(기록 없이 판만 앞서가거나 그 반대가 되지 않는다).
    observeVersion: {
      route: noticesObserveVersion,
      handle(tx, ctx, input) {
        if (parseActor(ctx.actor)?.kind !== "machine") {
          return err({
            code: "forbidden",
            message: "only the program observes the product version",
          });
        }
        const stored = tx.sql.get(
          "select value from core_meta where key = 'product_version'",
          [],
        );
        const last = stored === undefined ? null : String(stored["value"]);
        if (last === input.version) return ok({ changed: false, from: last });
        tx.sql.run(
          `insert into core_meta (key, value) values ('product_version', ?)
           on conflict (key) do update set value = excluded.value`,
          [input.version],
        );
        if (last === null && input.fresh)
          return ok({ changed: false, from: null });
        const recorded = recordProgramNotice(tx, {
          kind: "lophn_updated",
          params: { from: last ?? "unknown", to: input.version },
        });
        if (!recorded.ok) return recorded;
        return ok({ changed: true, from: last });
      },
    },
    // 사람만 지운다. route의 actors가 같은 경계를 먼저 막고, 여기서 한 번 더 본다.
    // 휘발은 행을 지우고, 영구는 읽음으로만 바꾸고 남긴다.
    dismiss: {
      route: noticeDismiss,
      handle(tx, ctx, input) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return err({
            code: "forbidden",
            message: "only the user dismisses a notice",
          });
        }
        const row = loadNotice(tx.sql, input.id);
        if (row === undefined) {
          return err({ code: "not_found", message: "notice not found" });
        }
        if (!row.persistent) {
          tx.sql.run("delete from notices where id = ?", [input.id]);
          pushClosed(tx, row.app, input.id);
        } else if (row.read_at === null) {
          const at = tx.now();
          tx.sql.run("update notices set read_at = ? where id = ?", [
            at,
            input.id,
          ]);
          pushRead(tx, row.app, input.id, at);
        }
        return ok({ id: input.id });
      },
    },
    markRead: {
      route: noticeMarkRead,
      handle(tx, ctx, input) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return err({
            code: "forbidden",
            message: "only the user marks a notice read",
          });
        }
        const at = tx.now();
        let marked = 0;
        for (const id of new Set(input.ids)) {
          const row = loadNotice(tx.sql, id);
          if (row === undefined || !row.persistent || row.read_at !== null)
            continue;
          tx.sql.run("update notices set read_at = ? where id = ?", [at, id]);
          pushRead(tx, row.app, id, at);
          marked += 1;
        }
        return ok({ marked });
      },
    },
  };
}
