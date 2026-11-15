// What waits on the person, the front of the Inbox (tools/wireframes/drafts/phone/shell.tsx HomeScreen). A permission
// request is answered here with Deny and Allow once; everything else opens in the Inbox.
import { t } from "@lophn/i18n";
import { Button, Card, Pre, Text } from "@lophn/ui-native";
import { Check, X } from "lucide-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import {
  type CardView,
  cardOf,
  type Inbox,
  type useNames,
  type WaitingEntry,
  type Who,
  sessionIn,
  type WorkspaceView,
} from "../../data/mod.ts";
import { ago, Face, LOPHN } from "../../parts/mod.ts";

/** How many cards Home shows; the rest are one tap away under Inbox. */
export const NEEDS_SHOWN = 2;

// The desktop Inbox's order of groups, so Home shows the front of the same list.
const GROUP: Record<WaitingEntry["kind"], number> = {
  permission: 0,
  question: 1,
  activation: 2,
  share: 3,
  job_approval: 4,
  job_hold: 4,
};

export function frontOf(entries: readonly WaitingEntry[]): WaitingEntry[] {
  return [...entries]
    .sort((a, b) => GROUP[a.kind] - GROUP[b.kind])
    .slice(0, NEEDS_SHOWN);
}

const cardStyle = {
  marginHorizontal: 16,
  marginBottom: 8,
  paddingVertical: 12,
  paddingHorizontal: 14,
} as const;

export function NeedsYou({
  entries,
  inbox,
  names,
  workspaces,
  onInbox,
  onUpdate,
}: {
  entries: readonly WaitingEntry[];
  inbox: Inbox;
  names: ReturnType<typeof useNames>;
  workspaces: readonly WorkspaceView[];
  onInbox: () => void;
  onUpdate: (release: string) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const view = cardOf(entry, names);
        const found = sessionIn(workspaces, entry.session);
        // The session's own name and place, as the sidebar says them; the card model's line is for the desktop.
        const meta =
          found === undefined
            ? view.meta
            : [
                found.row.title ?? t("left-sidebar.label.untitled"),
                found.workspace.name,
              ]
                .filter((part) => part !== null)
                .join(" · ");
        const head = (
          <Head
            who={found?.row.who ?? null}
            title={view.title}
            age={ago(entry.receivedAt)}
          />
        );
        if (entry.kind === "permission" && view.choices.includes("once")) {
          return (
            <PermissionCard
              key={entry.id}
              entry={entry}
              view={view}
              meta={meta}
              head={head}
              inbox={inbox}
            />
          );
        }
        const open = () =>
          entry.kind === "activation" ? onUpdate(entry.id) : onInbox();
        return (
          <Pressable key={entry.id} accessibilityRole="button" onPress={open}>
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
      })}
    </>
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
      <Face profile={who?.profile ?? LOPHN} size={22} />
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
  meta,
  head,
  inbox,
}: {
  entry: WaitingEntry & { kind: "permission" };
  view: CardView;
  meta: string;
  head: ReactNode;
  inbox: Inbox;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const command = view.factsPinned
    ? view.facts.find((fact) => fact.style === "code")
    : undefined;
  async function decide(choice: "once" | "reject") {
    setBusy(true);
    setFailed(false);
    const done = await inbox.decide(entry, choice);
    // A decided request leaves the list and takes this card with it.
    if (!done.ok) {
      setFailed(true);
      setBusy(false);
    }
  }
  return (
    <Card tone="base" style={cardStyle}>
      {head}
      <Meta>{meta}</Meta>
      {command !== undefined ? (
        <View style={{ marginTop: 8 }}>
          <Pre>{command.value}</Pre>
        </View>
      ) : (
        <Description>{view.description}</Description>
      )}
      {failed && (
        <Text variant="note" tone="critical" style={{ marginTop: 8 }}>
          {t("waiting.notice.decide-failed")}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <Button block icon={X} disabled={busy} onPress={() => decide("reject")}>
          {t("waiting.button.deny")}
        </Button>
        <Button
          block
          variant="primary"
          icon={Check}
          disabled={busy}
          onPress={() => decide("once")}
        >
          {t("waiting.button.allow-once")}
        </Button>
      </View>
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
