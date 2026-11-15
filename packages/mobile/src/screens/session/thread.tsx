// The conversation's rows, laid out the way the desktop thread does (conversation/agent-thread.tsx): my messages are
// bubbles on the right, a received message stands on its own, and everything else (the agent's text, tool lines, edit
// cards, calls, decisions, the turn's end, errors) gathers into one agent turn while no message of mine comes between.
// Every row is a memo component keyed by the desktop layout's cached entries, so a long thread does not redraw while
// text streams into its last turn.
import { type MessageKey, t } from "@lophn/i18n";
import {
  Act,
  AgentTurn,
  Button,
  EditCard,
  ErrorLine,
  FileChip,
  Markdown,
  Meta,
  Pre,
  StatusMark,
  Text,
  Thumb,
  UserBubble,
} from "@lophn/ui-native";
import * as Clipboard from "expo-clipboard";
import {
  Bot,
  Info,
  LayoutGrid,
  ListChecks,
  Pencil,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  Undo2,
} from "lucide-react-native";
import { createContext, memo, type ReactNode, useContext, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { AcpWriting } from "../../../../protocol/acp/mod.ts";
import { TURN_FAILED_REASONS } from "../../../../protocol/lophn-agent/turn-values.ts";
import type { ToolCallView } from "../../../../shell/renderer/conversation/activity/model.ts";
import type {
  AgentTabSource,
  ApprovalResultView,
  BodyPart,
  QueuedView,
  ThreadEntry,
  ThreadMessage,
} from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import { messageTime, textOfParts } from "../../../../shell/renderer/conversation/agent-view-model.ts";
import { targetOf } from "../../../../shell/renderer/conversation/approval-card/subject-text.ts";
import type { Outgoing } from "../../../../shell/renderer/conversation/delivery-state.ts";
import { closeOpenFence } from "../../../../shell/renderer/conversation/live-text.ts";
import { partsOfContent } from "../../../../shell/renderer/conversation/thread-layout.ts";
import { useNav } from "../../app/nav.ts";
import { useInbox } from "../../data/mod.ts";
import { Face, type Profile } from "../../parts/mod.ts";
import { duration, elapsedText, Line, useTick } from "./parts.tsx";

// ---- rows

export type ThreadRow =
  | { readonly kind: "user"; readonly id: string; readonly message: ThreadMessage }
  | { readonly kind: "received"; readonly id: string; readonly message: ThreadMessage }
  | {
      readonly kind: "turn";
      readonly id: string;
      readonly entries: readonly ThreadEntry[];
      readonly live: AcpWriting | null;
    }
  /** An entry outside any agent turn: a turn that ended before the agent said anything, a notice outside a turn, my shell command, a rewound range. */
  | { readonly kind: "entry"; readonly id: string; readonly entry: ThreadEntry }
  | { readonly kind: "outgoing"; readonly id: string; readonly outgoing: Outgoing }
  | { readonly kind: "queued"; readonly id: string; readonly queued: QueuedView };

/** Entries in order to rows. `nested` is a rewound range: read only, without edit cards (those edits went back). */
export function rowsOf(
  entries: readonly ThreadEntry[],
  live: AcpWriting | null,
  nested = false,
): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let group: ThreadEntry[] | null = null;
  // A turn's key is the separator before it, which stays put when its first entry is saved or the snapshot is read again.
  let after = "start";
  const flush = () => {
    if (group !== null) rows.push({ kind: "turn", id: `turn-${after}`, entries: group, live: null });
    group = null;
  };
  const separate = (row: ThreadRow) => {
    flush();
    rows.push(row);
    after = row.id;
  };
  for (const entry of entries) {
    switch (entry.kind) {
      case "message":
        if (entry.actor === "agent") (group ??= []).push(entry);
        else separate({ kind: entry.actor === "user" ? "user" : "received", id: entry.id, message: entry });
        break;
      case "edit":
        if (!nested) (group ??= []).push(entry);
        break;
      case "turn-end":
        if (group === null) rows.push({ kind: "entry", id: entry.id, entry });
        else group.push(entry);
        break;
      case "info":
      case "command-output":
        if (entry.turn === null) separate({ kind: "entry", id: entry.id, entry });
        else (group ??= []).push(entry);
        break;
      case "shell":
      case "hidden":
        separate({ kind: "entry", id: entry.id, entry });
        break;
      default:
        (group ??= []).push(entry);
    }
  }
  const tail = group as ThreadEntry[] | null;
  if (live !== null && (live.text !== "" || live.reasoning !== "")) {
    rows.push({ kind: "turn", id: `turn-${after}`, entries: tail ?? [], live });
  } else if (tail !== null) flush();
  return rows;
}

// ---- what rows reach

export interface ThreadActions {
  readonly session: string;
  readonly source: AgentTabSource;
  readonly agent: { readonly name: string; readonly profile: Profile };
  readonly readOnly: boolean;
  readonly canRetry: boolean;
  /** App names by id, for app cards and release lines. */
  readonly apps: ReadonlyMap<string, string>;
  openSteps(calls: readonly ToolCallView[], output?: string | null): void;
  openThought(text: string): void;
  openDiff(entry: string): void;
  openQueued(queued: QueuedView): void;
  resend(outgoing: Outgoing): void;
}

export const ThreadContext = createContext<ThreadActions | null>(null);

function useActions(): ThreadActions {
  const found = useContext(ThreadContext);
  if (found === null) throw new Error("ThreadContext is missing");
  return found;
}

// ---- one row

function sameRow(a: { row: ThreadRow }, b: { row: ThreadRow }): boolean {
  const x = a.row;
  const y = b.row;
  if (x.kind !== y.kind || x.id !== y.id) return false;
  if (x.kind === "turn" && y.kind === "turn") {
    return (
      x.live === y.live &&
      x.entries.length === y.entries.length &&
      x.entries.every((entry, at) => entry === y.entries[at])
    );
  }
  return payloadOf(x) === payloadOf(y);
}

function payloadOf(row: ThreadRow): unknown {
  switch (row.kind) {
    case "user":
    case "received":
      return row.message;
    case "turn":
      return row.entries;
    case "entry":
      return row.entry;
    case "outgoing":
      return row.outgoing;
    case "queued":
      return row.queued;
  }
}

export const Row = memo(function Row({ row }: { row: ThreadRow }) {
  switch (row.kind) {
    case "user":
      return <UserMessage message={row.message} />;
    case "received":
      return <ReceivedMessage message={row.message} />;
    case "turn":
      return <Turn entries={row.entries} live={row.live} />;
    case "entry":
      return <LooseEntry entry={row.entry} />;
    case "outgoing":
      return <OutgoingMessage outgoing={row.outgoing} />;
    case "queued":
      return <QueuedMessage queued={row.queued} />;
  }
}, sameRow);

// ---- messages

function useImage(blob: string): string | null {
  const { session, source } = useActions();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void source.imageUrl(session, blob).then((found) => {
      if (live) setUrl(found);
    });
    return () => {
      live = false;
    };
  }, [session, source, blob]);
  return url;
}

function Picture({ blob }: { blob: string }) {
  const url = useImage(blob);
  return <Thumb source={url === null ? undefined : { uri: url }} />;
}

/** Pictures and files a message carries, as the composer shows them. */
function Attached({ parts }: { parts: readonly BodyPart[] }) {
  const shown = parts.filter(
    (part) => part.kind === "image" || part.kind === "resource_link" || part.kind === "resource",
  );
  if (shown.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
      {shown.map((part, at) =>
        part.kind === "image" ? (
          <Picture key={at} blob={part.blob} />
        ) : (
          <FileChip
            key={at}
            name={part.kind === "resource_link" ? part.name : (part.uri.split("/").pop() ?? part.uri)}
          />
        ),
      )}
    </View>
  );
}

function UserMessage({ message }: { message: ThreadMessage }) {
  const text = textOfParts(message.parts);
  const note =
    message.delivery === "steer"
      ? t("conversation.label.steer")
      : message.via !== undefined
        ? t("conversation.label.via", { app: message.via })
        : undefined;
  return (
    <View style={{ gap: 6 }}>
      <Attached parts={message.parts} />
      {text !== "" && (
        <UserBubble note={note} noteIcon={message.delivery === "steer" ? Pencil : undefined}>
          {text}
        </UserBubble>
      )}
    </View>
  );
}

function senderName(message: ThreadMessage): string {
  const sender = message.sender;
  if (sender === null) return t("conversation.label.sender-agent-other");
  switch (sender.kind) {
    case "agent":
      return sender.name ?? t("conversation.label.sender-agent-other");
    case "program":
      return sender.label ?? t("conversation.label.sender-program-unknown");
    case "app":
      return sender.name;
  }
}

/** A message another agent, a program or an app sent. It stands apart from the agent's turns with who sent it. */
function ReceivedMessage({ message }: { message: ThreadMessage }) {
  return (
    <View style={{ gap: 6 }}>
      <Line icon={Send}>{t("conversation.label.sender-sent-by", { sender: senderName(message) })}</Line>
      <Body parts={message.parts} />
    </View>
  );
}

function OutgoingMessage({ outgoing }: { outgoing: Outgoing }) {
  const { resend } = useActions();
  const text = textOfParts(partsOfContent(outgoing.content));
  const failed = outgoing.phase === "not_sent" || outgoing.phase === "unconfirmed";
  return (
    <View style={{ gap: 6, opacity: outgoing.phase === "sending" ? 0.6 : 1 }}>
      <UserBubble>{text}</UserBubble>
      {failed && (
        <View style={{ alignItems: "flex-end", gap: 6 }}>
          <Text variant="caption" tone="critical" align="right">
            {t(outgoing.phase === "not_sent" ? "conversation.notice.not-sent" : "conversation.notice.unconfirmed")}
          </Text>
          {outgoing.phase === "unconfirmed" && (
            <Button size="sm" icon={RefreshCw} onPress={() => resend(outgoing)}>
              {t("conversation.button.resend")}
            </Button>
          )}
        </View>
      )}
    </View>
  );
}

/** A message sent while the agent works, waiting for the next turn. Pressing it offers Send now and Remove. */
function QueuedMessage({ queued }: { queued: QueuedView }) {
  const { openQueued } = useActions();
  return (
    <Pressable accessibilityRole="button" style={{ opacity: 0.7 }} onPress={() => openQueued(queued)}>
      <UserBubble note={t("conversation.label.queued-messages")}>{queued.summary}</UserBubble>
    </Pressable>
  );
}

// ---- an agent turn

function Turn({ entries, live }: { entries: readonly ThreadEntry[]; live: AcpWriting | null }) {
  const { agent } = useActions();
  return (
    <AgentTurn face={<Face profile={agent.profile} size={20} />} name={agent.name}>
      {entries.map((entry) => (
        <TurnEntry key={entry.id} entry={entry} said={entries} />
      ))}
      {live !== null && <Live live={live} />}
    </AgentTurn>
  );
}

function Live({ live }: { live: AcpWriting }) {
  if (live.text === "") {
    return <Act>{t("conversation.label.thinking")}</Act>;
  }
  return <Markdown variant="chat" streaming source={closeOpenFence(live.text)} />;
}

/** The text of the turn's last message that has any, for the end line's copy button. */
function copyTextOf(entries: readonly ThreadEntry[]): string {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]!;
    if (entry.kind === "message") {
      const text = textOfParts(entry.parts);
      if (text !== "") return text;
    }
  }
  return "";
}

/** The agent's text with its reasoning line before it, and what it attached. */
function Body({ parts }: { parts: readonly BodyPart[] }) {
  const { openThought, apps } = useActions();
  const nodes: ReactNode[] = [];
  parts.forEach((part, at) => {
    switch (part.kind) {
      case "reasoning":
        nodes.push(
          <Act key={at} onPress={part.text === "" ? undefined : () => openThought(part.text)}>
            {part.durationMs === null
              ? t("conversation.label.thought")
              : t("conversation.label.thought-for", { duration: duration(part.durationMs) })}
          </Act>,
        );
        break;
      case "text":
        if (part.text !== "") nodes.push(<Markdown key={at} variant="chat" source={part.text} />);
        break;
      case "app_card":
        nodes.push(
          <Line key={at} icon={LayoutGrid}>
            {t("mobile.session.label.app-card", { app: apps.get(part.app) ?? part.app })}
          </Line>,
        );
        break;
      default:
        break;
    }
  });
  return (
    <>
      {nodes}
      <Attached parts={parts} />
    </>
  );
}

/** The folded line of a run of tool calls: one call's title and time, or the run counted by kind (the desktop's ToolLine). */
function toolLabel(calls: readonly ToolCallView[]): string {
  const first = calls[0]!;
  if (calls.length === 1) {
    const time = elapsedText(first.state === "running", first.startedAt, first.durationMs);
    const state = TOOL_STATE[first.state];
    return [first.title, time, state === undefined ? "" : t(state)].filter((part) => part !== "").join(" · ");
  }
  const count = (category: ToolCallView["category"]) =>
    calls.filter((call) => call.category === category).length;
  switch (first.category) {
    case "read":
    case "search":
    case "list": {
      const read = count("read");
      const searched = count("search");
      const listed = count("list");
      return [
        read > 0 ? t("conversation.label.tool-read", { count: read }) : "",
        searched > 0 ? t("conversation.label.tool-searched", { count: searched }) : "",
        listed > 0 ? t("conversation.label.tool-listed", { count: listed }) : "",
      ]
        .filter((part) => part !== "")
        .join(" · ");
    }
    case "command":
      return t("conversation.label.tool-ran", { count: calls.length });
    case "web":
      return t("conversation.label.tool-web", { count: calls.length });
    case "other":
      return t("conversation.label.tool-used", { count: calls.length, tool: first.tool });
  }
}

const TOOL_STATE: Partial<Record<ToolCallView["state"], MessageKey>> = {
  error: "conversation.label.tool-call-failed",
  denied: "conversation.label.tool-call-denied",
  cancelled: "conversation.label.tool-call-cancelled",
};

function Tools({ calls }: { calls: readonly ToolCallView[] }) {
  const { openSteps } = useActions();
  useTick(calls.length === 1 && calls[0]!.state === "running");
  return <Act onPress={() => openSteps(calls)}>{toolLabel(calls)}</Act>;
}

function Subagent({ entry }: { entry: Extract<ThreadEntry, { kind: "subagent" }> }) {
  const running = entry.state === "running";
  useTick(running);
  const time = elapsedText(running, entry.startedAt, entry.durationMs);
  return (
    <Line
      icon={Bot}
      under={running ? (entry.last ?? undefined) : undefined}
      end={
        running ? (
          <Text variant="caption" tone="muted">
            {time === "" ? t("conversation.label.subagent-running") : time}
          </Text>
        ) : entry.state === "done" ? (
          time === "" ? undefined : (
            <Text variant="caption" tone="muted">
              {time}
            </Text>
          )
        ) : (
          <StatusMark
            tone={entry.state === "failed" ? "critical" : "neutral"}
            label={t(entry.state === "failed" ? "conversation.label.tool-call-failed" : "conversation.label.tool-call-cancelled")}
          />
        )
      }
    >
      {t("mobile.session.label.subagent", { agent: entry.agent, description: entry.description })}
    </Line>
  );
}

const CALL_TITLE = {
  none: "conversation.title.call-handoff",
  result: "conversation.title.call-asked",
  conversation: "conversation.title.call-working-with",
} as const;

function Call({ entry }: { entry: Extract<ThreadEntry, { kind: "call" }> }) {
  const { call } = entry;
  const failed = call.status?.state === "failed" || (call.status === null && call.toolState !== "running" && call.toolState !== "ok");
  return (
    <Line
      icon={Send}
      under={call.task}
      end={failed ? <StatusMark tone="critical" label={t("conversation.label.call-failed")} /> : undefined}
    >
      {t(CALL_TITLE[call.reply], { to: call.to })}
    </Line>
  );
}

const RESULT_TONE = { allowed: "good", denied: "critical", cancelled: "neutral" } as const;

function resultLabel(result: ApprovalResultView): string {
  if (result.subject.kind === "plan" && result.outcome !== "cancelled") {
    const picked = result.subject.modes.find((mode) => mode.id === result.mode);
    if (result.outcome === "allowed" && picked !== undefined) {
      return t("conversation.label.plan-approved-mode", { mode: picked.label });
    }
    return t(result.outcome === "allowed" ? "conversation.label.plan-approved" : "conversation.label.plan-not-approved");
  }
  return t(
    result.outcome === "allowed"
      ? "conversation.label.approval-allowed"
      : result.outcome === "denied"
        ? "conversation.label.approval-denied"
        : "conversation.label.approval-cancelled",
  );
}

const SCOPE = {
  once: "conversation.label.approval-scope-once",
  session: "conversation.label.approval-scope-session",
  always: "conversation.label.approval-scope-always",
} as const;

/** The line a decision leaves: allowed, denied, or cancelled because the work ended first (the desktop's ApprovalResult). */
function Decision({ result }: { result: ApprovalResultView }) {
  const detail = [
    result.choice === null ? null : t(SCOPE[result.choice]),
    result.reason === null ? null : t("conversation.label.approval-reason-given", { reason: result.reason }),
    result.outcome === "cancelled" ? t("conversation.label.approval-cancelled-detail") : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const target = targetOf(result.subject);
  return (
    <Line
      icon={ShieldCheck}
      under={detail}
      end={<StatusMark tone={RESULT_TONE[result.outcome]} label={resultLabel(result)} />}
    >
      {target === "" ? (
        <Text variant="detail" tone="muted">
          {resultLabel(result)}
        </Text>
      ) : (
        <Text variant="detail" tone="muted" mono numberOfLines={2}>
          {target}
        </Text>
      )}
    </Line>
  );
}

function Questions({ entry }: { entry: Extract<ThreadEntry, { kind: "questions" }> }) {
  const head =
    entry.outcome === "submitted"
      ? t("conversation.label.questions-answered", { count: entry.lines.length })
      : entry.outcome === "cancelled"
        ? t("conversation.label.question-cancelled")
        : entry.outcome === "parent_reply"
          ? t("conversation.label.question-answered-by-parent")
          : t("conversation.label.questions-ended-by-message");
  const under =
    entry.outcome === "parent_reply"
      ? (entry.reply ?? "")
      : entry.lines
          .map(
            (line) =>
              `${line.header}: ${
                line.answer ??
                t(
                  entry.outcome === "submitted"
                    ? "conversation.label.question-answered-elsewhere"
                    : "conversation.label.question-no-answer",
                )
              }`,
          )
          .join("\n");
  return (
    <Line icon={ListChecks} under={under}>
      {head}
    </Line>
  );
}

type FailedReason = (typeof TURN_FAILED_REASONS)[number];

// Same table as the desktop's provider-error.tsx, which the phone cannot load (DOM).
const FAILED_TEXT = {
  model_error: "conversation.error.turn-model-error",
  tool_error: "conversation.error.turn-tool-error",
  context_limit: "conversation.error.turn-context-limit",
  model_attempt_limit: "conversation.error.turn-model-attempt-limit",
  stall_limit: "conversation.error.turn-stall-limit",
  active_limit: "conversation.error.turn-active-limit",
  repeated_tool_failure: "conversation.error.turn-repeated-tool-failure",
  effect_unknown: "conversation.error.turn-effect-unknown",
  clock_uncertain: "conversation.error.turn-clock-uncertain",
  configuration_unavailable: "conversation.error.turn-configuration-unavailable",
  model_required: "conversation.error.turn-model-required",
  target_unavailable: "conversation.error.turn-target-unavailable",
  no_answer: "conversation.error.turn-no-answer",
  internal: "conversation.error.turn-internal",
} as const satisfies Record<FailedReason, string>;

function errorText(entry: Extract<ThreadEntry, { kind: "provider-error" }>): string {
  const status = entry.evidence?.http_status;
  if (entry.code === "configuration_unavailable" && (status === 402 || status === 429)) {
    return t("conversation.error.turn-usage-limit");
  }
  if (entry.code === "configuration_unavailable" && (status === 401 || status === 403)) {
    return t("conversation.error.turn-sign-in-rejected");
  }
  if ((entry.code === "model_error" || entry.code === "model_attempt_limit") && status === 429) {
    return t("conversation.error.turn-rate-limited");
  }
  return entry.code in FAILED_TEXT ? t(FAILED_TEXT[entry.code as FailedReason]) : entry.message;
}

/** A failed request in one line with Retry, which sends the failed turn's input again. */
function ProviderError({ entry }: { entry: Extract<ThreadEntry, { kind: "provider-error" }> }) {
  const { source, canRetry, readOnly } = useActions();
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const retry = async () => {
    setState("sending");
    const result = await source.retryTurn(entry.turn);
    setState(result.ok ? "idle" : "failed");
  };
  return (
    <ErrorLine
      action={
        canRetry && !readOnly ? (
          <Button size="sm" icon={RefreshCw} disabled={state === "sending"} onPress={() => void retry()}>
            {t("conversation.button.retry")}
          </Button>
        ) : undefined
      }
    >
      {state === "failed" ? `${errorText(entry)}\n${t("conversation.notice.retry-failed")}` : errorText(entry)}
    </ErrorLine>
  );
}

function InfoLine({ entry }: { entry: Extract<ThreadEntry, { kind: "info" }> }) {
  return (
    <Line
      icon={Info}
      end={entry.level === "warning" ? <StatusMark tone="warning" label={t("conversation.label.info-warning")} /> : undefined}
    >
      {entry.text}
    </Line>
  );
}

function CommandOutput({ entry }: { entry: Extract<ThreadEntry, { kind: "command-output" }> }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="caption" tone="muted" mono>{`/${entry.command}`}</Text>
      {entry.format === "markdown" ? <Markdown variant="chat" source={entry.text} /> : <Pre wrap>{entry.text}</Pre>}
    </View>
  );
}

function TurnEnd({ entry, said }: { entry: Extract<ThreadEntry, { kind: "turn-end" }>; said?: readonly ThreadEntry[] }) {
  const { readOnly } = useActions();
  if (entry.outcome === "failed") {
    return <StatusMark tone="serious" label={t("conversation.label.status-stopped")} />;
  }
  const time = messageTime(entry.at, new Date());
  const text = said === undefined ? "" : copyTextOf(said);
  return (
    <Meta onCopy={readOnly || text === "" ? undefined : () => void Clipboard.setStringAsync(text)}>
      {t(entry.outcome === "stopped" ? "mobile.session.label.stopped-after-at" : "mobile.session.label.worked-for-at", {
        duration: duration(entry.activeMs),
        time,
      })}
    </Meta>
  );
}

function TurnEntry({ entry, said }: { entry: ThreadEntry; said: readonly ThreadEntry[] }) {
  const { openDiff } = useActions();
  switch (entry.kind) {
    case "message":
      return <Body parts={entry.parts} />;
    case "tools":
      return <Tools calls={entry.calls} />;
    case "subagent":
      return <Subagent entry={entry} />;
    case "edit": {
      const { edit } = entry;
      if (edit.toolState === "ok" || edit.toolState === "running") {
        return <EditCard path={edit.path} add={edit.added} del={edit.removed} onPress={() => openDiff(entry.id)} />;
      }
      return (
        <Line icon={Pencil} end={<StatusMark tone="critical" label={t("conversation.label.tool-call-failed")} />}>
          {`${t("conversation.label.edit-failed")} ${edit.path}`}
        </Line>
      );
    }
    case "call":
      return <Call entry={entry} />;
    case "release-consent":
      return <ReleaseConsent release={entry.release} />;
    case "questions":
      return <Questions entry={entry} />;
    case "approval-result":
      return <Decision result={entry.result} />;
    case "turn-end":
      return <TurnEnd entry={entry} said={said} />;
    case "provider-error":
      return <ProviderError entry={entry} />;
    case "info":
      return <InfoLine entry={entry} />;
    case "command-output":
      return <CommandOutput entry={entry} />;
    case "shell":
    case "hidden":
      return null;
  }
}

/** A release waiting on the person's consent, which is given in the Inbox. */
function ReleaseConsent({ release }: { release: string }) {
  const nav = useNav();
  const waiting = useInbox().entries.find((entry) => entry.kind === "activation" && entry.id === release);
  return (
    <Line icon={ShieldCheck} onPress={waiting === undefined ? undefined : () => nav.open({ name: "inbox" })}>
      {waiting?.kind === "activation"
        ? t("conversation.title.consent-waiting", { app: waiting.request.app_name })
        : t("conversation.title.consent-handled")}
    </Line>
  );
}

// ---- outside a turn

/** My `!` command: on my side, with its output in the steps sheet. */
function Shell({ entry }: { entry: Extract<ThreadEntry, { kind: "shell" }> }) {
  const { openSteps } = useActions();
  const call: ToolCallView = {
    id: entry.id,
    tool: "shell.run",
    category: "command",
    title: entry.command,
    state: entry.state,
    startedAt: null,
    durationMs: null,
  };
  return (
    <View style={{ alignItems: "flex-end" }}>
      <Line icon={Terminal} onPress={() => openSteps([call], entry.output)}>
        <Text variant="detail" tone="muted" mono numberOfLines={2}>
          {`${t("conversation.label.shell-you-ran")} ${entry.command}`}
        </Text>
      </Line>
    </View>
  );
}

/** A range a rewind hid: one line, and its rows read-only when opened. */
function Hidden({ entry }: { entry: Extract<ThreadEntry, { kind: "hidden" }> }) {
  const [open, setOpen] = useState(false);
  const result =
    entry.left.length > 0
      ? t("conversation.rewind.result-left", { restored: entry.restored, left: entry.left.length })
      : entry.restored > 0
        ? t("conversation.rewind.result-restored", { count: entry.restored })
        : undefined;
  return (
    <View style={{ gap: 12 }}>
      <Line
        icon={Undo2}
        under={result}
        end={
          <Text variant="caption" tone="muted" onPress={() => setOpen(!open)}>
            {t(open ? "conversation.button.hidden-hide" : "conversation.button.hidden-show")}
          </Text>
        }
      >
        {t("conversation.label.rewind-hidden", { count: entry.count })}
      </Line>
      {open && (
        <View style={{ gap: 18, opacity: 0.6 }}>
          {rowsOf(entry.entries, null, true).map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </View>
      )}
    </View>
  );
}

function LooseEntry({ entry }: { entry: ThreadEntry }) {
  switch (entry.kind) {
    case "turn-end":
      return <TurnEnd entry={entry} />;
    case "info":
      return <InfoLine entry={entry} />;
    case "command-output":
      return <CommandOutput entry={entry} />;
    case "shell":
      return <Shell entry={entry} />;
    case "hidden":
      return <Hidden entry={entry} />;
    default:
      return null;
  }
}
