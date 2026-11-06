import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type AppNotice,
  appNoticeDismiss,
  appNoticePost,
  NOTICE_PER_APP_MAX,
} from "../../../protocol/apps/notice.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import type { CommandDefinition, Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { loadApp } from "../registration/store.ts";

// 남지 않는 event를 commit 뒤 Bus로 내는 topic이다. 데이터는 Bus event 모양 그대로다.
export const APP_NOTICE_TOPIC = "app_notice";

type Pushing = Pick<Tx, "port" | "now">;

function pushPosted(tx: Pushing, notice: AppNotice): void {
  tx.port(afterCommit).push(APP_NOTICE_TOPIC, {
    type: "AppNoticePosted",
    subject: notice.app,
    at: tx.now(),
    payload: notice,
  });
}

function pushClosed(tx: Pushing, app: string, id: string): void {
  tx.port(afterCommit).push(APP_NOTICE_TOPIC, {
    type: "AppNoticeClosed",
    subject: app,
    at: tx.now(),
    payload: { id },
  });
}

// 앱을 보관하면 그 앱의 notice를 모두 거둔다. 열린 Inbox가 줄을 뺄 수 있게 Closed를 낸다.
export function clearAppNotices(
  tx: Pick<Tx, "sql" | "port" | "now">,
  app: string,
): void {
  const rows = tx.sql.all("select id from app_notices where app = ?", [app]);
  if (rows.length === 0) return;
  tx.sql.run("delete from app_notices where app = ?", [app]);
  for (const row of rows) pushClosed(tx, app, String(row["id"]));
}

export function createNoticeCommands(): {
  post: CommandDefinition<typeof appNoticePost>;
  dismiss: CommandDefinition<typeof appNoticeDismiss>;
} {
  return {
    // 앱 자식만 연다. 앱은 credential이 고정한 앱이다. 권한(notify.send)은 broker가 요청마다 판정했다.
    post: {
      route: appNoticePost,
      handle(tx, ctx, input): Result<{ id: AppNotice["id"] }> {
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
        const at = tx.now();
        const body = input.body ?? "";
        // 같은 key의 열린 notice는 id를 두고 내용과 시각만 바꾼다(맨 뒤로 옮기고 toast를 다시 띄운다).
        const open =
          input.key === undefined
            ? undefined
            : tx.sql.get(
                "select id from app_notices where app = ? and key = ?",
                [actor.id, input.key],
              );
        const id = open === undefined ? tx.newId("ntc") : String(open["id"]);
        if (open === undefined) {
          tx.sql.run(
            `insert into app_notices (id, app, key, title, body, created_at)
             values (?, ?, ?, ?, ?, ?)`,
            [id, actor.id, input.key ?? null, input.title, body, at],
          );
        } else {
          tx.sql.run(
            "update app_notices set title = ?, body = ?, created_at = ? where id = ?",
            [input.title, body, at, id],
          );
        }
        // 앱마다 열린 notice는 상한까지다. 오래된 것부터 거둔다.
        const overflow = tx.sql.all(
          `select id from app_notices where app = ?
           order by created_at desc, id desc limit -1 offset ?`,
          [actor.id, NOTICE_PER_APP_MAX],
        );
        for (const row of overflow) {
          tx.sql.run("delete from app_notices where id = ?", [row["id"]]);
          pushClosed(tx, actor.id, String(row["id"]));
        }
        pushPosted(tx, {
          id: id as AppNotice["id"],
          app: actor.id as AppNotice["app"],
          app_name: app.value.name,
          key: input.key ?? null,
          title: input.title,
          body,
          created_at: at,
        });
        return ok({ id: id as AppNotice["id"] });
      },
    },
    // 사람만 지운다. route의 actors가 같은 경계를 먼저 막고, 여기서 한 번 더 본다.
    dismiss: {
      route: appNoticeDismiss,
      handle(tx, ctx, input) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return err({
            code: "forbidden",
            message: "only the user dismisses a notice",
          });
        }
        const row = tx.sql.get("select app from app_notices where id = ?", [
          input.id,
        ]);
        if (row === undefined) {
          return err({ code: "not_found", message: "notice not found" });
        }
        tx.sql.run("delete from app_notices where id = ?", [input.id]);
        pushClosed(tx, String(row["app"]), input.id);
        return ok({ id: input.id });
      },
    },
  };
}
