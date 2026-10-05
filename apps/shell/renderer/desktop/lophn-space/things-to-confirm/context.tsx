// 창마다 하나인 질문·approval 통로와 고르던 답의 메모리. 대화 도크의 칸, things-to-confirm,
// notification chip이 같이 쓴다. 칸을 옮겨도 고른 답과 쓰던 글이 남는다(desktop#R8).
import { createContext, type ReactNode, useContext } from "react";

import type { RequestSource } from "./source.ts";

export type Ticks = (listener: () => void) => () => void;

/** 기본 박자. 열린 화면만 이 간격으로 현재 기록을 읽는다. */
export const POLL_MS = 3000;

export const intervalTicks: Ticks = (listener) => {
  const id = setInterval(listener, POLL_MS);
  return () => clearInterval(id);
};

/** 한 요청에 사람이 고르거나 쓰던 것. 보내기 전에는 아무 결정도 아니다. */
export interface CardDraft {
  readonly option: string | null;
  readonly text: string;
  readonly cancelling: boolean;
  readonly reason: string;
}

export const EMPTY_DRAFT: CardDraft = {
  option: null,
  text: "",
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

/** 통로가 없으면(통로 없는 테스트·화면) 칸·chip을 두지 않는다. */
export function useRequests(): RequestDeps | null {
  return useContext(RequestContext);
}
