// What waits on the person, docked above the composer: a permission request with exactly the choices its source offers,
// the agent's questions one at a time (pick, write your own, or skip), and a request for a secret, a login or a sign-in.
// A secret is typed here and a provider sign-in by code is done here; a site login and the other sign-ins are done on the
// computer.
import { t } from "@lophn/i18n";
import {
  AskCard,
  AskTitle,
  Button,
  Fact,
  QuestionCard,
  StatusMark,
  Text,
} from "@lophn/ui-native";
import { Check, ExternalLink, KeyRound, LogIn, TriangleAlert, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import type {
  InputRequestView,
  SecretRequestView,
  SignInRequestView,
} from "../../../../protocol/lophn-agent/input-request.ts";
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
import { inputRequestTitle } from "../../../../shell/renderer/conversation/input-request-card/title.ts";
import { type Conversation, type SignInStarted, useSetup } from "../../data/mod.ts";
import { SignInCode, SignInHandoff, signInFailure, useSecretField } from "../settings/setup-parts.tsx";
import { approvalFactsOf, approvalTitleOf } from "./permissions-model.ts";
import { DenySheet } from "./sheets.tsx";

type Choice = ApprovalCardRequest["choices"][number];

type MobileApprovalRequest = ApprovalCardRequest & {
  readonly reason?: string | null;
  readonly outside_rewind?: boolean;
};

const CHOICE_LABEL = {
  once: "conversation.button.approval-allow-once",
  session: "conversation.button.approval-allow-session",
  always: "conversation.button.approval-allow-always",
  reject: "conversation.button.approval-deny",
} as const;

/** The request's facts as the desktop card lists them: command, files, local tools, settings, or tool and effect. */
function factsOf(request: MobileApprovalRequest): { label: string; value: string; fit?: boolean }[] {
  return approvalFactsOf(request, { changeText, targetOf, effectOf });
}

/**
 * A permission request. The buttons follow the source's `choices` (including `session` when allowed): extra scopes and
 * Deny sit above Allow once, which stays full width nearest the thumb.
 */
function Approval({
  agent,
  request,
  decide,
}: {
  agent: string;
  request: MobileApprovalRequest;
  decide: (choice: Choice, reason?: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [denying, setDenying] = useState(false);
  const press = async (choice: Choice, reason?: string) => {
    setBusy(true);
    setFailed(false);
    const done = await decide(choice, reason);
    setBusy(false);
    setFailed(!done);
  };
  const scopes = (["session", "always"] as const).filter((choice) => request.choices.includes(choice));
  const hasDeny = request.choices.includes("reject");
  const hasOnce = request.choices.includes("once");
  const reason = request.reason != null && request.reason.trim() !== "" ? request.reason : null;
  const outsideRewind = request.outside_rewind === true;
  const renderChoice = (choice: Choice) => (
    <Button
      key={choice}
      block
      icon={choice === "reject" ? X : Check}
      disabled={busy}
      onPress={() => (choice === "reject" ? setDenying(true) : void press(choice))}
    >
      {t(CHOICE_LABEL[choice])}
    </Button>
  );
  return (
    <AskCard>
      <AskTitle icon={TriangleAlert}>{approvalTitleOf(request.subject, agent, titleOf)}</AskTitle>
      {outsideRewind && (
        <View style={{ marginTop: 8 }}>
          <StatusMark tone="warning" label="Outside rewind" />
        </View>
      )}
      {reason !== null && (
        <Text variant="note" tone="secondary" style={{ marginTop: 8 }}>
          {reason}
        </Text>
      )}
      {factsOf(request).map((fact) => (
        <Fact key={fact.label} {...fact} />
      ))}
      {failed && (
        <Text variant="note" tone="critical" style={{ marginTop: 10 }}>
          {t("conversation.notice.decide-failed")}
        </Text>
      )}
      {scopes.length === 2 ? (
        <>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
            {scopes.map(renderChoice)}
          </View>
          {hasDeny && (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              {renderChoice("reject")}
            </View>
          )}
        </>
      ) : (
        (hasDeny || scopes.length > 0) && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
            {hasDeny && renderChoice("reject")}
            {scopes.map(renderChoice)}
          </View>
        )
      )}
      {hasOnce && (
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          <Button block variant="primary" icon={Check} disabled={busy} onPress={() => void press("once")}>
            {t(CHOICE_LABEL.once)}
          </Button>
        </View>
      )}
      <DenySheet
        open={denying}
        agent={agent}
        busy={busy}
        onClose={() => setDenying(false)}
        onDeny={(reasonText) => {
          setDenying(false);
          void press("reject", reasonText);
        }}
      />
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

type RequestTarget = { readonly session: string; readonly toolCall: string };

/** Cancel the request: ends it without a value, and the agent hears so. */
function CancelRequest({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Button block icon={X} disabled={disabled} onPress={onPress}>
      {t("mobile.kit.button.cancel-request")}
    </Button>
  );
}

/** Why the last Save or Sign in did not go through, over the buttons. */
function Failure({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <Text variant="note" tone="critical" style={{ marginTop: 10 }}>
      {text}
    </Text>
  );
}

function secretFailure(code: string, computer: string): string {
  if (code === "forbidden") return t("mobile.setup.notice.not-allowed", { computer });
  return t(code === "invalid_input" ? "secret-input.error.invalid" : "secret-input.error.unavailable");
}

/** A secret typed on the phone. Save sends it to the computer, which stores it and ends the request. */
function SecretRequest({
  agent,
  computer,
  target,
  view,
  cancel,
}: {
  agent: string;
  computer: string;
  target: RequestTarget;
  view: SecretRequestView;
  cancel: (() => void) | undefined;
}) {
  const setup = useSetup();
  const secret = useSecretField({ label: view.name });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setFailed(null);
    const sent = await setup.answerSecret(target, secret.take());
    setBusy(false);
    if (!sent.ok) setFailed(secretFailure(sent.code, computer));
  };
  return (
    <AskCard>
      <AskTitle icon={KeyRound}>{inputRequestTitle(view, agent)}</AskTitle>
      <Fact
        label={t("conversation.label.input-request-destinations")}
        value={
          view.destinations.length === 0
            ? t("conversation.notice.input-request-no-destination")
            : view.destinations.join("\n")
        }
      />
      <View style={{ marginTop: 10, gap: 4 }}>
        <Text variant="caption" tone="muted">
          {view.name}
        </Text>
        {secret.field}
      </View>
      <Text variant="note" tone="muted" style={{ marginTop: 8 }}>
        {t(view.configured ? "conversation.notice.input-request-replaces" : "secret-input.help.value")}
      </Text>
      <Failure text={failed} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {cancel !== undefined && <CancelRequest disabled={busy} onPress={cancel} />}
        <Button block variant="primary" icon={Check} disabled={busy || !secret.filled} onPress={() => void save()}>
          {t("secret-input.button.save")}
        </Button>
      </View>
    </AskCard>
  );
}

/**
 * A provider sign-in that ends in any browser (device code). Sign in starts it on the computer and shows the code; the
 * person opens the page. The computer waits for the provider and ends the request when it connects.
 */
function CodeSignInRequest({
  agent,
  computer,
  target,
  view,
  cancel,
}: {
  agent: string;
  computer: string;
  target: RequestTarget;
  view: SignInRequestView;
  cancel: (() => void) | undefined;
}) {
  const setup = useSetup();
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<SignInStarted | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (started === null) return;
    return setup.followSignIn(started.login, (outcome) => {
      setStarted(null);
      if (typeof outcome === "object") setFailed(signInFailure(outcome.failed));
    });
  }, [setup, started]);
  const start = async () => {
    setBusy(true);
    setFailed(null);
    const begun = await setup.startSignIn({ request: { session: target.session, tool_call: target.toolCall } });
    setBusy(false);
    if (begun.ok) setStarted(begun.value);
    else setFailed(begun.code === "forbidden" ? t("mobile.setup.notice.not-allowed", { computer }) : signInFailure(begun.code));
  };
  const stop = async () => {
    if (started !== null) await setup.cancelSignIn(started);
    cancel?.();
  };
  return (
    <AskCard>
      <AskTitle icon={LogIn}>{inputRequestTitle(view, agent)}</AskTitle>
      <Fact
        label={t("conversation.label.input-request-sign-in-at")}
        value={view.destinations.join("\n") || view.subject}
      />
      {started === null ? (
        <Text variant="note" tone="muted" style={{ marginTop: 10 }}>
          {t("conversation.notice.input-request-sign-in-help", { agent })}
        </Text>
      ) : started.callbackMode === "remote_handoff" ? (
        <SignInHandoff onSubmit={(url) => setup.deliverSignInCallback(started, url)} />
      ) : (
        <SignInCode code={started.code} />
      )}
      <Failure text={failed} />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        {cancel !== undefined && <CancelRequest disabled={busy} onPress={() => void stop()} />}
        {started === null ? (
          <Button block variant="primary" icon={LogIn} disabled={busy} onPress={() => void start()}>
            {t("conversation.button.input-request-sign-in")}
          </Button>
        ) : (
          <Button
            block
            variant={started.callbackMode === "remote_handoff" ? undefined : "primary"}
            icon={ExternalLink}
            onPress={() => void Linking.openURL(started.url)}
          >
            {t("mobile.setup.button.open-page")}
          </Button>
        )}
      </View>
    </AskCard>
  );
}

/** A provider sign-in the phone can finish (device code or remote callback handoff). */
function byCode(view: SignInRequestView): boolean {
  if (view.target.type !== "provider") return false;
  return view.target.login.definition.oauth !== null;
}

/**
 * What an agent asks the person to enter. A secret is typed here, and a provider sign-in by code is done here; a site login
 * and a sign-in that must come back to the computer's browser (or an app's, an MCP server's) are only described, with Cancel.
 */
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
  const cancel =
    source.cancelInputRequest === undefined
      ? undefined
      : () => void source.cancelInputRequest?.({ session, toolCall });
  const target = { session, toolCall };
  if (view.kind === "secret") {
    return <SecretRequest agent={agent} computer={computer} target={target} view={view} cancel={cancel} />;
  }
  if (view.kind === "sign_in" && byCode(view)) {
    return <CodeSignInRequest agent={agent} computer={computer} target={target} view={view} cancel={cancel} />;
  }
  const fact =
    view.kind === "login"
      ? { label: t("conversation.label.input-request-origin"), value: view.origin }
      : { label: t("conversation.label.input-request-sign-in-at"), value: view.destinations.join("\n") || view.subject };
  return (
    <AskCard>
      <AskTitle icon={view.kind === "sign_in" ? LogIn : KeyRound}>{inputRequestTitle(view, agent)}</AskTitle>
      <Fact label={fact.label} value={fact.value} />
      <Text variant="note" tone="muted" style={{ marginTop: 10 }}>
        {t(view.kind === "sign_in" ? "mobile.session.notice.sign-in-on-computer" : "mobile.session.notice.login-on-computer", {
          computer,
        })}
      </Text>
      {cancel !== undefined && (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
          <Button icon={X} onPress={cancel}>
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
          decide={async (choice, reason) => (await conversation.decide(choice, reason)).ok}
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
