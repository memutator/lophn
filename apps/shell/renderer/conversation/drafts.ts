// 창마다 하나인 대화 메모리. 세션마다 작성 중 말·선택 답·커서·보낸 말의 전달 상태·읽던
// 위치를 둔다. 도크를 닫거나 세션을 바꾸거나 confirmation window가 떠도 이 값은 그대로라
// 다시 열면 같은 자리에서 이어 쓴다(shell/desktop#R8). 디스크에는 쓰지 않는다.
import type { Outgoing, SendMode } from "./delivery-state.ts";

export interface Draft {
  readonly text: string;
  /** 커서·선택 범위. 같으면 커서다. */
  readonly selection: readonly [number, number];
  readonly mode: SendMode;
  /** 질문 칸에서 고른 답. 아직 보내지 않았다. */
  readonly choice: string | null;
  /** 보낸 말 하나. 접수되면 입력칸을 비우고 이것도 지운다. */
  readonly outgoing: Outgoing | null;
  /** 읽던 위치. null이면 맨 아래를 따라간다. */
  readonly scroll: number | null;
}

export const EMPTY_DRAFT: Draft = {
  text: "",
  selection: [0, 0],
  mode: "request",
  choice: null,
  outgoing: null,
  scroll: null,
};

export class DraftStore {
  #drafts = new Map<string, Draft>();
  // 이 창이 보낸 말의 글. 본문은 hash로만 접수되므로 글은 보낸 창만 안다.
  #texts = new Map<string, string>();
  #listeners = new Set<() => void>();
  #version = 0;
  #selected: string | null = null;

  /** 사람이 고른 세션. 도크를 닫았다 열어도 같은 세션이다. */
  selected(): string | null {
    return this.#selected;
  }

  select(session: string): void {
    this.#selected = session;
    this.#notify();
  }

  draft(session: string): Draft {
    return this.#drafts.get(session) ?? EMPTY_DRAFT;
  }

  save(session: string, patch: Partial<Draft>): void {
    this.#drafts.set(session, { ...this.draft(session), ...patch });
    this.#notify();
  }

  /** 접수된 말을 입력칸에서 비운다. 그 사이 다시 쓴 글은 없다(보내는 동안 잠긴다). */
  sent(session: string, outgoing: Outgoing): void {
    this.#texts.set(outgoing.body, outgoing.text);
    this.save(session, {
      text: "",
      selection: [0, 0],
      choice: null,
      outgoing: null,
    });
  }

  /** 접수 전에도 글을 기억한다. 보낸 말이 확정 메시지로 바뀌어도 같은 글을 보인다. */
  remember(body: string, text: string): void {
    this.#texts.set(body, text);
  }

  textOf(body: string): string | undefined {
    return this.#texts.get(body);
  }

  subscribe = (listener: () => void): () => void => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** useSyncExternalStore의 snapshot. 바뀔 때마다 오른다. */
  version = (): number => this.#version;

  #notify() {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}
