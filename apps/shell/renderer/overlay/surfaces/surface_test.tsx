import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  isFocused,
  manualTimer,
  one,
  pressAsync,
  settle,
  style,
} from "../../../../../packages/design/components/testing.ts";
import type {
  OverlayApi,
  OverlayEvent,
  OverlayKind,
  OverlayResult,
  OverlaySurface,
} from "../../../ipc/overlay.ts";
import { overlayRegistry } from "../registry.ts";
import { surfaceMount } from "./surface.tsx";

function fixture() {
  const root = document.createElement("main");
  document.body.append(root);
  const timer = manualTimer();
  const listeners = new Set<(event: OverlayEvent) => void>();
  const results: OverlayResult[] = [];
  const api: OverlayApi = {
    open: () => Promise.reject(new Error("overlay never opens")),
    close: () => Promise.reject(new Error("overlay never closes")),
    result: (input) => {
      results.push(input);
      return Promise.resolve({ ok: true, value: null });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const registry = overlayRegistry(
    root,
    api,
    { surface: "surface" },
    () => {},
    surfaceMount({ timer, clock: timer }),
  );
  function surface(
    kind: OverlayKind,
    choices = [{ id: "yes", label: "Keep" }, { id: "no", label: "Discard" }],
  ): OverlaySurface {
    return {
      kind,
      surfaceId: kind,
      requestId: kind,
      generation: 1,
      anchorRect: { x: 100, y: 80, width: 200, height: 100 },
      rect: { x: 30, y: 20, width: 200, height: 100 },
      model: {
        label: "<script>Owner label</script>",
        text: "Owner text",
        choices,
      },
    };
  }
  async function emit(surfaces: OverlaySurface[]) {
    act(() => {
      for (const listener of listeners) {
        listener({
          generation: 1,
          bounds: { x: 70, y: 60, width: 600, height: 400 },
          surfaces,
        });
      }
    });
    await settle();
  }
  function host(kind: OverlayKind): HTMLElement {
    return one(root, `[data-kind=${kind}]`);
  }
  async function dispose() {
    act(() => registry.dispose());
    await settle();
    root.remove();
  }
  return { root, timer, results, surface, emit, host, dispose };
}

Deno.test("shell/design-system#R20: overlay의 dialog 안 menu는 dialog 위 sibling host에 그리고 Escape는 menu만 닫는다", async () => {
  const f = fixture();
  await f.emit([f.surface("dialog"), f.surface("menu")]);
  const dialog = f.host("dialog");
  const menu = f.host("menu");
  assert(dialog.nextElementSibling === menu, "hosts are not siblings");
  assert(one(dialog, "[role=dialog]"), "dialog is not drawn in its host");
  assert(one(menu, "[role=menu]"), "menu is not drawn in its host");
  assert(
    Number(style(menu).zIndex) > Number(style(dialog).zIndex),
    "menu host is not above the dialog host",
  );
  assert(menu.contains(document.activeElement), "menu did not take focus");
  await pressAsync(document.activeElement!, "Escape");
  assertEquals(f.results, [{
    surfaceId: "menu",
    generation: 1,
    type: "closed",
  }]);
  await f.dispose();
});

Deno.test("shell/design-system#R33: overlay menu 행은 32px이고 고르면 selected 하나만 api.result로 돌아간다", async () => {
  const f = fixture();
  await f.emit([f.surface("menu")]);
  const rows = [...f.host("menu").querySelectorAll("[role=menuitem]")];
  assertEquals(rows.map((row) => style(row).height), ["32px", "32px"]);
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(f.results, [{
    surfaceId: "menu",
    generation: 1,
    type: "selected",
    choiceId: "yes",
  }]);
  await f.dispose();
});

Deno.test("shell/design-system#R33: overlay 표면은 owner 문구를 글로만 그리고 tooltip·popover·palette·sheet·dialog 공통 컴포넌트를 쓴다", async () => {
  const f = fixture();
  await f.emit([
    f.surface("tooltip"),
    f.surface("popover"),
    f.surface("sheet"),
    f.surface("dialog"),
    f.surface("palette"),
  ]);
  assertEquals(f.root.querySelectorAll("script").length, 0);
  assert(
    f.host("tooltip").textContent?.includes("<script>Owner label</script>"),
  );
  assertEquals(
    [...f.host("popover").querySelectorAll("button")].map((row) =>
      style(row).height
    ),
    ["32px", "32px"],
  );
  assertEquals(
    one(f.host("sheet"), "[role=dialog]").textContent?.includes("Owner text"),
    true,
  );
  const dialog = one(f.host("dialog"), "[role=dialog]");
  assertEquals(
    [...dialog.querySelectorAll("button")].map((button) =>
      button.dataset.variant
    ),
    ["secondary", "primary"],
  );
  assertEquals(
    f.host("palette").querySelectorAll("[role=option]").length,
    2,
  );
  await f.dispose();
});

Deno.test("shell/design-system#R33: overlay notification은 focus를 옮기지 않는 toast로 행동 2개까지 고르고 받아들여진 결과 하나만 보낸다", async () => {
  const f = fixture();
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  await f.emit([f.surface("notification", [
    { id: "a", label: "Open" },
    { id: "b", label: "Undo" },
    { id: "c", label: "Later" },
  ])]);
  assert(isFocused(opener), "notification moved focus");
  const buttons = [...f.host("notification").querySelectorAll("button")];
  assertEquals(buttons.map((button) => button.textContent), [
    "Open",
    "Undo",
    "",
  ]);
  act(() => buttons[1].click());
  act(() => buttons[0].click());
  await settle();
  f.timer.advance(5000);
  // 받아들여진 고르기 하나만 결과다. 뒤의 행동과 시간 닫힘은 보내지 않는다.
  assertEquals(f.results, [
    {
      surfaceId: "notification",
      generation: 1,
      type: "selected",
      choiceId: "b",
    },
  ]);
  opener.remove();
  await f.dispose();
});

Deno.test("shell/design-system#R20: overlay sheet는 backdrop 없이 바깥 click에, popover는 바깥 focus 이동에 닫힘을 알린다", async () => {
  const f = fixture();
  await f.emit([f.surface("popover")]);
  const outside = document.createElement("button");
  document.body.append(outside);
  act(() => outside.focus());
  await settle();
  assertEquals(f.results, [{
    surfaceId: "popover",
    generation: 1,
    type: "closed",
  }]);
  await f.emit([f.surface("sheet")]);
  assertEquals(f.root.querySelectorAll("[data-state]").length, 1);
  act(() => {
    outside.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    outside.click();
  });
  await settle();
  assertEquals(f.results.at(-1), {
    surfaceId: "sheet",
    generation: 1,
    type: "closed",
  });
  outside.remove();
  await f.dispose();
});

Deno.test("shell/app-frame#R24: 같은 generation 갱신·표면 제거·dispose는 새 결과도 focus 복귀도 만들지 않는다", async () => {
  const f = fixture();
  const before = document.createElement("button");
  document.body.append(before);
  before.focus();
  const menu = f.surface("menu");
  await f.emit([menu]);
  const content = one(f.host("menu"), "[role=menu]");
  const focused = document.activeElement;
  assert(content.contains(focused), "menu did not take focus");
  await f.emit([{ ...menu, rect: { x: 40, y: 50, width: 200, height: 100 } }]);
  assert(document.activeElement === focused, "same generation moved focus");
  assert(f.host("menu").contains(content), "same generation remounted");
  await f.emit([]);
  assertEquals(f.results, []);
  assert(!isFocused(before), "Radix restored focus inside the overlay");
  before.focus();
  await f.emit([f.surface("dialog")]);
  assert(f.host("dialog").contains(document.activeElement));
  await f.dispose();
  assert(!isFocused(before), "dispose restored focus inside the overlay");
  assertEquals(f.results, []);
  before.remove();
});
