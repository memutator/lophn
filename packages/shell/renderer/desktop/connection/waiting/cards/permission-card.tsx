// turn 안 권한 요청. 세부(대상, 정규화한 입력, 효과)는 접혀 있다.
import { useState } from "react";
import type { WaitingEntry } from "../../events/waiting-store.ts";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";
import { Decision, type OnDecide } from "./decision.tsx";
import { Head } from "./head.tsx";

export interface DecideCardProps {
  readonly entry: WaitingEntry;
  readonly view: CardView;
  readonly onDecide: OnDecide;
  /** 거절 이유 칸을 연 채 시작한다. */
  readonly denying?: boolean;
  readonly reason?: string;
  /** 세부를 펼친 채 시작한다. 기본은 접힌다. */
  readonly expanded?: boolean;
}

export function Facts({ view }: { view: CardView }) {
  return (
    <dl className={styles.facts}>
      {view.facts.map((fact) => <FactRow key={fact.label} fact={fact} />)}
    </dl>
  );
}

function FactRow({ fact }: { fact: CardView["facts"][number] }) {
  return (
    <>
      <dt>{fact.label}</dt>
      <dd className={fact.style === "code" ? styles.code : undefined}>
        {fact.style === "effect"
          ? (
            <span className={styles.effect} data-effect={fact.effect}>
              {fact.value}
            </span>
          )
          : fact.value}
      </dd>
    </>
  );
}

export function PermissionCard(
  { entry, view, onDecide, denying, reason, expanded = false }: DecideCardProps,
) {
  const [open, setOpen] = useState(expanded);
  return (
    <article className={styles.request} data-kind="permission">
      <Head
        view={view}
        agent={entry.agent}
        toggle={{ open, onToggle: () => setOpen(!open) }}
      />
      {open ? <Facts view={view} /> : null}
      <Decision
        choices={view.choices}
        requester={view.requester}
        denying={denying}
        reason={reason}
        onDecide={onDecide}
      />
    </article>
  );
}
