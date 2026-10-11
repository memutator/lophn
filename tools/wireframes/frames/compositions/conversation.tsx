// 대화 탭 본문. lophn과 Context Engineer 둘이고, 말 속의 context 이름과 객체 id는 링크라서 누르면 탭이 열린다.
import type { ReactNode } from "react";
import {
  conversationIcons,
  IconButton,
  Textarea,
} from "@lophn/design/components";
import { Button, Field } from "@lophn/ui-control";

import { Link } from "./link.tsx";
import { contextTab, experimentTab, findingTab } from "./phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";
import styles from "./compose.module.css";

type Open = (tab: TabSpec) => void;

interface Turn {
  readonly who: string;
  readonly mine?: boolean;
  readonly text: ReactNode;
}

/** Context Engineer가 묻는 질문. 답 단추를 누르면 답이 대화에 남고 작업이 이어진다. */
export const CE_QUESTION =
  "Some release notes list issues by number, others by title. Should I match titles to issues too?";
export const CE_ANSWERS: readonly string[] = [
  "Yes, match titles",
  "Numbers only",
];

function lophnTurns(open: Open): readonly Turn[] {
  const finding = (id: string) => (
    <Link onClick={() => open(findingTab(id))}>{id}</Link>
  );
  return [
    { who: "You", mine: true, text: "Which findings are about C-049?" },
    {
      who: "lophn",
      text: (
        <>
          Three: {finding("F-009")}, {finding("F-010")} and{" "}
          {finding("F-011")}. F-009 and F-010 are improvements, F-011 is a
          regression on query-recipe-gap.
        </>
      ),
    },
    {
      who: "You",
      mine: true,
      text: "Open the regression and compare it with exp-008.",
    },
    {
      who: "lophn",
      text: (
        <>
          Opened {finding("F-011")} next to{" "}
          <Link onClick={() => open(experimentTab("exp-008"))}>exp-008</Link>.
          The regression shows up only on scenarios that need a recipe lookup.
        </>
      ),
    },
    { who: "You", mine: true, text: "Which context are these findings in?" },
    {
      who: "lophn",
      text: (
        <>
          They are in the{" "}
          <Link onClick={() => open(contextTab("eval"))}>eval</Link>{" "}
          context. Two of its documents don't match what it expects yet; see its
          {" "}
          <Link onClick={() => open(contextTab("eval", "violations"))}>
            Violations
          </Link>.
        </>
      ),
    },
  ];
}

const NEW_CONTEXT_TURNS: readonly Turn[] = [
  {
    who: "Context Engineer",
    text:
      "What should the new context help with? Tell me which folders or files to look at, and what you want to find.",
  },
];

function engineerTurns(
  open: Open,
  answer: string | null,
  onAnswer: (answer: string) => void,
): readonly Turn[] {
  const turns: Turn[] = [
    {
      who: "Context Engineer",
      text: (
        <>
          I read the 3 places you picked for{" "}
          <Link onClick={() => open(contextTab("release-notes"))}>
            release-notes
          </Link>: 24 documents. Releases are numbered, issues have a page each,
          and CHANGELOG.md lists entries per version.
        </>
      ),
    },
    {
      who: "Context Engineer",
      text: (
        <>
          <span>{CE_QUESTION}</span>
          {answer === null
            ? (
              <span className={styles.choices}>
                {CE_ANSWERS.map((label, index) => (
                  <Button
                    key={label}
                    variant={index === 0 ? "primary" : "secondary"}
                    onClick={() => onAnswer(label)}
                  >
                    {label}
                  </Button>
                ))}
                <span className={styles.waiting}>Waiting for your answer</span>
              </span>
            )
            : null}
        </>
      ),
    },
  ];
  if (answer !== null) {
    turns.push(
      { who: "You", mine: true, text: answer },
      {
        who: "Context Engineer",
        text: answer === CE_ANSWERS[0]
          ? "Got it. I'll match titles to issues too and go on with the searches."
          : "Got it. Only issue numbers count. I'll go on with the searches.",
      },
    );
  }
  return turns;
}

/** 대화 탭. `with`가 Context Engineer면 질문과 답 단추가 나온다. */
export function Conversation(
  { who, fresh = false, open, answer = null, onAnswer = () => {} }: {
    who: "lophn" | "Context Engineer";
    /** 새 context를 시작하는 대화. Context Engineer의 첫 질문만 있다. */
    fresh?: boolean;
    open: Open;
    answer?: string | null;
    onAnswer?: (answer: string) => void;
  },
) {
  const turns = who === "lophn"
    ? lophnTurns(open)
    : fresh
    ? NEW_CONTEXT_TURNS
    : engineerTurns(open, answer, onAnswer);
  return (
    <div className={styles.chat}>
      <div className={styles.turns}>
        {turns.map((turn, index) => (
          <div
            key={index}
            className={`${styles.turn} ${turn.mine ? styles.mine : ""}`}
          >
            <span className={styles.who}>{turn.who}</span>
            <p className={styles.said}>{turn.text}</p>
          </div>
        ))}
      </div>
      <div className={styles.composer}>
        <Field label="Message">
          <Textarea rows={2} placeholder={`Message ${who}`} />
        </Field>
        <IconButton
          icon={conversationIcons.send}
          label="Send"
          variant="secondary"
        />
      </div>
    </div>
  );
}
