import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  one,
  press,
  pressAsync,
  render,
  settle,
  unmountSettled,
} from "../../../../design/components/testing.ts";

import { AgentHeader, type AgentHeaderProps } from "./agent-header.tsx";
import {
  EVAL_ANALYST,
  HEADER_CURRENT,
  HEADER_NOW,
  HEADER_SESSIONS,
  headerSessionId,
} from "../testdata/agent-header.ts";

type Call = readonly [string, ...string[]];

function recorder() {
  const calls: Call[] = [];
  const props: Pick<
    AgentHeaderProps,
    | "onSwitch"
    | "onNew"
    | "onRename"
    | "onArchive"
    | "onUnarchive"
    | "onDelete"
    | "onForkSession"
    | "onRewindMenu"
    | "onUsage"
    | "onCloseTab"
  > = {
    onSwitch: (session) => calls.push(["switch", session]),
    onNew: () => calls.push(["new"]),
    onRename: (session, title) => calls.push(["rename", session, title]),
    onArchive: (session) => calls.push(["archive", session]),
    onUnarchive: (session) => calls.push(["unarchive", session]),
    onDelete: (session) => calls.push(["delete", session]),
    onForkSession: () => calls.push(["fork"]),
    onRewindMenu: () => calls.push(["rewind-menu"]),
    onUsage: () => calls.push(["usage"]),
    onCloseTab: () => calls.push(["close-tab"]),
  };
  return { calls, props };
}

function header(
  props: ReturnType<typeof recorder>["props"],
  sessionClosed = false,
) {
  return (
    <AgentHeader
      agent={EVAL_ANALYST}
      session={HEADER_CURRENT}
      sessions={HEADER_SESSIONS}
      now={HEADER_NOW}
      sessionClosed={sessionClosed}
      {...props}
    />
  );
}

function popover(): HTMLElement {
  return one(document.body, "[data-session-popover]");
}

async function open(root: ParentNode): Promise<HTMLElement> {
  click(one(root, "[data-session-trigger]"));
  await settle();
  return popover();
}

function line(n: number): HTMLElement {
  return one(popover(), `[data-session="${headerSessionId(n)}"]`);
}

function titles(): string[] {
  return [...popover().querySelectorAll("[role=option]")].map((row) =>
    row.querySelector("[data-session-title]")?.textContent ?? ""
  );
}

function type(input: HTMLElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function buttonNamed(root: ParentNode, name: string): HTMLElement {
  const found = [...root.querySelectorAll("button")].find((button) =>
    button.getAttribute("aria-label") === name ||
    button.textContent?.trim() === name
  );
  if (!found) throw new Error(`no button named ${name}`);
  return found;
}

Deno.test("shell/desktop#R38 [agent-I21]: 머리는 avatar, agent 이름, 점, session 제목 순서이고 agent를 고르는 칸이 없다", async () => {
  const { props } = recorder();
  using view = render(header(props));
  const bar = one(view.container, "[data-agent-header]");
  const avatar = one(bar, "[data-avatar]");
  assertEquals(avatar.dataset.kind, "icon");
  assertEquals(avatar.dataset.icon, "search");
  assertEquals(avatar.dataset.size, "md");
  const text = bar.textContent ?? "";
  const at = ["Eval analyst", "·", "Week 41 summary"].map((part) =>
    text.indexOf(part)
  );
  assert(at[0] >= 0 && at[0] < at[1] && at[1] < at[2], `order: ${text}`);
  assertEquals(text.replace(/[\s·]/g, ""), "EvalanalystWeek41summary");
  assert(
    one(bar, "[data-session-trigger]").contains(avatar),
    "avatar is outside the session trigger",
  );
  assertEquals(bar.querySelectorAll("select, [role=combobox]").length, 0);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: popover는 검색칸 아래에 그 agent의 session만 Today·Earlier로 묶어 보인다", async () => {
  const { props } = recorder();
  using view = render(header(props));
  const box = await open(view.container);
  const search = one(
    box,
    'input[aria-label="Search Eval analyst sessions"]',
  );
  // 검색칸이 목록보다 앞에 있다.
  assert(
    search.compareDocumentPosition(one(box, "[role=listbox]")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    "search is not above the list",
  );
  const heads = [...box.querySelectorAll("[data-session-group]")].map((
    head,
  ) => head.textContent);
  assertEquals(heads, ["Today", "Earlier"]);
  // 다른 agent의 session(Failing scenarios)과 archived는 기본 목록에 없다.
  assertEquals(titles(), [
    "Week 41 summary",
    "Regression on query-recipe-gap",
    "Release notes check",
    "Findings about C-049",
  ]);
  assertEquals(
    line(1).querySelector("[data-session-when]")?.textContent,
    "2 minutes ago",
  );
  assertEquals(
    line(2).querySelector("[data-session-when]")?.textContent,
    "12 minutes ago",
  );
  assertEquals(
    line(3).querySelector("[data-session-when]")?.textContent,
    "3 hours ago",
  );
  assertEquals(
    line(4).querySelector("[data-session-when]")?.textContent,
    "2 days ago",
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: 지금 session에 ✓가 있고 상태 점은 모양과 이름으로 구별한다", async () => {
  const { props } = recorder();
  using view = render(header(props));
  await open(view.container);
  assertEquals(line(1).getAttribute("aria-selected"), "true");
  assertEquals(line(1).querySelector("[data-check]")?.textContent, "✓");
  assertEquals(line(2).getAttribute("aria-selected"), "false");
  assertEquals(line(2).querySelector("[data-check]")?.textContent, "");
  const waiting = one(line(1), '[role=img][aria-label="Waiting for you"]');
  assertEquals(waiting.textContent, "●");
  const working = one(line(2), '[role=img][aria-label="Working"]');
  assertEquals(working.textContent, "◐");
  // 쉬는 session은 점이 없다.
  assertEquals(line(3).querySelectorAll("[role=img]").length, 0);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: 검색어를 치면 제목에 맞는 session만 남고 맞는 게 없으면 그렇게 말한다", async () => {
  const { props } = recorder();
  using view = render(header(props));
  const box = await open(view.container);
  const search = one(box, "input[aria-label^='Search']");
  type(search, "RECIPE");
  assertEquals(titles(), ["Regression on query-recipe-gap"]);
  // 다른 agent의 session은 검색해도 나오지 않는다.
  type(search, "failing");
  assertEquals(titles(), []);
  assertEquals(
    one(box, "[data-no-match]").textContent,
    "No sessions match.",
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: 줄을 누르면 그 session으로 가고 popover가 닫힌다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props));
  await open(view.container);
  click(line(2));
  await settle();
  assertEquals(calls, [["switch", headerSessionId(2)]]);
  assertEquals(document.body.querySelector("[data-session-popover]"), null);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: 줄마다 Rename·Archive·Delete 단추가 있고 누른다고 session이 바뀌지 않는다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props));
  await open(view.container);
  const names = ["Rename", "Archive", "Delete"];
  for (const n of [1, 2, 3, 4]) {
    const labels = [...line(n).querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label")
    );
    assertEquals(labels, names);
  }
  click(buttonNamed(line(2), "Archive"));
  assertEquals(calls, [["archive", headerSessionId(2)]]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: Rename은 줄을 입력칸으로 바꿔 Enter로 저장하고 Esc로 취소한다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props));
  await open(view.container);
  click(buttonNamed(line(3), "Rename"));
  const input = one(
    popover(),
    'input[aria-label="Rename Release notes check"]',
  ) as HTMLInputElement;
  assertEquals(input.value, "Release notes check");
  // 공백뿐인 제목은 저장하지 않는다.
  type(input, "   ");
  press(input, "Enter");
  assertEquals(calls, []);
  type(input, "  Release notes review  ");
  press(input, "Enter");
  assertEquals(calls, [["rename", headerSessionId(3), "Release notes review"]]);

  calls.length = 0;
  click(buttonNamed(line(4), "Rename"));
  const second = one(
    popover(),
    'input[aria-label="Rename Findings about C-049"]',
  );
  type(second, "Something else");
  press(second, "Escape");
  assertEquals(calls, []);
  assertEquals(
    popover().querySelectorAll("input[aria-label^='Rename']").length,
    0,
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: Delete는 되돌릴 수 없다는 확인 뒤에만 부르고 Cancel이면 부르지 않는다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props));
  await open(view.container);
  click(buttonNamed(line(3), "Delete"));
  assertEquals(calls, []);
  const confirm = one(popover(), "[role=alertdialog]");
  assertEquals(
    confirm.textContent?.includes(
      `Delete "Release notes check"? This can't be undone.`,
    ),
    true,
  );
  click(buttonNamed(confirm, "Cancel"));
  assertEquals(calls, []);
  assertEquals(popover().querySelectorAll("[role=alertdialog]").length, 0);

  click(buttonNamed(line(3), "Delete"));
  click(buttonNamed(one(popover(), "[role=alertdialog]"), "Delete"));
  assertEquals(calls, [["delete", headerSessionId(3)]]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: Archived (n) 줄을 펴면 archive한 session이 보이고 Restore로 다시 연다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props));
  const box = await open(view.container);
  const archived = buttonNamed(box, "Archived (2)");
  assertEquals(archived.getAttribute("aria-expanded"), "false");
  assertEquals(box.textContent?.includes("Docs folder cleanup"), false);
  click(archived);
  assertEquals(archived.getAttribute("aria-expanded"), "true");
  assertEquals(
    [...box.querySelectorAll("[data-archived-session]")].map((row) =>
      row.querySelector("[data-session-title]")?.textContent
    ),
    ["Docs folder cleanup", "First eval run"],
  );
  click(
    buttonNamed(
      one(box, `[data-archived-session="${headerSessionId(6)}"]`),
      "Restore",
    ),
  );
  assertEquals(calls, [["unarchive", headerSessionId(6)]]);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R39 [agent-I21]: New session은 새 session을 요청하고 popover를 닫는다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props));
  const box = await open(view.container);
  click(buttonNamed(box, "New session"));
  await settle();
  assertEquals(calls, [["new"]]);
  assertEquals(document.body.querySelector("[data-session-popover]"), null);
  await unmountSettled(view);
});

async function openMore(root: ParentNode): Promise<string[]> {
  const more = one(root, '[aria-label="More"]');
  focus(more);
  await pressAsync(more, "Enter");
  return [...document.querySelectorAll("[role=menu] [role=menuitem]")].map((
    item,
  ) => item.textContent?.trim() ?? "");
}

// 열린 menu에서 index번째 항목을 키보드로 고른다(열면 첫 항목에 focus가 있다).
async function pickMore(index: number): Promise<void> {
  for (let step = 0; step < index; step += 1) {
    await pressAsync(document.activeElement!, "ArrowDown");
  }
  await pressAsync(document.activeElement!, "Enter");
}

Deno.test("shell/desktop#R38 [agent-I21]: ⋯ 메뉴는 Rename, Fork, Rewind…, Usage, Close tab 순서다", async () => {
  const { props } = recorder();
  using view = render(header(props));
  assertEquals(await openMore(view.container), [
    "Rename",
    "Fork",
    "Rewind…",
    "Usage",
    "Close tab",
  ]);
  await pressAsync(document.activeElement!, "Escape");
  await unmountSettled(view);
});

Deno.test("shell/desktop#R38 [agent-I21]: ⋯ 메뉴의 Fork·Rewind…·Usage·Close tab은 각자의 callback만 부른다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props));
  const expected: [number, Call][] = [
    [1, ["fork"]],
    [2, ["rewind-menu"]],
    [3, ["usage"]],
    [4, ["close-tab"]],
  ];
  for (const [index, call] of expected) {
    calls.length = 0;
    await openMore(view.container);
    await pickMore(index);
    assertEquals(calls, [call]);
  }
  await unmountSettled(view);
});

Deno.test("shell/desktop#R38 [agent-I21]: ⋯ 메뉴의 Rename은 머리의 제목을 입력칸으로 바꿔 Enter로 저장하고 Esc로 취소한다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props));
  await openMore(view.container);
  await pickMore(0);
  assertEquals(calls, []);
  const input = one(
    view.container,
    '[data-agent-header] input[data-header-rename][aria-label="Rename Week 41 summary"]',
  ) as HTMLInputElement;
  assertEquals(input.value, "Week 41 summary");
  type(input, "   ");
  press(input, "Enter");
  assertEquals(calls, []);
  type(input, "  Week 41 report ");
  press(input, "Enter");
  assertEquals(calls, [["rename", HEADER_CURRENT.id, "Week 41 report"]]);

  calls.length = 0;
  await openMore(view.container);
  await pickMore(0);
  const again = one(view.container, "input[data-header-rename]");
  type(again, "Dropped");
  press(again, "Escape");
  assertEquals(calls, []);
  assertEquals(
    view.container.querySelectorAll("input[data-header-rename]").length,
    0,
  );
  await unmountSettled(view);
});

Deno.test("shell/desktop#R38 [agent-I21]: closed session의 ⋯ 메뉴에는 Usage와 Close tab만 남는다", async () => {
  const { calls, props } = recorder();
  using view = render(header(props, true));
  assertEquals(await openMore(view.container), ["Usage", "Close tab"]);
  await pickMore(1);
  // Close tab은 탭·칸만 닫는 callback이고 session을 지우거나 archive하지 않는다.
  assertEquals(calls, [["close-tab"]]);
  await unmountSettled(view);
});
