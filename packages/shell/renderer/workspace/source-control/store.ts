// Source Control 패널의 창 하나 상태. 오른쪽 sidebar를 닫거나 다른 panel로 가도 체크아웃마다 커밋 초안·보기 모양·접힘이 남는다.
// workspace-window가 창마다 하나 만든다(전역 mutable 상태를 두지 않는다).
import type { CheckoutRef } from "../worktrees/source.ts";

export type ChangesView = "flat" | "tree";

export type SectionKey = "conflicts" | "staged" | "changes" | "commits";

export interface CheckoutPrefs {
  readonly draft: string;
  readonly view: ChangesView;
  readonly folded: ReadonlySet<SectionKey>;
  /** tree 보기에서 접은 디렉터리(체크아웃 기준 상대 경로, 묶음마다 앞에 `<section>:`). */
  readonly closedDirs: ReadonlySet<string>;
}

const DEFAULT_PREFS: CheckoutPrefs = {
  draft: "",
  view: "flat",
  // Commits는 펼칠 때 읽는다(spec 5.1.5 기본 접힘).
  folded: new Set<SectionKey>(["commits"]),
  closedDirs: new Set(),
};

export interface SourceControlStore {
  prefs(key: string): CheckoutPrefs;
  update(key: string, patch: Partial<CheckoutPrefs>): void;
  /** 사람이 고정한 대상. null이면 활성 탭을 따라간다. */
  pinned(): CheckoutRef | null;
  setPinned(checkout: CheckoutRef | null): void;
  subscribe(listener: () => void): () => void;
  /** useSyncExternalStore가 바뀜을 아는 값. 바꿀 때마다 오른다. */
  version(): number;
}

export function createSourceControlStore(): SourceControlStore {
  const prefs = new Map<string, CheckoutPrefs>();
  const listeners = new Set<() => void>();
  let pinned: CheckoutRef | null = null;
  let version = 0;
  const changed = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  return {
    prefs: (key) => prefs.get(key) ?? DEFAULT_PREFS,
    update(key, patch) {
      prefs.set(key, { ...(prefs.get(key) ?? DEFAULT_PREFS), ...patch });
      changed();
    },
    pinned: () => pinned,
    setPinned(checkout) {
      pinned = checkout;
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
  };
}
