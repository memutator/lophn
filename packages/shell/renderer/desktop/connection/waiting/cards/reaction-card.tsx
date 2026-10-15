// 물음인 reaction. 어떤 domain event로 어떤 agent의 session을 열지 보이고 허락·거절한다.
// 요청한 agent가 없어서 거절 이유 칸이 없다.
import { useState } from "react";
import { Head } from "./head.tsx";
import { Decision } from "./decision.tsx";
import { type DecideCardProps, Facts } from "./permission-card.tsx";
import styles from "../waiting.module.css";

export function ReactionCard(
  { entry, view, onDecide, expanded = false }: DecideCardProps,
) {
  const [open, setOpen] = useState(expanded);
  return (
    <article className={styles.request} data-kind="reaction">
      <Head
        view={view}
        agent={entry.agent}
        toggle={{ open, onToggle: () => setOpen(!open) }}
      />
      {open ? <Facts view={view} /> : null}
      <Decision
        choices={view.choices}
        requester={null}
        onDecide={onDecide}
      />
    </article>
  );
}
