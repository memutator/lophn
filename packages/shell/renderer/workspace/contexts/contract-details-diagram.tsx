// Contract 그림: type 상자와 관계 화살표. 다른 context의 type은 점선 상자로 맨 뒤에 놓인다.
// 상자 자리와 화살표 모양은 contract-details-layout.ts가 정한다.
import type { ReactNode } from "react";
import { t } from "@lophn/wording";

import type { ContractModel } from "./contract-details-model.ts";
import {
  layoutGrid,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodeOrigin,
  routeEdge,
} from "./contract-details-layout.ts";
import styles from "./contract-details.module.css";

export function ContractDiagram(
  { graph }: { readonly graph: ContractModel["graph"] },
): ReactNode {
  const grid = layoutGrid(graph.nodes.length);
  const cellOf = new Map(
    graph.nodes.map((node, index) => [node.key, grid.cells[index]!] as const),
  );
  const nameOf = new Map(
    graph.nodes.map((node) => [node.key, node.name] as const),
  );
  return (
    <div className={styles.scroll}>
      <svg
        role="img"
        aria-label={t("contexts.label.contract-diagram")}
        className={styles.diagram}
        width={grid.width}
        height={grid.height}
        viewBox={`0 0 ${grid.width} ${grid.height}`}
      >
        {graph.edges.map((edge, index) => {
          const from = cellOf.get(edge.from);
          const to = cellOf.get(edge.to);
          if (!from || !to) return null;
          const route = routeEdge(from, to);
          return (
            <g
              key={index}
              data-edge
              data-from={nameOf.get(edge.from)}
              data-to={nameOf.get(edge.to)}
              data-edge-external={String(edge.external)}
            >
              <path
                d={route.line}
                className={edge.external ? styles.lineOuter : styles.line}
              />
              <polygon points={route.head} className={styles.arrow} />
              <text
                x={route.label.x}
                y={route.label.y}
                textAnchor="middle"
                dominantBaseline="central"
                className={styles.edgeLabel}
              >
                {edge.label}
              </text>
            </g>
          );
        })}
        {graph.nodes.map((node, index) => {
          const origin = nodeOrigin(grid.cells[index]!);
          return (
            <g
              key={node.key}
              data-node={node.name}
              data-node-external={String(node.external)}
            >
              <rect
                x={origin.x}
                y={origin.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                className={node.external ? styles.nodeOuter : styles.node}
              />
              <text
                x={origin.x + NODE_WIDTH / 2}
                y={origin.y + NODE_HEIGHT / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className={styles.nodeText}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
