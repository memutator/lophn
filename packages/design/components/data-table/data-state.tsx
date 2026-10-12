import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { type EmptyAction, EmptyState } from "../empty-state/empty-state.tsx";
import { ErrorState } from "../error-state/error-state.tsx";
import { Loading } from "../skeleton/skeleton.tsx";
import type { Timer } from "../shared.ts";

export interface EmptySpec {
  // 비어 있는 이유 한 문장과 다음 행동 하나(shell/design-system#R34).
  message: string;
  action: EmptyAction;
  icon?: LucideIcon;
}

// 앱 화면과 세션 시각 블록이 같은 모양으로 넘기는 상태 입력.
export interface DataStateProps {
  loading?: boolean;
  // 불러오지 못했으면 그 대상의 사람 말 이름. 원인은 추측하지 않는다(shell/wording#R10).
  failed?: string;
  // 불러오기 실패와 그릴 수 없는 data의 다음 행동.
  onRetry: () => void;
  empty: EmptySpec;
  // loading 지연을 재는 timer. 테스트가 바꿔 끼운다.
  timer?: Timer;
}

interface Props extends DataStateProps {
  defaultIcon: LucideIcon;
  isEmpty: boolean;
  placeholder: ReactNode;
  children: ReactNode;
}

// loading(300ms 지연 뒤 skeleton) → error → empty → 내용 순서로 하나만 그린다.
export function DataState(
  {
    loading = false,
    failed,
    onRetry,
    empty,
    timer,
    defaultIcon,
    isEmpty,
    placeholder,
    children,
  }: Props,
) {
  return (
    <Loading loading={loading} placeholder={placeholder} timer={timer}>
      {failed !== undefined
        ? <ErrorState target={failed} onRetry={onRetry} />
        : isEmpty
        ? (
          <EmptyState
            icon={empty.icon ?? defaultIcon}
            message={empty.message}
            action={empty.action}
          />
        )
        : children}
    </Loading>
  );
}
