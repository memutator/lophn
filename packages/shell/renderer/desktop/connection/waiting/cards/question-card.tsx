// 사람에게 묻는 `ask`의 질문. 질문 내용은 event에 없어서 읽는 route로 가져온다. 질문 하나에 선택지만 고르면
// 되는 경우는 선택지를 눌러 바로 답하고, 그 밖에는 session에서 답한다.
import { useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";
import type { AskQuestion } from "../../../../../../protocol/lophn-agent/ask-tool.ts";
import type { CoreSource } from "../../connection.ts";
import type { WaitingEntry } from "../../events/waiting-store.ts";
import { answerQuestion, readQuestions } from "../decide.ts";
import type { CardView } from "../model.ts";
import styles from "../waiting.module.css";
import { Head } from "./head.tsx";

type Question = WaitingEntry & { kind: "question" };

export function QuestionCard(
  { entry, view, core, onOpenSession }: {
    entry: Question;
    view: CardView;
    core: CoreSource;
    onOpenSession: (session: string) => void;
  },
) {
  // undefined는 읽는 중, null은 읽지 못함(풀렸거나 끊김)이다.
  const [questions, setQuestions] = useState<
    readonly AskQuestion[] | null | undefined
  >(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void readQuestions(core, entry).then((read) => {
      if (live) setQuestions(read);
    });
    return () => {
      live = false;
    };
  }, [core, entry.id]);

  const only = questions?.length === 1 && !questions[0].multiSelect
    ? questions[0]
    : null;
  const description = only !== null
    ? only.question
    : questions === undefined
    ? view.description
    : questions === null
    ? t("waiting.notice.question-in-session")
    : t("waiting.notice.question-multiple", { count: questions.length });

  async function answer(question: AskQuestion, label: string) {
    setBusy(true);
    setFailed(false);
    const result = await answerQuestion(core, entry, [{
      question: question.question,
      status: "answered",
      answer: [label],
    }]);
    setBusy(false);
    setFailed(!result.ok);
  }

  return (
    <article className={styles.request} data-kind="question">
      <Head view={{ ...view, description }} agent={entry.agent} />
      {failed
        ? <p className={styles.error}>{t("waiting.notice.decide-failed")}</p>
        : null}
      <div className={styles.actions}>
        <Button
          size="sm"
          variant="ghost"
          disabled={entry.session === null}
          onClick={() => {
            if (entry.session !== null) onOpenSession(entry.session);
          }}
        >
          {t("waiting.button.open-session")}
        </Button>
        {only !== null
          ? [...only.options].reverse().map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant={option === only.options[0] ? "primary" : "secondary"}
              disabled={busy}
              onClick={() => answer(only, option.label)}
            >
              {option.label}
            </Button>
          ))
          : null}
      </div>
    </article>
  );
}
