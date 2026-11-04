// 창마다 하나인 대화 메모리. 세션마다 작성 중 말·커서·보낸 말의 전달 상태·읽던
// 위치를 둔다. 탭을 닫거나 session을 바꿔도 이 값은 그대로라
// 다시 열면 같은 자리에서 이어 쓴다. 읽은 메시지 본문도 창 메모리에
// 둔다. 확정 메시지의 본문은 바뀌지 않아 한 번 읽으면 다시 읽지 않는다. 디스크에는 쓰지
// 않는다.
import { blocksText } from "../../../protocol/lophn-agent/content-block.ts";
import type { Outgoing } from "./delivery-state.ts";
import type { ViewDetail } from "./activity/model.ts";
import type { BodyPart } from "./agent-tab-source.ts";
import type { Attachment } from "./attachments.ts";

export interface Draft {
  readonly text: string;
  /** 커서·선택 범위. 같으면 커서다. */
  readonly selection: readonly [number, number];
  /** 보낼 말에 붙인 파일과 이미지. */
  readonly attachments: readonly Attachment[];
  /** 보낸 말 하나. 접수되면 입력칸을 비우고 이것도 지운다. */
  readonly outgoing: Outgoing | null;
  /** 읽던 위치. null이면 맨 아래를 따라간다. */
  readonly scroll: number | null;
  /** 단계 줄을 어디까지 보이는지(Messages·Compact·Everything). session마다 기억한다. */
  readonly detail: ViewDetail;
}

const EMPTY_DRAFT: Draft = {
  text: "",
  selection: [0, 0],
  attachments: [],
  outgoing: null,
  scroll: null,
  detail: "compact",
};

/** 확정 메시지 본문을 읽은 결과. failed의 code는 core가 답한 오류다. */
export type BodyState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly parts: readonly BodyPart[] }
  | { readonly state: "failed"; readonly code: string };

export class DraftStore {
  #drafts = new Map<string, Draft>();
  // 이 창이 보낸 말의 글(메시지 id별). 본문을 읽기 전에 그 자리를 채운다.
  #texts = new Map<string, string>();
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

  /** key가 맞는 draft 전부(창 사이 이동용). */
  entries(match: (key: string) => boolean): [string, Draft][] {
    return [...this.#drafts].filter(([key]) => match(key));
  }

  save(session: string, patch: Partial<Draft>): void {
    this.#drafts.set(session, { ...this.draft(session), ...patch });
    this.#notify();
  }

  /**
   * 접수된 말의 글을 입력칸에서 비우고 보낸 말은 접수됨으로 남긴다. 확정 메시지가 대화에 오면 부르는 쪽이 보낸 말을
   * 지운다. 그 사이 다시 쓴 글은 없다(보내는 동안 잠긴다).
   */
  accepted(session: string, outgoing: Outgoing): void {
    this.#texts.set(outgoing.id, blocksText(outgoing.content));
    this.save(session, {
      text: "",
      selection: [0, 0],
      attachments: [],
      outgoing,
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

  body(message: string): BodyState | undefined {
    return this.#bodies.get(message);
  }

  setBody(message: string, state: BodyState): void {
    this.#bodies.set(message, state);
    this.#notify();
  }

  subscribe = (listener: () => void): (() => void) => {
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
