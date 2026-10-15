// composer 위에 붙는 질문 카드와 승인 카드, 그리고 결정 뒤 대화에 남는 접힌 줄. 확인 창 없이 카드에서 바로 결정한다.
// 질문: 질문마다 header, 선택지 2~4개(label과 description), multiSelect, 늘 붙는 Other. 기한도 추천 칸도 Skip도 없다.
// 승인: 내용은 program이 만든 문구(대상, 입력, 효과)이고, app-api·MCP tool은 선택지 넷, 설정 고치기는 둘이다.
import { type ReactNode, useState } from "react";
import {
  Button,
  Icon,
  iconPixels,
  Kbd,
  StatusMark,
} from "@lophn/design/components";
import {
  editorIcons,
  lophnSpaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import type {
  ApprovalContent,
  ApprovalResultView,
  AskedQuestion,
  QuestionAnswer,
} from "./data.ts";
import t from "./agent-tab.module.css";

const OTHER = "\u0000other";

type Picks = Record<string, readonly string[]>;

/**
 * 질문 카드. 질문이 여럿이어도 한 번에 하나만 보이고, `‹` `›`와 "1 of 2"로 넘긴다. 답을 기다리는 동안 agent는 멈춰
 * 있고, 사람이 그냥 메시지를 보내도 끝난다. 단추는 카드 오른쪽 끝에 모은다. `initial`은 page가 미리 골라 둔 답이다.
 */
export function QuestionCard(
  { questions, agent, initial = {}, typed: initialTyped = {}, onSubmit }: {
    questions: readonly AskedQuestion[];
    agent: string;
    initial?: Picks;
    typed?: Record<string, string>;
    onSubmit?: (answers: readonly QuestionAnswer[]) => void;
  },
) {
  const [picks, setPicks] = useState<Picks>(initial);
  const [typed, setTyped] = useState(initialTyped);
  const [index, setIndex] = useState(0);
  const chosen = (question: AskedQuestion) => picks[question.id] ?? [];
  const answered = (question: AskedQuestion) => {
    const list = chosen(question);
    if (list.length === 0) return false;
    return !list.includes(OTHER) || (typed[question.id] ?? "").trim() !== "";
  };
  const toggle = (question: AskedQuestion, value: string) => {
    const now = chosen(question);
    if (!question.multiSelect) {
      setPicks({ ...picks, [question.id]: [value] });
    } else {
      setPicks({
        ...picks,
        [question.id]: now.includes(value)
          ? now.filter((item) => item !== value)
          : [...now, value],
      });
    }
  };
  const answerOf = (question: AskedQuestion): string =>
    chosen(question)
      .map((value) => value === OTHER ? typed[question.id] ?? "" : value)
      .join(", ");
  const question = questions[index];
  const last = index === questions.length - 1;
  return (
    <section className={t.card} aria-label={`Questions from ${agent}`}>
      <header className={t.cardHead}>
        <span className={t.cardTitle}>{agent} is asking</span>
        {questions.length === 1 ? null : (
          <span className={t.cardNav}>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Previous question"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              ‹
            </Button>
            <span className={t.cardCount}>
              {index + 1} of {questions.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Next question"
              disabled={last}
              onClick={() => setIndex(index + 1)}
            >
              ›
            </Button>
          </span>
        )}
      </header>
      <div className={t.cardBody}>
        <div
          key={question.id}
          className={t.ask}
          role={question.multiSelect ? "group" : "radiogroup"}
          aria-label={question.question}
        >
          <p className={t.askHead}>
            <span className={t.askTag}>{question.header}</span>
            {question.multiSelect
              ? <span className={t.askMulti}>Pick any</span>
              : null}
          </p>
          <p className={t.askText}>{question.question}</p>
          {question.options.map((option, position) => (
            <Choice
              key={option.label}
              multi={question.multiSelect}
              checked={chosen(question).includes(option.label)}
              index={position + 1}
              onClick={() => toggle(question, option.label)}
            >
              <span className={t.choiceLabel}>{option.label}</span>
              <span className={t.choiceDesc}>{option.description}</span>
            </Choice>
          ))}
          <Choice
            multi={question.multiSelect}
            checked={chosen(question).includes(OTHER)}
            index={question.options.length + 1}
            onClick={() => toggle(question, OTHER)}
          >
            <span className={t.choiceLabel}>Other</span>
            <input
              className={t.otherInput}
              aria-label={`Type your own answer: ${question.question}`}
              placeholder="Type your own answer"
              value={typed[question.id] ?? ""}
              onClick={(event) => event.stopPropagation()}
              onFocus={() => {
                if (!chosen(question).includes(OTHER)) toggle(question, OTHER);
              }}
              onChange={(event) =>
                setTyped({ ...typed, [question.id]: event.target.value })}
            />
          </Choice>
        </div>
      </div>
      <footer className={t.cardFoot}>
        <span className={t.cardNote}>
          Waiting for your answer. Sending a message instead also ends the
          questions.
        </span>
        {last
          ? (
            <Button
              size="sm"
              variant="primary"
              disabled={!questions.every(answered)}
              onClick={() =>
                onSubmit?.(
                  questions.map((item) => ({
                    header: item.header,
                    answer: answerOf(item),
                  })),
                )}
            >
              Submit
            </Button>
          )
          : (
            <Button
              size="sm"
              variant="primary"
              disabled={!answered(question)}
              onClick={() => setIndex(index + 1)}
            >
              Next
            </Button>
          )}
      </footer>
    </section>
  );
}

function Choice(
  { multi, checked, index, onClick, children }: {
    multi: boolean;
    checked: boolean;
    index: number;
    onClick: () => void;
    children: ReactNode;
  },
) {
  return (
    <div
      className={t.choice}
      role={multi ? "checkbox" : "radio"}
      aria-checked={checked}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClick();
      }}
    >
      <span
        className={multi ? t.checkBox : t.radioDot}
        data-on={checked ? "" : undefined}
        aria-hidden="true"
      >
        {checked && multi ? "✓" : null}
      </span>
      <span className={t.choiceText}>{children}</span>
      <Kbd keys={[String(index)]} />
    </div>
  );
}

/** 답한 뒤나 사람 메시지로 끝난 뒤 대화에 남는 접힌 요약. */
export function QuestionSummary(
  { outcome, answers, headers }: {
    outcome: "submitted" | "message";
    answers?: readonly QuestionAnswer[];
    headers?: readonly string[];
  },
) {
  const [open, setOpen] = useState(false);
  const submitted = outcome === "submitted";
  return (
    <div className={t.summary}>
      <button
        type="button"
        className={t.summaryHead}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon
          icon={open ? lophnSpaceIcons.collapse : lophnSpaceIcons.expand}
          pixels={iconPixels("small")}
        />
        {submitted
          ? (
            <span>
              <span className={t.ok}>✓</span> Answered {answers?.length ?? 0}
              {" "}
              questions
            </span>
          )
          : <span>Ended by your message</span>}
      </button>
      {open || !submitted
        ? (
          <ul className={t.summaryList}>
            {submitted
              ? answers?.map((item) => (
                <li key={item.header}>
                  <span className={t.summaryKey}>{item.header}</span>
                  {item.answer}
                </li>
              ))
              : (
                <>
                  <li className={t.summaryPlain}>
                    You sent a message while the questions were open, so the
                    questions closed. lophn reads your message as the answer.
                  </li>
                  {headers?.map((header) => (
                    <li key={header}>
                      <span className={t.summaryKey}>{header}</span>
                      <span className={t.summaryNone}>No answer picked</span>
                    </li>
                  ))}
                </>
              )}
          </ul>
        )
        : null}
    </div>
  );
}

/** 사람이 고른 결정. 설정 고치기는 allow와 deny뿐이다. */
export type ApprovalDecision = "once" | "session" | "always" | "allow" | "deny";

/**
 * 승인 카드. app-api·MCP tool은 [Allow once] [Allow for this session] [Always allow] [Deny]이고 설정 고치기는
 * [Allow] [Deny]다. [Deny]는 이유를 적는 칸을 펼치고, 적지 않고 보내도 된다. 카드를 닫거나 가만히 두는 것은 결정이 아니다.
 */
export function ApprovalCard(
  {
    agent,
    kind,
    content,
    denyOpen = false,
    reason: initialReason = "",
    onDecide,
  }: {
    agent: string;
    kind: "tool" | "settings";
    content: ApprovalContent;
    denyOpen?: boolean;
    reason?: string;
    onDecide?: (decision: ApprovalDecision, reason: string) => void;
  },
) {
  const [denying, setDenying] = useState(denyOpen);
  const [reason, setReason] = useState(initialReason);
  const [decision, setDecision] = useState<string | null>(null);
  const decide = (key: ApprovalDecision, label: string) => {
    setDecision(label);
    onDecide?.(key, reason.trim());
  };
  const diff = kind === "settings";
  return (
    <section className={t.card} aria-label="Approval">
      <div className={t.approval}>
        <p className={t.approvalTitle}>
          <Icon icon={editorIcons.problem} pixels={iconPixels("base")} />
          {agent} wants to {diff ? "change" : "run"} {content.title}
        </p>
        <dl className={t.facts}>
          <dt>Target</dt>
          <dd>{content.target}</dd>
          <dt>Input</dt>
          <dd>
            {diff
              ? (
                <pre className={t.pre} aria-label="Change">
                  {content.input.split("\n").map((line, index) => (
                    <span
                      key={index}
                      className={line.startsWith("+")
                        ? t.add
                        : line.startsWith("−")
                        ? t.del
                        : undefined}
                    >
                      {line + "\n"}
                    </span>
                  ))}
                </pre>
              )
              : <pre className={t.pre}>{content.input}</pre>}
          </dd>
          <dt>Effect</dt>
          <dd>{content.effect}</dd>
        </dl>
      </div>
      {denying
        ? (
          <div className={t.reasonRow}>
            <input
              className={t.reasonInput}
              aria-label="Reason for denying"
              placeholder={`Why not? ${agent} reads this (optional)`}
              value={reason}
              autoFocus={initialReason === ""}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button size="sm" onClick={() => setDenying(false)}>Back</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => decide("deny", "Denied")}
            >
              Deny
            </Button>
          </div>
        )
        : null}
      <footer className={t.approvalFoot}>
        <span className={t.cardNote}>
          {decision === null
            ? `${agent} is paused until you decide.`
            : `${decision}.`}
        </span>
        {denying ? null : (
          <>
            {kind === "tool"
              ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => decide("once", "Allowed once")}
                  >
                    Allow once
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      decide("session", "Allowed for this session")}
                  >
                    Allow for this session
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => decide("always", "Always allowed")}
                  >
                    Always allow
                  </Button>
                </>
              )
              : (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => decide("allow", "Allowed")}
                >
                  Allow
                </Button>
              )}
            <Button size="sm" onClick={() => setDenying(true)}>Deny</Button>
          </>
        )}
      </footer>
    </section>
  );
}

const OUTCOME: Record<
  ApprovalResultView["outcome"],
  { tone: "good" | "neutral" | "critical" | "warning"; label: string }
> = {
  received: { tone: "warning", label: "Allowed, running" },
  applied: { tone: "good", label: "Allowed and done" },
  denied: { tone: "critical", label: "Denied" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

/** 결정 뒤 대화에 남는 한 줄. 허락을 받은 것, 적용된 것, 거절, 일이 끝나 취소된 것을 구별한다. */
export function ApprovalResult({ result }: { result: ApprovalResultView }) {
  const mark = OUTCOME[result.outcome];
  return (
    <div className={t.result}>
      <StatusMark tone={mark.tone} label={mark.label} />
      <span className={t.resultTitle}>{result.title}</span>
      <span className={t.resultDetail}>{result.detail}</span>
    </div>
  );
}
