import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  pressAsync,
  render,
  unmountSettled,
} from "../../../../../../packages/design/components/testing.ts";

import { DocumentsScreen } from "../documents/documents-screen.tsx";
import type { Series, SeriesDetail, SeriesDraftInput } from "../source.ts";
import { fakeSource, SERIES } from "../testdata/fake-source.ts";
import {
  byText,
  find,
  flush,
  pressTab,
  submit,
  typeInto,
} from "../testdata/dom.ts";

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

const ROW = { ...SERIES, members: 2 };

const DETAIL: SeriesDetail = {
  series: SERIES,
  members: [
    {
      key: "week-1",
      document: "doc_1",
      title: "Week 1",
      version: "ver_1",
      latestVersion: "ver_1",
      archived: false,
    },
    {
      key: "week-2",
      document: "doc_2",
      title: "Week 2",
      version: "ver_2",
      latestVersion: "ver_3",
      archived: false,
    },
  ],
};

async function openSeriesTab(
  data: Parameters<typeof fakeSource>[0],
) {
  const fake = fakeSource({ seriesList: [ROW], ...data });
  const view = render(
    <DocumentsScreen source={fake.source} now={() => 0} initialTab="series" />,
  );
  await flush();
  return { ...fake, view };
}

Deno.test("shell/desktop#R1: series 등록은 자리·이름·제목·format·정렬·다음 이름 규칙을 받고 지원하지 않는 규칙은 보내지 않는다", async () => {
  const { view, of } = await openSeriesTab({});
  click(find(view.container, "[data-register-series]"));
  await flush();
  const form = find(view.container, "[data-register-form]");
  await choose(fieldTrigger(form, "Place"), 0);
  typeInto(find(form, "[data-series-name]"), "weekly");
  typeInto(find(form, "[data-series-title]"), "Weekly report");
  await choose(fieldTrigger(form, "Order"), 1);
  typeInto(find(form, "[data-next-rule]"), "week-{n:5}");
  submit(form);
  await flush();
  assertEquals(of("createSeries").length, 0);
  assert(
    form.textContent?.includes(
      "lophn can't use this rule. End it with one number part, padded to 4 digits or fewer.",
    ),
  );
  typeInto(find(form, "[data-next-rule]"), "week-{n}");
  submit(form);
  await flush();
  const input = of("createSeries")[0]!.args[0] as SeriesDraftInput;
  assertEquals(input, {
    place: { kind: "project", id: "prj_1" },
    name: "weekly",
    title: "Weekly report",
    format: "document",
    direction: "descending",
    nextRule: "week-{n}",
  });
  // 등록하면 그 가족 상세로 가고 목록을 다시 읽는다.
  assert(view.container.querySelector("[data-series-head='ser_1']"));
  assertEquals(of("seriesList").length, 2);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 빈 가족은 다음 이름을 꾸미지 않고 첫 key를 사람이 정해 첫 멤버를 더한다", async () => {
  const { view, of, calls } = await openSeriesTab({
    next: { key: "", from: null, taken: false },
    placeDocuments: [
      { id: "doc_7", title: "Kickoff", format: "document" },
      { id: "doc_8", title: "Scan", format: "pdf" },
    ],
  });
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  assertEquals(
    find(view.container, "[data-next-key]").textContent,
    "This series has no documents yet. Choose the first key yourself.",
  );
  const key = find(view.container, "[data-member-key]") as HTMLInputElement;
  assertEquals(key.value, "");
  // 제안을 읽었을 뿐 아무것도 만들지 않았다.
  const writes = ["createSeries", "addMember", "setArchived"];
  assertEquals(calls.filter((call) => writes.includes(call.method)).length, 0);
  typeInto(key, "week-1");
  // 같은 format의 문서만 후보다.
  await choose(fieldTrigger(view.container, "Document"), 0);
  submit(find(view.container, "[data-add-member]"));
  await flush();
  const [series, document, chosen] = of("addMember")[0]!.args as [
    Series,
    string,
    string,
  ];
  assertEquals(series.revision, "7");
  assertEquals(document, "doc_7");
  assertEquals(chosen, "week-1");
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 다음 key 제안은 계산 근거와 이미 쓰인 이름을 함께 보이고 여러 번 읽어도 문서를 만들지 않는다", async () => {
  const { view, of, calls } = await openSeriesTab({
    series: () => ({ ok: true, value: DETAIL }),
    next: { key: "week-3", from: "week-2", taken: false },
  });
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  assertEquals(
    find(view.container, "[data-next-key='week-3']").textContent,
    "Suggested key week-3, worked out from week-2 with the rule week-{n}.",
  );
  assertEquals(
    (find(view.container, "[data-member-key]") as HTMLInputElement).value,
    "week-3",
  );
  assertEquals(
    [...view.container.querySelectorAll("[data-member]")].map((row) =>
      row.getAttribute("data-member")
    ),
    ["week-1", "week-2"],
  );
  assertEquals(of("nextKey").length >= 1, true);
  const writes = ["createSeries", "addMember", "setArchived"];
  assertEquals(calls.filter((call) => writes.includes(call.method)).length, 0);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 이미 쓰인 제안 key는 미리 채우지 않고 다른 key를 고르게 한다", async () => {
  const { view } = await openSeriesTab({
    series: () => ({ ok: true, value: DETAIL }),
    next: { key: "week-3", from: "week-2", taken: true },
  });
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  assertEquals(
    find(view.container, "[data-next-taken]").textContent,
    "That key or its name is already used. Choose another.",
  );
  assertEquals(
    (find(view.container, "[data-member-key]") as HTMLInputElement).value,
    "",
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 멤버를 순서대로 읽고 앞·뒤 멤버로 옮기며 series로 돌아간다", async () => {
  const { view, of } = await openSeriesTab({
    series: () => ({ ok: true, value: DETAIL }),
  });
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  click(find(view.container, "[data-member='week-1']"));
  await flush();
  assertEquals(of("outline").at(-1)!.args, ["doc_1", "ver_1"]);
  const previous = find(view.container, "[data-previous]") as HTMLButtonElement;
  assert(previous.disabled);
  click(find(view.container, "[data-next]"));
  await flush();
  assertEquals(of("outline").at(-1)!.args, ["doc_2", "ver_2"]);
  assert((find(view.container, "[data-next]") as HTMLButtonElement).disabled);
  assertEquals(find(view.container, "[data-sequence]").textContent, "week-2");
  click(find(view.container, "[data-back-to-series]"));
  await flush();
  assert(view.container.querySelector("[data-series-head='ser_1']"));
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: 가족 보관은 멤버를 지우지 않고 해제할 수 있으며 보관한 가족은 사람이 고를 때만 목록에 보인다", async () => {
  let archived = false;
  const { view, of } = await openSeriesTab({
    series: () => ({
      ok: true,
      value: { ...DETAIL, series: { ...SERIES, archived } },
    }),
  });
  click(find(view.container, "[data-series='ser_1']"));
  await flush();
  archived = true;
  click(find(view.container, "[data-archive-series='archive']"));
  await flush();
  assertEquals(of("setArchived")[0]!.args[1], true);
  assertEquals(
    find(view.container, "[data-series-archived]").textContent,
    "This series is archived. Its documents and versions stay as they are.",
  );
  // 보관해도 멤버 구성과 key를 그대로 읽는다. 멤버 추가 칸은 없다.
  assertEquals(view.container.querySelectorAll("[data-member]").length, 2);
  assertEquals(view.container.querySelector("[data-add-member]"), null);
  archived = false;
  click(find(view.container, "[data-archive-series='unarchive']"));
  await flush();
  assertEquals(of("setArchived")[1]!.args[1], false);
  assertEquals(of("seriesList").map((call) => call.args[0]).at(0), "active");
  click(find(view.container, "[data-panel='series'] [role=checkbox]"));
  await flush();
  assertEquals(of("seriesList").at(-1)!.args[0], "all");
  await unmountSettled(view);
});

Deno.test("shell/desktop#R1: series 탭은 검색 탭의 결과를 지우지 않는다", async () => {
  const { view } = await openSeriesTab({});
  pressTab(byText(view.container, "Search"));
  await flush();
  typeInto(find(view.container, "[data-search-input]"), "goals");
  pressTab(byText(view.container, "Series"));
  await flush();
  pressTab(byText(view.container, "Search"));
  await flush();
  assertEquals(
    (find(view.container, "[data-search-input]") as HTMLInputElement).value,
    "goals",
  );
  await unmountSettled(view);
});
