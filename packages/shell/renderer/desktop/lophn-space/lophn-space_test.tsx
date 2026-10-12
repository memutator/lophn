import { assert, assertEquals } from "@std/assert";
import { click, render, style } from "../../../../design/components/testing.ts";

import { LophnSpace } from "./lophn-space.tsx";
import { Desktop } from "../main.tsx";
import { openLophn } from "../router.ts";
import type { CoreSource } from "../connection/connection.ts";
import { fakeSource } from "./testdata/fake-source.ts";
import { byLabel, find, flush } from "./testdata/dom.ts";

const core: CoreSource = {
  subscribe(listener) {
    listener({ state: "ready", confirmedAt: 1 });
    return () => {};
  },
  call: () => Promise.resolve({ ok: true, value: {} }),
};

Deno.test("shell/desktop#R28: lophn 공간 sidebar는 여섯 형제를 한 단으로 두고 분류 전·거처 같은 중간 계층이 없다", async () => {
  const { source } = fakeSource();
  using view = render(
    <LophnSpace source={source} windowWidth={1440} onLauncher={() => {}} />,
  );
  await flush();
  const sidebar = find(view.container, "nav[data-sidebar='open']");
  assertEquals(sidebar.getAttribute("aria-label"), "Lophn Workspace");
  assertEquals(style(sidebar).width, "240px");
  const rows = [...sidebar.querySelectorAll("[data-screen]")];
  assertEquals(rows.map((row) => row.getAttribute("data-screen")), [
    "projects",
    "documents",
    "apps",
    "things-to-confirm",
    "settings",
  ]);
  assertEquals(rows.map((row) => row.textContent), [
    "Projects",
    "Documents",
    "Apps",
    "Things to confirm",
    "Settings",
  ]);
  // 모든 행이 같은 깊이다. 접고 펴는 묶음이나 하위 목록이 없다.
  assertEquals(sidebar.querySelectorAll("ul").length, 1);
  for (const row of rows) assert(row.querySelector("svg.lucide"));
  const text = sidebar.textContent ?? "";
  for (const gone of ["Unsorted", "Inbox", "Home", "Series"]) {
    assert(!text.includes(gone), `${gone} is in the sidebar`);
  }
});

Deno.test("shell/desktop#R1: lophn 공간은 documents를 먼저 열고 형제를 고르면 본문과 상단 경로가 바뀐다", async () => {
  const { source, of } = fakeSource();
  let launcher = 0;
  using view = render(
    <LophnSpace
      source={source}
      windowWidth={1440}
      onLauncher={() => launcher++}
    />,
  );
  await flush();
  const space = find(view.container, "[data-space='lophn']");
  assertEquals(space.getAttribute("data-current-screen"), "documents");
  assertEquals(
    find(view.container, "[data-screen='documents']").getAttribute(
      "aria-current",
    ),
    "page",
  );
  assert(view.container.querySelector("[data-screen-body='documents']"));
  assertEquals(
    [...view.container.querySelectorAll("[data-crumb]")].map((crumb) =>
      crumb.textContent
    ),
    ["Lophn Workspace", "Documents"],
  );
  // 검색 조건 선택지는 전체 목차와 format 목록에서 온다.
  assertEquals(of("catalog").length, 1);
  assertEquals(of("formats").length, 1);
  click(find(view.container, "[data-screen='settings']"));
  assertEquals(space.getAttribute("data-current-screen"), "settings");
  assert(view.container.querySelector("[data-not-ready='settings']"));
  assertEquals(
    [...view.container.querySelectorAll("[data-crumb]")].map((crumb) =>
      crumb.textContent
    ),
    ["Lophn Workspace", "Settings"],
  );
  click(byLabel(view.container, "Launcher"));
  assertEquals(launcher, 1);
});

Deno.test("shell/desktop#R28: 좁은 창은 sidebar를 접고 런처 복귀를 상단 바로 옮기며 640px 미만은 숨긴다", async () => {
  const { source } = fakeSource();
  using narrow = render(
    <LophnSpace source={source} windowWidth={800} onLauncher={() => {}} />,
  );
  await flush();
  const sidebar = find(narrow.container, "nav[data-sidebar='collapsed']");
  assertEquals(style(sidebar).width, "56px");
  const settings = find(sidebar, "[data-screen='settings']");
  assertEquals(settings.getAttribute("aria-label"), "Settings");
  assert(
    find(narrow.container, "header").querySelector("[data-launcher-back]"),
    "launcher is not in the top bar",
  );
  narrow.unmount();
  using phone = render(
    <LophnSpace source={source} windowWidth={600} onLauncher={() => {}} />,
  );
  await flush();
  assertEquals(phone.container.querySelector("nav[data-sidebar]"), null);
});

Deno.test("shell/desktop#R1: 런처의 lophn 진입점은 대화 없이 lophn 공간의 documents로 간다", async () => {
  const { source } = fakeSource();
  using view = render(
    <Desktop source={core} lophn={source} initial={openLophn()} />,
  );
  await flush();
  const space = find(view.container, "[data-space='lophn']");
  assertEquals(space.getAttribute("data-current-screen"), "documents");
  click(byLabel(view.container, "Launcher"));
  await flush();
  assertEquals(view.container.querySelector("[data-space='lophn']"), null);
  click(find(view.container, "[data-entry='lophn']"));
  await flush();
  assert(view.container.querySelector("[data-space='lophn']"));
});
