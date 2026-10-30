// 봉한 artifact view는 kit을 import하지 못한다. 그래서 판을 고정한 이 build를 가상 path로 내주고,
// artifact HTML은 <script>로 불러 전역 LophnKit만 쓴다(architecture/artifact.md).
import { createRoot, type Root } from "react-dom/client";
import { GraphDiagram, type GraphEdge, type GraphNode } from "@lophn/ui/data";
import { t } from "@lophn/i18n";

interface GraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  locale?: string;
  timeZone?: string;
}

const roots = new WeakMap<HTMLElement, Root>();

const reload = () => globalThis.location.reload();

function renderGraph(
  element: HTMLElement,
  { nodes, edges, locale, timeZone }: GraphProps,
): void {
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }
  root.render(
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

Object.assign(globalThis, { LophnKit: { renderGraph } });
