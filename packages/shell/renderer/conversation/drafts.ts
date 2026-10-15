// 창마다 하나인 대화 메모리. 세션마다 작성 중 말·선택 답·커서·보낸 말의 전달 상태·읽던
// 위치를 둔다. 탭을 닫거나 session을 바꿔도 이 값은 그대로라
// 다시 열면 같은 자리에서 이어 쓴다. 읽은 메시지 본문도 창 메모리에
// 둔다. 확정 메시지의 본문은 바뀌지 않아 한 번 읽으면 다시 읽지 않는다. 디스크에는 쓰지
// 않는다.
import type { Outgoing, SendMode } from "./delivery-state.ts";
import type { BodyPart } from "./agent-tab-source.ts";

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

/** 확정 메시지 본문을 읽은 결과. failed의 code는 core가 답한 오류다. */
export type BodyState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly parts: readonly BodyPart[] }
  | { readonly state: "failed"; readonly code: string };

/**
 * 시각 블록을 문서로 남겨 달라는 요청. request는 그 요청으로 보낸 말의
 * 메시지 id다. failed면 보내지 못했다.
 */
export interface SaveRecord {
  readonly request: string;
  readonly failed: boolean;
}

function blockKey(message: string, block: string): string {
  return `${message}\u0000${block}`;
}

export class DraftStore {
  #drafts = new Map<string, Draft>();
  // 이 창이 보낸 말의 글(메시지 id별). 본문을 읽기 전에 그 자리를 채운다.
  #texts = new Map<string, string>();
  // 블록(메시지·key)별 마지막 문서로 남기기 요청과, 요청으로 보낸 말의 id.
  #saves = new Map<string, SaveRecord>();
  #saveRequests = new Map<string, string>();
  #bodies = new Map<string, BodyState>();
  #listeners = new Set<() => void>();
  #version = 0;
  #selected: string | null = null;

  /** 사람이 고른 session. 탭을 닫았다 열어도 같은 session이다. */
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

  /**
   * 접수된 말을 입력칸에서 비운다. 그 사이 다시 쓴 글은 없다(보내는 동안 잠긴다). 문서로
   * 남기기 요청은 입력칸의 글이 아니므로 보낸 말만 지우고 작성 중인 글은 그대로 둔다.
   */
  sent(session: string, outgoing: Outgoing): void {
    this.#texts.set(outgoing.id, outgoing.text);
    if (this.#saveRequests.has(outgoing.id)) {
      this.save(session, { outgoing: null });
      return;
    }
    this.save(session, {
      text: "",
      selection: [0, 0],
      choice: null,
      outgoing: null,
    });
  }

  /**
   * 접수 전에도 글을 기억한다. 보낸 말이 확정 메시지로 바뀌어 본문을 읽기 전까지 같은
   * 글을 보인다. 읽은 본문이 오면 그것이 우선이다(core가 redaction을 거친 값).
   */
  remember(message: string, text: string): void {
    this.#texts.set(message, text);
  }

  textOf(message: string): string | undefined {
    return this.#texts.get(message);
  }

  /** 블록을 문서로 남겨 달라는 요청을 보낸다. 같은 블록의 이전 요청을 대신한다. */
  requestSave(message: string, block: string, request: string): void {
    const key = blockKey(message, block);
    this.#saves.set(key, { request, failed: false });
    this.#saveRequests.set(request, key);
    this.#notify();
  }

  /** 요청을 보내지 못했다. 다시 누를 수 있다. */
  saveFailed(request: string): void {
    const key = this.#saveRequests.get(request);
    const record = key === undefined ? undefined : this.#saves.get(key);
    if (key === undefined || record?.request !== request) return;
    this.#saves.set(key, { request, failed: true });
    this.#notify();
  }

  isSaveRequest(message: string): boolean {
    return this.#saveRequests.has(message);
  }

  saveOf(message: string, block: string): SaveRecord | undefined {
    return this.#saves.get(blockKey(message, block));
  }

  body(message: string): BodyState | undefined {
    return this.#bodies.get(message);
  }

  setBody(message: string, state: BodyState): void {
    this.#bodies.set(message, state);
    this.#notify();
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
