// tool 줄·편집 카드·Worked for·진행 chip(agent-I27). 값은 run trace에서 그린 화면 값이고 보이는 말·
// 순서·aria·data-*·callback 인자를 단언한다.
//
// 약속한 hook:
// - tool 줄 [data-tool-line=<id>] 안의 머리 button(aria-expanded)과 하위 줄 [data-tool-sub]
// - 편집 카드 [data-edit-card=<id>] 안의 요약 [data-edit-summary]와 버튼 Open·Undo
// - 회색 줄 [data-worked-for]
// - 되돌린 편집 카드: 요약이 "Undid the edit to <경로>", 단추 Open뿐이다(Undo를 다시 되돌리는 기능은 없다)
// - Undo를 누를 수 없는 카드: 단추가 비활성이고 이유 [data-undo-reason]가 보인다(lophn-agent/revert#R19)
// - 보기 상세 select [data-view-detail-select] 안의 button(값 이름)과 열리면 [role=listbox]의 항목
// - 진행 chip: aria-label "Tasks"인 button, popover 안의 줄 [data-task=<id>][data-state=done|now|later]
import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  one,
  pressAsync,
  render,
  settle,
  unmountSettled,
} from "../../../../../packages/design/components/testing.ts";

import { EditCard } from "./edit-card.tsx";
import type { EditView, ViewDetail } from "./model.ts";
import { ProgressChip } from "./progress-chip.tsx";
import { ToolLine } from "./tool-line.tsx";
import { ViewDetailSelect } from "./view-detail-select.tsx";
import { WorkedFor } from "./worked-for.tsx";
import { READ_TOOL, REPORT_EDIT, TASKS } from "../testdata/activity.ts";

function text(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function head(root: ParentNode): HTMLElement {
  return one(root, `[data-tool-line="${READ_TOOL.id}"] button[aria-expanded]`);
}

function subs(root: ParentNode): string[] {
  return [...root.querySelectorAll("[data-tool-sub]")].map(text);
}

Deno.test("shell/desktop#R41 [agent-I27]: tool 호출은 collapsed(Compact)에서 한 줄로 접혀 있고 눌러 펼치면 하위 줄이 순서대로 나온다", () => {
  using view = render(<ToolLine tool={READ_TOOL} detail="collapsed" />);
  assertEquals(
    text(head(view.container)).replace(/\s*[›>]$/, ""),
    "Read 3 documents",
  );
  assertEquals(head(view.container).getAttribute("aria-expanded"), "false");
  assertEquals(subs(view.container), []);
  click(head(view.container));
  assertEquals(head(view.container).getAttribute("aria-expanded"), "true");
  assertEquals(subs(view.container), READ_TOOL.lines);
  click(head(view.container));
  assertEquals(head(view.container).getAttribute("aria-expanded"), "false");
  assertEquals(subs(view.container), []);
});

Deno.test("shell/desktop#R42 [agent-I27]: expanded(Everything)는 tool 줄을 모두 펼쳐 보이고 hidden(Messages)은 tool 줄을 그리지 않는다", () => {
  using view = render(<ToolLine tool={READ_TOOL} detail="expanded" />);
  assertEquals(head(view.container).getAttribute("aria-expanded"), "true");
  assertEquals(subs(view.container), READ_TOOL.lines);
  view.rerender(<ToolLine tool={READ_TOOL} detail="hidden" />);
  assertEquals(view.container.querySelector("[data-tool-line]"), null);
  assertEquals(text(view.container), "");
  // 다시 collapsed로 돌리면 접힌 한 줄이다.
  view.rerender(<ToolLine tool={READ_TOOL} detail="collapsed" />);
  assertEquals(head(view.container).getAttribute("aria-expanded"), "false");
});

Deno.test("shell/desktop#R41 [agent-I27]: 편집 카드는 Edited <경로> +n −m을 보이고 Open·Undo가 그 편집을 인자로 callback을 부른다", () => {
  const opened: EditView[] = [];
  const undone: EditView[] = [];
  using view = render(
    <EditCard
      edit={REPORT_EDIT}
      onOpen={(edit) => opened.push(edit)}
      onUndo={(edit) => undone.push(edit)}
      undone={false}
      undo={{ can: true }}
    />,
  );
  const card = one(view.container, `[data-edit-card="${REPORT_EDIT.id}"]`);
  assertEquals(
    text(one(card, "[data-edit-summary]")),
    "Edited docs/reports/2026-w40.md +24 −3",
  );
  const names = [...card.querySelectorAll("button")].map(text);
  assertEquals(names, ["Open", "Undo"]);
  const [open, undo] = card.querySelectorAll("button");
  click(open);
  assertEquals(opened, [REPORT_EDIT]);
  assertEquals(undone, []);
  click(undo);
  assertEquals(undone, [REPORT_EDIT]);
  assertEquals(opened.length, 1);
});

Deno.test("shell/desktop#R41 [agent-I27]: 일이 끝나면 회색 줄 Worked for 18s를 남기고 1분 넘게 일하면 1m 15s로 쓴다", () => {
  using view = render(<WorkedFor durationMs={18_000} />);
  assertEquals(
    text(one(view.container, "[data-worked-for]")),
    "Worked for 18s",
  );
  view.rerender(<WorkedFor durationMs={75_000} />);
  assertEquals(
    text(one(view.container, "[data-worked-for]")),
    "Worked for 1m 15s",
  );
});

Deno.test("shell/desktop#R42 [agent-I27]: 진행 chip은 끝낸 수/전체를 보이고 누르면 Tasks popover가 ✓ 끝남 ● 지금 ○ 남음을 목록 순서대로 보인다", async () => {
  const view = render(<ProgressChip tasks={TASKS} />);
  const chip = one(view.container, 'button[aria-label="Tasks"]');
  assertEquals(text(chip), "2/4");
  assertEquals(document.querySelector("[data-task]"), null);
  click(chip);
  await settle();
  const rows = [...document.querySelectorAll("[data-task]")];
  assertEquals(
    rows.map((
      row,
    ) => [row.getAttribute("data-task"), row.getAttribute("data-state")]),
    TASKS.map((task) => [task.id, task.state]),
  );
  const marks = { done: "✓", now: "●", later: "○" } as const;
  rows.forEach((row, index) => {
    const task = TASKS[index];
    assertEquals(text(row), `${marks[task.state]} ${task.text}`);
  });
  await unmountSettled(view);
});

Deno.test("shell/desktop#R42 [agent-I27]: 할 일이 없으면 진행 chip을 그리지 않는다", () => {
  using view = render(<ProgressChip tasks={[]} />);
  assertEquals(view.container.querySelector("button"), null);
  assert(text(view.container) === "");
});

Deno.test("shell/desktop#R41 lophn-agent/revert#R19 [agent-RW3e]: Undo를 누른 뒤의 카드는 Undid the edit to <경로>이고 Open뿐이다(Undo를 다시 되돌리는 Redo는 없다)", () => {
  const opened: EditView[] = [];
  using view = render(
    <EditCard
      edit={REPORT_EDIT}
      undone
      undo={{ can: false, reason: "already_reverted" }}
      onOpen={(edit) => opened.push(edit)}
      onUndo={() => {}}
    />,
  );
  const root = one(view.container, `[data-edit-card="${REPORT_EDIT.id}"]`);
  assertEquals(
    text(one(root, "[data-edit-summary]")),
    "Undid the edit to docs/reports/2026-w40.md",
  );
  assertEquals([...root.querySelectorAll("button")].map(text), ["Open"]);
  assertEquals(root.querySelector("[data-undo-reason]"), null);
  click(root.querySelectorAll("button")[0]);
  assertEquals(opened, [REPORT_EDIT]);
});

Deno.test("lophn-agent/revert#R19 [agent-RW3e]: 지금 파일이 그 call이 쓴 내용과 다르거나 더 나중 편집이 있으면 Undo는 비활성이고 이유가 보이며 눌러도 부르지 않는다", () => {
  const cases: [Parameters<typeof EditCard>[0]["undo"], string][] = [
    [
      { can: false, reason: "edited_outside" },
      "This file changed after lophn wrote it, so it is left as it is.",
    ],
    [
      { can: false, reason: "later_edit" },
      "A later edit changed the same file, so only that one can be undone first.",
    ],
    [
      { can: false, reason: "no_pre_image" },
      "The earlier content of this file wasn't kept.",
    ],
    [
      { can: false, reason: "unknown" },
      "lophn can't undo this edit.",
    ],
  ];
  for (const [undo, reason] of cases) {
    const undone: EditView[] = [];
    using view = render(
      <EditCard
        edit={REPORT_EDIT}
        undone={false}
        undo={undo}
        onOpen={() => {}}
        onUndo={(edit) => undone.push(edit)}
      />,
    );
    const card = one(view.container, `[data-edit-card="${REPORT_EDIT.id}"]`);
    const button = [...card.querySelectorAll("button")].find((item) =>
      text(item) === "Undo"
    ) as HTMLButtonElement;
    assert(button.disabled);
    assertEquals(text(one(card, "[data-undo-reason]")), reason);
    // 이유는 단추에 이어져 있어 보조 기술이 함께 읽는다.
    assertEquals(
      button.getAttribute("aria-describedby"),
      one(card, "[data-undo-reason]").id,
    );
    click(button);
    assertEquals(undone, []);
  }
});

Deno.test("shell/desktop#R42 [agent-I27]: 보기 상세 select는 Compact로 시작하고 Messages·Compact·Everything을 이 순서로 보이며 고른 값을 부른다", async () => {
  const chosen: ViewDetail[] = [];
  const view = render(
    <ViewDetailSelect value="compact" onChange={(v) => chosen.push(v)} />,
  );
  const trigger = one(view.container, "[data-view-detail-select] button");
  assertEquals(text(trigger), "Compact");
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  assertEquals(
    [...document.querySelectorAll("[role=listbox] [role=option]")].map(text),
    ["Messages", "Compact", "Everything"],
  );
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(chosen, ["everything"]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R42 [agent-I27]: 보기 상세를 바꿔도 편집 카드는 그대로이고 tool 줄만 숨김·접힘·펼침으로 바뀐다", () => {
  const modes = {
    hidden: "none",
    collapsed: "false",
    expanded: "true",
  } as const;
  const edit = (
    <EditCard
      edit={REPORT_EDIT}
      undone={false}
      undo={{ can: true }}
      onOpen={() => {}}
      onUndo={() => {}}
    />
  );
  using view = render(<div />);
  const seen: string[] = [];
  const cards: string[] = [];
  for (const [detail, expected] of Object.entries(modes)) {
    view.rerender(
      <div>
        <ToolLine
          tool={READ_TOOL}
          detail={detail as keyof typeof modes}
        />
        {edit}
      </div>,
    );
    const head = view.container.querySelector("[data-tool-line] button");
    seen.push(head?.getAttribute("aria-expanded") ?? "none");
    cards.push(
      text(one(view.container, `[data-edit-card="${REPORT_EDIT.id}"]`)),
    );
    assertEquals(seen.at(-1), expected);
  }
  assertEquals(new Set(cards).size, 1);
});
