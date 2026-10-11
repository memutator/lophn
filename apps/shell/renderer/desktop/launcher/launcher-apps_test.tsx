import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../packages/design/components/testing.ts";

import type { ConnectionState, CoreSource } from "../connection/connection.ts";
import { find, flush } from "../lophn-space/testdata/dom.ts";
import {
  appRow,
  BUDGET,
  fakeApps,
  NOTES,
  OLD,
} from "../lophn-space/apps/testdata/fake-apps.ts";
import { Launcher } from "./launcher.tsx";
import type { LauncherSource } from "./source.ts";

const ready: ConnectionState = { state: "ready", confirmedAt: 1 };
const core: CoreSource = {
  subscribe(listener) {
    listener(ready);
    return () => {};
  },
  call: () => Promise.resolve({ ok: true, value: {} }),
};

const projects: LauncherSource = {
  projects: () => Promise.resolve({ ok: true, value: [] }),
  register: () => Promise.reject(new Error("unused")),
  pickFolder: () => Promise.reject(new Error("unused")),
};

Deno.test("shell/desktop#R25: 런처는 프로젝트 section 아래에 보관하지 않은 앱 카드를 보이고 누르면 그 앱 공간을 연다", async () => {
  const apps = fakeApps({
    rows: [
      appRow(NOTES, "Reading notes"),
      appRow(OLD, "Old tracker", { archived: true }),
      appRow(BUDGET, "Grocery budget"),
    ],
    runs: { [BUDGET]: "running", [NOTES]: "stopped" },
  });
  const opened: string[] = [];
  using view = render(
    <Launcher
      source={core}
      onLophn={() => {}}
      projects={projects}
      apps={apps.source}
      onApp={(app) => opened.push(app)}
    />,
  );
  await flush();
  const sections = [...view.container.querySelectorAll("[data-section]")];
  assertEquals(sections.map((s) => s.getAttribute("data-section")), [
    "projects",
    "apps",
  ]);
  const cards = [...view.container.querySelectorAll("[data-card='app']")];
  assertEquals(
    cards.map((c) => c.querySelector("button")?.textContent),
    ["Grocery budget", "Reading notes"],
  );
  assertEquals(find(cards[0]!, "[data-status]").textContent, "Running");
  const text = view.container.textContent ?? "";
  for (const raw of ["app_", "Old tracker"]) assert(!text.includes(raw), raw);
  click(find(cards[0]!, "button"));
  assertEquals(opened, [BUDGET]);
});

Deno.test("shell/desktop#R25: 앱이 없으면 앱 section은 비었음 상태와 다음 행동 하나를 보인다", async () => {
  const apps = fakeApps({ rows: [] });
  let lophn = 0;
  using view = render(
    <Launcher
      source={core}
      onLophn={() => lophn++}
      projects={projects}
      apps={apps.source}
    />,
  );
  await flush();
  const empty = find(
    view.container,
    "[data-section='apps'] [data-state='empty']",
  );
  assertEquals(empty.querySelector("p")?.textContent, "No apps yet.");
  const buttons = empty.querySelectorAll("button");
  assertEquals(buttons.length, 1);
  click(buttons[0]!);
  assertEquals(lophn, 1);
});
