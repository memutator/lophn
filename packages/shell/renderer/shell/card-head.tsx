// card 머리 줄을 탭 본문이 바꾸는 길. 탭 상태(browser의 주소·history)는 본문 컴포넌트가 들고 있어서, 본문이
// 자기 칸의 머리 줄에 필요한 것을 올리면(useCardHead) ContentCard가 그 줄에 그린다. card 밖(floated 패널,
// detached 창)에서는 올릴 곳이 없어 false를 돌려주고, 본문이 스스로 그린다.
import {
  createContext,
  type DependencyList,
  type ReactNode,
  useContext,
  useEffect,
} from "react";
import type { MenuItem } from "@lophn/ui/overlay";

export interface CardHeadSpec {
  /** ← →(와 새로 고침)의 덮어쓰기. 없으면 shell 이동 기록이다. */
  readonly nav?: {
    readonly canBack: boolean;
    readonly canForward: boolean;
    readonly onBack: () => void;
    readonly onForward: () => void;
    /** 주면 → 옆에 새로 고침 단추가 선다. */
    readonly onReload?: () => void;
    readonly reloadDisabled?: boolean;
  };
  /** 경로와 상태 글 자리를 대신하는 가운데 칸. 남는 폭을 채운다. */
  readonly center?: ReactNode;
  /** ⋯ 앞에 놓는 단추들. */
  readonly actions?: ReactNode;
  /** ⋯ 메뉴의 맨 위 묶음. 고른 항목은 `onSelect`가 받고 기본 항목과 구분선으로 나뉜다. */
  readonly menu?: {
    readonly items: readonly MenuItem[];
    readonly onSelect: (id: string) => void;
    /** DOM menu가 native view 밑에 깔리는 탭이 열림 동안 view를 숨기려고 듣는다. */
    readonly onOpenChange?: (open: boolean) => void;
  };
}

export type CardHeadSetter = (spec: CardHeadSpec | null) => void;

export const CardHeadContext = createContext<CardHeadSetter | null>(null);

/**
 * 이 본문이 선 칸의 머리 줄에 spec을 올린다. spec은 deps가 바뀔 때만 다시 올린다. card 안이면 true,
 * 밖이면 false(본문이 자기 머리를 그린다).
 */
export function useCardHead(spec: CardHeadSpec, deps: DependencyList): boolean {
  const set = useContext(CardHeadContext);
  useEffect(() => {
    if (set === null) return;
    set(spec);
    return () => set(null);
  }, [set, ...deps]);
  return set !== null;
}
