import { useEffect, useState } from "react";
import { Field, IconButton, Textarea, Tooltip } from "@lophn/design/components";
import { confirmIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { AnsweredSummary } from "../../../conversation/question-card/answered-summary.tsx";
import type {
  AnswerSummaryStatus,
  GroupAnswer,
  QuestionGroupView,
} from "../../../conversation/question-card/model.ts";
import { QuestionCard } from "../../../conversation/question-card/question-card.tsx";
import { type CardProblem, ProblemLine, problemOf } from "./card-problem.tsx";
import type { CardDraft } from "./context.tsx";
import { roleLabel } from "./labels.ts";
import { reviewTarget, textTooLong, usableText } from "./model.ts";
import type {
  QuestionGroupRequest,
  QuestionGroupText,
  RequestSource,
  SourceResult,
} from "./source.ts";
import styles from "./request-card.module.css";

export interface QuestionGroupPanelProps {
  group: QuestionGroupRequest;
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

// 묶음의 글. 읽는 동안·읽지 못하면 그렇다고 말한다. 글은 React 글로만 그린다.
function useGroupText(
  source: RequestSource,
  group: QuestionGroupRequest,
): QuestionGroupText | null | undefined {
  const [text, setText] = useState<QuestionGroupText | null | undefined>(
    undefined,
  );
  // 닫히면 답·취소 글이 생기므로 상태가 바뀌면 다시 읽는다.
  useEffect(() => {
    let live = true;
    setText(undefined);
    void source.text(group).then((read) => {
      if (live) setText(read.ok ? read.value : null);
    });
    return () => {
      live = false;
    };
  }, [source, group.id, group.status]);
  return text;
}

// 묶음 카드가 받는 값. 읽은 묶음과 글을 합친다. 묻는 agent의 이름은 그 run의 역할이다.
function viewOf(
  group: QuestionGroupRequest,
  text: QuestionGroupText,
): QuestionGroupView {
  return {
    id: group.id,
    agentName: group.role === null
      ? t("things-to-confirm.label.agent-unknown")
      : roleLabel(group.role),
    expires_at: group.expiresAt,
    questions: group.questions.map((entry) => {
      const words = text.questions.find((item) => item.id === entry.id);
      return {
        id: entry.id,
        prompt: words?.prompt ?? "",
        reason: words?.reason ?? "",
        options: entry.options.map((option) => ({
          key: option.key,
          label: option.label,
          description: words?.options.get(option.key) ?? "",
        })),
        recommendation: words?.recommendation == null ? null : {
          option_key: entry.recommended,
          explanation: words.recommendation,
        },
      };
    }),
  };
}

// 닫힌 묶음의 요약 상태. 답 접수와 고정 action 적용을 따로 말한다(questions#R10).
function summaryStatus(group: QuestionGroupRequest): AnswerSummaryStatus {
  if (group.status === "answered") {
    // 고른 선택지가 고정 action이면 적용까지 따로 센다. 적용되기 전에는 접수만 된 것이다.
    let acting = 0;
    let applied = 0;
    for (const entry of group.questions) {
      const answer = entry.answer;
      if (answer === null || answer.kind !== "option") continue;
      const chosen = entry.options.find((option) =>
        option.key === answer.option
      );
      if (chosen === undefined || !chosen.action) continue;
      acting += 1;
      if (entry.applied) applied += 1;
    }
    if (acting === 0) return "answered";
    return applied === acting ? "applied" : "applying";
  }
  if (group.status === "expired") return "expired";
  return group.closedReason === "deferred" ? "skipped" : "cancelled";
}

// 받은 답. 자유 답의 글은 core가 둔 글을 읽어 넣는다. 읽지 못한 글은 건너뛴다.
function answersOf(
  group: QuestionGroupRequest,
  text: QuestionGroupText,
): GroupAnswer[] {
  const found: GroupAnswer[] = [];
  for (const entry of group.questions) {
    if (entry.answer === null) continue;
    if (entry.answer.kind === "option") {
      found.push({
        question: entry.id,
        answer: { kind: "option", option_key: entry.answer.option },
      });
      continue;
    }
    const written = text.questions.find((item) => item.id === entry.id)
      ?.answer;
    if (written != null) {
      found.push({
        question: entry.id,
        answer: { kind: "text", text: written },
      });
    }
  }
  return found;
}

// 세션 없는 run의 질문 묶음 하나. 대화 안 카드와 같은 QuestionCard로 그리고, 고르는 것만으로는
// 아무것도 보내지 않으며 Submit이 모든 답을 한 번에 보낸다(questions#R4). Skip과 취소는 따로
// 닫는 요청이다(R6). 고정 action이 있는 선택지는 답을 보내지 않고 [Review]로 보호 창만 연다.
export function QuestionGroupPanel(
  {
    group,
    source,
    draft: current,
    onDraft: save,
    onChanged,
    offline = false,
    now = Date.now,
  }: QuestionGroupPanelProps,
) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<CardProblem | null>(null);
  const text = useGroupText(source, group);

  const frame = (children: React.ReactNode) => (
    <article
      className={styles.card}
      data-request="question"
      data-request-id={group.id}
      data-status={group.status}
    >
      {children}
    </article>
  );

  if (text === undefined) {
    return frame(
      <p className={styles.meta} data-question-text="loading">
        {t("things-to-confirm.notice.question-loading")}
      </p>,
    );
  }
  if (text === null) {
    return frame(
      <p className={styles.unavailable} data-question-text="failed">
        {t("things-to-confirm.error.question-text")}
      </p>,
    );
  }

  const view = viewOf(group, text);

  if (group.status !== "pending") {
    return frame(
      <>
        {text.questions.map((entry) => (
          <p key={entry.id} className={styles.text} data-question-text="ready">
            {entry.prompt}
          </p>
        ))}
        <AnsweredSummary
          group={view}
          status={summaryStatus(group)}
          answers={answersOf(group, text)}
        />
        {group.status === "cancelled" && text.closedReason
          ? (
            <p className={styles.text} data-closed-reason="">
              {text.closedReason}
            </p>
          )
          : null}
      </>,
    );
  }

  const reasonTooLong = textTooLong(current.reason);
  const canCancel = usableText(current.reason) && !reasonTooLong;

  const settle = (result: SourceResult<void>, otherwise: CardProblem) => {
    setBusy(false);
    const next = problemOf(result, otherwise);
    setProblem(next);
    if (next === null || next === "changed") onChanged();
  };

  const submit = async (answers: readonly GroupAnswer[]) => {
    if (busy || offline) return;
    setBusy(true);
    setProblem(null);
    const target = reviewTarget(group, answers);
    if (target !== null) {
      // action 있는 선택지는 이 카드에서 답하지 않는다. 보호 창이 action 답 경로와 확인
      // handle을 맡는다(shell#T29).
      const opened = await source.review({
        kind: "question_option_action",
        ...target,
      });
      setBusy(false);
      setProblem(opened.ok ? null : "review-unavailable");
      return;
    }
    settle(await source.answer(group, answers), "send-failed");
  };

  const skip = async () => {
    if (busy || offline) return;
    setBusy(true);
    setProblem(null);
    settle(await source.defer(group), "later-failed");
  };

  const cancel = async () => {
    if (busy || offline || !canCancel) return;
    setBusy(true);
    setProblem(null);
    settle(await source.cancel(group, current.reason), "cancel-failed");
  };

  return frame(
    <>
      <QuestionCard
        group={view}
        now={now()}
        disabled={busy || offline}
        onSubmit={(answers) => void submit(answers)}
        onSkip={() => void skip()}
      />
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
            {reasonTooLong
              ? (
                <p className={styles.problem} data-too-long="">
                  {t("things-to-confirm.error.too-long")}
                </p>
              )
              : null}
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
            <span />
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
          </div>
        )}
    </>,
  );
}
