// agent 답 앞의 reasoning 요약 줄. 도는 동안에는 "Thinking"이 흐르고, 저장된 뒤에는 "Thought for {d}"나
// "Thought"다. 읽을 글이 있으면 눌러 펼치고 접힌 채 시작한다. 글을 표로 그리는 ToolRow 대신 이 file의
// 단추를 둔다.
import { type ReactElement, useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { Shimmer } from "@lophn/ui/feedback";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { commonIcons } from "../../icons/mod.ts";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import { duration } from "../activity/worked-for.tsx";
import { ChatMarkdown } from "./chat-markdown.tsx";
import styles from "./message-body.module.css";

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
  const label = thinking ? (
    <Shimmer>{t("conversation.label.thinking")}</Shimmer>
  ) : text !== "" && durationMs !== null ? (
    t("conversation.label.thought-for", { duration: duration(durationMs) })
  ) : (
    t("conversation.label.thought")
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
