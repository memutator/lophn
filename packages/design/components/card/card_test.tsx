import { assertEquals, assertThrows } from "@std/assert";
import { one, render, style } from "../testing.ts";
import { Card } from "./card.tsx";

Deno.test("shell/design-system#R31: 카드는 surface·기본 테두리·radius 8px·안 여백 16px이고 그림자가 없다", () => {
  using view = render(<Card>Grocery app</Card>);
  const card = style(one(view.container, "div"));
  assertEquals(card.backgroundColor, "#ffffff");
  assertEquals(
    [card.borderTopWidth, card.borderTopStyle, card.borderTopColor],
    ["1px", "solid", "#e1e0d9"],
  );
  assertEquals(card.borderTopLeftRadius, "8px");
  assertEquals(
    [card.paddingTop, card.paddingRight, card.paddingBottom, card.paddingLeft],
    ["16px", "16px", "16px", "16px"],
  );
  assertEquals(["", "none"].includes(card.boxShadow), true);
});

Deno.test("shell/design-system#R31: 카드 안에 카드를 두면 그리지 않고 오류다", () => {
  const original = console.error;
  console.error = () => {};
  try {
    assertThrows(
      () =>
        render(
          <Card>
            <Card>nested</Card>
          </Card>,
        ),
      Error,
      "Card cannot be nested",
    );
  } finally {
    console.error = original;
  }
});
