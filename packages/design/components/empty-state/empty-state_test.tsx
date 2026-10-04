import { assert, assertEquals } from "@std/assert";
import { FolderOpen } from "lucide-react";
import { ErrorState } from "../error-state/error-state.tsx";
import { EmptyState } from "./empty-state.tsx";
import { click, one, render, style } from "../testing.ts";

const add = { label: "Add project", onSelect: () => {} };

Deno.test("shell/design-system#R34: empty는 20px 아이콘·한 문장·행동 하나이고 삽화가 없다", () => {
  const selected: string[] = [];
  using view = render(
    <EmptyState
      icon={FolderOpen}
      message="No projects yet."
      action={{ label: "Add project", onSelect: () => selected.push("add") }}
    />,
  );
  const icons = view.container.querySelectorAll("svg");
  assertEquals(icons.length, 1);
  assertEquals(icons[0].getAttribute("width"), "20");
  assertEquals(view.container.querySelectorAll("p").length, 1);
  assertEquals(one(view.container, "p").textContent, "No projects yet.");
  assertEquals(view.container.querySelectorAll("button").length, 1);
  assertEquals(view.container.querySelectorAll("img").length, 0);
  click(one(view.container, "button"));
  assertEquals(selected, ["add"]);
});

Deno.test("shell/design-system#R34: 행동 없는 empty는 compile에서 거절된다", () => {
  // @ts-expect-error empty는 다음 행동 하나를 반드시 받는다.
  void <EmptyState icon={FolderOpen} message="No projects yet." />;
  using view = render(
    <EmptyState icon={FolderOpen} message="No projects yet." action={add} />,
  );
  assertEquals(view.container.querySelectorAll("button").length, 1);
});

Deno.test("shell/design-system#R1: empty와 error는 표지·아이콘·문장·행동으로 혼동하지 않는다", () => {
  using view = render(
    <div>
      <EmptyState icon={FolderOpen} message="No projects yet." action={add} />
      <ErrorState target="Projects" onRetry={() => {}} />
    </div>,
  );
  const [empty, error] = [...view.container.querySelectorAll("[data-state]")];
  assertEquals(empty.getAttribute("data-state"), "empty");
  assertEquals(error.getAttribute("data-state"), "error");
  assert(
    one(empty, "svg").getAttribute("class") !==
      one(error, "svg").getAttribute("class"),
  );
  assertEquals(empty.querySelectorAll("button").length, 1);
  assertEquals(one(empty, "button").textContent, "Add project");
  assertEquals(error.querySelectorAll("button").length, 1);
  assertEquals(one(error, "button").textContent, "Reload");
});

Deno.test("shell/design-system#R5: empty·error는 본문 크기 한 단계로 같은 위계이며 제목을 키우지 않는다", () => {
  using view = render(
    <div>
      <EmptyState icon={FolderOpen} message="No projects yet." action={add} />
      <ErrorState target="Projects" onRetry={() => {}} />
    </div>,
  );
  assertEquals(view.container.querySelectorAll("h1,h2,h3,h4,h5,h6").length, 0);
  const sizes = [...view.container.querySelectorAll("p")].map((p) =>
    style(p).fontSize
  );
  assertEquals(sizes, ["14px", "14px"]);
});
