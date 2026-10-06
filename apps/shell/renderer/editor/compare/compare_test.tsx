// 버전 비교 화면(shell#T18). documents.diff 모양의 추가·삭제 줄과 두 판 본문을 주는 통로로
// 화면을 그려 치수·접기·나란히 보기·절 고르기·같은 판·복원 결과를 본다.
import { assert, assertEquals } from "@std/assert";
import { ResizeSourceProvider } from "@lophn/design/components";
import {
  click,
  manualResize,
  one,
  render,
  settle,
  style,
} from "../../../../../packages/design/components/testing.ts";
import { tokens } from "../../../../../packages/design/tokens.ts";

import type { RestoreReport } from "../../../ipc/editor.ts";
import type {
  ChangeRun,
  SectionEntry,
  VersionDiff,
  VersionRow,
  VersionSource,
} from "../versions/source.ts";
import { CompareView, type RestoreAnswer, restoreNotice } from "./compare-view.tsx";
import {
  buildLines,
  changedSections,
  foldRows,
  pairRows,
  SECTION_PICK_LINES,
} from "./model.ts";

const V1 = "ver_one";
const V2 = "ver_two";
const V3 = "ver_three";

function row(id: string, number: number): VersionRow {
  return {
    id,
    number,
    savedBy: "user",
    savedAt: Date.parse("2026-10-05T09:00:00Z") + number * 60_000,
    fromFile: false,
    contentHash: id,
    restorable: true,
  };
}

const ROWS = [row(V3, 3), row(V2, 2), row(V1, 1)];

function lines(count: number, label = "line"): string[] {
  return Array.from({ length: count }, (_, at) => `${label} ${at + 1}`);
}

/** before의 한 줄(1부터)을 바꾼 after와 그 diff. documents.diff와 같은 모양이다. */
function changed(before: string[], at: number, text: string) {
  const after = [...before];
  after[at - 1] = text;
  const diff: VersionDiff = {
    deletions: [{ range: { start: at, end: at }, text: before[at - 1]! }],
    additions: [{ range: { start: at, end: at }, text }],
    omissions: [],
    complete: true,
  };
  return { after, diff };
}

function section(
  key: string,
  title: string,
  start: number,
  end: number,
  bodyHash: string,
): SectionEntry {
  return {
    key,
    title,
    level: 2,
    ownRanges: [{ start, end }],
    subtree: { start, end },
    bodyHash,
  };
}

function sourceOf(options: {
  before: string[];
  after: string[];
  diff: VersionDiff;
  sectionsBefore?: SectionEntry[];
  sectionsAfter?: SectionEntry[];
  diffFails?: boolean;
  restore?: (version: string) => RestoreReport;
}) {
  const restored: string[] = [];
  const source: VersionSource = {
    facts: () => Promise.resolve({ ok: false, code: "unavailable" }),
    history: () => Promise.resolve({ ok: true, value: ROWS }),
    text: (_document, version) =>
      Promise.resolve({
        ok: true,
        value: (version === V1 ? options.before : options.after).join("\n"),
      }),
    sections: (_document, version) =>
      Promise.resolve({
        ok: true,
        value: (version === V1
          ? options.sectionsBefore
          : options.sectionsAfter) ?? [],
      }),
    diff: () =>
      Promise.resolve(
        options.diffFails
          ? { ok: false, code: "unavailable" }
          : { ok: true, value: options.diff },
      ),
    sectionHistory: () => Promise.resolve({ ok: false, code: "unavailable" }),
    contexts: () => Promise.resolve({ ok: true, value: [] }),
    restore: (_document, version) => {
      restored.push(version);
      return Promise.resolve({
        ok: true,
        value: options.restore?.(version) ??
          { outcome: "saved", version: "ver_four", file: null, failure: null },
      });
    },
  };
  return { source, restored };
}

async function flush(): Promise<void> {
  await settle();
  await settle();
}

function view(
  source: VersionSource,
  options: {
    width?: number;
    onRestore?: (version: string) => Promise<RestoreAnswer>;
    onChange?: (before: string, after: string) => void;
  } = {},
) {
  const resize = manualResize();
  const rendered = render(
    <ResizeSourceProvider value={resize}>
      <CompareView
        document="doc_plan"
        before={V1}
        after={V3}
        source={source}
        onChange={options.onChange ?? (() => {})}
        onClose={() => {}}
        onRestore={options.onRestore ??
          (async (version) => {
            const result = await source.restore("doc_plan", version);
            return result.ok
              ? { kind: "report", report: result.value }
              : { kind: "failed", code: result.code };
          })}
      />
    </ResizeSourceProvider>,
  );
  resize.resize({ width: options.width ?? 900, height: 600 });
  return { rendered, resize };
}

function tableRows(container: HTMLElement): HTMLTableRowElement[] {
  return [...container.querySelectorAll("[data-compare-body] tr")] as
    HTMLTableRowElement[];
}

Deno.test("shell/editor#R13: documents의 추가·삭제 줄을 두 판 본문과 맞춰 줄 번호를 옛/새 각각 단다", () => {
  const before = ["# Plan", "", "first", "keep"];
  const { after, diff } = changed(before, 3, "second");
  const built = buildLines(before.join("\n"), after.join("\n"), diff)!;
  assertEquals(built.map((line) => [line.kind, line.oldNumber, line.newNumber]), [
    ["same", 1, 1],
    ["same", 2, 2],
    ["delete", 3, undefined],
    ["add", undefined, 3],
    ["same", 4, 4],
  ]);
  // 줄 좌표가 맞지 않으면(지운 줄 글이 옛 판과 다르면) 비교를 꾸미지 않는다.
  const wrong: VersionDiff = {
    ...diff,
    deletions: [{ range: { start: 3, end: 3 }, text: "other" }],
  };
  assertEquals(buildLines(before.join("\n"), after.join("\n"), wrong), null);
});

Deno.test("shell/editor#R13: 바뀌지 않은 7줄 넘는 구간은 앞뒤 3줄만 남기고 7줄 이하는 그대로 둔다", () => {
  const before = lines(30);
  const { after, diff } = changed(before, 15, "changed");
  const built = buildLines(before.join("\n"), after.join("\n"), diff)!;
  const rows = foldRows(built, new Set(), true);
  // 처음 14줄은 변경 앞 3줄만, 뒤 15줄은 변경 뒤 3줄만 남는다.
  assertEquals(rows[0], { kind: "fold", start: 0, count: 11 });
  assertEquals(rows.filter((item) => item.kind === "line").length, 3 + 2 + 3);
  assertEquals(rows.at(-1), { kind: "fold", start: 19, count: 12 });
  // 가운데 구간(앞뒤가 모두 변경)은 앞 3줄·뒤 3줄을 남긴다.
  const middle: CompareChange = changedTwice(lines(40), 5, 30);
  const twice = foldRows(middle.lines, new Set(), true);
  const fold = twice.find((item) => item.kind === "fold" && item.start > 5);
  assertEquals(fold, { kind: "fold", start: 9, count: 18 });
  // 펼친 구간과 7줄 이하 구간은 접지 않는다.
  assertEquals(
    foldRows(built, new Set([0, 19]), true).every((item) =>
      item.kind === "line"
    ),
    true,
  );
  const short = changedTwice(lines(12), 2, 10);
  assertEquals(
    foldRows(short.lines, new Set(), true).some((item) =>
      item.kind === "fold" && item.start > 2 && item.start < 9
    ),
    false,
  );
  // 전체 보기는 접지 않는다.
  assertEquals(
    foldRows(built, new Set(), false).length,
    built.length,
  );
});

interface CompareChange {
  lines: ReturnType<typeof buildLines> & object;
}

function changedTwice(
  before: string[],
  first: number,
  second: number,
): CompareChange {
  const after = [...before];
  after[first - 1] = "one";
  after[second - 1] = "two";
  const runs = (side: string[], at: number[]): ChangeRun[] =>
    at.map((n) => ({ range: { start: n, end: n }, text: side[n - 1]! }));
  const built = buildLines(before.join("\n"), after.join("\n"), {
    deletions: runs(before, [first, second]),
    additions: runs(after, [first, second]),
  })!;
  return { lines: built };
}

Deno.test("shell/editor#R13: 접힌 줄은 눌러 펼치고, 도구 줄 44px·원문 13px/20px·줄 번호 40px·기호 16px로 그린다", async () => {
  const before = lines(30);
  const { after, diff } = changed(before, 15, "changed");
  const { source } = sourceOf({ before, after, diff });
  const { rendered } = view(source);
  await flush();
  const container = rendered.container;
  assertEquals(
    style(one(container, "[role=toolbar]")).minHeight,
    tokens.table.row.comfortable,
  );
  const changedRow = tableRows(container).find((item) =>
    item.dataset.diff === "add"
  )!;
  const cells = [...changedRow.cells];
  assertEquals(style(cells[0]!).width, "40px");
  assertEquals(style(cells[1]!).width, "40px");
  assertEquals(style(cells[2]!).width, "16px");
  assertEquals(style(one(container, "table")).fontSize, "13px");
  assertEquals(style(one(container, "table")).lineHeight, "20px");
  const folds = container.querySelectorAll("[data-fold]");
  assertEquals(folds.length, 2);
  assertEquals(folds[0]!.textContent, "Show 11 unchanged lines");
  click(folds[0]!);
  await flush();
  assertEquals(container.querySelectorAll("[data-fold]").length, 1);
  assertEquals(
    tableRows(container).filter((item) => item.dataset.diff === "same")
      .length,
    14 + 3,
  );
  rendered.unmount();
});

Deno.test("shell/editor#R14: 추가·삭제는 +·− 기호와 diff 색을 함께 써서 색 없이도 읽힌다", async () => {
  const before = ["a", "b", "c"];
  const { after, diff } = changed(before, 2, "B");
  const { source } = sourceOf({ before, after, diff });
  const { rendered } = view(source);
  await flush();
  const rows = tableRows(rendered.container);
  const removed = rows.find((item) => item.dataset.diff === "delete")!;
  const added = rows.find((item) => item.dataset.diff === "add")!;
  assertEquals(removed.cells[2]!.textContent, "−");
  assertEquals(added.cells[2]!.textContent, "+");
  assertEquals(style(removed).backgroundColor, tokens.diff.deleteLine.light);
  assertEquals(style(added).backgroundColor, tokens.diff.addLine.light);
  assertEquals(removed.cells[3]!.textContent, "b");
  assertEquals(added.cells[3]!.textContent, "B");
  rendered.unmount();
});

Deno.test("shell/editor#R14: 같은 두 판이면 en message key의 These versions are identical을 보인다", async () => {
  const same = ["# Plan", "body"];
  const { source } = sourceOf({
    before: same,
    after: same,
    diff: { additions: [], deletions: [], omissions: [], complete: true },
  });
  const { rendered } = view(source);
  await flush();
  assertEquals(
    one(rendered.container, "[data-compare-state]").textContent,
    "These versions are identical.",
  );
  assertEquals(rendered.container.querySelector("table"), null);
  rendered.unmount();
});

Deno.test("shell/editor#R14: 본문을 확인하지 못한 판은 같다고 그리지 않고 비교하지 못했다고 보인다", async () => {
  const same = ["# Plan"];
  const { source } = sourceOf({
    before: same,
    after: same,
    diff: {
      additions: [],
      deletions: [],
      omissions: [{ version: V1, ranges: [], reason: "unverified" }],
      complete: true,
    },
  });
  const { rendered } = view(source);
  await flush();
  assertEquals(
    one(rendered.container, "[data-compare-state]").dataset.compareState,
    "unread",
  );
  assert(
    !rendered.container.textContent!.includes("These versions are identical"),
  );
  rendered.unmount();
});

Deno.test("shell/editor#R13: 나란히 보기는 본문 1,100px 이상에서만 그리고 좁으면 한 줄 보기와 이유를 보인다", async () => {
  const before = ["a", "b", "c"];
  const { after, diff } = changed(before, 2, "B");
  const { source } = sourceOf({ before, after, diff });
  const { rendered, resize } = view(source, { width: 900 });
  await flush();
  click(one(rendered.container, "[data-compare-mode-button=split]"));
  await flush();
  assertEquals(
    one(rendered.container, "table").dataset.compareMode,
    "unified",
  );
  assertEquals(
    one(rendered.container, "[data-compare-note]").textContent,
    "Side by side needs a wider view, so the lines are in one column.",
  );
  resize.resize({ width: 1100, height: 600 });
  await flush();
  assertEquals(one(rendered.container, "table").dataset.compareMode, "split");
  assertEquals(rendered.container.querySelector("[data-compare-note]"), null);
  // 한 변경 묶음의 지운 줄과 더한 줄이 한 행에 짝을 이룬다.
  const pair = tableRows(rendered.container)[1]!;
  assertEquals(
    [...pair.cells].map((cell) => cell.textContent),
    ["2", "−", "b", "2", "+", "B"],
  );
  rendered.unmount();
});

Deno.test("shell/editor#R13: 바뀐 절 목록은 220px이고 5,000줄 넘는 문서는 절을 골라 그 절만 그린다", async () => {
  const before = lines(SECTION_PICK_LINES + 10);
  before[0] = "## Alpha";
  before[3000] = "## Beta";
  const { after, diff } = changed(before, 4000, "changed in beta");
  const sectionsBefore = [
    section("alpha", "Alpha", 1, 3000, "a1"),
    section("beta", "Beta", 3001, before.length, "b1"),
  ];
  const sectionsAfter = [
    section("alpha", "Alpha", 1, 3000, "a1"),
    section("beta", "Beta", 3001, after.length, "b2"),
  ];
  const { source } = sourceOf({
    before,
    after,
    diff,
    sectionsBefore,
    sectionsAfter,
  });
  const { rendered } = view(source);
  await flush();
  const rail = one(rendered.container, "[data-compare-rail]");
  assertEquals(style(rail).width, "220px");
  const items = [...rail.querySelectorAll("[data-compare-section]")];
  assertEquals(items.map((item) => item.getAttribute("data-compare-section")), [
    "beta",
  ]);
  assert(items[0]!.textContent!.includes("+1 −1"));
  assertEquals(
    one(rendered.container, "[data-compare-state]").dataset.compareState,
    "pick",
  );
  assertEquals(rendered.container.querySelector("table"), null);
  click(items[0]!);
  await flush();
  const shown = tableRows(rendered.container).filter((item) =>
    item.dataset.diff !== undefined
  );
  // 고른 절의 줄만 그린다(변경 앞뒤 3줄과 바뀐 두 줄).
  assertEquals(shown.length, 3 + 2 + 3);
  assertEquals(
    changedSections(sectionsBefore, sectionsAfter, buildLines(
      before.join("\n"),
      after.join("\n"),
      diff,
    )!).map((delta) => [delta.key, delta.change, delta.added, delta.removed]),
    [["beta", "modified", 1, 1]],
  );
  rendered.unmount();
});

Deno.test("shell/editor#R14: 복원은 secondary 행동이고 primary 버튼이 없으며, 확인 뒤 결과를 그대로 보인다", async () => {
  const before = ["a", "b"];
  const { after, diff } = changed(before, 2, "B");
  const outcomes: RestoreReport[] = [
    { outcome: "saved", version: "ver_four", file: null, failure: null },
    { outcome: "unchanged", version: V3, file: null, failure: null },
    { outcome: "conflict", version: null, file: null, failure: null },
  ];
  const { source, restored } = sourceOf({
    before,
    after,
    diff,
    restore: () => outcomes.shift()!,
  });
  const { rendered } = view(source);
  await flush();
  const container = rendered.container;
  assertEquals(container.querySelector("[data-variant=primary]"), null);
  const button = one(container, "[data-compare-restore]");
  assertEquals(button.dataset.variant, "secondary");
  assertEquals(button.getAttribute("aria-label"), "Restore version 1");
  // 누르면 바로 복원하지 않고 확인 줄을 연다.
  click(button);
  await flush();
  assertEquals(restored, []);
  assert(one(container, "[data-restore-confirm]").textContent!.includes(
    "Make version 1 the newest version?",
  ));
  assertEquals(container.querySelector("[data-variant=primary]"), null);
  const expected = ["saved", "unchanged", "conflict"];
  for (const notice of expected) {
    click(one(container, "[data-compare-restore]"));
    await flush();
    click(one(container, "[data-restore-confirm-button]"));
    await flush();
    assertEquals(
      one(container, "[data-restore-notice]").dataset.restoreNotice,
      notice,
    );
  }
  assertEquals(restored, [V1, V1, V1]);
  assertEquals(
    one(container, "[data-restore-notice]").textContent,
    "The document changed while restoring. Compare again before restoring.",
  );
  rendered.unmount();
});

Deno.test("shell/editor#R14: 파일 쓰기와 판 확정 결과를 섞지 않고 보인다", () => {
  const report = (over: Partial<RestoreReport>): RestoreAnswer => ({
    kind: "report",
    report: {
      outcome: "saved",
      version: null,
      file: null,
      failure: null,
      ...over,
    },
  });
  assertEquals(
    restoreNotice(report({ outcome: "conflict", file: "conflict" })),
    "file-conflict",
  );
  assertEquals(
    restoreNotice(report({ outcome: "pending", file: "written" })),
    "pending",
  );
  assertEquals(
    restoreNotice(report({ outcome: "failed", file: "unknown" })),
    "file-unknown",
  );
  assertEquals(restoreNotice({ kind: "unsaved" }), "unsaved");
  assertEquals(
    restoreNotice({ kind: "failed", code: "unsupported" }),
    "unsupported",
  );
});

Deno.test("shell/editor#R13: 비교를 읽지 못하면 다시 시도를 두고, 판을 바꾸면 같은 문서의 다른 두 판을 연다", async () => {
  const before = ["a"];
  const { after, diff } = changed(before, 1, "b");
  const { source } = sourceOf({ before, after, diff, diffFails: true });
  const changes: [string, string][] = [];
  const { rendered } = view(source, {
    onChange: (left, right) => changes.push([left, right]),
  });
  await flush();
  assertEquals(
    one(rendered.container, "[data-state=error]").textContent!.includes(
      "this comparison",
    ),
    true,
  );
  click(one(rendered.container, "[data-compare-swap]"));
  assertEquals(changes, [[V3, V1]]);
  assertEquals(pairRows([], []), []);
  rendered.unmount();
});
