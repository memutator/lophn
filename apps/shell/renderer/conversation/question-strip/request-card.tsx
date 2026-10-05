import { useEffect, useState } from "react";
import {
  confirmIcons,
  Field,
  Icon,
  IconButton,
  iconPixels,
  StatusMark,
  Textarea,
  Tooltip,
} from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import type { CardDraft } from "../../desktop/lophn-space/things-to-confirm/context.tsx";
import {
  needsReview,
  usableText,
} from "../../desktop/lophn-space/things-to-confirm/model.ts";
import {
  requestTitle,
  statusOf,
} from "../../desktop/lophn-space/things-to-confirm/labels.ts";
import type {
  ApprovalRequest,
  QuestionRequest,
  Request,
  RequestSource,
  SourceResult,
} from "../../desktop/lophn-space/things-to-confirm/source.ts";
import styles from "./request-card.module.css";

export type CardProblem =
  | "send-failed"
  | "changed"
  | "not-allowed"
  | "review-unavailable"
  | "later-failed"
  | "cancel-failed";

const PROBLEM_TEXT: Record<
  CardProblem,
  | "things-to-confirm.error.send-failed"
  | "things-to-confirm.error.changed"
  | "things-to-confirm.error.not-allowed"
  | "things-to-confirm.error.review-unavailable"
  | "things-to-confirm.error.later-failed"
  | "things-to-confirm.error.cancel-failed"
> = {
  "send-failed": "things-to-confirm.error.send-failed",
  changed: "things-to-confirm.error.changed",
  "not-allowed": "things-to-confirm.error.not-allowed",
  "review-unavailable": "things-to-confirm.error.review-unavailable",
  "later-failed": "things-to-confirm.error.later-failed",
  "cancel-failed": "things-to-confirm.error.cancel-failed",
};

/** 보낸 결과를 사람이 겪는 일로 바꾼다. 결과를 모르는 것은 다시 해 보게 한다. */
function problemOf(
  result: SourceResult<void>,
  otherwise: CardProblem,
): CardProblem | null {
  if (result.ok) return null;
  if (result.code === "conflict" || result.code === "not_found") {
    return "changed";
  }
  if (result.code === "forbidden" || result.code === "invalid_input") {
    return otherwise === "send-failed" ? "not-allowed" : otherwise;
  }
  return otherwise;
}

export interface RequestCardProps {
  request: Request;
  source: RequestSource;
  /** 고른 답·쓰던 글. 칸을 옮겨도 남는다. */
  draft: CardDraft;
  onDraft: (patch: Partial<CardDraft>) => void;
  /** 답·미루기·취소가 접수되거나 대상이 바뀌어 다시 읽어야 한다. */
  onChanged: () => void;
  /** 연결이 끊기면 보내기를 막는다. 고르고 쓰는 것은 그대로 된다. */
  offline?: boolean;
  now?: () => number;
}

// 질문 하나 또는 approval 하나. 고르는 것만으로는 아무것도 보내지 않는다(questions#R4).
// action 있는 선택지와 approval은 [Review]로 confirmation window를 연다.
export function RequestCard(props: RequestCardProps) {
  const { request } = props;
  return (
    <article
      className={styles.card}
      data-request={request.kind}
      data-request-id={request.id}
      data-status={request.status}
    >
      <CardHead request={request} />
      {request.kind === "question"
        ? <QuestionBody {...props} question={request} />
        : <ApprovalBody {...props} approval={request} />}
    </article>
  );
}

function CardHead({ request }: { request: Request }) {
  const status = statusOf(request);
  return (
    <header className={styles.head}>
      <span className={styles.title}>
        <Icon
          icon={request.kind === "question"
            ? confirmIcons.question
            : confirmIcons.decision}
          pixels={iconPixels("base")}
        />
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

function ProblemLine({ problem }: { problem: CardProblem | null }) {
  if (problem === null) return null;
  return (
    <p className={styles.problem} data-problem={problem}>
      {t(PROBLEM_TEXT[problem])}
    </p>
  );
}

function QuestionBody(
  {
    question,
    source,
    draft: current,
    onDraft: save,
    onChanged,
    offline = false,
    now = Date.now,
  }: RequestCardProps & { question: QuestionRequest },
) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CardProblem | null>(null);

  if (question.status !== "pending") {
    return <ClosedQuestion question={question} />;
  }

  const review = needsReview(question, current.option);
  const canSend = current.option !== null || usableText(current.text);

  const settle = (result: SourceResult<void>, otherwise: CardProblem) => {
    setBusy(false);
    const next = problemOf(result, otherwise);
    setProblem(next);
    if (next === null || next === "changed") onChanged();
  };

  const send = async () => {
    if (busy || offline || !canSend) return;
    setBusy(true);
    setProblem(null);
    if (review && current.option !== null) {
      const opened = await source.review({
        kind: "question_option_action",
        question: question.id,
        option_key: current.option,
      });
      setBusy(false);
      setProblem(opened.ok ? null : "review-unavailable");
      return;
    }
    const answer = current.option !== null
      ? { kind: "option" as const, option: current.option }
      : { kind: "text" as const, text: current.text };
    settle(await source.answer(question, answer), "send-failed");
  };

  const later = async () => {
    if (busy || offline) return;
    setBusy(true);
    setProblem(null);
    settle(await source.defer(question), "later-failed");
  };

  const cancel = async () => {
    if (busy || offline || !usableText(current.reason)) return;
    setBusy(true);
    setProblem(null);
    settle(await source.cancel(question, current.reason), "cancel-failed");
  };

  const sendLabel = review
    ? t("things-to-confirm.button.review")
    : t("things-to-confirm.button.send-answer");

  return (
    <>
      <p className={styles.unavailable} data-question-text="">
        {t("things-to-confirm.notice.question-text-unavailable")}
      </p>
      {question.expiresAt === null
        ? null
        : (
          <p className={styles.meta} data-expires="">
            {t("things-to-confirm.label.expires", {
              when: formatRelativeTime(
                new Date(question.expiresAt),
                new Date(now()),
              ),
            })}
          </p>
        )}
      {question.options.length === 0 ? null : (
        <div
          className={styles.options}
          role="radiogroup"
          aria-label={t("things-to-confirm.label.options")}
        >
          {question.options.map((option) => {
            const chosen = current.option === option.key;
            return (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={styles.option}
                data-option={option.key}
                onClick={() => save({ option: chosen ? null : option.key })}
              >
                <span className={styles.dot} aria-hidden="true" />
                <span className={styles.optionLabel}>{option.label}</span>
                {question.recommended === option.key
                  ? (
                    <span className={styles.mark} data-recommended="">
                      <Icon
                        icon={confirmIcons.recommended}
                        pixels={iconPixels("base")}
                      />
                      {t("things-to-confirm.label.recommended")}
                    </span>
                  )
                  : null}
                {option.action
                  ? (
                    <span className={styles.mark} data-opens-review="">
                      <Icon
                        icon={confirmIcons.review}
                        pixels={iconPixels("base")}
                      />
                      {t("things-to-confirm.label.opens-review")}
                    </span>
                  )
                  : null}
              </button>
            );
          })}
        </div>
      )}
      <Field label={t("things-to-confirm.label.own-answer")}>
        <Textarea
          rows={2}
          value={current.text}
          data-own-answer=""
          onChange={(event) =>
            save({ text: event.currentTarget.value, option: null })}
        />
      </Field>
      <p className={styles.meta}>{t("things-to-confirm.notice.no-answer")}</p>
      <ProblemLine problem={problem} />
      {current.cancelling
        ? (
          <div className={styles.cancel} data-cancel-form="">
            <Field label={t("things-to-confirm.label.cancel-reason")}>
              <Textarea
                rows={2}
                value={current.reason}
                data-cancel-reason=""
                onChange={(event) =>
                  save({ reason: event.currentTarget.value })}
              />
            </Field>
            <div className={styles.actions}>
              <Tooltip content={t("things-to-confirm.button.keep-question")}>
                <IconButton
                  icon={confirmIcons.keep}
                  label={t("things-to-confirm.button.keep-question")}
                  size="sm"
                  data-keep-question=""
                  onClick={() => save({ cancelling: false })}
                />
              </Tooltip>
              <Tooltip content={t("things-to-confirm.button.confirm-cancel")}>
                <IconButton
                  icon={confirmIcons.confirmCancel}
                  label={t("things-to-confirm.button.confirm-cancel")}
                  variant="danger"
                  size="sm"
                  data-confirm-cancel=""
                  disabled={busy || offline || !usableText(current.reason)}
                  onClick={() => void cancel()}
                />
              </Tooltip>
            </div>
          </div>
        )
        : (
          <div className={styles.actions}>
            <span className={styles.secondary}>
              <Tooltip content={t("things-to-confirm.button.later")}>
                <IconButton
                  icon={confirmIcons.later}
                  label={t("things-to-confirm.button.later")}
                  size="sm"
                  data-later=""
                  disabled={busy || offline}
                  onClick={() => void later()}
                />
              </Tooltip>
              <Tooltip content={t("things-to-confirm.button.cancel-question")}>
                <IconButton
                  icon={confirmIcons.cancel}
                  label={t("things-to-confirm.button.cancel-question")}
                  size="sm"
                  data-cancel-question=""
                  disabled={busy || offline}
                  onClick={() => save({ cancelling: true })}
                />
              </Tooltip>
            </span>
            <Tooltip content={sendLabel}>
              <IconButton
                icon={review ? confirmIcons.review : confirmIcons.answer}
                label={sendLabel}
                variant="secondary"
                size="sm"
                data-send-answer={review ? undefined : ""}
                data-review={review ? "" : undefined}
                disabled={busy || offline || !canSend}
                onClick={() => void send()}
              />
            </Tooltip>
          </div>
        )}
    </>
  );
}

// 닫힌 질문. 답 접수와 실제 적용을 따로 말한다(questions#R10).
function ClosedQuestion({ question }: { question: QuestionRequest }) {
  if (question.status !== "answered" || question.answer === null) return null;
  const answer = question.answer;
  const option = answer.kind === "option"
    ? question.options.find((item) => item.key === answer.option)
    : undefined;
  return (
    <>
      <p className={styles.meta} data-answer="">
        {answer.kind === "option"
          ? t("things-to-confirm.notice.answered-option", {
            option: option?.label ?? answer.option,
          })
          : t("things-to-confirm.notice.answered-text")}
      </p>
      {option?.action
        ? (
          <p className={styles.meta} data-applied={String(question.applied)}>
            {question.applied
              ? t("things-to-confirm.notice.answer-applied")
              : t("things-to-confirm.notice.answer-not-applied")}
          </p>
        )
        : null}
    </>
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
