import { assert, assertEquals } from "@std/assert";
import {
  click,
  render,
} from "../../../../../../packages/design/components/testing.ts";

import { AppsScreen } from "./apps-screen.tsx";
import { Desktop } from "../../main.tsx";
import { openLophn } from "../../router.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { fakeSource } from "../testdata/fake-source.ts";
import { find, flush } from "../testdata/dom.ts";
import {
  appRow,
  BUDGET,
  BUDGET_RELEASE,
  fakeApps,
  NOTES,
  OLD,
} from "./testdata/fake-apps.ts";

const ROWS = [
  appRow(NOTES, "Reading notes", { release: "rel_01h455vb4pex5v6nkc6gd5fd02" }),
  appRow(OLD, "Old tracker", { archived: true }),
  appRow(BUDGET, "Grocery budget", { release: BUDGET_RELEASE }),
];

function rowsOf(container: Element) {
  return [...container.querySelectorAll("[data-app-row]")];
}

Deno.test("shell/wording#R4: apps 화면은 사람이 지은 이름과 상태 라벨만 보이고 원시 enum·ID가 없다", async () => {
  const apps = fakeApps({
    rows: ROWS,
    runs: { [BUDGET]: "running", [NOTES]: "unavailable" },
  });
  using view = render(<AppsScreen source={apps.source} onOpen={() => {}} />);
  await flush();
  const rows = rowsOf(view.container);
  // 보관하지 않은 앱이 먼저, 그 안은 이름 순서다.
  assertEquals(
    rows.map((row) => row.querySelector("span")?.textContent),
    ["Grocery budget", "Reading notes", "Old tracker"],
  );
  assertEquals(rows.map((row) => row.getAttribute("data-status")), [
    "running",
    "unavailable",
    "archived",
  ]);
  const text = view.container.textContent ?? "";
  for (const label of ["Running", "Not responding", "Archived"]) {
    assert(text.includes(label), label);
  }
  for (const raw of ["app_", "rel_", "unavailable", "active", "archived"]) {
    assert(!text.includes(raw), raw);
  }
  // 보관한 앱은 열지 않고 실행 상태도 읽지 않는다.
  assertEquals(rows[2]!.querySelector("[data-action='open']"), null);
  assert(!apps.calls.some((call) => call[0] === "runtime" && call[1] === OLD));
});

Deno.test("shell/wording#R4: 보관과 꺼내기는 묻지 않고 하고 결과를 이름으로 알리며, 낡은 기준이면 최신을 다시 보인다", async () => {
  const apps = fakeApps({ rows: ROWS });
  using view = render(<AppsScreen source={apps.source} onOpen={() => {}} />);
  await flush();
  click(find(view.container, "[data-action='archive']"));
  await flush();
  assertEquals(
    find(view.container, "[data-notice]").textContent,
    "Grocery budget is archived and won't start.",
  );
  assertEquals(apps.calls.find((call) => call[0] === "archive"), [
    "archive",
    BUDGET,
    true,
    "7",
  ]);
  click(
    find(
      view.container,
      "[data-app-row][data-status='archived'] [data-action='restore']",
    ),
  );
  await flush();
  assertEquals(
    find(view.container, "[data-notice]").textContent,
    "Grocery budget is back. It stays stopped until you start it.",
  );

  const stale = fakeApps({ rows: ROWS, archiveCode: "conflict" });
  using again = render(
    <AppsScreen source={stale.source} onOpen={() => {}} />,
  );
  await flush();
  const lists = stale.calls.filter((call) => call[0] === "list").length;
  click(find(again.container, "[data-action='archive']"));
  await flush();
  assertEquals(
    find(again.container, "[data-notice]").textContent,
    "This changed since you opened it. Showing the latest.",
  );
  assertEquals(
    stale.calls.filter((call) => call[0] === "list").length,
    lists + 1,
  );
});

Deno.test("shell/wording#R4: apps 목록을 읽지 못하면 대상과 다시 시도를 보이고 앱이 없으면 한 문장만 보인다", async () => {
  using failed = render(
    <AppsScreen
      source={fakeApps({ listFails: true }).source}
      onOpen={() => {}}
    />,
  );
  await flush();
  assertEquals(
    find(failed.container, "[data-state='error'] p").textContent,
    "Couldn't load your apps.",
  );
  using empty = render(
    <AppsScreen source={fakeApps().source} onOpen={() => {}} />,
  );
  await flush();
  assertEquals(
    find(empty.container, "[data-screen-body='apps']").textContent,
    "No apps yet.",
  );
});

const core: CoreSource = {
  subscribe(listener) {
    listener({ state: "ready", confirmedAt: 1 });
    return () => {};
  },
  call: () => Promise.resolve({ ok: true, value: {} }),
};

Deno.test("shell/app-frame#R26: apps 화면의 열기는 그 앱 공간으로 가고 바의 런처 복귀로 돌아온다", async () => {
  const apps = fakeApps({ rows: ROWS, screen: "home" });
  const { source } = fakeSource();
  using view = render(
    <Desktop
      source={core}
      initial={openLophn("apps")}
      lophn={source}
      apps={apps.source}
      windowWidth={1280}
    />,
  );
  await flush();
  click(find(view.container, "[data-action='open']"));
  await flush();
  const space = find(view.container, "[data-space='app']");
  assertEquals(space.getAttribute("data-app"), BUDGET);
  assertEquals(find(space, "[data-app-name]").textContent, "Grocery budget");
  click(find(space, "[data-launcher-back]"));
  await flush();
  assertEquals(view.container.querySelector("[data-space='app']"), null);
});
