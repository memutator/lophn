import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { ResizeSourceProvider } from "../resize.ts";
import { domResizeSource } from "../resize.ts";
import { manualResize, one, render, style } from "../testing.ts";
import {
  DashboardCell,
  DashboardFrame,
  FormFrame,
  LauncherFrame,
  ListDetailFrame,
  OverviewFrame,
  TableFrame,
} from "./frames.tsx";
import type { ReadingWidth } from "./model.ts";
import { ReadingFrame } from "./reading-frame.tsx";
import { type ReadingWidthSetting, useReadingWidth } from "./reading-width.ts";
import { useTocPlacement } from "./toc-placement.ts";

function Probe() {
  return <span data-probe={useTocPlacement()} />;
}

function reading(width: ReadingWidth = "default") {
  return (
    <ReadingFrame width={width} header={<h1>Doc</h1>} toc={<Probe />}>
      <p>Body</p>
    </ReadingFrame>
  );
}

Deno.test("shell/design-system#R23: 목차 자리는 viewport가 아니라 관측한 칸 폭으로 옆과 머리를 오간다", () => {
  const resize = manualResize();
  using view = render(
    <ResizeSourceProvider value={resize}>{reading()}</ResizeSourceProvider>,
  );
  assertEquals(resize.observed(), 1);
  const frame = one(view.container, "[data-frame=reading]");
  const group = one(view.container, "[data-toc]");
  // 관측 전에는 목차를 좁은 쪽(머리)에 둔다.
  assertEquals(group.dataset.toc, "head");
  // 안쪽 948px = 칸 1012px - 32px×2.
  resize.resize({ width: 1012 });
  assertEquals(group.dataset.toc, "side");
  assertEquals(one(view.container, "aside [data-probe]").dataset.probe, "side");
  assertEquals(view.container.querySelectorAll("[data-probe]").length, 1);
  resize.resize({ width: 1011 });
  assertEquals(group.dataset.toc, "head");
  assertEquals(one(view.container, "[data-probe]").dataset.probe, "head");
  assertEquals(view.container.querySelector("aside"), null);
  assertEquals(frame.dataset.pad, "wide");
  view.rerender(
    <ResizeSourceProvider value={resize}>
      {reading("wide")}
    </ResizeSourceProvider>,
  );
  resize.resize({ width: 1132 });
  assertEquals(group.dataset.toc, "side");
  const aside = style(one(view.container, "aside"));
  assertEquals(aside.width, "220px");
  assertEquals(aside.position, "sticky");
  assertEquals(style(group).columnGap, "48px");
  assertEquals(style(group).justifyContent, "center");
});

Deno.test("shell/design-system#R42: 520px 칸은 16px 여백과 본문 최대폭을 적용하고 목차는 머리로 간다", () => {
  const resize = manualResize();
  using view = render(
    <ResizeSourceProvider value={resize}>{reading()}</ResizeSourceProvider>,
  );
  resize.resize({ width: 520 });
  const frame = one(view.container, "[data-frame=reading]");
  assertEquals(frame.dataset.pad, "narrow");
  const pad = style(frame.firstElementChild!);
  assertEquals([pad.paddingLeft, pad.paddingRight], ["16px", "16px"]);
  assertEquals(one(view.container, "[data-toc]").dataset.toc, "head");
  const body = style(one(view.container, "[data-toc] > div"));
  assertEquals(body.maxWidth, "680px");
  assertEquals(body.minWidth, "0px");
  resize.resize({ width: 1280 });
  assertEquals(frame.dataset.pad, "wide");
  assertEquals(style(frame.firstElementChild!).paddingLeft, "32px");
});

Deno.test("shell/design-system#R23: 기본 관측은 ResizeObserver의 content 폭을 쓰고 unmount에서 끊는다", () => {
  const target = globalThis as { ResizeObserver?: unknown };
  const original = target.ResizeObserver;
  const made: FakeObserver[] = [];
  class FakeObserver {
    observed: Element[] = [];
    disconnected = false;
    constructor(readonly callback: (entries: unknown[]) => void) {
      made.push(this);
    }
    observe(element: Element) {
      this.observed.push(element);
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  target.ResizeObserver = FakeObserver;
  try {
    const view = render(
      <ResizeSourceProvider value={domResizeSource}>
        {reading("narrow")}
      </ResizeSourceProvider>,
    );
    assertEquals(made.length, 1);
    const frame = one(view.container, "[data-frame=reading]");
    assertEquals(made[0].observed, [frame]);
    act(() => made[0].callback([{ contentRect: { width: 932, height: 600 } }]));
    assertEquals(one(view.container, "[data-toc]").dataset.toc, "side");
    act(() => made[0].callback([{ contentRect: { width: 931, height: 600 } }]));
    assertEquals(one(view.container, "[data-toc]").dataset.toc, "head");
    view.unmount();
    assert(made[0].disconnected);
  } finally {
    target.ResizeObserver = original;
  }
});

Deno.test("shell/design-system#R22: 폼·런처·개요 기둥은 정한 최대폭으로 가용 영역 가운데에 둔다", () => {
  const resize = manualResize();
  using view = render(
    <ResizeSourceProvider value={resize}>
      <FormFrame header={<h1>Form</h1>}>form</FormFrame>
      <LauncherFrame>launcher</LauncherFrame>
      <OverviewFrame>overview</OverviewFrame>
    </ResizeSourceProvider>,
  );
  for (const pane of [800, 1280, 1920]) {
    resize.resize({ width: pane });
    for (
      const [frame, max] of [
        ["form", "640px"],
        ["launcher", "1040px"],
        ["overview", "800px"],
      ]
    ) {
      const column = style(
        one(view.container, `[data-frame=${frame}] > div > div`),
      );
      assertEquals(column.maxWidth, max, frame);
      assertEquals(column.flexBasis, max, frame);
      assertEquals(column.flexShrink, "1", frame);
      const center = style(
        one(view.container, `[data-frame=${frame}] > div`),
      );
      assertEquals([center.display, center.justifyContent], ["flex", "center"]);
      assertEquals(
        one(view.container, `[data-frame=${frame}]`).dataset.pad,
        "wide",
      );
    }
  }
  assertEquals(
    style(one(view.container, "[data-frame=form] header")).marginBottom,
    "24px",
  );
});

Deno.test("shell/design-system#R21: dashboard는 최대 1440px·12열·간격 16px, 목록은 360px+상세, 표는 전체 폭이다", () => {
  using view = render(
    <ResizeSourceProvider value={manualResize()}>
      <DashboardFrame>
        <DashboardCell span={3}>a</DashboardCell>
        <DashboardCell span={12}>b</DashboardCell>
      </DashboardFrame>
      <ListDetailFrame list={<ul />} detail={<div />} />
      <TableFrame header={<h1>Rows</h1>}>
        <table />
      </TableFrame>
    </ResizeSourceProvider>,
  );
  const dashboard = one(view.container, "[data-frame=dashboard] > div > div");
  assertEquals(style(dashboard).maxWidth, "1440px");
  assertEquals(style(dashboard.parentElement!).justifyContent, "center");
  const grid = style(dashboard.lastElementChild!);
  assertEquals(grid.display, "grid");
  assertEquals(grid.columnGap, "16px");
  assertEquals(grid.rowGap, "16px");
  assert(
    /repeat\(12, minmax\(0(px)?, 1fr\)\)/.test(grid.gridTemplateColumns),
    grid.gridTemplateColumns,
  );
  const cells = dashboard.querySelectorAll("[data-span]");
  assertEquals(
    style(cells[0]).gridColumn.replace(/\s*\/\s*auto/, ""),
    "span 3",
  );
  assertEquals(
    style(cells[1]).gridColumn.replace(/\s*\/\s*auto/, ""),
    "span 12",
  );
  const list = style(one(view.container, "[data-frame=list-detail]"));
  assert(
    list.gridTemplateColumns.startsWith("360px"),
    list.gridTemplateColumns,
  );
  assertEquals(list.width, "100%");
  const table = one(view.container, "[data-frame=table]");
  assertEquals(style(table).width, "100%");
  assert(["", "none"].includes(style(table).maxWidth));
  assertEquals(style(table.lastElementChild!).width, "100%");
});

function SettingFrame({ setting }: { setting: ReadingWidthSetting }) {
  const [width, setWidth] = useReadingWidth(setting);
  return (
    <ReadingFrame width={width}>
      <button type="button" onClick={() => setWidth("wide")}>wide</button>
    </ReadingFrame>
  );
}

Deno.test("shell/design-system#R23: 읽기 폭은 주입한 전역 설정을 읽고 바꾸며 모르는 값은 기본 폭이다", () => {
  let stored: unknown = "narrow";
  const listeners = new Set<() => void>();
  const setting: ReadingWidthSetting = {
    read: () => stored as ReadingWidth,
    write: (width) => {
      stored = width;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  using view = render(
    <ResizeSourceProvider value={manualResize()}>
      <SettingFrame setting={setting} />
    </ResizeSourceProvider>,
  );
  const group = one(view.container, "[data-width]");
  assertEquals(group.dataset.width, "narrow");
  assertEquals(style(group.firstElementChild!).maxWidth, "600px");
  act(() => one(view.container, "button").click());
  assertEquals(stored, "wide");
  assertEquals(group.dataset.width, "wide");
  assertEquals(style(group.firstElementChild!).maxWidth, "800px");
  act(() => setting.write("huge" as ReadingWidth));
  assertEquals(group.dataset.width, "default");
});
