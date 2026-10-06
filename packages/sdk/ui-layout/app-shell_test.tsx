import { assertEquals } from "@std/assert";
import { render } from "../../design/components/testing.ts";
import { AppShell } from "./mod.ts";

Deno.test("apps/sdk#R15: nav가 없는 AppShell의 본문은 sidebar 칸이 아니라 전체 폭을 쓰고 nav가 있으면 sidebar 칸을 둔다", () => {
  using bare = render(<AppShell title="Todos">body</AppShell>);
  assertEquals(
    bare.container.querySelector("[data-nav=none] > main")?.textContent,
    "body",
  );
  assertEquals(bare.container.querySelector("nav"), null);
  using withNav = render(
    <AppShell title="Todos" nav={<span>menu</span>}>body</AppShell>,
  );
  assertEquals(withNav.container.querySelector("[data-nav=none]"), null);
  assertEquals(withNav.container.querySelector("nav")?.textContent, "menu");
});
