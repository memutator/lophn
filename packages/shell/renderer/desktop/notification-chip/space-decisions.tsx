import { useCallback, useEffect, useState } from "react";
import { Icon, iconPixels } from "@lophn/design/components";
import { connectionFailedIcon } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { ConnectionState } from "../connection/connection.ts";
import {
  intervalTicks,
  useRequests,
} from "../lophn-space/things-to-confirm/context.tsx";
import { placeWaiting } from "../lophn-space/things-to-confirm/model.ts";
import type {
  Place,
  Request,
} from "../lophn-space/things-to-confirm/source.ts";
import styles from "./notification-chip.module.css";

export interface WaitingPillProps {
  count: number;
  /** 있으면 pill이 things-to-confirm으로 가는 단추다. */
  onOpen?: () => void;
}

// 결정 대기 개수의 글자 pill. 색이 아니라 "2 decisions waiting" 글로 읽는다.
// 0이면 그리지 않는다. 런처 카드와 공간 크롬이 같은 모양을 쓴다.
export function WaitingPill({ count, onOpen }: WaitingPillProps) {
  if (count <= 0) return null;
  const label = t("common.label.decisions-waiting", { count });
  return onOpen
    ? (
      <button
        type="button"
        className={styles.pill}
        data-waiting-pill={count}
        onClick={onOpen}
      >
        {label}
      </button>
    )
    : <span className={styles.pill} data-waiting-pill={count}>{label}</span>;
}

export interface SpaceDecisionsProps {
  /** 이 공간. 그 공간의 결정 대기만 센다. */
  place: Place;
  /** things-to-confirm으로 간다. 결정은 거기서 confirmation window로 연다. */
  onOpen: () => void;
}

/** 열린 화면이 보는 질문·approval 기록과 연결 상태. 통로가 없으면 deps가 null이다. */
export function useRequestOverview(): {
  deps: ReturnType<typeof useRequests>;
  requests: readonly Request[];
  connection: ConnectionState["state"];
} {
  const deps = useRequests();
  const [requests, setRequests] = useState<readonly Request[]>([]);
  const [connection, setConnection] = useState<ConnectionState["state"]>(
    "starting",
  );

  const refresh = useCallback(async () => {
    if (deps === null) return;
    const read = await deps.source.overview();
    if (read.ok) setRequests(read.value.requests);
  }, [deps]);

  useEffect(() => {
    if (deps === null) return;
    let previous: string | null = null;
    return deps.source.watch((state) => {
      setConnection(state.state);
      if (state.state === "ready" && previous !== "ready") void refresh();
      previous = state.state;
    });
  }, [deps, refresh]);

  const ticks = deps?.ticks ?? intervalTicks;
  useEffect(
    () =>
      ticks(() => {
        if (connection === "ready") void refresh();
      }),
    [ticks, refresh, connection],
  );
  return { deps, requests, connection };
}

// 프로젝트·앱 공간의 lophn 크롬. 그 공간의 결정 대기와 lophn 장애 안내만 둔다.
// 전역 관리 크롬은 두지 않는다.
export function SpaceDecisions({ place, onOpen }: SpaceDecisionsProps) {
  const { deps, requests, connection } = useRequestOverview();
  if (deps === null) return null;
  const down = connection === "failed" || connection === "stale";
  const count = placeWaiting(requests, place, "all");
  if (!down && count === 0) return null;
  return (
    <span className={styles.chrome} data-space-decisions="">
      {down
        ? (
          <span className={styles.down} data-core-down="">
            <Icon icon={connectionFailedIcon} pixels={iconPixels("base")} />
            {t("common.notice.core-down")}
          </span>
        )
        : null}
      <WaitingPill count={count} onOpen={onOpen} />
    </span>
  );
}
