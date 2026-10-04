import { assert, assertEquals } from "@std/assert";
import { barHits, barItems } from "./bar-layout.ts";
import type { ColoredSeries } from "./palette.ts";

const series = (values: (number | null)[][]): ColoredSeries[] =>
  values.map((list, index) => ({
    key: `s${index}`,
    label: `S${index}`,
    values: list,
    slot: index,
  }));

// 0이 220px에 있고 1당 1px 올라가는 축.
const y = (value: number) => 220 - value;
const band = () => ({ start: 0, width: 24 });

function grows(item: { value: number; base: number; end: number }) {
  return item.value > 0 ? item.end < item.base : item.end > item.base;
}

Deno.test("shell/design-system#R13: 2px 간격 이하의 누적 조각은 뒤집어 그리지 않고 건너뛴다", () => {
  const items = barItems(1, series([[100], [0.25]]), true, band, y);
  assertEquals(items.map((item) => item.series), [0]);
  assert(items.every(grows));
  // 건너뛴 조각 대신 실제로 그린 바깥 조각이 둥근 data 끝을 갖는다.
  assertEquals(items[0].rounded, true);
  const negative = barItems(1, series([[-100], [-2], [-5]]), true, band, y);
  assertEquals(negative.map((item) => item.series), [0, 2]);
  assert(negative.every(grows));
  assertEquals(negative.map((item) => item.rounded), [false, true]);
  // 간격보다 두꺼운 조각은 2px 밀린 시작과 원래 끝을 지킨다.
  const [, upper] = barItems(1, series([[100], [5]]), true, band, y);
  assertEquals([upper.base, upper.end], [118, 115]);
});

Deno.test("shell/design-system#R13: 묶음 막대 hover 자리는 띠를 겹치지 않게 나누고 막대를 품는다", () => {
  const wide = () => ({ start: 0, width: 200 });
  const items = barItems(1, series([[1], [2], [3]]), false, wide, y);
  const hits = barHits(items, 3, false, wide, 8, 220);
  assertEquals(hits[0].x, 0);
  assertEquals(hits[2].x + hits[2].width, 200);
  for (const [index, hit] of hits.entries()) {
    const item = items[index];
    assert(hit.x <= item.x && item.x + item.width <= hit.x + hit.width);
    assertEquals([hit.y, hit.height], [8, 212]);
    if (index > 0) {
      assertEquals(hits[index - 1].x + hits[index - 1].width, hit.x);
    }
    // 보이는 막대 치수는 그대로다.
    assertEquals(item.width, 24);
  }
});

Deno.test("shell/design-system#R13: 누적 막대 hover 자리는 띠 폭 전체로 위아래를 겹치지 않게 나눈다", () => {
  const items = barItems(1, series([[50], [1], [50]]), true, band, y);
  assertEquals(items.length, 2);
  const hits = barHits(items, 3, true, band, 8, 220);
  const [lower, upper] = hits;
  assertEquals(upper.y, 8);
  assertEquals(lower.y + lower.height, 220);
  assertEquals(upper.y + upper.height, lower.y);
  assert(hits.every((hit) => hit.width === 24 && hit.height > 0));
});

Deno.test("shell/design-system#R41: 9계열이 1px 띠에 있어도 막대와 hover 자리는 띠 안에 있고 폭이 음수가 아니다", () => {
  const nine = series(Array.from({ length: 9 }, () => [1]));
  const tiny = () => ({ start: 8, width: 1 });
  const items = barItems(1, nine, false, tiny, y);
  assertEquals(items.length, 9);
  const hits = barHits(items, 9, false, tiny, 8, 220);
  for (const [index, hit] of hits.entries()) {
    assert(hit.width >= 0 && hit.x >= 8 && hit.x + hit.width <= 9 + 1e-9);
    assert(
      items[index].x >= 8 && items[index].x + items[index].width <= 9 + 1e-9,
    );
  }
  // 폭이 없는 띠에는 막대도 hover 자리도 두지 않는다.
  const none = () => ({ start: 8, width: 0 });
  assertEquals(barItems(1, nine, false, none, y), []);
  assertEquals(barItems(1, nine, true, none, y), []);
});
