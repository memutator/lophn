// 창마다 하나인 질문·approval 통로와 쓰던 글의 메모리. things-to-confirm,
// 공간 크롬이 같이 쓴다. 요청을 옮겨도 쓰던 취소 이유가 남는다.
import { createContext, type ReactNode, useContext } from "react";

import type { RequestSource } from "./source.ts";

export type Ticks = (listener: () => void) => () => void;

/** 기본 박자. 열린 화면만 이 간격으로 현재 기록을 읽는다. */
export const POLL_MS = 3000;

export const intervalTicks: Ticks = (listener) => {
  const id = setInterval(listener, POLL_MS);
  return () => clearInterval(id);
};

/**
 * 한 요청에 사람이 쓰던 것. 보내기 전에는 아무 결정도 아니다. 묶음 카드의 고른 답과 자유 답은
 * 카드가 자기 안에 둔다.
 */
export interface CardDraft {
  readonly cancelling: boolean;
  readonly reason: string;
}

export const EMPTY_DRAFT: CardDraft = {
  cancelling: false,
  reason: "",
};

/** 요청별 초안. 창 메모리에만 있고 어디에도 저장하지 않는다. */
export class RequestDrafts {
  #drafts = new Map<string, CardDraft>();

  get(request: string): CardDraft {
    return this.#drafts.get(request) ?? EMPTY_DRAFT;
  }

  save(request: string, patch: Partial<CardDraft>): CardDraft {
    const next = { ...this.get(request), ...patch };
    this.#drafts.set(request, next);
    return next;
  }

  /** 답이 접수되거나 질문이 닫히면 초안을 버린다. */
  drop(request: string): void {
    this.#drafts.delete(request);
  }
}

export interface RequestDeps {
  readonly source: RequestSource;
  readonly drafts: RequestDrafts;
  readonly ticks?: Ticks;
  readonly now?: () => number;
}

const RequestContext = createContext<RequestDeps | null>(null);

export function RequestsProvider(
  { deps, children }: { deps: RequestDeps; children: ReactNode },
) {
  return (
    <RequestContext.Provider value={deps}>{children}</RequestContext.Provider>
  );
}

/** 통로가 없으면(통로 없는 테스트·화면) chip과 공간 크롬의 대기 수를 두지 않는다. */
export function useRequests(): RequestDeps | null {
  return useContext(RequestContext);
}
