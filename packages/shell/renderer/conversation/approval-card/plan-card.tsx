// harness가 plan을 내고 승인을 기다리는 카드. 본문은 plan markdown이고 12줄에서 접는다. 주 단추는 harness가 주는 다음
// mode마다 하나이고(맨 오른쪽이 첫 mode) [Keep planning]은 거절이다. 이유 칸은 승인 카드의 것을 쓴다.
import { type KeyboardEvent, type ReactElement, useRef, useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { actionIcons, editorIcons } from "../../icons/mod.ts";
import type { ArtifactsSlice } from "../../workspace/kinds/host.ts";
import type { ApprovalSubject } from "../agent-tab-source.ts";
import { ChatMarkdown } from "../message-list/chat-markdown.tsx";
import { useFold } from "../thread/fold-toggle.tsx";
import { ReasonRow } from "./reason-row.tsx";
import styles from "./approval-card.module.css";

const FOLD_LINES = 12;

interface PlanCardProps {
  agent: string;
  /** 승인 요청 id. */
  id: string;
  subject: Extract<ApprovalSubject, { kind: "plan" }>;
  /** 결정을 보내고 접수되었는지 돌려준다. 승인은 고른 mode, 거절은 이유(없으면 생략)다. */
  onDecide: (
    choice: { readonly mode: string } | "reject",
    reason?: string,
  ) => Promise<boolean>;
  artifacts?: ArtifactsSlice | undefined;
}

export function PlanCard({
  agent,
  id,
  subject,
  onDecide,
  artifacts,
}: PlanCardProps): ReactElement {
  const { plan, modes } = subject;
  const fold = useFold(plan, FOLD_LINES, "conversation.button.plan-show-full");
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const reasonInput = useRef<HTMLInputElement>(null);

  async function decide(choice: { readonly mode: string } | "reject") {
    setBusy(true);
    setFailed(false);
    const done = await onDecide(
      choice,
      choice === "reject" ? reason.trim() || undefined : undefined,
    );
    setBusy(false);
    setFailed(!done);
  }

  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (busy || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setReasonOpen(!reasonOpen);
    } else if (
      event.key === "Enter" &&
      reasonOpen &&
      (event.target as HTMLElement) === reasonInput.current
    ) {
      event.preventDefault();
      event.stopPropagation();
      void decide("reject");
    }
  };

  return (
    <section
      className={styles.card}
      aria-label={t("conversation.label.approval")}
      data-approval-id={id}
      data-plan-card=""
      data-key-context="modal"
      onKeyDown={keyDown}
    >
      <div className={styles.approval}>
        <p className={styles.title}>
          <Icon icon={editorIcons.problem} pixels={iconPixels("base")} />
          {t("conversation.title.approval-plan", { agent })}
        </p>
        <ChatMarkdown text={fold.shown} artifacts={artifacts} />
        {fold.toggle}
      </div>
      {reasonOpen ? (
        <ReasonRow
          agent={agent}
          value={reason}
          onChange={setReason}
          inputRef={reasonInput}
        />
      ) : null}
      <footer className={styles.foot} data-many={modes.length > 2 || undefined}>
        <p className={failed ? `${styles.note} ${styles.error}` : styles.note}>
          {failed
            ? t("conversation.notice.decide-failed")
            : t("conversation.notice.approval-paused", { agent })}
        </p>
        {reasonOpen ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setReasonOpen(false)}
            >
              {t("common.button.back")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={actionIcons.deny}
              disabled={busy}
              onClick={() => void decide("reject")}
            >
              {t("conversation.button.plan-keep-planning")}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="secondary"
              icon={actionIcons.deny}
              disabled={busy}
              onClick={() => setReasonOpen(true)}
            >
              {t("conversation.button.plan-keep-planning")}
            </Button>
            {/* 주 단추(첫 mode)가 맨 오른쪽에 오도록 거꾸로 그린다. */}
            {[...modes].reverse().map((mode, at) => (
              <Button
                key={mode.id}
                size="sm"
                variant={at === modes.length - 1 ? "primary" : "secondary"}
                icon={actionIcons.approve}
                disabled={busy}
                data-plan-mode={mode.id}
                onClick={() => void decide({ mode: mode.id })}
              >
                {t("conversation.button.plan-approve", { mode: mode.label })}
              </Button>
            ))}
          </>
        )}
      </footer>
    </section>
  );
}
