import { assert, assertEquals } from "@std/assert";
import {
  click,
  one,
  render,
} from "../../../../../packages/design/components/testing.ts";

import { MessageTurns, type MessageTurnsProps } from "./turns.tsx";
import {
  CONTEXT_ENGINEER,
  EDIT_BLOCK,
  LEADING_BLOCK,
  TOOL_BLOCK,
  TURN_ITEMS,
  turnMessageId,
} from "../testdata/message-turns.ts";

function turns(over: Partial<MessageTurnsProps> = {}) {
  const calls: string[][] = [];
  const node = (
    <MessageTurns
      agent={CONTEXT_ENGINEER}
      items={TURN_ITEMS}
      sessionClosed={false}
      onRewind={(message) => calls.push(["rewind", message])}
      onFork={(message) => calls.push(["fork", message])}
      {...over}
    />
  );
  return { calls, node };
}

function message(root: ParentNode, n: number): HTMLElement {
  return one(root, `[data-message="${turnMessageId(n)}"]`);
}

Deno.test("shell/desktop#R40 [agent-I22]: 내 메시지는 오른쪽 bubble이고 이름도 avatar도 없다", () => {
  const { node } = turns();
  using view = render(node);
  for (const n of [1, 5]) {
    const mine = message(view.container, n);
    assertEquals(mine.dataset.actor, "user");
    assertEquals(mine.dataset.side, "end");
    assertEquals(mine.querySelectorAll("[data-avatar]").length, 0);
    assertEquals(mine.querySelectorAll("[data-agent-name]").length, 0);
    assertEquals(mine.textContent?.includes("Context Engineer"), false);
  }
  assertEquals(
    message(view.container, 1).textContent?.includes(
      "Link the release notes to the findings.",
    ),
    true,
  );
});

Deno.test("shell/desktop#R40 [agent-I22]: agent 메시지는 왼쪽에 avatar 24px·이름·시각을 위에 한 번 둔다", () => {
  const { node } = turns();
  using view = render(node);
  const groups = view.container.querySelectorAll("[data-agent-turn]");
  assertEquals(groups.length, 2);
  const first = groups[0] as HTMLElement;
  assertEquals(first.dataset.side, "start");
  const avatar = one(first, "[data-avatar]");
  assertEquals(avatar.dataset.size, "md");
  assertEquals(avatar.dataset.kind, "icon");
  assertEquals(avatar.dataset.icon, "contexts");
  assertEquals(one(first, "[data-agent-name]").textContent, "Context Engineer");
  assertEquals(one(first, "[data-turn-time]").textContent, "9:01 AM");
  // 이름·avatar·시각은 메시지들보다 위에 있다.
  const head = one(first, "[data-agent-name]");
  assert(
    head.compareDocumentPosition(message(first, 2)) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    "name is not above the first message",
  );
});

Deno.test("shell/desktop#R40 [agent-I22]: 같은 agent가 이어 말하면 이름·avatar는 첫 메시지에만 있고 나머지는 그 아래에 이어진다", () => {
  const { node } = turns();
  using view = render(node);
  const first = view.container.querySelectorAll("[data-agent-turn]")[0];
  const ids = [...first.querySelectorAll("[data-message]")].map((item) =>
    (item as HTMLElement).dataset.message
  );
  assertEquals(ids, [turnMessageId(2), turnMessageId(3), turnMessageId(4)]);
  assertEquals(first.querySelectorAll("[data-avatar]").length, 1);
  assertEquals(first.querySelectorAll("[data-agent-name]").length, 1);
  assertEquals(first.querySelectorAll("[data-turn-time]").length, 1);
  assertEquals(
    [...first.querySelectorAll("[data-message]")].map((item) =>
      item.textContent
    ),
    [
      "I found three findings.",
      "Two of them mention release notes.",
      "I linked both.",
    ],
  );
});

Deno.test("shell/desktop#R40 [agent-I22]: 내 메시지가 끼면 묶음이 나뉘어 다음 agent 메시지에 이름·avatar가 다시 한 번 보인다", () => {
  const { node } = turns();
  using view = render(node);
  const groups = view.container.querySelectorAll("[data-agent-turn]");
  const second = groups[1] as HTMLElement;
  assertEquals(second.querySelectorAll("[data-message]").length, 1);
  assertEquals(
    (second.querySelector("[data-message]") as HTMLElement).dataset.message,
    turnMessageId(6),
  );
  assertEquals(
    one(second, "[data-agent-name]").textContent,
    "Context Engineer",
  );
  assertEquals(one(second, "[data-turn-time]").textContent, "9:06 AM");
  // 화면 전체의 이름·avatar는 묶음마다 하나씩이다.
  assertEquals(view.container.querySelectorAll("[data-avatar]").length, 2);
  assertEquals(view.container.querySelectorAll("[data-agent-name]").length, 2);
});

Deno.test("shell/desktop#R40 [agent-I22]: agent 이름을 고정 글자로 쓰지 않고 props의 이름과 profile을 따른다", () => {
  const { node } = turns({
    agent: {
      name: "Eval analyst",
      profile: { kind: "image", src: "blob:avatar-eval-analyst" },
    },
  });
  using view = render(node);
  const names = [...view.container.querySelectorAll("[data-agent-name]")]
    .map((name) => name.textContent);
  assertEquals(names, ["Eval analyst", "Eval analyst"]);
  const text = view.container.textContent ?? "";
  assertEquals(text.includes("lophn"), false);
  assertEquals(text.includes("Context Engineer"), false);
  const avatar = one(view.container, "[data-avatar]");
  assertEquals(avatar.dataset.kind, "image");
  assertEquals(
    avatar.querySelector("img")?.getAttribute("src"),
    "blob:avatar-eval-analyst",
  );
});

Deno.test("shell/desktop#R48 [agent-I22]: 내 메시지에 Rewind to here와 Fork from here 단추가 있고 누르면 그 메시지 id로 부른다", () => {
  const { calls, node } = turns();
  using view = render(node);
  const mine = message(view.container, 5);
  const labels = [...mine.querySelectorAll("button")].map((button) =>
    button.getAttribute("aria-label")
  );
  assertEquals(labels, ["Rewind to here", "Fork from here"]);
  click(one(mine, 'button[aria-label="Rewind to here"]'));
  click(one(mine, 'button[aria-label="Fork from here"]'));
  assertEquals(calls, [
    ["rewind", turnMessageId(5)],
    ["fork", turnMessageId(5)],
  ]);
  // agent 메시지에는 단추가 없다.
  assertEquals(message(view.container, 2).querySelectorAll("button").length, 0);
});

Deno.test("shell/desktop#R48 [agent-I22]: closed session의 메시지에는 Rewind·Fork 단추가 없다", () => {
  const { node } = turns({ sessionClosed: true });
  using view = render(node);
  assertEquals(view.container.querySelectorAll("button").length, 0);
  // 글은 그대로 보인다.
  assertEquals(
    message(view.container, 1).textContent?.includes(
      "Link the release notes to the findings.",
    ),
    true,
  );
});

function order(group: Element): string[] {
  return [...group.querySelectorAll("[data-message], [data-turn-block]")].map(
    (item) =>
      (item as HTMLElement).dataset.message ??
        (item as HTMLElement).dataset.turnBlock ?? "",
  );
}

Deno.test("shell/desktop#R40 [agent-I22]: 메시지 사이의 tool 줄·카드는 같은 묶음에 이름 없이 순서대로 이어진다", () => {
  const { node } = turns();
  using view = render(node);
  const first = view.container.querySelectorAll("[data-agent-turn]")[0];
  assertEquals(order(first), [
    turnMessageId(2),
    TOOL_BLOCK,
    turnMessageId(3),
    EDIT_BLOCK,
    turnMessageId(4),
  ]);
  // block이 끼어도 묶음은 하나이고 이름·avatar·시각은 위에 한 번뿐이다.
  assertEquals(first.querySelectorAll("[data-avatar]").length, 1);
  assertEquals(first.querySelectorAll("[data-agent-name]").length, 1);
  assertEquals(one(first, "[data-turn-time]").textContent, "9:01 AM");
  const tool = one(first, `[data-turn-block="${TOOL_BLOCK}"]`);
  assertEquals(tool.textContent, "Read 3 documents ›");
  assertEquals(
    tool.querySelectorAll("[data-avatar], [data-agent-name]").length,
    0,
  );
  assertEquals(
    one(first, `[data-turn-block="${EDIT_BLOCK}"]`).textContent,
    "Edited findings/c-049.md +4 −1",
  );
  // block은 왼쪽 열에 놓인다.
  assertEquals(
    tool.closest("[data-agent-turn]")?.getAttribute("data-side"),
    "start",
  );
});

Deno.test("shell/desktop#R40 [agent-I22]: block으로 시작하는 묶음도 이름·avatar가 묶음 위에 한 번 있다", () => {
  const { node } = turns();
  using view = render(node);
  const second = view.container.querySelectorAll("[data-agent-turn]")[1];
  assertEquals(order(second), [LEADING_BLOCK, turnMessageId(6)]);
  assertEquals(second.querySelectorAll("[data-avatar]").length, 1);
  assertEquals(
    one(second, "[data-agent-name]").textContent,
    "Context Engineer",
  );
  assertEquals(one(second, "[data-turn-time]").textContent, "9:06 AM");
  assert(
    one(second, "[data-agent-name]").compareDocumentPosition(
      one(second, `[data-turn-block="${LEADING_BLOCK}"]`),
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
    "name is not above the leading block",
  );
  // block은 내 메시지 쪽이 아니라 agent 묶음 안에만 있다.
  assertEquals(
    view.container.querySelectorAll("[data-actor=user] [data-turn-block]")
      .length,
    0,
  );
});

Deno.test("shell/desktop#R40 [agent-I22]: 메시지 본문은 body로 받은 node를 그대로 그린다", () => {
  const { node } = turns({
    items: [
      {
        kind: "message",
        id: turnMessageId(1),
        actor: "agent",
        body: <strong data-rich="">Rendered by the caller</strong>,
        time: "9:00 AM",
      },
    ],
  });
  using view = render(node);
  const message = one(view.container, `[data-message="${turnMessageId(1)}"]`);
  assertEquals(
    one(message, "strong[data-rich]").textContent,
    "Rendered by the caller",
  );
});
