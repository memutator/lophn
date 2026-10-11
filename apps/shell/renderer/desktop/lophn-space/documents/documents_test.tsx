import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  pressAsync,
  render,
  unmountSettled,
} from "../../../../../../packages/design/components/testing.ts";

import { DocumentsScreen } from "./documents-screen.tsx";
import type { SearchConditions, SearchPage } from "../source.ts";
import { fakeSource, OUTLINE } from "../testdata/fake-source.ts";
import {
  byLabel,
  byText,
  find,
  flush,
  pressTab,
  submit,
  typeInto,
} from "../testdata/dom.ts";

const clean = { lagging: false, rebuilding: false, omissions: 0 };

const PAGE: SearchPage = {
  hits: [{
    document: "doc_1",
    version: "ver_2",
    latestVersion: "ver_2",
    section: "goals",
    title: "Release notes",
    snippet: "the goals for this release",
    format: "document",
    fromSummary: false,
  }, {
    document: "doc_2",
    version: "ver_5",
    latestVersion: "ver_6",
    section: null,
    title: "Old plan",
    snippet: "planned goals",
    format: "pdf",
    fromSummary: true,
  }],
  coverage: clean,
  nextCursor: null,
};

/** Radix Select를 키보드로 열고 steps번 내려 고른다. */
async function choose(trigger: Element, steps: number): Promise<void> {
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  for (let step = 0; step < steps; step += 1) {
    await pressAsync(document.activeElement!, "ArrowDown");
  }
  await pressAsync(document.activeElement!, "Enter");
  await flush();
}

function fieldTrigger(root: ParentNode, label: string): HTMLElement {
  for (const element of root.querySelectorAll("label")) {
    if (element.textContent === label) {
      return find(root, `#${CSS.escape(element.getAttribute("for")!)}`);
    }
  }
  throw new Error(`no field ${label}`);
}

async function search(root: ParentNode, query: string): Promise<void> {
  typeInto(find(root, "[data-search-input]"), query);
  submit(find(root, "[data-search-form]"));
  await flush();
}

Deno.test("shell/desktop#R1: 검색 결과는 제목과 짧은 근거만 보이고 본문은 문서를 열 때 읽는다", async () => {
  const { source, of } = fakeSource({
    search: () => ({ ok: true, value: PAGE }),
  });
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  await search(view.container, "goals");
  const searched = of("search")[0]!.args[0] as SearchConditions;
  assertEquals(searched.query, "goals");
  assertEquals(searched.includeArchived, false);
  const hits = [...view.container.querySelectorAll("[data-hits] [data-hit]")];
  assertEquals(
    hits.map((hit) => hit.querySelector("[data-snippet]")?.textContent),
    [
      "the goals for this release",
      "planned goals",
    ],
  );
  assert(hits[0]!.textContent?.includes("Release notes"));
  assert(hits[1]!.textContent?.includes("Matched in a summary"));
  assert(hits[1]!.textContent?.includes("PDF"));
  assert(hits[1]!.querySelector("[data-newer-version]"));
  // 목록만 받았다. 본문·목차는 아직 읽지 않는다.
  assertEquals(of("read").length, 0);
  assertEquals(of("outline").length, 0);
  click(hits[0]!);
  await flush();
  assertEquals(of("outline")[0]!.args, ["doc_1", "ver_2"]);
  assertEquals(of("head")[0]!.args, ["doc_1", "ver_2"]);
  assertEquals(of("read")[0]!.args, ["doc_1", "ver_2", "goals", undefined]);
  assertEquals(hits[0]!.getAttribute("aria-current"), "true");
  assert(view.container.querySelector("[data-reader='doc_1'] [data-body]"));
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 프로젝트·앱·focus·format 조건으로 좁히면 같은 검색어로 다시 찾는다", async () => {
  const { source, of } = fakeSource({
    search: () => ({ ok: true, value: PAGE }),
  });
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  await search(view.container, "goals");
  // 자리 선택지: Any place, lophn(프로젝트), Groceries(앱).
  await choose(fieldTrigger(view.container, "Place"), 2);
  const byApp = of("search").at(-1)!.args[0] as SearchConditions;
  assertEquals(byApp.place, { kind: "app", id: "app_1" });
  assertEquals(byApp.query, "goals");
  await choose(fieldTrigger(view.container, "Context"), 1);
  await choose(fieldTrigger(view.container, "Format"), 2);
  const narrowed = of("search").at(-1)!.args[0] as SearchConditions;
  assertEquals(narrowed.context, "ctx_1");
  assertEquals(narrowed.format, "pdf");
  assertEquals(narrowed.place, { kind: "app", id: "app_1" });
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 검색이 뒤처졌으면 빈 결과를 원본 부재로 말하지 않고 지연을 알린다", async () => {
  const { source } = fakeSource({
    search: () => ({
      ok: true,
      value: {
        hits: [],
        coverage: { lagging: true, rebuilding: false, omissions: 2 },
        nextCursor: null,
      },
    }),
  });
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  await search(view.container, "goals");
  const notes = [...view.container.querySelectorAll("[data-coverage-note]")];
  assertEquals(notes.map((note) => note.textContent), [
    "Search hasn't caught up with the newest changes yet.",
    "2 documents couldn't be searched.",
  ]);
  const empty = find(view.container, "[data-state='empty']");
  assertEquals(
    empty.querySelector("p")?.textContent,
    "Nothing matches yet, and search may not include the newest changes.",
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 보관을 빼고 찾은 빈 결과는 보관 포함을 권하고 보관 문서를 제목으로 찾는다", async () => {
  const { source, of } = fakeSource({
    archived: [{
      document: "doc_9",
      version: "ver_9",
      title: "Goals 2025",
      format: "document",
    }],
  });
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  await search(view.container, "goals");
  assertEquals(of("archived").length, 0);
  const empty = find(view.container, "[data-state='empty']");
  assertEquals(
    empty.querySelector("p")?.textContent,
    "Nothing matches among documents that aren't archived.",
  );
  click(byText(empty, "Include archived"));
  await flush();
  const conditions = of("archived")[0]!.args[0] as SearchConditions;
  assertEquals(conditions.includeArchived, true);
  assertEquals(conditions.query, "goals");
  const archived = find(view.container, "[data-archived-hits]");
  assert(archived.textContent?.includes("Goals 2025"));
  click(find(archived, "[data-hit='doc_9']"));
  await flush();
  assertEquals(of("outline")[0]!.args, ["doc_9", "ver_9"]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: saved view는 지금 조건을 이름 붙여 저장하고 열 때마다 조건으로 다시 찾는다", async () => {
  const views = [{
    id: "viw_1",
    name: "Release goals",
    place: null,
    filter: {
      text: "goals",
      context: null,
      format: null,
      status: "all" as const,
    },
    revision: "1",
  }];
  const { source, of } = fakeSource({
    search: () => ({ ok: true, value: PAGE }),
    views,
    openView: () => ({
      ok: true,
      value: {
        entries: [{
          document: "doc_1",
          title: "Release notes",
          version: "ver_1",
          latestVersion: "ver_2",
          savedAt: 0,
          excerpt: "First lines",
        }],
        coverage: { lagging: true, rebuilding: false, omissions: 0 },
        nextCursor: null,
      },
    }),
  });
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  await search(view.container, "goals");
  click(
    find(view.container, "[data-include-archived] button, [role=checkbox]"),
  );
  await flush();
  click(find(view.container, "[data-save-view]"));
  await flush();
  typeInto(find(document.body, "[data-view-name]"), "Release goals");
  submit(find(document.body, "[data-save-view-form]"));
  await flush();
  const [name, conditions] = of("saveView")[0]!.args as [
    string,
    SearchConditions,
  ];
  assertEquals(name, "Release goals");
  assertEquals(conditions.query, "goals");
  assertEquals(conditions.includeArchived, true);
  // 저장은 검색을 다시 부르지 않는다.
  const searches = of("search").length;
  assert(find(view.container, "[data-view-saved]"));

  pressTab(byText(view.container, "Saved views"));
  await flush();
  const panel = find(view.container, "[data-tab-panel='views']");
  assert(!panel.hidden);
  click(find(panel, "[data-view='viw_1']"));
  await flush();
  click(find(panel, "[data-view='viw_1']"));
  await flush();
  assertEquals(of("openView").map((call) => call.args[0]), ["viw_1", "viw_1"]);
  assertEquals(of("search").length, searches);
  const opened = find(panel, "[data-opened-view='viw_1']");
  assert(
    opened.textContent?.includes(
      "This list is found again from the view's conditions each time you open it.",
    ),
  );
  assert(opened.querySelector("[data-coverage-note='lagging']"));
  assert(opened.textContent?.includes("Newer version available"));
  click(find(opened, "[data-hit='doc_1']"));
  await flush();
  assertEquals(of("outline").at(-1)!.args, ["doc_1", "ver_1"]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 목차에서 section을 고르면 그 범위만 읽고 [Read more]는 같은 고정 판의 다음 범위를 읽는다", async () => {
  const { source, of } = fakeSource({
    search: () => ({ ok: true, value: PAGE }),
    read: (section, cursor) => ({
      ok: true,
      value: {
        status: section === null ? "whole" : "found",
        text: cursor === undefined ? `first ${section ?? "all"}\n` : "second\n",
        hidden: false,
        complete: cursor !== undefined,
        nextCursor: cursor === undefined ? "c2" : null,
      },
    }),
  });
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  await search(view.container, "goals");
  click(find(view.container, "[data-hit='doc_2']"));
  await flush();
  assertEquals(of("read")[0]!.args, ["doc_2", "ver_2", null, undefined]);
  // 목차의 첫 줄은 문서 전체, 다음은 Goals, Plan이다.
  await choose(fieldTrigger(view.container, "On this page"), 2);
  assertEquals(of("read").at(-1)!.args, ["doc_2", "ver_2", "plan", undefined]);
  click(find(view.container, "[data-read-more]"));
  await flush();
  assertEquals(of("read").at(-1)!.args, ["doc_2", "ver_2", "plan", "c2"]);
  const body = find(view.container, "[data-body]");
  assert(body.textContent?.includes("first plan"));
  assert(body.textContent?.includes("second"));
  assertEquals(view.container.querySelector("[data-read-more]"), null);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 옛 판을 읽으면 최신 판이 따로 있음을 알리고 최신 판은 따로 연다", async () => {
  const { source, of } = fakeSource({
    search: () => ({ ok: true, value: PAGE }),
    outline: (version) => ({
      ok: true,
      value: version === null
        ? OUTLINE
        : { ...OUTLINE, version: "ver_1", latestVersion: "ver_2" },
    }),
  });
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  await search(view.container, "goals");
  click(find(view.container, "[data-hit='doc_2']"));
  await flush();
  const state = find(view.container, "[data-version-state]");
  assertEquals(state.getAttribute("data-version-state"), "older");
  assertEquals(state.textContent, "Newer version available");
  assertEquals(of("read")[0]!.args[1], "ver_1");
  click(find(view.container, "[data-open-latest]"));
  await flush();
  assertEquals(of("outline").at(-1)!.args, ["doc_2", null]);
  assertEquals(
    find(view.container, "[data-version-state]").getAttribute(
      "data-version-state",
    ),
    "latest",
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 옮겨진 옛 링크와 지정 판을 알리고 없는 section은 비슷한 내용으로 대신 열지 않는다", async () => {
  const { source, of } = fakeSource({
    resolve: {
      ok: true,
      value: {
        document: "doc_1",
        version: "ver_1",
        section: "gone",
        moved: true,
        current: "lophn/plan",
        pinned: true,
        status: "missing",
      },
    },
    outline: () => ({
      ok: true,
      value: { ...OUTLINE, version: "ver_1", latestVersion: "ver_2" },
    }),
    head: { title: "Plan", versionNumber: 1, savedAt: 0, status: "active" },
    read: () => ({
      ok: true,
      value: {
        status: "missing",
        text: null,
        hidden: false,
        complete: true,
        nextCursor: null,
      },
    }),
  });
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  click(find(view.container, "[data-open-link]"));
  typeInto(find(view.container, "[data-link-input]"), "lophn/old-plan#gone@1");
  submit(find(view.container, "[data-link-form]"));
  await flush();
  assertEquals(of("resolve")[0]!.args, ["lophn/old-plan#gone@1"]);
  assertEquals(
    find(view.container, "[data-link-moved]").textContent,
    "This link's document was renamed or moved. It's now lophn/plan.",
  );
  assertEquals(
    find(view.container, "[data-link-pinned]").textContent,
    "This link points to version 1.",
  );
  assertEquals(of("read").map((call) => call.args[2]), ["gone"]);
  assertEquals(
    find(view.container, "[data-section-status='missing']").textContent,
    "This version has no such section, so nothing similar was opened instead.",
  );
  assertEquals(view.container.querySelector("[data-body]"), null);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 알 수 없는 링크는 문서를 열지 않고 링크 칸에서 알린다", async () => {
  const { source, of } = fakeSource();
  const view = render(<DocumentsScreen source={source} now={() => 0} />);
  await flush();
  click(byLabel(view.container, "Open a link"));
  typeInto(find(view.container, "[data-link-input]"), "nowhere");
  submit(find(view.container, "[data-link-form]"));
  await flush();
  assert(
    view.container.textContent?.includes(
      "This link doesn't point to a document lophn can open.",
    ),
  );
  assertEquals(of("outline").length, 0);
  await unmountSettled(view);
});
