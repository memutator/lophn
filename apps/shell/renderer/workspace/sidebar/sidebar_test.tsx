import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  render,
  style,
} from "../../../../../packages/design/components/testing.ts";

import { Sidebar } from "./sidebar.tsx";
import type { ProjectView } from "../source.ts";

const project: ProjectView = {
  id: "prj_1",
  title: "lophn",
  folders: [{ path: "/work/lophn" }],
};

function renderSidebar(
  mode: "open" | "collapsed" | "hidden",
  width: number,
  handlers: { onLauncher?: () => void; onToggle?: () => void } = {},
) {
  return render(
    <Sidebar
      mode={mode}
      width={width}
      project={project}
      documents={[{ id: "doc_1", title: "notes" }]}
      contexts={[{ id: "ctx_1", title: "design" }]}
      onLauncher={handlers.onLauncher ?? (() => {})}
      onToggle={handlers.onToggle ?? (() => {})}
      onOpenDocument={() => {}}
    />,
  );
}

Deno.test("shell/desktop#R22: sidebar는 240px, 접힘 56px, 탐색 행은 32px다", () => {
  using open = renderSidebar("open", 240);
  const nav = open.container.querySelector("[data-sidebar]") as HTMLElement;
  assertEquals(style(nav).width, "240px");
  const row = open.container.querySelector("[data-document]") as HTMLElement;
  assertEquals(style(row).height, "32px");
  const header = open.container.querySelector(
    "[data-sidebar] > div",
  ) as HTMLElement;
  assertEquals(style(header).height, "48px");

  using collapsed = renderSidebar("collapsed", 56);
  const folded = collapsed.container.querySelector(
    "[data-sidebar]",
  ) as HTMLElement;
  assertEquals(style(folded).width, "56px");
  // 접히면 이름 없이 아이콘 행만 남는다.
  const foldedRow = collapsed.container.querySelector(
    "[data-document]",
  ) as HTMLElement;
  assertEquals(foldedRow.textContent, "");
  assertEquals(foldedRow.getAttribute("aria-label"), "notes");
  assertEquals(style(foldedRow).width, "32px");
});

Deno.test("shell/design-system#R24: 640px 미만에서는 sidebar를 그리지 않는다", () => {
  using hidden = renderSidebar("hidden", 0);
  assertEquals(hidden.container.querySelector("[data-sidebar]"), null);
});

Deno.test("shell/desktop#R26: 런처 복귀는 sidebar가 열렸을 때만 sidebar에 있다", () => {
  const back: string[] = [];
  using open = renderSidebar("open", 240, {
    onLauncher: () => back.push("back"),
  });
  const button = open.container.querySelector(
    "[data-launcher-back]",
  ) as HTMLElement;
  assertEquals(button.getAttribute("aria-label"), "Launcher");
  assertEquals(button.textContent, "");
  act(() => button.click());
  assertEquals(back, ["back"]);

  using collapsed = renderSidebar("collapsed", 56);
  assertEquals(collapsed.container.querySelector("[data-launcher-back]"), null);
});

Deno.test("shell/desktop#R28: sidebar는 프로젝트 폴더·문서·연관 컨텍스트만 보인다", () => {
  using view = renderSidebar("open", 240);
  const sections = [
    ...view.container.querySelectorAll("[data-section]"),
  ].map((node) => node.getAttribute("data-section"));
  assertEquals(sections, ["folders", "documents", "contexts"]);
  assertEquals(
    view.container.querySelector("[data-folder]")?.textContent,
    "lophn",
  );
  assertEquals(
    view.container.querySelector("[data-document]")?.textContent,
    "notes",
  );
  assertEquals(
    view.container.querySelector("[data-context]")?.textContent,
    "design",
  );
  const text = view.container.textContent ?? "";
  for (const gone of ["Inbox", "Unsorted", "Uncategorized"]) {
    assert(!text.includes(gone), `${gone} should not appear`);
  }
});

Deno.test("shell/desktop#R22: 접힘 버튼이 사람의 접힘을 바꾼다", () => {
  const toggled: number[] = [];
  using view = renderSidebar("open", 240, {
    onToggle: () => toggled.push(1),
  });
  const toggle = view.container.querySelector(
    "[data-sidebar-toggle]",
  ) as HTMLElement;
  assertEquals(toggle.getAttribute("aria-expanded"), "true");
  // 접기 버튼은 글자 없이 Lucide 아이콘만 보이고 이름은 aria-label에 둔다.
  assertEquals(toggle.textContent, "");
  assertEquals(toggle.getAttribute("aria-label"), "Collapse sidebar");
  const icon = toggle.querySelector("svg") as SVGElement;
  assertEquals(icon.getAttribute("width"), "16");
  assertEquals(icon.getAttribute("stroke-width"), "1.5");
  act(() => toggle.click());
  assertEquals(toggled, [1]);
});
