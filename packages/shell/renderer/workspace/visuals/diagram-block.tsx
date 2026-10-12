// 도표 블록. design의 GraphDiagram으로 그린다(shell/workspace#R12). 좌표·SVG·Mermaid
// 코드는 받지 않고 배치는 SDK가 정한다. node 설명은 도표 아래 목록의 글로 보인다.
import { GraphDiagram } from "@lophn/chart";
import { t } from "@lophn/wording";

import type { DiagramContent } from "./registry.ts";
import styles from "./visuals.module.css";

export interface DiagramBlockProps {
  content: DiagramContent;
  onReadDescription: () => void;
  onRetry: () => void;
}

export function DiagramBlock(
  { content, onReadDescription, onRetry }: DiagramBlockProps,
) {
  const described = content.nodes.filter((node) => node.description !== null);
  return (
    <div data-visual-diagram="">
      <GraphDiagram
        nodes={content.nodes.map((node) => ({
          id: node.key,
          label: node.label,
        }))}
        edges={content.edges.map((edge) =>
          edge.label === null
            ? { from: edge.from, to: edge.to }
            : { from: edge.from, to: edge.to, label: edge.label }
        )}
        onRetry={onRetry}
        empty={{
          message: t("conversation.empty.visual-no-data"),
          action: {
            label: t("conversation.button.visual-read-description"),
            onSelect: onReadDescription,
          },
        }}
      />
      {described.length > 0
        ? (
          <dl className={styles.nodes} data-visual-nodes="">
            {described.map((node) => (
              <div key={node.key} className={styles.node}>
                <dt className={styles.nodeLabel}>{node.label}</dt>
                <dd className={styles.nodeText}>{node.description}</dd>
              </div>
            ))}
          </dl>
        )
        : null}
    </div>
  );
}
