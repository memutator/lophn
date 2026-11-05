// 슬래시 명령이 낸 글. 머리는 `/<명령>`과 시각이고 본문은 format대로 그린다(markdown은 chat markdown, 고정폭은 code block).
// 10줄이 넘으면 접는다.
import type { ReactElement } from "react";
import { CodeBlock } from "@lophn/ui/reading";

import { clockTime } from "../agent-view-model.ts";
import { ChatMarkdown } from "../message-list/chat-markdown.tsx";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import { useFold } from "./fold-toggle.tsx";
import styles from "./thread.module.css";

const FOLD_LINES = 10;

export function CommandOutput({
  command,
  text,
  format,
  at,
  artifacts,
}: {
  command: string;
  text: string;
  format: "markdown" | "preformatted";
  at: string;
  artifacts: ArtifactsSlice | undefined;
}): ReactElement {
  const fold = useFold(text, FOLD_LINES);
  return (
    <div className={styles.output} data-command-output={command}>
      <div className={styles.outputHead}>
        <span className={styles.outputName}>/{command}</span>
        <span className={styles.time}>{clockTime(at)}</span>
      </div>
      {format === "markdown" ? (
        <ChatMarkdown text={fold.shown} artifacts={artifacts} />
      ) : (
        <CodeBlock code={fold.shown} />
      )}
      {fold.toggle}
    </div>
  );
}
