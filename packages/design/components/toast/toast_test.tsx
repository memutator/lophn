import { assertEquals } from "@std/assert";
import { act } from "react";
import { tokens } from "../../tokens.ts";
import { Toast, ToastStack } from "./toast.tsx";
import {
  click,
  focus,
  manualTimer,
  one,
  press,
  render,
  style,
} from "../testing.ts";

function closes(props: Partial<Parameters<typeof Toast>[0]> = {}) {
  const timer = manualTimer();
  const closed: string[] = [];
  const view = render(
    <ToastStack>
      <Toast
        title="Saved"
        timer={timer}
        clock={timer}
        onClose={() => closed.push("closed")}
        {...props}
      />
    </ToastStack>,
  );
  const toast = one(view.container, "[data-tone]");
  return { timer, closed, view, toast };
}

function hover(target: Element, entering: boolean) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(entering ? "pointerover" : "pointerout", {
        bubbles: true,
        relatedTarget: entering ? document.body : document.body,
      }),
    );
  });
}

Deno.test("shell/design-system#R33: toast는 폭360px·toast 층이고 기본 5초·짧은 조작 2초 뒤 닫힌다", () => {
  const normal = closes();
  using _normal = normal.view;
  assertEquals(style(normal.toast).width, tokens.toast.width);
  assertEquals(
    style(normal.toast.parentElement!).zIndex,
    String(tokens.z.toast),
  );
  normal.timer.advance(4999);
  assertEquals(normal.closed, []);
  normal.timer.advance(1);
  assertEquals(normal.closed, ["closed"]);
  const brief = closes({ duration: "brief" });
  using _brief = brief.view;
  brief.timer.advance(1999);
  assertEquals(brief.closed, []);
  brief.timer.advance(1);
  assertEquals(brief.closed, ["closed"]);
});

Deno.test("shell/design-system#R33: toast는 hover와 focus 동안 남은 시간을 멈추고 둘 다 끝나야 이어 간다", () => {
  const { timer, closed, view, toast } = closes();
  using _view = view;
  timer.advance(3000);
  hover(toast, true);
  timer.advance(10000);
  assertEquals(closed, []);
  const close = one(toast, "button");
  focus(close);
  hover(toast, false);
  timer.advance(10000);
  assertEquals(closed, [], "keyboard focus must keep the toast");
  act(() => close.blur());
  timer.advance(1999);
  assertEquals(closed, []);
  timer.advance(1);
  assertEquals(closed, ["closed"]);
});

Deno.test("shell/design-system#R33: error toast는 시간으로 닫히지 않고 Escape·닫기로만 닫힌다", () => {
  const { timer, closed, view, toast } = closes({ tone: "error" });
  using _view = view;
  timer.advance(60000);
  assertEquals(closed, []);
  assertEquals(timer.pending(), 0);
  press(toast, "Escape");
  assertEquals(closed, ["closed"]);
  click(one(toast, "button[aria-label=Close]"));
  assertEquals(closed, ["closed", "closed"]);
});

Deno.test("shell/design-system#R33: toast 행동은 최대 2개이고 고른 id만 돌려준다", () => {
  const chosen: string[] = [];
  const { view, toast } = closes({
    actions: [{ id: "undo", label: "Undo" }, { id: "open", label: "Open" }],
    onAction: (id) => chosen.push(id),
  });
  using _view = view;
  const buttons = [...toast.querySelectorAll("button")];
  assertEquals(buttons.map((button) => button.textContent), [
    "Undo",
    "Open",
    "",
  ]);
  click(buttons[1]);
  assertEquals(chosen, ["open"]);
  const three = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ] as const;
  // @ts-expect-error 행동은 2개를 넘지 못한다.
  void <Toast title="Saved" onClose={() => {}} actions={three} />;
});
