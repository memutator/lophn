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
  textTooLong,
  usableText,
} from "../../desktop/lophn-space/things-to-confirm/model.ts";
import {
  requestTitle,
  statusOf,
} from "../../desktop/lophn-space/things-to-confirm/labels.ts";
import type {
  ApprovalRequest,
  QuestionRequest,
  QuestionText,
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

// 질문의 글. 읽는 동안·읽지 못하면 그렇다고 말한다. 글은 React 글로만 그린다.
function useQuestionText(
  source: RequestSource,
  question: QuestionRequest,
): QuestionText | null | undefined {
  const [text, setText] = useState<QuestionText | null | undefined>(undefined);
  // 닫히면 답·취소 글이 생기므로 상태가 바뀌면 다시 읽는다.
  useEffect(() => {
    let live = true;
    setText(undefined);
    void source.text(question).then((read) => {
      if (live) setText(read.ok ? read.value : null);
    });
    return () => {
      live = false;
    };
  }, [source, question.id, question.status]);
  return text;
}

function Prompt({ text }: { text: QuestionText | null | undefined }) {
  if (text === undefined) {
    return (
      <p className={styles.meta} data-question-text="loading">
        {t("things-to-confirm.notice.question-loading")}
      </p>
    );
  }
  if (text === null) {
    return (
      <p className={styles.unavailable} data-question-text="failed">
        {t("things-to-confirm.error.question-text")}
      </p>
    );
  }
  return (
    <>
      <p className={styles.text} data-question-text="ready">{text.prompt}</p>
      <p className={styles.meta} data-question-reason="">{text.reason}</p>
    </>
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
  const text = useQuestionText(source, question);

  if (question.status !== "pending") {
    return (
      <>
        <Prompt text={text} />
        <ClosedQuestion question={question} text={text} />
      </>
    );
  }

  const review = needsReview(question, current.option);
  const ownTooLong = current.option === null && textTooLong(current.text);
  const reasonTooLong = textTooLong(current.reason);
  const canSend = current.option !== null ||
    (usableText(current.text) && !ownTooLong);
  const canCancel = usableText(current.reason) && !reasonTooLong;

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
      // action 있는 선택지는 이 칸에서 답하지 않는다. 보호 창이 action 답 경로와 확인
      // handle을 맡는다(shell#T29).
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
    if (busy || offline || !canCancel) return;
    setBusy(true);
    setProblem(null);
    settle(await source.cancel(question, current.reason), "cancel-failed");
  };

  const sendLabel = review
    ? t("things-to-confirm.button.review")
    : t("things-to-confirm.button.send-answer");

  return (
    <>
      <Prompt text={text} />
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
                <span className={styles.optionText}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  {text?.options.get(option.key)
                    ? (
                      <span
                        className={styles.optionDescription}
                        data-option-description=""
                      >
                        {text.options.get(option.key)}
                      </span>
                    )
                    : null}
                </span>
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
                {option.action && option.command !== "term.define"
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
      {text?.recommendation
        ? (
          <p className={styles.why} data-recommendation="">
            <span className={styles.whyLabel}>
              {t("things-to-confirm.label.why-recommended")}
            </span>
            <span className={styles.text}>{text.recommendation}</span>
          </p>
        )
        : null}
      <Field label={t("things-to-confirm.label.own-answer")}>
        <Textarea
          rows={2}
          value={current.text}
          data-own-answer=""
          onChange={(event) =>
            save({ text: event.currentTarget.value, option: null })}
        />
      </Field>
      {ownTooLong ? <TooLong /> : null}
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
            {reasonTooLong ? <TooLong /> : null}
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
                  disabled={busy || offline || !canCancel}
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

function TooLong() {
  return (
    <p className={styles.problem} data-too-long="">
      {t("things-to-confirm.error.too-long")}
    </p>
  );
}

// 닫힌 질문. 답 접수와 실제 적용을 따로 말한다(questions#R10). 자유 답과 취소 이유는 core가
// 둔 글을 그대로 보인다.
function ClosedQuestion(
  { question, text }: {
    question: QuestionRequest;
    text: QuestionText | null | undefined;
  },
) {
  if (question.status === "cancelled") {
    return text?.closedReason
      ? <p className={styles.text} data-closed-reason="">{text.closedReason}</p>
      : null;
  }
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
      {answer.kind === "text" && text?.answer
        ? <p className={styles.text} data-answer-text="">{text.answer}</p>
        : null}
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
