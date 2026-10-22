import { useId, useMemo } from "react";
import { Network } from "lucide-react";
import {
  ChartFrame,
  type ChartLocaleProps,
  type ChartStateProps,
} from "./chart-frame.tsx";
import { Icon } from "../../primitives/icon/icon.tsx";
import { STATUS_ICONS } from "../../feedback/status-mark/status-mark.tsx";
import { type Box, GEOMETRY } from "./geometry.ts";
import { ICON_GAP, ICON_SIZE, layoutGraph } from "./graph-layout.ts";
import { Tooltip } from "./marks.tsx";
import type { GraphEdge, GraphNode } from "./types.ts";
import { useActive } from "./use-active.ts";
import { checkGraph } from "./validate.ts";
import styles from "./chart.module.css";

export interface GraphDiagramProps extends ChartStateProps, ChartLocaleProps {
  nodes: readonly GraphNode[];
  // 이미 있는 node id만 가리킨다. 자기 자신을 가리키는 edge는 받지 않는다.
  edges: readonly GraphEdge[];
}

// 화살표 끝 크기. 선 1px에 맞춘 작은 삼각형이다.
const ARROW = GEOMETRY.pad;

function GraphPlot(
  { width, nodes, edges }: {
    width: number;
    nodes: readonly GraphNode[];
    edges: readonly GraphEdge[];
  },
) {
  const layout = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  // url(#…) 안에서 깨지지 않도록 React id의 기호를 뺀다.
  const marker = `arrow-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const { active, setActive, plotProps } = useActive(layout.nodes.length);
  const pad = GEOMETRY.pad;
  const svgWidth = Math.max(width, layout.width + pad * 2);
  const svgHeight = layout.height + pad * 2;
  const box: Box = { left: 0, right: svgWidth, top: 0, bottom: svgHeight };
  const current = active === null ? undefined : layout.nodes[active];
  return (
    <div className={styles.diagram}>
      <svg
        {...plotProps}
        className={styles.plot}
        width={svgWidth}
        height={svgHeight}
        data-chart="graph"
      >
        <defs>
          <marker
            id={marker}
            viewBox={`0 0 ${ARROW} ${ARROW}`}
            refX={ARROW}
            refY={ARROW / 2}
            markerWidth={ARROW}
            markerHeight={ARROW}
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path
              className={styles.arrow}
              d={`M0,0L${ARROW},${ARROW / 2}L0,${ARROW}Z`}
            />
          </marker>
        </defs>
        <g transform={`translate(${pad},${pad})`}>
          {layout.edges.map((edge, index) => (
            <g key={index} data-edge={index}>
              <path
                className={styles.edge}
                d={edge.path}
                markerEnd={`url(#${marker})`}
              />
              {edge.shortLabel !== undefined && (
                <text
                  className={styles.edgeLabel}
                  x={edge.labelX}
                  y={edge.labelY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {edge.shortLabel}
                </text>
              )}
            </g>
          ))}
          {layout.nodes.map((node, index) => (
            <g
              key={node.id}
              data-node={index}
              onPointerEnter={() => setActive(index)}
            >
              <rect
                className={styles.node}
                data-active={active === index || undefined}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={GEOMETRY.barRadius}
              />
              <text
                className={styles.nodeLabel}
                x={node.x + node.width / 2}
                y={node.y + node.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {node.shortLabel}
              </text>
              {node.status && (
                <g
                  className={styles.nodeStatus}
                  data-tone={node.status.tone}
                  transform={`translate(${node.x + node.statusX},${
                    node.y + node.statusY
                  })`}
                >
                  <g transform={`translate(0,${-ICON_SIZE / 2})`}>
                    <Icon
                      icon={STATUS_ICONS[node.status.tone]}
                      pixels={ICON_SIZE}
                    />
                  </g>
                  <text
                    className={styles.nodeStatusLabel}
                    x={ICON_SIZE + ICON_GAP}
                    dominantBaseline="middle"
                  >
                    {node.shortStatus}
                  </text>
                </g>
              )}
              {node.shortNote !== undefined && (
                <text
                  className={styles.nodeNote}
                  x={node.x + node.width / 2}
                  y={node.y + node.noteY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                >
                  {node.shortNote}
                </text>
              )}
            </g>
          ))}
        </g>
        {current && (
          <Tooltip
            anchor={current.x + pad + current.width}
            box={box}
            width={svgWidth}
            title={current.label}
            rows={current.note === undefined
              ? []
              : [{ name: current.note, value: "" }]}
          />
        )}
      </svg>
    </div>
  );
}

// node와 edge로 된 도표. 층 배치는 결정적이고 node는 중립색이라 표 보기를 두지 않는다.
export function GraphDiagram(
  { nodes, edges, locale, timeZone, ...state }: GraphDiagramProps,
) {
  const check = useMemo(() => checkGraph({ nodes, edges }), [nodes, edges]);
  return (
    <ChartFrame
      {...state}
      locale={locale}
      timeZone={timeZone}
      problem={check.ok ? undefined : check.problem}
      isEmpty={check.ok && nodes.length === 0}
      defaultIcon={Network}
      legend={[]}
    >
      {(width) =>
        check.ok && (
          <GraphPlot
            width={width}
            nodes={check.value.nodes}
            edges={check.value.edges}
          />
        )}
    </ChartFrame>
  );
}
