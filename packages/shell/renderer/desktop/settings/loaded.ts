// useCoreRead가 준 읽기 상태를 화면의 모양으로 옮긴다. 읽는 중·실패·stale은 그대로 둔다.
import type { Loaded } from "../connection/core-read.ts";

export function mapLoaded<T, U>(
  loaded: Loaded<T>,
  map: (value: T) => U,
): Loaded<U> {
  return loaded.state === "ready"
    ? { ...loaded, value: map(loaded.value) }
    : loaded;
}

/** 둘 다 읽혔을 때만 ready다. 하나라도 실패면 failed다. */
export function bothLoaded<A, B, U>(
  a: Loaded<A>,
  b: Loaded<B>,
  map: (a: A, b: B) => U,
): Loaded<U> {
  if (a.state === "failed" || b.state === "failed") return { state: "failed" };
  if (a.state === "loading" || b.state === "loading") {
    return { state: "loading" };
  }
  return {
    state: "ready",
    value: map(a.value, b.value),
    staleSince: a.staleSince ?? b.staleSince,
  };
}
