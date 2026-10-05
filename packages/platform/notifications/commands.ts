// create_notification은 계기 표의 source 사실만 notification으로 만들고,
// mark_notification_read는 읽음 표시만 남긴다(R5, R6). 둘 다 본문·결정을 만들지 않는다.

import { err, ok } from "../../base/mod.ts";
import type { RequestContext, Tx } from "../../contracts/platform/mod.ts";
import {
  createNotification,
  markNotificationRead,
  notificationCreated,
  notificationRead,
} from "../../contracts/platform/mod.ts";
import { defineSyncCommand } from "../ledger/mod.ts";
import { conditionMet, notificationView, triggerOf } from "./model.ts";
import { insertNotification, markRead, readNotificationRow } from "./store.ts";

export const NOTIFICATION_SUBSCRIBER = "notifications";

export const createNotificationCommand = defineSyncCommand(
  createNotification,
  (tx: Tx, _ctx: RequestContext, input) => {
    // source 재검사. cursor 위치의 event가 계기 표의 사실인지 transaction 안에서 본다.
    const row = tx.sql.get(
      "select type, subject, payload from events where seq = ?",
      [BigInt(input.source_seq)],
    );
    if (row === undefined) {
      return err({ code: "not_found", message: "source event가 없다" });
    }
    const sourceEvent = String(row["type"]);
    if (sourceEvent !== input.source_event) {
      return err({ code: "conflict", message: "source event가 다르다" });
    }
    const trigger = triggerOf(sourceEvent);
    if (trigger === undefined) {
      return err({ code: "forbidden", message: "계기 표 밖 event다" });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(String(row["payload"]));
    } catch {
      return err({
        code: "internal",
        message: "source payload를 읽을 수 없다",
      });
    }
    if (!conditionMet(trigger, payload)) {
      return err({ code: "forbidden", message: "생성 조건이 아니다" });
    }
    const view = notificationView(
      { id: input.id, source_seq: input.source_seq, read_at: null },
      sourceEvent,
      row["subject"],
      payload,
    );
    insertNotification(tx, view.notification);
    tx.emit(notificationCreated, input.id, { source_seq: input.source_seq });
    // notification·event·cursor를 같은 transaction에 확정한다(architecture 5.10).
    const advanced = tx.advanceSubscriberCursor(
      NOTIFICATION_SUBSCRIBER,
      input.processed_through_seq,
    );
    if (!advanced.ok) return advanced;
    return ok({ notification: view.notification, replayed: false });
  },
);

export const markNotificationReadCommand = defineSyncCommand(
  markNotificationRead,
  (tx: Tx, _ctx: RequestContext, input) => {
    const row = readNotificationRow(tx.sql, input.notification);
    if (row === undefined) {
      return err({ code: "not_found", message: "notification이 없다" });
    }
    // 읽음은 승인·답·닫힘이 아니다. notification 상태만 바꾼다(R6).
    const marked = markRead(tx.sql, input.notification, tx.now());
    if (marked === undefined) {
      return err({ code: "not_found", message: "notification이 없다" });
    }
    if (marked.changed) {
      const readAt = marked.row.read_at;
      if (readAt === null) {
        return err({ code: "internal", message: "읽음 표시가 남지 않았다" });
      }
      tx.emit(notificationRead, input.notification, { read_at: readAt });
    }
    return ok({ notification: marked.row, changed: marked.changed });
  },
);

export const NOTIFICATION_COMMANDS = [
  createNotificationCommand,
  markNotificationReadCommand,
] as const;
