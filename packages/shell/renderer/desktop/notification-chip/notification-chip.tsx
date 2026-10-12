import { useCallback, useEffect, useState } from "react";
import { Chip } from "@lophn/design/components";

import {
  intervalTicks,
  useRequests,
} from "../lophn-space/things-to-confirm/context.tsx";
import { noticeTitle } from "../lophn-space/things-to-confirm/labels.ts";
import { chipQueue } from "../lophn-space/things-to-confirm/model.ts";
import type { NotificationRow } from "../lophn-space/things-to-confirm/source.ts";
import styles from "./notification-chip.module.css";

export interface NotificationChipProps {
  /** [View]. things-to-confirm으로 갈 뿐 읽음·결정이 아니다. */
  onView: () => void;
}

// 창 오른쪽 아래 한 칸. 사람을 부르는 notification 하나와 나머지 개수, 보기·닫기를 둔다
// (shell/desktop#R10, shell/design-system#R35). 저절로 나타나도 focus나 현재 문서를 건드리지
// 않고, 저절로 사라지지 않는다. 닫기는 이 창에서 감출 뿐 읽음이 아니다.
export function NotificationChip({ onView }: NotificationChipProps) {
  const deps = useRequests();
  const [unread, setUnread] = useState<readonly NotificationRow[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    if (deps === null) return;
    const read = await deps.source.unread();
    // 읽지 못하면 마지막 chip을 그대로 둔다. 빈 결과로 보지 않는다.
    if (read.ok) setUnread(read.value);
  }, [deps]);

  useEffect(() => {
    if (deps === null) return;
    let previous: string | null = null;
    return deps.source.watch((state) => {
      setReady(state.state === "ready");
      if (state.state === "ready" && previous !== "ready") void refresh();
      previous = state.state;
    });
  }, [deps, refresh]);

  const ticks = deps?.ticks ?? intervalTicks;
  useEffect(
    () =>
      ticks(() => {
        if (ready) void refresh();
      }),
    [ticks, refresh, ready],
  );

  if (deps === null) return null;
  const queue = chipQueue(unread, dismissed);
  if (queue.length === 0) return null;
  const hide = (id: string) =>
    setDismissed((previous) => new Set([...previous, id]));
  return (
    <div className={styles.corner} data-notification-chip="">
      <Chip
        items={queue.map((row) => ({
          id: row.id,
          title: noticeTitle(row, deps.now?.() ?? Date.now()),
        }))}
        onView={(id) => {
          hide(id);
          onView();
        }}
        onDismiss={hide}
      />
    </div>
  );
}
