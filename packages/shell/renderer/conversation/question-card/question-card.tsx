// composer 위 질문 카드와 답한 뒤 대화에 남는 접힌 요약. 질문은 한 번에 하나만 보이고 ‹ 1 of N ›로 넘긴다.
// 기한, 추천, Skip은 없고 Other는 늘 붙는다. 답을 기다리는 동안 agent는 멈춰 있고, 사람이 그냥 메시지를
// 보내도 묶음은 끝난다.
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react";
import { Button, Icon, Kbd } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";
import { commonIcons } from "../../icons/mod.ts";
import type {
  AnsweredLine,
  AskedQuestion,
  QuestionAnswer,
  QuestionOutcome,
} from "../agent-tab-source.ts";
import {
  answerOf,
  answersOf,
  NO_PICK,
  OTHER_MAX,
  type Pick,
  togglePick,
  typeOther,
} from "./ask-model.ts";
import styles from "./question-card.module.css";

interface QuestionCardProps {
  /** 묻는 agent의 이름. */
  agent: string;
  questions: readonly AskedQuestion[];
  /** 답 전부를 한 번에 낸다. 접수되었는지 돌려준다. */
  onSubmit: (answers: readonly QuestionAnswer[]) => Promise<boolean>;
}

export function QuestionCard({
  agent,
  questions,
  onSubmit,
}: QuestionCardProps): ReactElement {
  const root = useRef<HTMLElement>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const question = questions[index];
  const pick = picks[question.id] ?? NO_PICK;
  const last = index === questions.length - 1;
  const answers = answersOf(questions, picks);

  const change = (next: Pick) =>
    setPicks((current) => ({ ...current, [question.id]: next }));
  const toggle = (label: string | null) =>
    change(togglePick(question, pick, label));

  async function submit() {
    if (answers === null) return;
    setBusy(true);
    setFailed(false);
    const done = await onSubmit(answers);
    setBusy(false);
    setFailed(!done);
  }

  // 번호 키는 글을 쓰는 중이 아닐 때만 선택지를 누른다.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return;
    }
    if (!/^[1-9]$/.test(event.key)) return;
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    const number = Number(event.key);
    if (number <= question.options.length) {
      toggle(question.options[number - 1].label);
    } else if (number === question.options.length + 1) {
      toggle(null);
      root.current?.querySelector<HTMLInputElement>("input")?.focus();
    } else return;
    event.preventDefault();
  };

  return (
    <section
      ref={root}
      className={styles.card}
      aria-label={t("conversation.label.question-card", { agent })}
      onKeyDown={onKeyDown}
    >
      <header className={styles.head}>
        <span className={styles.title}>
          {t("conversation.title.question-asking", { agent })}
        </span>
        {questions.length === 1 ? null : (
          <span className={styles.nav}>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("conversation.label.question-previous")}
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              ‹
            </Button>
            <span className={styles.count}>
              {t("conversation.label.request-position", {
                current: index + 1,
                total: questions.length,
              })}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("conversation.label.question-following")}
              disabled={last}
              onClick={() => setIndex(index + 1)}
            >
              ›
            </Button>
          </span>
        )}
      </header>
      <div className={styles.body}>
        <div
          key={question.id}
          className={styles.ask}
          role={question.multiSelect ? "group" : "radiogroup"}
          aria-label={question.question}
        >
          <p className={styles.askHead}>
            <span className={styles.tag}>{question.header}</span>
            {question.multiSelect ? (
              <span className={styles.multi}>
                {t("conversation.label.question-pick-any")}
              </span>
            ) : null}
          </p>
          <p className={styles.text}>{question.question}</p>
          {question.options.map((option, position) => (
            <Choice
              key={option.label}
              multi={question.multiSelect}
              checked={pick.labels.includes(option.label)}
              number={position + 1}
              onClick={() => toggle(option.label)}
            >
              <span className={styles.choiceLabel}>{option.label}</span>
              <span className={styles.choiceDesc}>{option.description}</span>
            </Choice>
          ))}
          <Choice
            multi={question.multiSelect}
            checked={pick.other}
            number={question.options.length + 1}
            onClick={() => toggle(null)}
          >
            <span className={styles.choiceLabel}>
              {t("common.label.other")}
            </span>
            <input
              className={styles.otherInput}
              aria-label={t("conversation.label.question-own-answer", {
                prompt: question.question,
              })}
              placeholder={t(
                "conversation.label.question-own-answer-placeholder",
              )}
              maxLength={OTHER_MAX}
              value={pick.text}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) =>
                change(typeOther(question, pick, event.currentTarget.value))
              }
            />
          </Choice>
        </div>
      </div>
      <footer className={styles.foot}>
        <p className={failed ? `${styles.note} ${styles.error}` : styles.note}>
          {failed
            ? t("conversation.notice.answer-failed")
            : t("conversation.notice.question-waiting")}
        </p>
        {last ? (
          <Button
            size="sm"
            variant="primary"
            disabled={busy || answers === null}
            onClick={submit}
          >
            {t("conversation.button.question-submit")}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            disabled={answerOf(question, pick) === null}
            onClick={() => setIndex(index + 1)}
          >
            {t("conversation.button.question-next")}
          </Button>
        )}
      </footer>
    </section>
  );
}

function Choice({
  multi,
  checked,
  number,
  onClick,
  children,
}: {
  multi: boolean;
  checked: boolean;
  number: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={styles.choice}
      role={multi ? "checkbox" : "radio"}
      aria-checked={checked}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span
        className={multi ? styles.checkBox : styles.radioDot}
        data-on={checked ? "" : undefined}
        aria-hidden="true"
      >
        {checked && multi ? "✓" : null}
      </span>
      <span className={styles.choiceText}>{children}</span>
      <Kbd keys={[String(number)]} />
    </div>
  );
}

interface QuestionSummaryProps {
  outcome: QuestionOutcome;
  /** 질문 순서대로 header와 답. */
  lines: readonly AnsweredLine[];
}

/** 풀린 묶음이 대화에 남는 접힌 요약. 사람 메시지로 끝난 묶음은 늘 펼쳐 고른 답이 없음을 보인다. */
export function QuestionSummary({
  outcome,
  lines,
}: QuestionSummaryProps): ReactElement {
  const [open, setOpen] = useState(false);
  const submitted = outcome === "submitted";
  const shown = open || !submitted;
  return (
    <div className={styles.summary}>
      <button
        type="button"
        className={styles.summaryHead}
        aria-expanded={shown}
        disabled={!submitted}
        onClick={() => setOpen(!open)}
      >
        {submitted ? (
          <Icon
            icon={open ? commonIcons.collapse : commonIcons.expand}
            pixels={iconPixels("small")}
          />
        ) : null}
        <span>
          {submitted ? (
            <>
              <span className={styles.ok}>✓</span>{" "}
              {t("conversation.label.questions-answered", {
                count: lines.length,
              })}
            </>
          ) : outcome === "cancelled" ? (
            t("conversation.label.question-cancelled")
          ) : (
            t("conversation.label.questions-ended-by-message")
          )}
        </span>
      </button>
      {shown ? (
        <ul className={styles.summaryList}>
          {outcome === "human_message" ? (
            <li className={styles.summaryPlain}>
              {t("conversation.notice.questions-ended-by-message")}
            </li>
          ) : null}
          {lines.map((line) => (
            <li key={line.header}>
              <span className={styles.summaryKey}>{line.header}</span>
              {line.answer !== null ? (
                line.answer
              ) : (
                <span className={styles.summaryNone}>
                  {submitted
                    ? t("conversation.label.question-answered-elsewhere")
                    : t("conversation.label.question-no-answer")}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
