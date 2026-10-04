import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { tokens } from "../../tokens.ts";
import { click, one, render, settle, style } from "../testing.ts";
import type { Clipboard } from "../shared.ts";
import { CopyButton } from "./copy-button.tsx";

interface Pending {
  resolve(): void;
  reject(reason: unknown): void;
}

// 호출마다 끝을 테스트가 정하는 clipboard.
function scriptedClipboard() {
  const calls: { text: string; pending: Pending }[] = [];
  const clipboard: Clipboard = {
    writeText: (text) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ text, pending: { resolve, reject } });
      }),
  };
  return { clipboard, calls };
}

async function finish(run: () => void): Promise<void> {
  await act(async () => {
    run();
    await Promise.resolve();
  });
  await settle();
}

function status(container: HTMLElement): HTMLElement | null {
  return container.querySelector("[role=status]");
}

Deno.test("shell/design-system#R30: 복사가 실패하면 중립 문장을 보이고 같은 버튼으로 다시 시도해 성공하면 지운다", async () => {
  const { clipboard, calls } = scriptedClipboard();
  using view = render(
    <CopyButton text="prj_01J8ZK" label="Copy ID" clipboard={clipboard} />,
  );
  const button = one(view.container, "button[aria-label='Copy ID']");
  click(button);
  await finish(() => calls[0].pending.reject(new Error("denied")));
  const shown = status(view.container)!;
  assertEquals(shown.textContent, "Couldn't copy. Try again.");
  assertEquals(style(shown).color, tokens.color.text.secondary.light);
  click(button);
  assertEquals(calls.map((call) => call.text), ["prj_01J8ZK", "prj_01J8ZK"]);
  await finish(() => calls[1].pending.resolve());
  assertEquals(status(view.container), null);
});

Deno.test("shell/design-system#R30: clipboard가 바로 throw해도 실패 문장으로 바꾼다", async () => {
  const clipboard: Clipboard = {
    writeText: () => {
      throw new Error("no clipboard");
    },
  };
  using view = render(
    <CopyButton text="abc" label="Copy code" clipboard={clipboard} />,
  );
  click(one(view.container, "button"));
  await settle();
  assertEquals(
    status(view.container)?.textContent,
    "Couldn't copy. Try again.",
  );
});

Deno.test("shell/design-system#R30: 늦게 끝난 앞 시도는 새 시도의 결과를 덮지 않는다", async () => {
  const { clipboard, calls } = scriptedClipboard();
  using view = render(
    <CopyButton text="abc" label="Copy code" clipboard={clipboard} />,
  );
  const button = one(view.container, "button");
  click(button);
  click(button);
  await finish(() => calls[1].pending.resolve());
  await finish(() => calls[0].pending.reject(new Error("late")));
  assertEquals(status(view.container), null);
});

Deno.test("shell/design-system#R30: unmount 뒤에 끝난 실패는 상태를 바꾸지 않고 처리되지 않은 rejection도 남기지 않는다", async () => {
  const { clipboard, calls } = scriptedClipboard();
  let renders = 0;
  function Counted() {
    renders += 1;
    return <CopyButton text="abc" label="Copy code" clipboard={clipboard} />;
  }
  const view = render(<Counted />);
  click(one(view.container, "button"));
  const before = renders;
  view.unmount();
  let unhandled = 0;
  const onUnhandled = (event: PromiseRejectionEvent) => {
    unhandled += 1;
    event.preventDefault();
  };
  globalThis.addEventListener("unhandledrejection", onUnhandled);
  try {
    await finish(() => calls[0].pending.reject(new Error("late")));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.removeEventListener("unhandledrejection", onUnhandled);
  }
  assertEquals(unhandled, 0);
  assertEquals(renders, before);
  assert(!view.container.isConnected);
});
