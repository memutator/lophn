import { assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { Kbd } from "./kbd.tsx";
import { render, style } from "../testing.ts";

Deno.test("shell/design-system#R5: Kbd는 caption 크기 중립 글자로 크롬이 내용을 누르지 않는다", () => {
  using view = render(<Kbd keys={["Ctrl", "K"]} />);
  const keys = [...view.container.querySelectorAll("kbd > kbd")];
  assertEquals(keys.map((key) => key.textContent), ["Ctrl", "K"]);
  for (const key of keys) {
    assertEquals(style(key).fontSize, tokens.type.caption.size);
    assertEquals(style(key).color, tokens.color.text.secondary.light);
  }
});
