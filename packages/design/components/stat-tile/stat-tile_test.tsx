import { assert, assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { one, render, style } from "../testing.ts";
import { StatRow, StatTile } from "./stat-tile.tsx";

Deno.test("shell/design-system#R31: 수치 타일은 라벨→4px→28px 값→4px→변화량과 방향 아이콘이고 값은 중립색이다", () => {
  using view = render(
    <StatTile
      label="Requests"
      value={1_284_000}
      unit="per day"
      change={-12}
      changeLabel="vs last week"
    />,
  );
  const tile = view.container.firstElementChild!;
  const [label, value, change] = [...tile.children] as HTMLElement[];
  assertEquals(label.textContent, "Requests");
  assertEquals(style(tile).rowGap, "4px");
  const number = style(value.firstElementChild!);
  assertEquals([number.fontSize, number.lineHeight], ["28px", "36px"]);
  assertEquals(number.color, tokens.color.text.primary.light);
  assertEquals(value.firstElementChild!.textContent, "1.3M");
  assertEquals(value.lastElementChild!.textContent, "per day");
  assertEquals(change.dataset.direction, "down");
  assertEquals(change.textContent, "-12vs last week");
  assertEquals(style(change).color, tokens.color.text.secondary.light);
  assert(one(change, "svg").classList.contains("lucide-trending-down"));
});

Deno.test("shell/design-system#R31: 변화 방향은 부호와 아이콘 모양으로 구별한다", () => {
  using view = render(
    <div>
      <StatTile label="Up" value={5} change={3} />
      <StatTile label="Flat" value={5} change={0} />
    </div>,
  );
  const changes = [...view.container.querySelectorAll("[data-direction]")];
  assertEquals(changes.map((c) => (c as HTMLElement).dataset.direction), [
    "up",
    "flat",
  ]);
  assertEquals(changes.map((c) => c.textContent), ["+3", "0"]);
  assert(one(changes[0], "svg").classList.contains("lucide-trending-up"));
  assert(one(changes[1], "svg").classList.contains("lucide-minus"));
});

Deno.test("shell/design-system#R31: 수치 타일은 한 줄에 최대 4개다", () => {
  using view = render(
    <StatRow>
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <StatTile key={n} label={`Metric ${n}`} value={n} />
      ))}
    </StatRow>,
  );
  const row = style(view.container.firstElementChild!);
  assertEquals(row.display, "grid");
  assert(
    /^repeat\(4, minmax\(0(px)?, 1fr\)\)$/.test(row.gridTemplateColumns),
    row.gridTemplateColumns,
  );
  assertEquals(tokens.stat.perRow, 4);
});
