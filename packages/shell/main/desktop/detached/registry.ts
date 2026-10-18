// detached 창들의 표. Electron을 모른다: 창은 ref 문자열로만 가리킨다.
import type { DetachedTab, TabTransfer } from "../../../ipc/detached.ts";

export interface DetachedEntry {
  /** detached 창 */
  ref: string;
  /** 이 탭이 돌아갈 project 창 */
  parent: string;
  project: string;
  key: string;
  /** 마지막으로 알려진 탭 값. 창이 갑자기 사라지면 이 값으로 돌려준다. */
  tab: DetachedTab;
  /** 창이 뜬 뒤 `take`가 당겨 가는 값 */
  transfer: TabTransfer | null;
  /** true면 창 닫기(×)를 가로채지 않는다(dock·remove·close·project 창 닫힘) */
  silent: boolean;
}

export class DetachedRegistry {
  readonly #entries = new Map<string, DetachedEntry>();

  add(entry: DetachedEntry): void {
    this.#entries.set(entry.ref, entry);
  }

  byRef(ref: string): DetachedEntry | undefined {
    return this.#entries.get(ref);
  }

  byParentKey(parent: string, key: string): DetachedEntry | undefined {
    return [...this.#entries.values()].find((entry) =>
      entry.parent === parent && entry.key === key
    );
  }

  childrenOf(parent: string): DetachedEntry[] {
    return [...this.#entries.values()].filter((entry) =>
      entry.parent === parent
    );
  }

  remove(ref: string): void {
    this.#entries.delete(ref);
  }

  setTab(ref: string, tab: DetachedTab): void {
    const entry = this.#entries.get(ref);
    if (entry !== undefined) entry.tab = tab;
  }

  silence(ref: string): void {
    const entry = this.#entries.get(ref);
    if (entry !== undefined) entry.silent = true;
  }
}
