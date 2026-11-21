// Agents 탭 하나가 화면 밖에서 쥐는 상태: 탭 안의 이동 기록(list → agent A → …), 저장하지 않은 편집, 탭 줄에 보일 얼굴.
// 탭을 고르지 않는 동안 본문이 unmount되어도 편집이 남고(탭 줄의 저장 안 됨 표시도 그대로다), 창 하나가 하나씩 갖는다.
// 기록은 메모리에만 있다. layout 파일에는 열어 둔 agent(`fields.agent`)만 남는다.
import type { AvatarProfile } from "../../parts/avatar/avatar.tsx";
import type { Ready } from "./editor/editor-model.ts";

/** 탭 안에서 보는 자리. new는 첫 저장 전의 새 agent다(n은 구분하는 번호, from은 복제한 원래 agent). */
export type Place =
  | { readonly kind: "list" }
  | { readonly kind: "agent"; readonly agent: string }
  | { readonly kind: "new"; readonly n: number; readonly from?: string };

export const LIST: Place = { kind: "list" };

export const samePlace = (a: Place, b: Place): boolean =>
  a.kind === b.kind &&
  (a.kind === "list" ||
    (a.kind === "agent" && b.kind === "agent" && a.agent === b.agent) ||
    (a.kind === "new" && b.kind === "new" && a.n === b.n));

/** 열어 둔 agent를 가리키는 값. 목록이나 새 agent는 null이다(새 agent는 저장 전에는 id가 없다). */
export const agentOfPlace = (place: Place): string | null =>
  place.kind === "agent" ? place.agent : null;

export interface History {
  readonly places: readonly Place[];
  readonly at: number;
}

export const startHistory = (agent: string | null): History =>
  agent === null
    ? { places: [LIST], at: 0 }
    : { places: [LIST, { kind: "agent", agent }], at: 1 };

export const here = (history: History): Place => history.places[history.at]!;

export const canBack = (history: History): boolean => history.at > 0;

export const canForward = (history: History): boolean =>
  history.at < history.places.length - 1;

/** 새 자리로 간다. 앞으로 갈 수 있던 기록은 버린다. 같은 자리면 그대로다. */
export function open(history: History, place: Place): History {
  if (samePlace(here(history), place)) return history;
  const places = [...history.places.slice(0, history.at + 1), place];
  return { places, at: places.length - 1 };
}

/** 지금 자리를 바꾼다(지운 agent, 첫 저장으로 id가 생긴 새 agent). 기록 길이는 그대로다. */
export function replace(history: History, place: Place): History {
  const places = history.places.map((one, at) =>
    at === history.at ? place : one,
  );
  return { ...history, places };
}

/**
 * 지운(없어진) agent의 자리를 기록에서 뺀다. 이어 붙은 같은 자리는 하나로 합친다. 지금 자리가 그 agent였으면
 * 지금 자리는 앞의 자리를 가리킨다(곧이어 목록을 `open`한다).
 */
export function forget(history: History, place: Place): History {
  const places: Place[] = [];
  let at = -1;
  history.places.forEach((one, index) => {
    if (samePlace(one, place)) return;
    const last = places.at(-1);
    if (last === undefined || !samePlace(last, one)) places.push(one);
    if (index <= history.at) at = places.length - 1;
  });
  return places.length === 0
    ? startHistory(null)
    : { places, at: Math.max(at, 0) };
}

export const back = (history: History): History =>
  canBack(history) ? { ...history, at: history.at - 1 } : history;

export const forward = (history: History): History =>
  canForward(history) ? { ...history, at: history.at + 1 } : history;

/** 탭 줄이 보이는 얼굴: 열어 둔 agent의 이름과 profile. */
export interface Face {
  readonly name: string;
  readonly profile: AvatarProfile;
}

const sameFace = (a: Face | null, b: Face | null): boolean =>
  a === b ||
  (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** 저장하지 않은 편집. place의 editor가 쥔 값이다. */
export interface Draft {
  readonly place: Place;
  readonly ready: Ready;
}

export interface TabState {
  readonly history: History;
  /** 저장하지 않은 편집이 있을 때만 있다. */
  readonly draft: Draft | null;
  readonly face: Face | null;
}

export class AgentsTabs {
  readonly #tabs = new Map<string, TabState>();
  readonly #listeners = new Set<() => void>();
  #version = 0;

  get(key: string): TabState | undefined {
    return this.#tabs.get(key);
  }

  /** 편집이 남은 탭인가(탭 줄의 저장 안 됨 표시, 닫기 확인). */
  isDirty(key: string): boolean {
    return this.#tabs.get(key)?.draft != null;
  }

  faceOf(key: string): Face | null {
    return this.#tabs.get(key)?.face ?? null;
  }

  /** 상태를 바꾼다. 탭 줄이 보는 것(편집이 남았는지, 얼굴)이 달라질 때만 구독자를 깨운다. */
  set(key: string, next: TabState): void {
    const was = this.#tabs.get(key);
    this.#tabs.set(key, next);
    if (
      (was?.draft != null) !== (next.draft != null) ||
      !sameFace(was?.face ?? null, next.face)
    ) {
      this.#bump();
    }
  }

  delete(key: string): void {
    if (this.#tabs.delete(key)) this.#bump();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly version = (): number => this.#version;

  #bump(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}
