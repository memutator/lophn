import { assertEquals } from "@std/assert";
import { click, one, render, style } from "../testing.ts";
import { List, ListItem } from "./list.tsx";

Deno.test("shell/design-system#R32: 목록 항목은 세로 여백 8px, 제목과 메타 사이 2px이다", () => {
  const picked: string[] = [];
  using view = render(
    <List>
      <ListItem title="Budget" meta="Updated today" />
      <ListItem
        title="Trips"
        meta="3 documents"
        selected
        onSelect={() => picked.push("trips")}
      />
    </List>,
  );
  const items = [...view.container.querySelectorAll("li")];
  for (const item of items) {
    const body = style(item.firstElementChild!);
    assertEquals([body.paddingTop, body.paddingBottom], ["8px", "8px"]);
    assertEquals([body.display, body.flexDirection], ["flex", "column"]);
    assertEquals(body.rowGap, "2px");
  }
  assertEquals(style(one(items[0], "span:last-child")).fontSize, "13px");
  assertEquals(style(items[1]).backgroundColor, "#e7f0fb");
  const button = one(items[1], "button");
  assertEquals(button.getAttribute("aria-current"), "true");
  click(button);
  assertEquals(picked, ["trips"]);
  assertEquals(items[0].querySelector("button"), null);
});
