// 창마다 하나인 대화 메모리. 세션마다 작성 중 말·커서·보낸 말의 전달 상태·읽던
// 위치를 둔다. 탭을 닫거나 session을 바꿔도 이 값은 그대로라
// 다시 열면 같은 자리에서 이어 쓴다. 디스크에는 쓰지 않는다.
import type { Outgoing } from "./delivery-state.ts";
import type { ViewDetail } from "./activity/model.ts";
import type { Attachment } from "./attachments.ts";
import type { ThreadPosition } from "./message-list/virtual-rows.ts";

export interface Draft {
  readonly text: string;
  /** 커서·선택 범위. 같으면 커서다. */
  readonly selection: readonly [number, number];
  /** 보낼 말에 붙인 파일과 이미지. */
  readonly attachments: readonly Attachment[];
  /** 보낸 말 하나. 접수되면 입력칸을 비우고 이것도 지운다. */
  readonly outgoing: Outgoing | null;
  /** 읽던 위치(행과 그 행 위에서의 거리). null이면 맨 아래를 따라간다. */
  readonly scroll: ThreadPosition | null;
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

export class DraftStore {
  #drafts = new Map<string, Draft>();
  // session마다 따로 알린다. 한 탭에서 치는 글이 같은 창의 다른 탭 화면을 다시 그리게 하지 않는다.
  #listeners = new Map<string, Set<() => void>>();
  #versions = new Map<string, number>();

  draft(session: string): Draft {
    return this.#drafts.get(session) ?? EMPTY_DRAFT;
  }

  /** key가 맞는 draft 전부(창 사이 이동용). */
  entries(match: (key: string) => boolean): [string, Draft][] {
    return [...this.#drafts].filter(([key]) => match(key));
  }

  save(session: string, patch: Partial<Draft>): void {
    this.#drafts.set(session, { ...this.draft(session), ...patch });
    this.#notify(session);
  }

  /**
   * 접수된 말의 글을 입력칸에서 비우고 보낸 말은 접수됨으로 남긴다. 확정 메시지가 대화에 오면 부르는 쪽이 보낸 말을
   * 지운다. 그 사이 다시 쓴 글은 없다(보내는 동안 잠긴다).
   */
  accepted(session: string, outgoing: Outgoing): void {
    this.save(session, {
      text: "",
      selection: [0, 0],
      attachments: [],
      outgoing,
    });
  }

  subscribe = (session: string, listener: () => void): (() => void) => {
    const set = this.#listeners.get(session) ?? new Set();
    this.#listeners.set(session, set);
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(session);
    };
  };

  /** useSyncExternalStore의 snapshot. 그 session의 draft가 바뀔 때마다 오른다. */
  version = (session: string): number => this.#versions.get(session) ?? 0;

  #notify(session: string) {
    this.#versions.set(session, (this.#versions.get(session) ?? 0) + 1);
    for (const listener of [...(this.#listeners.get(session) ?? [])]) {
      listener();
    }
  }
}
