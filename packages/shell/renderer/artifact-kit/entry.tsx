// 봉한 artifact view는 module을 import하지 못한다. 그래서 판을 고정한 이 build를 가상 path로 내주고,
// artifact HTML은 <script>로 불러 전역 LophnKit을 쓴다(architecture/artifact.md, ui-kit.md "artifact에 닿는 길").
// 앱이 `@lophn/ui/<분류>`로 받는 kit 전체와 React를 그대로 싣는다. build가 없으니 JSX 대신 `h`로 부른다.
import {
  createElement,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { icons } from "lucide-react";
import * as primitives from "@lophn/ui/primitives";
import * as input from "@lophn/ui/input";
import * as layout from "@lophn/ui/layout";
import * as navigation from "@lophn/ui/navigation";
import * as data from "@lophn/ui/data";
import * as feedback from "@lophn/ui/feedback";
import * as overlay from "@lophn/ui/overlay";
import * as reading from "@lophn/ui/reading";
import { GraphDiagram, type GraphEdge, type GraphNode } from "@lophn/ui/data";
import { t } from "@lophn/i18n";

import type {
  TabHead,
  TabHeadEvent,
} from "../../../protocol/shell/app-bridge-types.ts";

interface GraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  locale?: string;
  timeZone?: string;
}

const roots = new WeakMap<HTMLElement, Root>();

const reload = () => globalThis.location.reload();

/** element에 React node를 그린다. 같은 element에 다시 부르면 갱신한다. */
function render(element: HTMLElement, node: ReactNode): void {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(node);
}

function renderGraph(
  element: HTMLElement,
  { nodes, edges, locale, timeZone }: GraphProps,
): void {
  render(
    element,
    <GraphDiagram
      nodes={nodes}
      edges={edges}
      locale={locale}
      timeZone={timeZone}
      onRetry={reload}
      empty={{
        message: t("common.empty.not-ready"),
        action: { label: t("common.button.reload"), onSelect: reload },
      }}
    />,
  );
}

// ---- 탭 머리 줄. `@lophn/app-ui`의 useTabHead와 같은 약속이다(shell은 sdk를 import하지 못해 여기 둔다). ----

interface TabHeadBridge {
  setTabHead(head: TabHead | null): void;
  onTabHead(listener: (event: TabHeadEvent) => void): () => void;
}

interface TabHeadHandlers {
  onTab?(id: string): void;
  onAction?(id: string): void;
  onMenu?(id: string): void;
  onBack?(): void;
  onForward?(): void;
}

// artifact preload가 연 bridge(preload/artifact.ts). 파일을 browser로 바로 열면 없다.
function tabHeadBridge(): TabHeadBridge | undefined {
  return (globalThis as { lophnTabHead?: TabHeadBridge }).lophnTabHead;
}

// bridge는 받기 시작할 때 지금 shown을 곧바로 준다. 첫 render부터 맞는 값을 쓰려고 한 번 받고 바로 끊는다.
function shownNow(bridge: TabHeadBridge | undefined): boolean {
  let shown = false;
  if (bridge === undefined) return shown;
  const off = bridge.onTabHead((event) => {
    if (event.type === "shown") shown = event.shown;
  });
  off();
  return shown;
}

/**
 * page의 head를 lophn 탭 머리 줄에 올린다. lophn이 그리면 true, 그릴 곳이 없으면(떠 있는 탭, 창 밖) false라
 * 그때만 page가 같은 조작을 스스로 그린다.
 */
function useTabHead(
  head: TabHead | null,
  handlers: TabHeadHandlers = {},
): boolean {
  const bridge = useMemo(tabHeadBridge, []);
  const [shown, setShown] = useState(() => shownNow(bridge));
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (bridge === undefined) return;
    return bridge.onTabHead((event) => {
      const on = latest.current;
      if (event.type === "shown") setShown(event.shown);
      else if (event.type === "tab") on.onTab?.(event.id);
      else if (event.type === "action") on.onAction?.(event.id);
      else if (event.type === "menu") on.onMenu?.(event.id);
      else if (event.type === "back") on.onBack?.();
      else if (event.type === "forward") on.onForward?.();
    });
  }, [bridge]);

  const value = JSON.stringify(head);
  useEffect(() => {
    bridge?.setTabHead(JSON.parse(value) as TabHead | null);
  }, [bridge, value]);
  useEffect(() => () => bridge?.setTabHead(null), [bridge]);

  return shown;
}

Object.assign(globalThis, {
  LophnKit: {
    React,
    h: createElement,
    Fragment,
    useState,
    useEffect,
    useMemo,
    useRef,
    useCallback,
    render,
    useTabHead,
    icons,
    ui: {
      primitives,
      input,
      layout,
      navigation,
      data,
      feedback,
      overlay,
      reading,
    },
    renderGraph,
  },
});
