// 승인 카드(agent-I26). 카드는 결정을 내지 않고 고른 범위를 미리 고른 confirmation window를 여는
// callback만 부른다. 보이는 말·순서·role·callback 인자를 단언한다.
//
// 약속한 hook:
// - 카드 section[aria-label="Approval"][data-approval-id=<request id>]
// - 미리보기 줄 [data-preview-line=add|remove|context]
// - 버튼 이름 Allow·Deny, 범위 menu를 여는 버튼 aria-label "Allow scope"(menu role)
// - Deny 옆 Esc 안내 [data-esc-hint]. 일을 멈추는 Stop은 composer 것이라 카드에 없다
import { assert, assertEquals } from "@std/assert";
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

import { ApprovalCard } from "./approval-card.tsx";
import type { ApprovalCardRequest, ApprovalChoice } from "./model.ts";
import {
  COMMAND_CONFIRM_REQUEST,
  TOOL_ASK_REQUEST,
} from "../testdata/approval-card.ts";

function text(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function button(root: ParentNode, name: string): HTMLButtonElement | null {
  return [...root.querySelectorAll("button")].find((candidate) =>
    text(candidate) === name || candidate.getAttribute("aria-label") === name
  ) ?? null;
}

interface Calls {
  opened: ApprovalChoice[];
}

function renderCard(request: ApprovalCardRequest) {
  const calls: Calls = { opened: [] };
  const view = render(
    <ApprovalCard
      request={request}
      onOpenConfirmation={(choice) => calls.opened.push(choice)}
    />,
  );
  return { view, calls, card: one(view.container, "[data-approval-id]") };
}

Deno.test("shell/desktop#R47 [agent-I26]: 승인 카드는 요청 제목·한 줄 이유·변경 미리보기를 순서대로 보이고 Allow·Deny를 두고 Stop은 두지 않는다", () => {
  const { view, card } = renderCard(TOOL_ASK_REQUEST);
  using _ = view;
  assertEquals(card.tagName, "SECTION");
  assertEquals(card.getAttribute("aria-label"), "Approval");
  assertEquals(card.getAttribute("data-approval-id"), TOOL_ASK_REQUEST.id);
  const body = text(card);
  const at = [
    TOOL_ASK_REQUEST.title,
    TOOL_ASK_REQUEST.reason,
    TOOL_ASK_REQUEST.preview![0].text,
  ].map((part) => body.indexOf(part));
  assert(at.every((index) => index >= 0), `missing part: ${at}`);
  assertEquals([...at].sort((a, b) => a - b), at);
  assertEquals(
    [...card.querySelectorAll("[data-preview-line]")].map((line) => [
      line.getAttribute("data-preview-line"),
      text(line).replace(/^[+−-]\s*/, ""),
    ]),
    TOOL_ASK_REQUEST.preview!.map((line) => [line.kind, line.text]),
  );
  for (const name of ["Allow", "Deny"]) {
    assert(button(card, name), `no ${name} button`);
  }
  // 일을 멈추는 것은 composer의 Stop이고 카드에는 없다.
  assertEquals(button(card, "Stop"), null);
});

Deno.test("shell/desktop#R47 [agent-I26]: 미리보기가 없는 요청은 미리보기 칸을 그리지 않는다", () => {
  const { view, card } = renderCard(COMMAND_CONFIRM_REQUEST);
  using _ = view;
  assertEquals(card.querySelector("[data-preview-line]"), null);
  assert(text(card).includes(COMMAND_CONFIRM_REQUEST.title));
});

Deno.test("platform/approvals#R18 [agent-I26]: [Allow]는 결정을 내지 않고 Allow once를 미리 고른 confirmation window를 여는 callback만 부른다", () => {
  const { view, calls, card } = renderCard(TOOL_ASK_REQUEST);
  using _ = view;
  click(button(card, "Allow")!);
  assertEquals(calls.opened, ["allow_once"]);
});

Deno.test("platform/approvals#R18, R19 [agent-I26]: [Allow ▾]는 Allow once와 Allow for this session만 보이고(계속 허락 없음) 고른 범위를 미리 고른 값으로 넘긴다", async () => {
  const { view, calls, card } = renderCard(TOOL_ASK_REQUEST);
  const trigger = button(card, "Allow scope")!;
  focus(trigger);
  await pressAsync(trigger, "Enter");
  const items = [...document.querySelectorAll("[role=menuitem]")];
  assertEquals(items.map(text), ["Allow once", "Allow for this session"]);
  assertEquals(calls.opened, []);
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(calls.opened, ["allow_session"]);
  await settle();
  await unmountSettled(view);
});

Deno.test("platform/approvals#R20 [agent-I26]: 앱 command confirm 같은 request에는 session 선택이 없다", () => {
  const { view, card } = renderCard(COMMAND_CONFIRM_REQUEST);
  using _ = view;
  assertEquals(button(card, "Allow scope"), null);
  assert(!text(card).includes("session"));
  assert(button(card, "Allow"));
});

Deno.test("shell/desktop#R47 [agent-I26]: [Deny]도 결정을 내지 않고 deny를 미리 고른 confirmation window를 연다", () => {
  const { view, calls, card } = renderCard(TOOL_ASK_REQUEST);
  using _ = view;
  click(button(card, "Deny")!);
  assertEquals(calls.opened, ["deny"]);
});

Deno.test("shell/desktop#R47 [agent-I26]: Deny 옆에 Esc 안내가 있고 Esc를 누르면 deny를 미리 고른 confirmation window를 연다", () => {
  const { view, calls, card } = renderCard(TOOL_ASK_REQUEST);
  using _ = view;
  const deny = button(card, "Deny")!;
  assertEquals(text(one(card, "[data-esc-hint]")), "Esc");
  assert(
    deny.parentElement!.contains(one(card, "[data-esc-hint]")),
    "Esc hint is not next to Deny",
  );
  press(card, "Escape");
  assertEquals(calls.opened, ["deny"]);
});
