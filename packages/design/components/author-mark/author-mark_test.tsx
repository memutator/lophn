import { assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { AuthorMark } from "./author-mark.tsx";
import { one, render, style } from "../testing.ts";

Deno.test("shell/design-system#R34: agent가 쓴 내용은 작은 작성자 표식으로 보인다", () => {
  using view = render(<AuthorMark author="Operator" />);
  const mark = one(view.container, "[data-author=agent]");
  assertEquals(mark.textContent, "Written by Operator");
  assertEquals(style(mark).fontSize, tokens.type.caption.size);
  assertEquals(style(mark).color, tokens.color.text.muted.light);
  assertEquals(view.container.querySelectorAll("svg").length, 0);
});
