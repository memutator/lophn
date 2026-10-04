import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
  style,
} from "../../../../packages/design/components/testing.ts";

import type { ConnectionState, CoreSource } from "./connection/connection.ts";
import { Launcher } from "./launcher/launcher.tsx";

function sourceOf(states: ConnectionState[]): {
  source: CoreSource;
  calls: unknown[];
  push(state: ConnectionState): void;
} {
  const listeners = new Set<(state: ConnectionState) => void>();
  const calls: unknown[] = [];
  return {
    calls,
    source: {
      subscribe(listener) {
        listeners.add(listener);
        for (const state of states) listener(state);
        return () => listeners.delete(listener);
      },
      call(input) {
        calls.push(input);
        return Promise.resolve({ ok: true, value: {} });
      },
    },
    push(state) {
      act(() => {
        for (const listener of listeners) listener(state);
      });
    },
  };
}

const clock = (confirmedAt: number) => `at ${confirmedAt}`;

// happy-dom은 calc를 풀지 않는다. token 합으로 쓴 calc(a + b)를 px로 더한다.
function sumPixels(value: string): string {
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)];
  return `${parts.reduce((sum, part) => sum + Number(part[1]), 0)}px`;
}

const ready: ConnectionState = { state: "ready", confirmedAt: 1 };

Deno.test("shell/desktop#R25: 런처는 1040px 기둥, 48px 끌기 바, 바 오른쪽 lophn 아이콘 진입점을 두고 카드는 비었음 상태다", () => {
  let opened = 0;
  using view = render(
    <Launcher
      source={sourceOf([ready]).source}
      onLophn={() => opened++}
    />,
  );
  const column = view.container.querySelector(
    "[data-column='launcher']",
  ) as HTMLElement;
  assertEquals(style(column).maxWidth, "1040px");
  const bar = view.container.querySelector("header") as HTMLElement;
  assertEquals(style(bar).height, "48px");
  assert(bar.textContent?.includes("lophn"), "wordmark is missing");
  const entry = view.container.querySelector(
    "[data-entry='lophn']",
  ) as HTMLElement;
  assert(bar.contains(entry), "lophn entry is not in the bar");
  assert(
    entry.parentElement?.closest("header > div:last-child"),
    "lophn entry is not on the right",
  );
  assertEquals(entry.getAttribute("aria-label"), "lophn");
  assertEquals(entry.textContent, "");
  assert(entry.querySelector("svg.lucide"), "lophn entry has no Lucide icon");
  click(entry);
  assertEquals(opened, 1);
  const cards = view.container.querySelector("[data-cards]");
  assertEquals(cards?.getAttribute("data-cards"), "empty");
  assertEquals(cards?.querySelectorAll("[data-card]").length, 0);
});

Deno.test("shell/desktop#R23: 상단 바는 macOS 신호등 80px, Windows·Linux 창 버튼 138px를 비운다", () => {
  for (
    const [platform, side, pixels] of [
      ["mac", "paddingLeft", "80px"],
      ["windows", "paddingRight", "138px"],
      ["linux", "paddingRight", "138px"],
    ] as const
  ) {
    using view = render(
      <Launcher
        source={sourceOf([ready]).source}
        onLophn={() => {}}
        platform={platform}
      />,
    );
    const bar = view.container.querySelector("header") as HTMLElement;
    assertEquals(bar.getAttribute("data-platform"), platform);
    assertEquals(sumPixels(style(bar)[side]), pixels, platform);
  }
});

Deno.test("shell/design-system#R43: 런처 크롬의 아이콘은 Lucide 16/20px·선 1.5다", () => {
  const states = sourceOf([{ state: "stale", confirmedAt: 5 }]);
  using view = render(
    <Launcher source={states.source} formatTime={clock} onLophn={() => {}} />,
  );
  const icons = [...view.container.querySelectorAll("svg.lucide")];
  assert(icons.length >= 3, `icons: ${icons.length}`);
  for (const icon of icons) {
    assert(
      ["16", "20"].includes(icon.getAttribute("width") ?? ""),
      icon.getAttribute("class")!,
    );
    assertEquals(icon.getAttribute("stroke-width"), "1.5");
  }
});

Deno.test("shell/desktop#R7: 준비 전·실패·단절을 구별하고 단절에는 확인 시각과 다음 행동 하나를 보인다", () => {
  const starting = sourceOf([{ state: "starting", confirmedAt: null }]);
  using view = render(
    <Launcher
      source={starting.source}
      formatTime={clock}
      onLophn={() => {}}
    />,
  );
  const notice = () =>
    view.container.querySelector("[data-connection]") as HTMLElement;
  assertEquals(notice().getAttribute("data-connection"), "starting");
  assertEquals(notice().textContent, "lophn is getting ready.");
  assertEquals(notice().querySelectorAll("button").length, 0);
  assertEquals(view.container.querySelector("[data-cards]"), null);

  starting.push({ state: "failed", confirmedAt: null });
  assertEquals(notice().getAttribute("data-connection"), "failed");
  assert(notice().textContent?.includes("couldn't get ready"));
  assertEquals(notice().querySelector("button")?.textContent, "Try again");
  assertEquals(view.container.querySelector("[data-cards]"), null);

  starting.push({ state: "stale", confirmedAt: 1_700_000_000_000 });
  assertEquals(notice().getAttribute("data-connection"), "stale");
  assert(notice().textContent?.includes("can't refresh"));
  assert(
    notice().textContent?.includes("at 1700000000000"),
    "confirmed time is missing",
  );
  assertEquals(notice().querySelector("button")?.textContent, "Reconnect");
  assert(
    view.container.querySelector("[data-cards]"),
    "the last screen is not kept while stale",
  );

  click(notice().querySelector("button")!);
  assertEquals(starting.calls, [{
    kind: "read",
    resource: "platform",
    method: "status",
    body: {},
  }]);

  starting.push({ state: "ready", confirmedAt: 1_700_000_000_000 });
  assertEquals(view.container.querySelector("[data-connection]"), null);
});

Deno.test("shell/wording#R1: 런처의 고정 문구는 message key로만 나온다", () => {
  const { source } = sourceOf([{ state: "stale", confirmedAt: 5 }]);
  using view = render(
    <Launcher source={source} formatTime={clock} onLophn={() => {}} />,
  );
  const text = view.container.textContent ?? "";
  for (
    const sentence of [
      "lophn can't refresh this page right now.",
      "Last checked at 5.",
      "Nothing to open yet.",
    ]
  ) {
    assert(text.includes(sentence), `missing: ${sentence}`);
  }
});
