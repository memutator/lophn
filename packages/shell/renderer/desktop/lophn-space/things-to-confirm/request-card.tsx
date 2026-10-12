import { useEffect, useState } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  StatusMark,
  Tooltip,
} from "@lophn/design/components";
import { confirmIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { type CardProblem, ProblemLine } from "./card-problem.tsx";
import type { CardDraft } from "./context.tsx";
import { requestTitle, statusOf } from "./labels.ts";
import { QuestionGroupPanel } from "./question-group.tsx";
import type { ApprovalRequest, Request, RequestSource } from "./source.ts";
import styles from "./request-card.module.css";

export interface RequestCardProps {
  request: Request;
  source: RequestSource;
  /** 쓰던 취소 이유. 요청을 옮겨도 남는다. */
  draft: CardDraft;
  onDraft: (patch: Partial<CardDraft>) => void;
  /** 답·미루기·취소가 접수되거나 대상이 바뀌어 다시 읽어야 한다. */
  onChanged: () => void;
  /** 연결이 끊기면 보내기를 막는다. 고르고 쓰는 것은 그대로 된다. */
  offline?: boolean;
  now?: () => number;
}

// 질문 묶음 하나 또는 approval 하나. 묶음은 대화 안 카드와 같은 묶음 카드로 그리고(questions#R17),
// approval은 [Review]로 confirmation window를 연다. 고르는 것만으로는 아무것도 보내지 않는다.
export function RequestCard(props: RequestCardProps) {
  const { request } = props;
  if (request.kind === "question") {
    return <QuestionGroupPanel {...props} group={request} />;
  }
  return (
    <article
      className={styles.card}
      data-request="approval"
      data-request-id={request.id}
      data-status={request.status}
    >
      <CardHead request={request} />
      <ApprovalBody {...props} approval={request} />
    </article>
  );
}

function CardHead({ request }: { request: ApprovalRequest }) {
  const status = statusOf(request);
  return (
    <header className={styles.head}>
      <span className={styles.title}>
        <Icon icon={confirmIcons.decision} pixels={iconPixels("base")} />
        <span>{requestTitle(request)}</span>
      </span>
      {request.status === "pending"
        ? (request.blocking
          ? (
            <span className={styles.blocking} data-blocking="">
              <StatusMark
                tone="warning"
                label={t("things-to-confirm.label.blocking")}
              />
            </span>
          )
          : null)
        : <StatusMark tone={status.tone} label={status.label} />}
    </header>
  );
}

function ApprovalBody(
  { approval, source, offline = false }: RequestCardProps & {
    approval: ApprovalRequest;
  },
) {
  const [reason, setReason] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CardProblem | null>(null);

  useEffect(() => {
    let live = true;
    void source.reason(approval).then((read) => {
      if (live) setReason(read.ok ? read.value : null);
    });
    return () => {
      live = false;
    };
  }, [source, approval.id]);

  const review = async () => {
    if (busy || offline) return;
    setBusy(true);
    const opened = await source.review({
      kind: "approval_request",
      approval: approval.id,
    });
    setBusy(false);
    setProblem(opened.ok ? null : "review-unavailable");
  };

  return (
    <>
      {reason === undefined
        ? null
        : reason === null
        ? (
          <p className={styles.unavailable} data-reason="">
            {t("things-to-confirm.notice.decision-text-unavailable")}
          </p>
        )
        : <p className={styles.text} data-reason="">{reason}</p>}
      <p className={styles.meta} data-reversible={String(approval.reversible)}>
        {approval.reversible
          ? t("things-to-confirm.notice.decision-reversible")
          : t("things-to-confirm.notice.decision-irreversible")}
      </p>
      <ProblemLine problem={problem} />
      {approval.status === "pending"
        ? (
          <div className={styles.actions}>
            <span />
            <Tooltip content={t("things-to-confirm.button.review")}>
              <IconButton
                icon={confirmIcons.review}
                label={t("things-to-confirm.button.review")}
                variant="secondary"
                size="sm"
                data-review=""
                disabled={busy || offline}
                onClick={() => void review()}
              />
            </Tooltip>
          </div>
        )
        : null}
    </>
  );
}
