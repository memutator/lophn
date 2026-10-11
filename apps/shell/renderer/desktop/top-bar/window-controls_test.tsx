import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
} from "../../../../../packages/design/components/testing.ts";

import type {
  WindowControlsApi,
  WindowState,
} from "../../../ipc/window-controls.ts";
import { TopBar } from "./top-bar.tsx";
import { WindowControls } from "./window-controls.tsx";

function fakeApi(): {
  api: WindowControlsApi;
  calls: string[];
  push(state: WindowState): void;
} {
  const calls: string[] = [];
  const listeners = new Set<(state: WindowState) => void>();
  const reply = Promise.resolve({
    ok: true as const,
    state: { maximized: false },
  });
  return {
    calls,
    api: {
      state: () => reply,
      minimize: () => (calls.push("minimize"), reply),
      toggleMaximize: () => (calls.push("toggle-maximize"), reply),
      close: () => (calls.push("close"), reply),
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    push(state) {
      act(() => {
        for (const listener of listeners) listener(state);
      });
    },
  };
}

Deno.test("shell/desktop#R23: 상단 바 창 단추는 최소화·최대화·닫기를 보내고 최대화 상태를 따른다", async () => {
  const fake = fakeApi();
  using view = render(<WindowControls api={fake.api} />);
  await act(async () => {});
  const button = (action: string) =>
    view.container.querySelector(
      `[data-window-action='${action}']`,
    ) as HTMLElement;
  assertEquals(
    button("toggle-maximize").getAttribute("aria-label"),
    "Maximize window",
  );
  click(button("minimize"));
  click(button("toggle-maximize"));
  click(button("close"));
  assertEquals(fake.calls, ["minimize", "toggle-maximize", "close"]);
  fake.push({ maximized: true });
  assertEquals(
    button("toggle-maximize").getAttribute("aria-label"),
    "Restore window",
  );
});

Deno.test("shell/desktop#R23: Windows·Linux 상단 바만 창 단추를 그리고 macOS는 신호등에 맡긴다", () => {
  const fake = fakeApi();
  (globalThis as { lophnWindow?: WindowControlsApi }).lophnWindow = fake.api;
  try {
    for (
      const [platform, shown] of [["linux", true], ["windows", true], [
        "mac",
        false,
      ]] as const
    ) {
      using view = render(<TopBar platform={platform} />);
      assertEquals(
        view.container.querySelector("[data-window-controls]") !== null,
        shown,
        platform,
      );
    }
  } finally {
    delete (globalThis as { lophnWindow?: WindowControlsApi }).lophnWindow;
  }
  using none = render(<TopBar platform="linux" />);
  assert(none.container.querySelector("[data-window-controls]") === null);
});
