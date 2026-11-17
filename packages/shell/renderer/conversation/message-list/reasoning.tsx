// agent 답 앞의 reasoning 요약 줄. 도는 동안에는 "Thinking"이 흐르고, 저장된 뒤에는 "Thought for {d}"나
// "Thought"다. 읽을 글이 있으면 눌러 펼치고 접힌 채 시작한다. 글을 표로 그리는 ToolRow 대신 이 file의
// 단추를 둔다.
import { type ReactElement, useMemo, useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { Shimmer } from "@lophn/ui/feedback";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { commonIcons } from "../../icons/mod.ts";
import type { ArtifactsSlice } from "./artifact-text.tsx";
import { duration } from "../activity/elapsed.ts";
import { ChatMarkdown } from "./chat-markdown.tsx";
import styles from "./message-body.module.css";

/** 낱말 수. 한국어·중국어처럼 띄어쓰기가 다른 글도 Intl.Segmenter가 낱말로 나눈다. */
function wordCount(text: string): number {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  let count = 0;
  for (const part of segmenter.segment(text)) if (part.isWordLike) count += 1;
  return count;
}

export function Reasoning({
  text,
  durationMs,
  thinking,
  artifacts,
}: {
  text: string;
  durationMs: number | null;
  thinking: boolean;
  artifacts: ArtifactsSlice | undefined;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const words = useMemo(() => (text === "" ? 0 : wordCount(text)), [text]);
  const spent = durationMs === null ? null : duration(durationMs);
  const label = thinking ? (
    <Shimmer>{t("conversation.label.thinking")}</Shimmer>
  ) : text === "" || spent === null ? (
    t("conversation.label.thought")
  ) : words === 0 ? (
    t("conversation.label.thought-for", { duration: spent })
  ) : (
    t("conversation.label.thought-for-words", {
      duration: spent,
      words,
    })
  );
  return (
    <div
      className={styles.reasoning}
      data-reasoning=""
      data-thinking={thinking ? "" : undefined}
    >
      {text === "" ? (
        <span className={styles.reasoningHead}>{label}</span>
      ) : (
        <button
          type="button"
          className={styles.reasoningHead}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span>{label}</span>
          <Icon
            icon={open ? commonIcons.collapse : commonIcons.expand}
            pixels={iconPixels("small")}
          />
        </button>
      )}
      {open ? (
        <div className={styles.reasoningText}>
          <ChatMarkdown text={text} artifacts={artifacts} />
        </div>
      ) : null}
    </div>
  );
}
