// 대화 줄 virtualization의 순수한 부분. 행마다 잰 높이를 key로 캐시하고(안 잰 행은 잰 것의 평균), 그 높이로
// 행의 위쪽 offset을 쌓아 화면 근처 행의 범위와 안 그리는 구간의 빈 칸 높이를 낸다.
// 행 사이는 flex gap이다. 높이 0인 행은 display:none이라 gap도 내지 않는다.

/** 읽던 위치. 화면 맨 위가 `row` 행의 위에서 `offset`px 아래다. 행 높이를 몰라도 같은 곳을 가리킨다. */
export interface ThreadPosition {
  readonly row: string;
  readonly offset: number;
}

const DEFAULT_ESTIMATE = 160;

/** 잰 행 높이. 달라졌는지 알려 부르는 쪽이 다시 그릴지 정한다. */
export class RowHeights {
  #map = new Map<string, number>();
  #sum = 0;
  #count = 0;

  get(key: string): number | undefined {
    return this.#map.get(key);
  }

  /** 0.5px 넘게 달라졌을 때만 바꾸고 true를 돌려준다. */
  set(key: string, height: number): boolean {
    const before = this.#map.get(key);
    if (before !== undefined && Math.abs(before - height) < 0.5) return false;
    if (before !== undefined && before > 0) {
      this.#sum -= before;
      this.#count -= 1;
    }
    if (height > 0) {
      this.#sum += height;
      this.#count += 1;
    }
    this.#map.set(key, height);
    return true;
  }

  /** 안 잰 행의 높이. 잰 행의 평균이다. */
  estimate(): number {
    return this.#count === 0 ? DEFAULT_ESTIMATE : this.#sum / this.#count;
  }
}

/** `offsets[i]`는 i번 행의 위, `offsets[n]`은 마지막 행 뒤의 gap까지 센 끝이다. */
export function offsetsOf(
  keys: readonly string[],
  heights: RowHeights,
  gap: number,
): number[] {
  const estimate = heights.estimate();
  const offsets = new Array<number>(keys.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const height = heights.get(keys[index]!) ?? estimate;
    offsets[index + 1] = offsets[index]! + (height > 0 ? height + gap : 0);
  }
  return offsets;
}

/** y 위치가 속한 행(위가 y 이하인 마지막 행). */
export function rowAt(offsets: readonly number[], y: number): number {
  const count = offsets.length - 1;
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid]! <= y) low = mid;
    else high = mid - 1;
  }
  return Math.max(0, low);
}

/** [top, bottom]에 걸치는 행의 반열린 범위 [start, end). */
export function windowOf(
  offsets: readonly number[],
  top: number,
  bottom: number,
): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count === 0) return { start: 0, end: 0 };
  const start = rowAt(offsets, Math.max(0, top));
  let end = start + 1;
  while (end < count && offsets[end]! < bottom) end += 1;
  return { start, end };
}

export type Segment =
  | { readonly kind: "space"; readonly height: number }
  | { readonly kind: "rows"; readonly from: number; readonly to: number };

/**
 * 그리는 행의 덩어리와 그 사이 빈 칸. [start, end)와 끝의 `pin`개 행을 그린다(끝 행은 쓰는 중인 글과 일하는 중
 * 줄이라 늘 그린다). 빈 칸 앞뒤에 flex gap이 하나씩 있어 빈 칸은 가린 행들의 높이에서 gap 하나를 뺀다.
 */
export function segmentsOf(
  offsets: readonly number[],
  gap: number,
  start: number,
  end: number,
  pin: number,
): Segment[] {
  const count = offsets.length - 1;
  const pinned = Math.max(0, count - pin);
  const first = Math.min(start, pinned);
  const last = Math.min(Math.max(end, first), count);
  const out: Segment[] = [];
  const space = (from: number, to: number) => {
    const height = offsets[to]! - offsets[from]! - gap;
    if (height > 0) out.push({ kind: "space", height });
  };
  space(0, first);
  if (last >= pinned) {
    if (first < count) out.push({ kind: "rows", from: first, to: count });
    return out;
  }
  if (first < last) out.push({ kind: "rows", from: first, to: last });
  space(last, pinned);
  out.push({ kind: "rows", from: pinned, to: count });
  return out;
}
