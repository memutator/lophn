// 정보 패널의 탭 본문(shell#T18, editor#R6). 버전 통로를 주입해 정보·버전·컨텍스트 탭이
// 무엇을 어떤 치수로 보이는지와 비교를 여는 행동을 본다. 틀(폭·머리·열림·닫기)은
// workspace_test가 본다.
import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
  settle,
  style,
} from "../../../../../packages/design/components/testing.ts";

import type {
  DocumentFacts,
  VersionRow,
  VersionSource,
} from "../versions/source.ts";
import { DocumentInfoPanel, type InfoTabId } from "./info-panel.tsx";

const NOW = Date.parse("2026-10-06T12:00:00Z");

function row(number: number, savedBy: VersionRow["savedBy"]): VersionRow {
  return {
    id: `ver_${number}`,
    number,
    savedBy,
    savedAt: NOW - (4 - number) * 3_600_000,
    fromFile: savedBy === "machine",
    contentHash: `hash_${number}`,
    restorable: true,
  };
}

const FACTS: DocumentFacts = {
  id: "doc_plan",
  title: "Plan",
  primaryPath: "notes/plan.md",
  linked: true,
  archived: false,
  formatName: "document",
  formatExplicit: false,
  latestVersion: "ver_3",
  latestNumber: 3,
  savedAt: NOW - 60_000,
  savedBy: "user",
};

function sourceOf(over: Partial<VersionSource> = {}): VersionSource {
  return {
    facts: () => Promise.resolve({ ok: true, value: FACTS }),
    history: () =>
      Promise.resolve({
        ok: true,
        value: [row(3, "user"), row(2, "machine"), row(1, "agent")],
      }),
    text: () => Promise.resolve({ ok: false, code: "unavailable" }),
    sections: () => Promise.resolve({ ok: false, code: "unavailable" }),
    diff: () => Promise.resolve({ ok: false, code: "unavailable" }),
    sectionHistory: () => Promise.resolve({ ok: false, code: "unavailable" }),
    contexts: () =>
      Promise.resolve({
        ok: true,
        value: [{ id: "ctx_1", title: "Launch review" }],
      }),
    restore: () => Promise.resolve({ ok: false, code: "unavailable" }),
    ...over,
  };
}

function panel(
  tab: InfoTabId,
  options: {
    source?: VersionSource;
    document?: string | null;
    onCompare?: (document: string, before: string, after: string) => void;
  } = {},
) {
  return render(
    <DocumentInfoPanel
      tab={tab}
      document={options.document === undefined ? "doc_plan" : options.document}
      source={options.source ?? sourceOf()}
      viewing="ver_3"
      onCompare={options.onCompare ?? (() => {})}
      now={() => NOW}
    />,
  );
}

Deno.test("shell/editor#R6: 정보 탭은 파일·보관 자리·형식·마지막 저장을 절 간격 20px로 보인다", async () => {
  using view = panel("info");
  await settle();
  const stack = one(view.container, "[data-info-facts]");
  assertEquals(style(stack).rowGap || style(stack).gap, "20px");
  const text = stack.textContent!;
  assert(text.includes("notes/plan.md"));
  assert(text.includes("In sync with the file on disk"));
  assert(text.includes("Version 3"));
  assert(text.includes("You"));
  assert(text.includes("3 versions"));
});

Deno.test("shell/editor#R6: 버전 탭은 새 판부터 32px 행에 저장 주체를 보이고 앞 판·최신 판과의 비교를 연다", async () => {
  const opened: [string, string, string][] = [];
  using view = panel("versions", {
    onCompare: (document, before, after) =>
      opened.push([document, before, after]),
  });
  await settle();
  const rows = [
    ...view.container.querySelectorAll("[data-version-row]"),
  ] as HTMLElement[];
  assertEquals(rows.map((item) => item.dataset.versionRow), ["3", "2", "1"]);
  assertEquals(style(rows[0]!).height, "32px");
  assertEquals(rows[0]!.getAttribute("aria-current"), "true");
  assert(rows[0]!.textContent!.includes("Newest"));
  assert(rows[1]!.textContent!.includes("From the file"));
  assert(rows[2]!.textContent!.includes("lophn"));
  // 비교는 아이콘 버튼이다. 글 버튼과 primary가 없다.
  const previous = one(view.container, "[data-compare-previous='3']");
  assertEquals(previous.textContent, "");
  assertEquals(
    previous.getAttribute("aria-label"),
    "Compare with the previous version",
  );
  assertEquals(view.container.querySelector("[data-variant=primary]"), null);
  click(previous);
  click(one(view.container, "[data-compare-newest='1']"));
  assertEquals(opened, [
    ["doc_plan", "ver_2", "ver_3"],
    ["doc_plan", "ver_1", "ver_3"],
  ]);
  // 첫 판은 앞 판이 없고 최신 판은 자기와 비교하지 않는다.
  assertEquals(
    (one(view.container, "[data-compare-previous='1']") as HTMLButtonElement)
      .disabled,
    true,
  );
  assertEquals(
    (one(view.container, "[data-compare-newest='3']") as HTMLButtonElement)
      .disabled,
    true,
  );
});

Deno.test("shell/editor#R6: 버전 이력을 읽지 못하면 다시 시도를 두고, 절을 읽을 수 있으면 절 고르기를 둔다", async () => {
  let fail = true;
  const source = sourceOf({
    history: () =>
      Promise.resolve(
        fail
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: [row(2, "user"), row(1, "user")] },
      ),
    sections: () =>
      Promise.resolve({
        ok: true,
        value: [{
          key: "goal",
          title: "Goal",
          level: 2,
          ownRanges: [{ start: 1, end: 3 }],
          subtree: { start: 1, end: 3 },
          bodyHash: "h",
        }],
      }),
  });
  using view = panel("versions", { source });
  await settle();
  const error = one(view.container, "[data-state=error]");
  assert(error.textContent!.includes("the version history"));
  fail = false;
  click(error.querySelector("button")!);
  await settle();
  await settle();
  assertEquals(view.container.querySelectorAll("[data-version-row]").length, 2);
  assert(view.container.textContent!.includes("Section"));
  assert(view.container.textContent!.includes("Whole document"));
});

Deno.test("shell/editor#R6: 컨텍스트 탭은 이 문서를 담은 컨텍스트를 32px 행으로 보이고, 문서가 아니면 안내한다", async () => {
  using view = panel("contexts");
  await settle();
  const list = one(view.container, "[data-info-contexts]");
  assertEquals(list.textContent, "Launch review");
  assertEquals(style(list.querySelector("li")!).height, "32px");
  using empty = panel("versions", { document: null });
  await settle();
  assertEquals(
    empty.container.textContent,
    "Open a document to see its details.",
  );
});
