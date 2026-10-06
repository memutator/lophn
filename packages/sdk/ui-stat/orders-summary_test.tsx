import { assert, assertEquals } from "@std/assert";
import * as design from "@lophn/design/components";
import { one, render, style } from "../../design/components/testing.ts";
import * as sdk from "./mod.ts";
import { OrdersSummary } from "./examples/orders-summary.tsx";

Deno.test("apps/sdk#R18: @lophn/ui-stat은 lophn 화면과 같은 수치 타일을 낸다", () => {
  assertEquals(sdk.StatTile, design.StatTile);
  assertEquals(sdk.StatRow, design.StatRow);
});

Deno.test("apps/sdk#R18: 예제는 read command 결과의 수치와 변화량을 방향 아이콘과 부호로 보인다", () => {
  using view = render(
    <OrdersSummary
      result={{
        orders: { current: 1_284, previous: 1_140 },
        revenue: { current: 182_400, previous: 190_000 },
        late: { current: 2, previous: 2 },
      }}
    />,
  );
  const tiles = [
    ...view.container.firstElementChild!.firstElementChild!.children,
  ] as HTMLElement[];
  const read = (tile: HTMLElement) => {
    const [label, value, change] = [...tile.children] as HTMLElement[];
    return [
      label.textContent,
      value.textContent,
      change.textContent,
      change.dataset.direction,
    ];
  };
  assertEquals(tiles.map(read), [
    ["Orders", "1,284", "+144vs last period", "up"],
    ["Revenue", "182KUSD", "-7,600vs last period", "down"],
    ["Late shipments", "2", "0vs last period", "flat"],
  ]);
  assertEquals(style(one(tiles[0], "span > span")).fontSize, "28px");
  assert(
    one(tiles[0], "[data-direction] svg").classList.contains(
      "lucide-trending-up",
    ),
  );
});
