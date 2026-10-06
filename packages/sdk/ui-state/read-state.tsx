import type { ReactNode } from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import {
  type EmptyAction,
  EmptyState,
  ErrorState,
  Loading,
  Skeleton,
  StaleNote,
  type Timer,
} from "@lophn/design/components";
import styles from "./state.module.css";

export interface Freshness {
  // 결과를 마지막으로 읽은 시각과 지금 시각. 지금은 앱의 clock에서 받는다.
  updatedAt: Date;
  now: Date;
  // 이보다 오래되면 마지막 갱신의 나이를 보인다.
  staleAfterMs: number;
}

export interface ReadStateProps {
  loading?: boolean;
  // 불러오지 못했으면 그 대상의 사람 말 이름. 원인은 추측하지 않는다(shell/wording#R10).
  failed?: string;
  onRetry: () => void;
  isEmpty: boolean;
  // 비어 있는 이유 한 문장과 다음 행동 하나(shell/design-system#R34).
  empty: { message: string; action: EmptyAction; icon?: LucideIcon };
  freshness?: Freshness;
  // 내용과 같은 자리를 지키는 skeleton. 없으면 본문 세 줄이다.
  placeholder?: ReactNode;
  timer?: Timer;
  children: ReactNode;
}

export function isStale({ updatedAt, now, staleAfterMs }: Freshness): boolean {
  return now.getTime() - updatedAt.getTime() > staleAfterMs;
}

// 읽기 결과의 loading(300ms 뒤 skeleton) → error → empty → 내용 중 하나만 그리고, 오래된 내용에는
// 마지막 갱신의 나이를 붙인다(apps/sdk#R18).
export function ReadState(
  {
    loading = false,
    failed,
    onRetry,
    isEmpty,
    empty,
    freshness,
    placeholder = <Skeleton lines={3} />,
    timer,
    children,
  }: ReadStateProps,
) {
  return (
    <Loading loading={loading} placeholder={placeholder} timer={timer}>
      {failed !== undefined
        ? <ErrorState target={failed} onRetry={onRetry} />
        : isEmpty
        ? (
          <EmptyState
            icon={empty.icon ?? Inbox}
            message={empty.message}
            action={empty.action}
          />
        )
        : (
          <div className={styles.content}>
            {freshness && isStale(freshness) && (
              <StaleNote updatedAt={freshness.updatedAt} now={freshness.now} />
            )}
            {children}
          </div>
        )}
    </Loading>
  );
}
