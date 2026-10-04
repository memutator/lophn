import { assert, assertEquals } from "@std/assert";
import { ErrorState } from "./error-state.tsx";
import { click, one, render } from "../testing.ts";

Deno.test("shell/design-system#R34: error는 실패 대상과 다시 불러오기 하나를 보인다", () => {
  let retried = 0;
  using view = render(
    <ErrorState target="Projects" onRetry={() => retried++} />,
  );
  assertEquals(one(view.container, "p").textContent, "Couldn't load Projects.");
  const buttons = view.container.querySelectorAll("button");
  assertEquals(buttons.length, 1);
  assertEquals(buttons[0].textContent, "Reload");
  click(buttons[0]);
  assertEquals(retried, 1);
});

Deno.test("shell/design-system#R2: error는 색 없이도 circle-x 표지와 글로 구별한다", () => {
  using view = render(<ErrorState target="Projects" onRetry={() => {}} />);
  const icon = one(view.container, "svg");
  assert(icon.classList.contains("lucide-circle-x"));
  assertEquals(icon.getAttribute("width"), "20");
});
