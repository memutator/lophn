import {
  type KeyboardEvent,
  type ReactElement,
  useId,
  useRef,
  useState,
} from "react";
import { Button, Icon, iconPixels, Kbd } from "@lophn/design/components";
import { confirmIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import {
  answerOf,
  completeAnswers,
  type GroupAnswer,
  type Pick,
  QUESTION_CARD_SPREAD_MAX,
  type QuestionGroupView,
  type QuestionView,
  type Remaining,
  remainingOf,
} from "./model.ts";
import styles from "./question-card.module.css";

export interface QuestionCardProps {
  group: QuestionGroupView;
  /** 지금 시각(epoch ms). 기한의 남은 시간을 이 값으로 센다. 시각은 주입한다. */
  now: number;
  /** true이면 보내기·Skip을 막는다(연결이 끊겼거나 접수 중). */
  disabled?: boolean;
  /**
   * 모든 질문에 답한 뒤 [Submit]을 누르면 질문 순서대로 답 전부를 한 번에 넘긴다.
   * 선택만으로는 부르지 않는다.
   */
  onSubmit: (answers: readonly GroupAnswer[]) => void;
  /** [Skip]: 묶음 전체를 답 없이 미룬다(DeferQuestionGroup). */
  onSkip: () => void;
}

function remainingText(remaining: Exclude<Remaining, { unit: "now" }>): string {
  switch (remaining.unit) {
    case "days-hours":
      return t("conversation.label.duration-days-hours", remaining);
    case "hours-minutes":
      return t("conversation.label.duration-hours-minutes", remaining);
    case "minutes":
      return t("conversation.label.duration-minutes", remaining);
  }
}

function expiryText(expiresAt: string, now: number): string {
  const remaining = remainingOf(expiresAt, now);
  return remaining.unit === "now"
    ? t("conversation.label.question-expires-now")
    : t("conversation.label.question-expires", {
      remaining: remainingText(remaining),
    });
}

// 대화 안 질문 묶음 카드. 질문이 QUESTION_CARD_SPREAD_MAX 이하이면 모두 펼치고 넘으면 "1 of N"으로
// 하나씩 넘긴다. 선택지에 번호 키와 추천 표시, 마지막에 Other, 아래에 "Work is paused until you
// answer"와 Skip·Submit을 둔다. 기한이 있으면 남은 시간을 보이고 머리의 Details를
// 펼치면 질문의 자세한 이유(reason)를 보인다.
export function QuestionCard(
  { group, now, disabled = false, onSubmit, onSkip }: QuestionCardProps,
): ReactElement {
  const titleId = useId();
  const root = useRef<HTMLElement>(null);
  const [picks, setPicks] = useState<Record<string, Pick | undefined>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [detailed, setDetailed] = useState(false);

  const total = group.questions.length;
  const paged = total > QUESTION_CARD_SPREAD_MAX;
  const visible = paged ? [group.questions[page]] : group.questions;
  const answers = completeAnswers(group, picks, texts);

  const pick = (question: QuestionView, chosen: Pick) => {
    setPicks((current) => ({ ...current, [question.id]: chosen }));
  };
  const focusOther = (question: QuestionView) => {
    root.current?.querySelector<HTMLInputElement>(
      `[data-question="${question.id}"] [data-option-other] input`,
    )?.focus();
  };

  // 번호 키는 누른 자리가 속한 질문에 간다. 자리가 질문 밖이면 하나씩 넘기는 카드는 보이는 질문,
  // 모두 펼친 카드는 첫 미답 질문이다. 글을 쓰는 중의 숫자는 번호 키가 아니다.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    if (!/^[1-9]$/.test(event.key)) return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea")) return;
    const owner = target.closest<HTMLElement>("[data-question]")?.dataset
      .question;
    const question = visible.find((candidate) => candidate.id === owner) ??
      (paged ? visible[0] : visible.find((candidate) =>
        answerOf(
          candidate,
          picks[candidate.id],
          texts[candidate.id] ?? "",
        ) ===
          null
      ));
    if (question === undefined) return;
    const number = Number(event.key);
    if (number <= question.options.length) {
      pick(question, { kind: "option", key: question.options[number - 1].key });
    } else if (number === question.options.length + 1) {
      pick(question, { kind: "other" });
      focusOther(question);
    } else return;
    event.preventDefault();
  };

  return (
    <section
      ref={root}
      className={styles.card}
      aria-labelledby={titleId}
      data-question-card=""
      onKeyDown={onKeyDown}
    >
      <header className={styles.head}>
        <Icon icon={confirmIcons.question} pixels={iconPixels("base")} />
        <span id={titleId} className={styles.title}>
          {t("conversation.label.question-asking", {
            agent: group.agentName,
            count: total,
          })}
        </span>
        {group.expires_at === null
          ? null
          : (
            <span className={styles.expiry} data-question-expiry="">
              {expiryText(group.expires_at, now)}
            </span>
          )}
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={detailed}
          onClick={() => setDetailed(!detailed)}
        >
          {t("conversation.button.question-details")}
        </Button>
      </header>
      <div className={styles.body}>
        {visible.map((question) => (
          <QuestionBlock
            key={question.id}
            question={question}
            pick={picks[question.id]}
            text={texts[question.id] ?? ""}
            detailed={detailed}
            onPick={(chosen) => pick(question, chosen)}
            onText={(text) => {
              setTexts((current) => ({ ...current, [question.id]: text }));
              pick(question, { kind: "other" });
            }}
            onOtherClick={() => {
              pick(question, { kind: "other" });
              focusOther(question);
            }}
          />
        ))}
      </div>
      {paged
        ? (
          <nav className={styles.pager}>
            <Button
              size="sm"
              variant="ghost"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              {t("common.button.back")}
            </Button>
            <span data-question-progress="">
              {t("conversation.label.request-position", {
                current: page + 1,
                total,
              })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={page === total - 1}
              onClick={() => setPage(page + 1)}
            >
              {t("conversation.button.question-next")}
            </Button>
          </nav>
        )
        : null}
      <footer className={styles.foot}>
        <span className={styles.paused}>
          {t("conversation.label.question-paused")}
        </span>
        <Button size="sm" disabled={disabled} onClick={onSkip}>
          {t("conversation.button.question-skip")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={disabled || answers === null}
          onClick={() => {
            if (!disabled && answers !== null) onSubmit(answers);
          }}
        >
          {t("conversation.button.question-submit")}
        </Button>
      </footer>
    </section>
  );
}

interface QuestionBlockProps {
  question: QuestionView;
  pick: Pick | undefined;
  text: string;
  detailed: boolean;
  onPick: (pick: Pick) => void;
  onText: (text: string) => void;
  onOtherClick: () => void;
}

function QuestionBlock(
  { question, pick, text, detailed, onPick, onText, onOtherClick }:
    QuestionBlockProps,
) {
  const otherChosen = pick?.kind === "other";
  return (
    <div className={styles.question}>
      <p className={styles.prompt}>{question.prompt}</p>
      {detailed
        ? (
          <p className={styles.reason} data-question-reason="">
            {question.reason}
          </p>
        )
        : null}
      <div
        className={styles.options}
        role="radiogroup"
        aria-label={question.prompt}
        data-question={question.id}
      >
        {question.options.map((option, index) => {
          const chosen = pick?.kind === "option" && pick.key === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={chosen}
              className={styles.option}
              data-option={option.key}
              onClick={() => onPick({ kind: "option", key: option.key })}
            >
              <span className={styles.optionText}>
                <span className={styles.optionName}>
                  {option.label}
                  {question.recommendation?.option_key === option.key
                    ? (
                      <span className={styles.recommended} data-recommended="">
                        {t("conversation.label.question-recommended")}
                      </span>
                    )
                    : null}
                </span>
                {option.description === ""
                  ? null
                  : (
                    <span className={styles.optionDetail}>
                      {option.description}
                    </span>
                  )}
              </span>
              <Kbd keys={[String(index + 1)]} />
            </button>
          );
        })}
        <div
          className={styles.option}
          role="radio"
          aria-checked={otherChosen}
          tabIndex={0}
          data-option-other=""
          onClick={(event) => {
            if (event.target === event.currentTarget) onOtherClick();
          }}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              onOtherClick();
            }
          }}
        >
          <span className={styles.otherRow}>
            <span className={styles.optionName}>
              {t("common.label.other")}
            </span>
            <input
              className={styles.otherInput}
              aria-label={t("conversation.label.question-own-answer", {
                prompt: question.prompt,
              })}
              placeholder={t(
                "conversation.label.question-own-answer-placeholder",
              )}
              value={text}
              onFocus={() => onPick({ kind: "other" })}
              onChange={(event) => onText(event.currentTarget.value)}
            />
          </span>
          <Kbd keys={[String(question.options.length + 1)]} />
        </div>
      </div>
      {question.recommendation === null
        ? null
        : (
          <p className={styles.why} data-recommendation="">
            {question.recommendation.explanation}
          </p>
        )}
    </div>
  );
}
