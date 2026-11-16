// What waits on the person, docked above the composer: a permission request with exactly the choices its source offers,
// the agent's questions one at a time (pick, write your own, or skip), and a request for a secret, a login or a sign-in,
// which the phone only describes: those values are typed on the computer.
import { t } from "@lophn/i18n";
import {
  AskCard,
  AskTitle,
  Button,
  Fact,
  QuestionCard,
  Text,
} from "@lophn/ui-native";
import { Check, KeyRound, LogIn, TriangleAlert, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { InputRequestView } from "../../../../protocol/lophn-agent/input-request.ts";
import type {
  ApprovalCardRequest,
  AskedGroup,
  QuestionAnswer,
} from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import {
  changeText,
  effectOf,
  targetOf,
  titleOf,
} from "../../../../shell/renderer/conversation/approval-card/subject-text.ts";
import type { Conversation } from "../../data/mod.ts";

type Choice = ApprovalCardRequest["choices"][number];

const CHOICE_LABEL = {
  once: "conversation.button.approval-allow-once",
  session: "conversation.button.approval-allow-session",
  always: "conversation.button.approval-allow-always",
  reject: "conversation.button.approval-deny",
} as const;

/** The request's facts as the desktop card lists them: the command, the changes, the setting change, or the tool and its effect. */
function factsOf(request: ApprovalCardRequest): { label: string; value: string; fit?: boolean }[] {
  const { subject } = request;
  const facts: { label: string; value: string; fit?: boolean }[] =
    subject.kind === "shell"
      ? [{ label: t("conversation.label.approval-command"), value: subject.command }]
      : subject.kind === "file_change"
        ? [
            {
              label: t("conversation.label.approval-changes"),
              value: subject.changes.map(changeText).join("\n"),
            },
          ]
        : subject.kind === "plan"
          ? [{ label: t("conversation.label.plan"), value: subject.plan }]
          : subject.kind === "setting"
            ? // core's lines as they are: the name and the whole path, one change per line.
              [{ label: t("conversation.label.approval-changes"), value: subject.lines.join("\n") }]
            : [
                { label: t("conversation.label.approval-target"), value: targetOf(subject) },
                { label: t("conversation.label.approval-effect"), value: effectOf(subject) ?? "" },
              ];
  if (request.choices.includes("always") && request.always_patterns.length > 0) {
    facts.push({
      label: t("conversation.label.approval-always"),
      value: request.always_patterns.join("\n"),
      fit: true,
    });
  }
  return facts;
}

/**
 * A permission request. The buttons are the source's `choices`: the other answers side by side, then Allow once, the most
 * common, full width nearest the thumb.
 */
function Approval({
  agent,
  request,
  decide,
}: {
  agent: string;
  request: ApprovalCardRequest;
  decide: (choice: Choice) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const press = async (choice: Choice) => {
    setBusy(true);
    setFailed(false);
    const done = await decide(choice);
    setBusy(false);
    setFailed(!done);
  };
  // The desktop card draws the choices right to left so Allow once ends nearest the hand; here it gets its own row.
  const others = [...request.choices].reverse().filter((choice) => choice !== "once");
  return (
    <AskCard>
      <AskTitle icon={TriangleAlert}>{titleOf(request.subject, agent)}</AskTitle>
      {factsOf(request).map((fact) => (
        <Fact key={fact.label} {...fact} />
      ))}
      {failed && (
        <Text variant="note" tone="critical" style={{ marginTop: 10 }}>
          {t("conversation.notice.decide-failed")}
        </Text>
      )}
      {others.length > 0 && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          {others.map((choice) => (
            <Button key={choice} block icon={choice === "reject" ? X : Check} disabled={busy} onPress={() => void press(choice)}>
              {t(CHOICE_LABEL[choice])}
            </Button>
          ))}
        </View>
      )}
      {request.choices.includes("once") && (
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          <Button block variant="primary" icon={Check} disabled={busy} onPress={() => void press("once")}>
            {t(CHOICE_LABEL.once)}
          </Button>
        </View>
      )}
    </AskCard>
  );
}

/**
 * The agent's questions, one at a time. Each is answered by picking an option (or several, when the question allows),
 * writing one's own, or skipped with the
 * arrow; the last one sends them all. Sending a plain message instead also ends them (the placeholder says so).
 */
function Questions({
  agent,
  group,
  answer,
}: {
  agent: string;
  group: AskedGroup & { questions: NonNullable<AskedGroup["questions"]> };
  answer: (answers: readonly QuestionAnswer[]) => Promise<boolean>;
}) {
  const { questions } = group;
  const [at, setAt] = useState(0);
  const [answers, setAnswers] = useState<readonly (QuestionAnswer | null)[]>(() => questions.map(() => null));
  const [failed, setFailed] = useState(false);
  const question = questions[at]!;
  const last = at === questions.length - 1;

  const next = async (picked: QuestionAnswer) => {
    const all = answers.map((one, index) => (index === at ? picked : one));
    setAnswers(all);
    if (!last) {
      setAt(at + 1);
      return;
    }
    setFailed(false);
    const done = await answer(
      all.map(
        (one, index) =>
          one ?? { question: questions[index]!.question, status: "unanswered", answer: [] },
      ),
    );
    setFailed(!done);
  };
  const chosen = answers[at];
  const labels = question.options.map((option) => option.label);
  // An answer is the labels picked, in option order, then the person's own words.
  const initial =
    chosen === null || chosen === undefined || chosen.status !== "answered"
      ? undefined
      : {
          choices: chosen.answer.flatMap((one) => {
            const index = labels.indexOf(one);
            return index === -1 ? [] : [index];
          }),
          text: chosen.answer.find((one) => !labels.includes(one)) ?? null,
        };
  return (
    <View>
      <QuestionCard
        key={question.id}
        title={t("conversation.title.question-asking", { agent })}
        question={question.question}
        options={question.options.map((option) => ({
          label: option.label,
          ...(option.description === "" ? {} : { sub: option.description }),
        }))}
        at={questions.length > 1 ? at + 1 : undefined}
        of={questions.length > 1 ? questions.length : undefined}
        onPrev={at > 0 ? () => setAt(at - 1) : undefined}
        onSkip={() =>
          void next({ question: question.question, status: "unanswered", answer: [] })
        }
        multi={question.multiSelect}
        initial={initial}
        nextLabel={last ? t("conversation.button.question-submit") : t("conversation.button.question-next")}
        onNext={(picked) =>
          void next({
            question: question.question,
            status: "answered",
            answer: [
              ...picked.choices.map((index) => labels[index]!),
              ...(picked.text === null ? [] : [picked.text]),
            ],
          })
        }
      />
      {failed && (
        <Text variant="note" tone="critical" style={{ marginTop: 6, marginHorizontal: 16 }}>
          {t("conversation.notice.answer-failed")}
        </Text>
      )}
    </View>
  );
}

// The desktop card's title (input-request-card.tsx, a DOM file the phone cannot load).
function inputTitle(view: InputRequestView, agent: string): string {
  if (view.kind === "login") return t(`conversation.title.input-request-${view.mode}`, { agent });
  if (view.kind === "sign_in") {
    return t("conversation.title.input-request-sign-in", { agent, subject: view.subject });
  }
  return t(
    "app" in view.slot
      ? "conversation.title.input-request-app"
      : "mcp" in view.slot
        ? "conversation.title.input-request-mcp"
        : "conversation.title.input-request-provider",
    { agent, subject: view.subject },
  );
}

/** A secret, a login or a sign-in: what is asked and where it goes, typed on the computer, with Cancel. */
function InputRequest({
  agent,
  computer,
  session,
  toolCall,
  conversation,
}: {
  agent: string;
  computer: string;
  session: string;
  toolCall: string;
  conversation: Conversation;
}) {
  const { source } = conversation;
  const [view, setView] = useState<InputRequestView | null>(null);
  useEffect(() => {
    let live = true;
    void source.readInputRequest?.({ session, toolCall }).then((result) => {
      if (live && result.ok) setView(result.value);
    });
    return () => {
      live = false;
    };
  }, [source, session, toolCall]);
  if (view === null) return null;
  const fact =
    view.kind === "login"
      ? { label: t("conversation.label.input-request-origin"), value: view.origin }
      : view.kind === "sign_in"
        ? { label: t("conversation.label.input-request-sign-in-at"), value: view.destinations.join("\n") || view.subject }
        : {
            label: t("conversation.label.input-request-secret"),
            value: view.destinations.length === 0 ? view.name : `${view.name} → ${view.destinations.join(", ")}`,
          };
  return (
    <AskCard>
      <AskTitle icon={view.kind === "sign_in" ? LogIn : KeyRound}>{inputTitle(view, agent)}</AskTitle>
      <Fact label={fact.label} value={fact.value} />
      <Text variant="note" tone="muted" style={{ marginTop: 10 }}>
        {t(view.kind === "sign_in" ? "mobile.session.notice.sign-in-on-computer" : "mobile.session.notice.secret-on-computer", {
          computer,
        })}
      </Text>
      {source.cancelInputRequest !== undefined && (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
          <Button icon={X} onPress={() => void source.cancelInputRequest?.({ session, toolCall })}>
            {t("mobile.kit.button.cancel-request")}
          </Button>
        </View>
      )}
    </AskCard>
  );
}

/** Whatever the conversation waits on the person for, or nothing. */
export function Pending({
  conversation,
  session,
  agent,
  computer,
}: {
  conversation: Conversation;
  session: string;
  agent: string;
  computer: string;
}) {
  const pending = conversation.thread?.pending;
  if (pending === undefined) return null;
  const { approval, questions } = pending;
  return (
    <>
      {approval !== null && (
        <Approval
          key={approval.id}
          agent={agent}
          request={approval}
          decide={async (choice) => (await conversation.decide(choice)).ok}
        />
      )}
      {questions !== null &&
        (questions.questions === null ? (
          <InputRequest
            key={questions.group}
            agent={agent}
            computer={computer}
            session={session}
            toolCall={questions.toolCall}
            conversation={conversation}
          />
        ) : (
          <Questions
            key={questions.group}
            agent={agent}
            group={{ ...questions, questions: questions.questions }}
            answer={async (answers) => (await conversation.answer(answers)).ok}
          />
        ))}
    </>
  );
}
