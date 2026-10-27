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
  /** 떠난 자리라 숨긴 창. 닫지 않았으므로 PTY와 앱 view가 산다. */
  hidden: boolean;
  /** 창이 알린 마지막 resume 값(kind가 정한 JSON). 없으면 null. 창을 조용히 닫을 때 `kept`로 옮긴다. */
  resume: unknown;
}

const keptKey = (project: string, key: string) =>
  JSON.stringify([project, key]);

export class DetachedRegistry {
  readonly #entries = new Map<string, DetachedEntry>();
  // project를 떠나며 조용히 닫은 창의 resume 값. 같은 (project, key)를 다시 열 때 한 번 쓰고 지운다.
  // 이 실행 동안 메모리에만 둔다. 같은 PTY를 두 창이 갖지 않게 쓰면 지운다.
  readonly #kept = new Map<string, unknown>();

  add(entry: DetachedEntry): void {
    this.#entries.set(entry.ref, entry);
  }

  byRef(ref: string): DetachedEntry | undefined {
    return this.#entries.get(ref);
  }

  byParentKey(parent: string, key: string): DetachedEntry | undefined {
    return [...this.#entries.values()].find(
      (entry) => entry.parent === parent && entry.key === key,
    );
  }

  childrenOf(parent: string): DetachedEntry[] {
    return [...this.#entries.values()].filter(
      (entry) => entry.parent === parent,
    );
  }

  remove(ref: string): void {
    this.#entries.delete(ref);
  }

  setTab(ref: string, tab: DetachedTab): void {
    const entry = this.#entries.get(ref);
    if (entry !== undefined) entry.tab = tab;
  }

  setHidden(ref: string, hidden: boolean): void {
    const entry = this.#entries.get(ref);
    if (entry !== undefined) entry.hidden = hidden;
  }

  setResume(ref: string, resume: unknown): void {
    const entry = this.#entries.get(ref);
    if (entry !== undefined) entry.resume = resume;
  }

  /** 창을 조용히 닫기 전에 부른다. 다시 열 때 쓸 값이 있으면 들어 둔다. */
  keep(entry: DetachedEntry): void {
    if (entry.resume !== null && entry.resume !== undefined) {
      this.#kept.set(keptKey(entry.project, entry.key), entry.resume);
    }
  }

  /** 들어 둔 값을 꺼내며 지운다. 없으면 null이다. */
  takeKept(project: string, key: string): unknown {
    const id = keptKey(project, key);
    const value = this.#kept.get(id) ?? null;
    this.#kept.delete(id);
    return value;
  }

  clearKept(): void {
    this.#kept.clear();
  }

  silence(ref: string): void {
    const entry = this.#entries.get(ref);
    if (entry !== undefined) entry.silent = true;
  }
}
