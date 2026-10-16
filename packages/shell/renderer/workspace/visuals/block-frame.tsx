// 대화 안 시각 블록 하나. 앱 카드만 그린다. 블록마다 따로 그려 한 블록이 틀려도 다른 블록이나 입력을 막지 않는다.
import { Component, type ReactNode } from "react";
import { t } from "@lophn/wording";

import { AppCardBlock } from "./app-card-block.tsx";
import type { AppCardRef } from "./registry.ts";
import styles from "./visuals.module.css";

// 그리기에서 난 예외를 이 블록 자리에 가둔다. 다른 블록과 메시지는 그대로 그린다.
class Contained extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Unavailable({ kind }: { kind: "kind" | "drawing" }) {
  return (
    <p className={styles.unavailable} data-visual-unavailable={kind}>
      {t(
        kind === "kind"
          ? "conversation.notice.visual-unavailable-kind"
          : "conversation.notice.visual-unavailable-drawing",
      )}
    </p>
  );
}

interface VisualBlockProps {
  /** 블록이 든 확정 메시지. */
  message: string;
  /** 같은 메시지 안에서 이 카드를 가리키는 key(`[a-z0-9_-]{1,64}`). */
  block: string;
  /** 그릴 앱 카드. 앱 카드가 아닌 블록은 null이다. */
  card: AppCardRef | null;
  /** 오류 문구에 쓰는 제목. */
  title: string;
}

/** 답 안의 시각 블록 하나. */
export function VisualBlock({ message, block, card, title }: VisualBlockProps) {
  return (
    <section
      className={styles.block}
      data-visual={card === null ? "unavailable" : "app_card"}
      data-visual-key={block}
      aria-label={title}
    >
      <div className={styles.content}>
        {card === null
          ? <Unavailable kind="kind" />
          : (
            <Contained fallback={<Unavailable kind="drawing" />}>
              <AppCardBlock
                card={card}
                message={message}
                block={block}
                label={title}
              />
            </Contained>
          )}
      </div>
    </section>
  );
}
