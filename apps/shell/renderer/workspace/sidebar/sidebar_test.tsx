import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  render,
  style,
} from "../../../../../packages/design/components/testing.ts";

import { Sidebar } from "./sidebar.tsx";
import type { ProjectView } from "../source.ts";
import type { RailAction } from "../contexts/shortcut-rail.tsx";

const project: ProjectView = {
  id: "prj_1",
  title: "lophn",
  folders: [{ path: "/work/lophn" }],
};

function renderSidebar(
  mode: "open" | "collapsed" | "hidden",
  width: number,
  handlers: {
    onLauncher?: () => void;
    onToggle?: () => void;
    onOpenContexts?: () => void;
    onRail?: (action: RailAction) => void;
  } = {},
) {
  return render(
    <Sidebar
      mode={mode}
      width={width}
      project={project}
      documents={[{ id: "doc_1", title: "notes" }]}
      onLauncher={handlers.onLauncher ?? (() => {})}
      onToggle={handlers.onToggle ?? (() => {})}
      onOpenDocument={() => {}}
      onOpenContexts={handlers.onOpenContexts ?? (() => {})}
      onRail={handlers.onRail ?? (() => {})}
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
  // 접히면 문서·폴더 행 없이 바로 가기 rail만 남는다(workspace#R32).
  assertEquals(collapsed.container.querySelector("[data-document]"), null);
  assertEquals(collapsed.container.querySelector("[data-folder]"), null);
  assertEquals(
    [...collapsed.container.querySelectorAll("[data-rail-action]")].map((
      button,
    ) => button.getAttribute("data-rail-action")),
    ["terminal", "contexts", "saved", "search", "agent"],
  );
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

Deno.test("shell/desktop#R28: sidebar는 프로젝트 폴더·문서·Contexts 행만 보인다", () => {
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
    view.container.querySelector("[data-contexts-row]")?.textContent,
    "Contexts",
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

Deno.test("shell/desktop#R28: 폴더 행은 눌러 펼치고 그 아래 문서를 열며 Contexts 행은 Contexts 탭을 연다", () => {
  const opened: string[] = [];
  const contexts: string[] = [];
  using view = render(
    <Sidebar
      mode="open"
      width={240}
      project={project}
      documents={[{ id: "doc_1", title: "notes" }]}
      files={[
        {
          folder: "/work/lophn",
          path: "docs/notes.md",
          document: "doc_1",
          title: "notes",
        },
      ]}
      onLauncher={() => {}}
      onToggle={() => {}}
      onOpenDocument={(document) => opened.push(document.id)}
      onOpenContexts={() => contexts.push("contexts")}
    />,
  );
  const folder = view.container.querySelector("[data-folder]") as HTMLElement;
  assertEquals(folder.getAttribute("aria-expanded"), "false");
  assertEquals(view.container.querySelector("[data-folder-document]"), null);
  act(() => folder.click());
  assertEquals(folder.getAttribute("aria-expanded"), "true");
  assertEquals(folder.getAttribute("aria-current"), "page");
  const inside = view.container.querySelector(
    "[data-folder-document]",
  ) as HTMLElement;
  act(() => inside.click());
  assertEquals(opened, ["doc_1"]);
  act(() => folder.click());
  assertEquals(folder.getAttribute("aria-expanded"), "false");
  assertEquals(view.container.querySelector("[data-folder-document]"), null);

  const row = view.container.querySelector(
    "[data-contexts-row]",
  ) as HTMLElement;
  act(() => row.click());
  assertEquals(contexts, ["contexts"]);
});
