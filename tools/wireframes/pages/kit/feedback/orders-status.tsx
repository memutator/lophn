// 앱 화면 예: 화면 root를 AppErrorBoundary로 감싸고 읽기 결과의 loading·empty·error·freshness를 보인다.
import type { ReactNode } from "react";
import { AppErrorBoundary } from "@lophn/app-ui";
import { ReadState } from "@lophn/ui/feedback";
import type { Timer } from "@lophn/ui/shared";

export interface OrdersResult {
  loading: boolean;
  failed: boolean;
  orders: readonly string[];
  // 결과를 마지막으로 읽은 시각.
  updatedAt: Date;
}

// 앱이 자기 catalog에서 가져오는 문구 자리다.
const TEXT = {
  orders: "orders",
  empty: "No orders yet.",
  reload: "Reload",
};

// 앱 진입의 root. 이 아래 render 오류는 lophn 오류 수집으로 넘어간다.
export function AppRoot({ children }: { children: ReactNode }) {
  return <AppErrorBoundary>{children}</AppErrorBoundary>;
}

export function OrdersStatus(
  { result, now, reload, timer }: {
    result: OrdersResult;
    now: Date;
    reload: () => void;
    timer?: Timer;
  },
) {
  return (
    <ReadState
      loading={result.loading}
      failed={result.failed ? TEXT.orders : undefined}
      onRetry={reload}
      isEmpty={result.orders.length === 0}
      empty={{
        message: TEXT.empty,
        action: { label: TEXT.reload, onSelect: reload },
      }}
      freshness={{
        updatedAt: result.updatedAt,
        now,
        staleAfterMs: 60 * 60 * 1000,
      }}
      timer={timer}
    >
      <ul>
        {result.orders.map((order) => <li key={order}>{order}</li>)}
      </ul>
    </ReadState>
  );
}
