// What waits on the person, the front of the Inbox of every computer the list shows (tools/wireframes/drafts/phone/shell.tsx
// HomeScreen). A permission request is answered here with Deny and Allow once, on its own computer; everything else opens
// in that computer's Inbox.
import { t } from "@lophn/i18n";
import { Button, Card, Pre, StatusMark, Text } from "@lophn/ui-native";
import { Check, X } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { TurnRequestChoiceKind } from "../../../../protocol/approvals/turn-request.ts";
import {
  type CardView,
  type ComputerLines,
  ComputerScope,
  cardOf,
  type Inbox,
  sessionIn,
  useInbox,
  useNames,
  type WaitingEntry,
  type Who,
} from "../../data/mod.ts";
import { ago, Face, LOPHN } from "../../parts/mod.ts";
import {
  type InboxPermissionDetails,
  inboxPermissionDetails,
} from "../session/permissions-model.ts";
import { DenySheet } from "../session/sheets.tsx";

/** How many cards Home shows; the rest are one tap away under Inbox. */
export const NEEDS_SHOWN = 2;

// The desktop Inbox's order of groups, so Home shows the front of the same list.
const GROUP: Record<WaitingEntry["kind"], number> = {
  permission: 0,
  question: 1,
  activation: 2,
  job_approval: 3,
  job_hold: 3,
  mail_hold: 4,
};

/** One thing waiting, with the computer it waits on. */
export interface Need {
  readonly lines: ComputerLines;
  readonly entry: WaitingEntry;
}

/** The front of every shown computer's Inbox, in the desktop Inbox's order of groups. */
export function frontOf(shown: readonly ComputerLines[]): Need[] {
  return shown
    .flatMap((lines) => lines.inbox.map((entry) => ({ lines, entry })))
    .sort((a, b) => GROUP[a.entry.kind] - GROUP[b.entry.kind])
    .slice(0, NEEDS_SHOWN);
}

const cardStyle = {
  marginHorizontal: 16,
  marginBottom: 8,
  paddingVertical: 12,
  paddingHorizontal: 14,
} as const;

export function NeedsYou({
  needs,
  many,
  onInbox,
  onUpdate,
}: {
  needs: readonly Need[];
  /** More than one computer shows: each card says its computer. */
  many: boolean;
  onInbox: (computer: string) => void;
  onUpdate: (computer: string, release: string) => void;
}) {
  return (
    <>
      {needs.map(({ lines, entry }) => (
        // The card answers through its own computer's Inbox and reads its names there.
        <ComputerScope key={`${lines.computer.key}:${entry.id}`} computer={lines.computer.key}>
          <NeedCard
            lines={lines}
            entry={entry}
            many={many}
            onInbox={() => onInbox(lines.computer.key)}
            onUpdate={(release) => onUpdate(lines.computer.key, release)}
          />
        </ComputerScope>
      ))}
    </>
  );
}

function NeedCard({
  lines,
  entry,
  many,
  onInbox,
  onUpdate,
}: {
  lines: ComputerLines;
  entry: WaitingEntry;
  many: boolean;
  onInbox: () => void;
  onUpdate: (release: string) => void;
}) {
  const inbox = useInbox();
  const view = cardOf(entry, useNames());
  const found = sessionIn(lines.workspaces, entry.session);
  // The session's own name and place, as the sidebar says them; the card model's line is for the desktop.
  const meta = [
    ...(found === undefined
      ? [view.meta]
      : [found.row.title ?? t("left-sidebar.label.untitled"), found.workspace.name]),
    many ? lines.computer.name : null,
  ]
    .filter((part) => part !== null && part !== "")
    .join(" · ");
  const permission =
    entry.kind === "permission"
      ? inboxPermissionDetails(entry.request, view)
      : null;
  const head = (
    <Head
      who={found?.row.who ?? null}
      title={permission !== null ? permission.title : view.title}
      age={ago(entry.receivedAt)}
    />
  );
  if (entry.kind === "permission" && permission !== null && permission.choices.length > 0) {
    return (
      <PermissionCard
        entry={entry}
        view={view}
        details={permission}
        meta={meta}
        head={head}
        inbox={inbox}
      />
    );
  }
  const open = () =>
    entry.kind === "activation" ? onUpdate(entry.id) : onInbox();
  return (
    <Pressable accessibilityRole="button" onPress={open}>
      <Card tone="base" style={cardStyle}>
        {head}
        <Meta>{meta}</Meta>
        {entry.kind === "question" ? (
          <QuestionText entry={entry} view={view} inbox={inbox} />
        ) : (
          <Description>{view.description}</Description>
        )}
      </Card>
    </Pressable>
  );
}

function Head({
  who,
  title,
  age,
}: {
  who: Who | null;
  title: string;
  age: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Face look={who?.avatar ?? LOPHN} size={22} />
      <Text variant="control" weight="medium" grow numberOfLines={1} style={{ lineHeight: 20 }}>
        {title}
      </Text>
      <Text variant="note" tone="muted">
        {age}
      </Text>
    </View>
  );
}

function Meta({ children }: { children: string }) {
  return (
    <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
      {children}
    </Text>
  );
}

function Description({ children }: { children: string }) {
  return (
    <Text variant="control" style={{ marginTop: 6 }}>
      {children}
    </Text>
  );
}

function PermissionCard({
  entry,
  view,
  details,
  meta,
  head,
  inbox,
}: {
  entry: WaitingEntry & { kind: "permission" };
  view: CardView;
  details: InboxPermissionDetails;
  meta: string;
  head: ReactNode;
  inbox: Inbox;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const command = details.factsPinned
    ? details.facts.find((fact) => fact.style === "code")
    : undefined;
  const [denying, setDenying] = useState(false);
  async function decide(choice: TurnRequestChoiceKind, reason?: string) {
    setBusy(true);
    setFailed(false);
    const done = await inbox.decide(entry, choice, reason);
    // A decided request leaves the list and takes this card with it.
    if (!done.ok) {
      setFailed(true);
      setBusy(false);
    }
  }
  const hasDeny = details.choices.includes("reject");
  const hasSession = details.choices.includes("session");
  const hasAlways = details.choices.includes("always");
  const hasOnce = details.choices.includes("once");
  return (
    <Card tone="base" style={cardStyle}>
      {head}
      <Meta>{meta}</Meta>
      {details.outsideRewind && (
        <View style={{ marginTop: 6 }}>
          <StatusMark tone="warning" label="Outside rewind" />
        </View>
      )}
      {details.reason !== null && <Description>{details.reason}</Description>}
      {command !== undefined ? (
        <View style={{ marginTop: 8 }}>
          <Pre wrap>{command.value}</Pre>
        </View>
      ) : (
        details.reason === null && <Description>{details.description}</Description>
      )}
      {details.alwaysPatterns.length > 0 && (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Text variant="caption" tone="muted">
            {t("waiting.label.fact-always")}
          </Text>
          <Pre wrap>{details.alwaysPatterns.join("\n")}</Pre>
        </View>
      )}
      {failed && (
        <Text variant="note" tone="critical" style={{ marginTop: 8 }}>
          {t("waiting.notice.decide-failed")}
        </Text>
      )}
      {(hasSession || hasAlways) && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          {hasSession && (
            <Button
              block
              icon={Check}
              disabled={busy}
              onPress={() => void decide("session")}
            >
              {t("conversation.button.approval-allow-session")}
            </Button>
          )}
          {hasAlways && (
            <Button
              block
              icon={Check}
              disabled={busy}
              onPress={() => void decide("always")}
            >
              {t("waiting.button.allow-always")}
            </Button>
          )}
        </View>
      )}
      {(hasDeny || hasOnce) && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: hasSession || hasAlways ? 8 : 10 }}>
          {hasDeny && (
            <Button
              block
              icon={X}
              disabled={busy}
              onPress={() => (view.requester === null ? void decide("reject") : setDenying(true))}
            >
              {t("waiting.button.deny")}
            </Button>
          )}
          {hasOnce && (
            <Button
              block
              variant="primary"
              icon={Check}
              disabled={busy}
              onPress={() => void decide("once")}
            >
              {t("waiting.button.allow-once")}
            </Button>
          )}
        </View>
      )}
      <DenySheet
        open={denying}
        agent={view.requester ?? ""}
        busy={busy}
        onClose={() => setDenying(false)}
        onDeny={(reason) => {
          setDenying(false);
          void decide("reject", reason);
        }}
      />
    </Card>
  );
}

/** The question itself when it is one plain question; the event does not carry it, so it is read. */
function QuestionText({
  entry,
  view,
  inbox,
}: {
  entry: WaitingEntry & { kind: "question" };
  view: CardView;
  inbox: Inbox;
}) {
  // undefined: reading. null: could not read.
  const [questions, setQuestions] =
    useState<Awaited<ReturnType<Inbox["questions"]>>>();
  useEffect(() => {
    let live = true;
    void inbox.questions(entry).then((read) => {
      if (live) setQuestions(read);
    });
    return () => {
      live = false;
    };
  }, [entry.id]);
  const text =
    questions === undefined
      ? view.description
      : questions === null
        ? t("waiting.notice.question-in-session")
        : questions.length === 1
          ? questions[0].question
          : t("waiting.notice.question-multiple", { count: questions.length });
  return <Description>{text}</Description>;
}
