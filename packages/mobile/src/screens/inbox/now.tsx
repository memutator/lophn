// Inbox, Now: what waits on the person, in the desktop waiting model's kinds, answered where it stands.
import { t } from "@lophn/i18n";
import { Band, Button, Pre, StatusMark, Tag, Text } from "@lophn/ui-native";
import { Check, ChevronRight, Play, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { TurnRequestChoiceKind } from "../../../../protocol/approvals/turn-request.ts";
import { useNav } from "../../app/nav.ts";
import {
  type CardView,
  cardOf,
  type Inbox,
  type Notice,
  sessionIn,
  useInbox,
  useMachineNameOf,
  useNames,
  useRemoteAppNameOf,
  useWorkspaces,
  type WaitingEntry,
  type WorkspaceView,
} from "../../data/mod.ts";
import { ago, Character, DIM, LOPHN } from "../../parts/mod.ts";
import {
  type InboxFact,
  inboxPermissionDetails,
  jobApprovalModeInfo,
} from "../session/permissions-model.ts";
import { DenySheet } from "../session/sheets.tsx";
import { Asker, Buttons, Item, useAnswering } from "./item.tsx";
import {
  type AskQuestion,
  intervalText,
  jobHoldNote,
  KIND_LABEL,
  scheduleText,
} from "./waiting.ts";

const GROUPS = [
  { title: "waiting.label.group-permission", kinds: ["permission"] },
  { title: "waiting.label.group-question", kinds: ["question"] },
  { title: "waiting.label.group-activation", kinds: ["activation"] },
  { title: "waiting.label.group-job", kinds: ["job_approval", "job_hold"] },
  { title: "waiting.label.group-mail", kinds: ["mail_hold"] },
] as const;

type Names = ReturnType<typeof useNames>;
type Kind<K extends WaitingEntry["kind"]> = WaitingEntry & { kind: K };

interface Shared {
  readonly inbox: Inbox;
  readonly names: Names;
  readonly workspaces: readonly WorkspaceView[];
  /** The computer is not reachable: answers cannot go. */
  readonly locked: boolean;
}

/** Everything waiting, grouped by kind. Null when nothing waits at all. */
export function Now({ locked }: { locked: boolean }) {
  const inbox = useInbox();
  const names = useNames();
  const workspaces = useWorkspaces();
  if (inbox.entries.length === 0 && inbox.notices.length === 0) return null;
  const shared = { inbox, names, workspaces, locked };
  return (
    <View style={{ opacity: locked ? DIM : 1 }}>
      {GROUPS.map((group) => {
        const rows = inbox.entries.filter((entry) =>
          (group.kinds as readonly string[]).includes(entry.kind),
        );
        if (rows.length === 0) return null;
        return (
          <View key={group.title}>
            <Band count={rows.length}>{t(group.title)}</Band>
            {rows.map((entry) => (
              <EntryItem key={entry.id} entry={entry} {...shared} />
            ))}
          </View>
        );
      })}
      {inbox.notices.length > 0 && (
        <View>
          <Band count={inbox.notices.length}>
            {t("waiting.label.group-notifications")}
          </Band>
          {inbox.notices.map((notice) => (
            <NoticeItem key={notice.id} notice={notice} {...shared} />
          ))}
        </View>
      )}
    </View>
  );
}

function EntryItem({ entry, ...shared }: { entry: WaitingEntry } & Shared) {
  switch (entry.kind) {
    case "permission":
      return <PermissionItem entry={entry} {...shared} />;
    case "question":
      return <QuestionItem entry={entry} {...shared} />;
    case "activation":
      return <ActivationItem entry={entry} {...shared} />;
    case "job_hold":
      return <JobHoldItem entry={entry} {...shared} />;
    case "mail_hold":
      return <MailHoldItem entry={entry} {...shared} />;
    case "job_approval":
      return <JobApprovalItem entry={entry} {...shared} />;
  }
}

/** Who asks, in which session, where: the session's own name as the sidebar says it, else the card model's line. */
function metaOf(
  entry: WaitingEntry,
  view: CardView,
  workspaces: readonly WorkspaceView[],
): string {
  const found = sessionIn(workspaces, entry.session);
  if (found === undefined) return view.meta;
  return [
    found.row.who?.name,
    found.row.title ?? t("left-sidebar.label.untitled"),
    found.workspace.name ?? t("left-sidebar.label.home"),
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
}

function useSessionTitle(entry: WaitingEntry) {
  const nav = useNav();
  const { session, agent, workspace } = entry;
  return session === null || agent === null
    ? undefined
    : () => nav.open({ name: "session", session, agent, workspace });
}

/** The command or other detail of a request, in full: a long command is wrapped, never cut. */
function Facts({ facts }: { facts: readonly InboxFact[] }) {
  if (facts.length === 0) return null;
  return (
    <View style={{ marginTop: 8, gap: 8 }}>
      {facts.map((fact, at) => (
        <View key={fact.label}>
          {at > 0 && (
            <Text variant="caption" tone="muted" style={{ marginBottom: 4 }}>
              {fact.label}
            </Text>
          )}
          {fact.style === "code" ? (
            <Pre wrap>{fact.value}</Pre>
          ) : (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Text variant="note" tone="muted">
                {fact.label}
              </Text>
              <Text variant="note" style={{ flexShrink: 1 }}>
                {fact.value}
              </Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function PermissionItem({
  entry,
  inbox,
  names,
  workspaces,
  locked,
}: { entry: Kind<"permission"> } & Shared) {
  const view = cardOf(entry, names);
  const details = inboxPermissionDetails(entry.request, view);
  const answering = useAnswering();
  const openSession = useSessionTitle(entry);
  const answer = (choice: TurnRequestChoiceKind, reason?: string) =>
    answering.send(() => inbox.decide(entry, choice, reason));
  const [denying, setDenying] = useState(false);
  const disabled = locked || answering.busy;
  return (
    <Item
      face={<Asker agent={entry.agent} />}
      title={details.title}
      onTitle={openSession}
      age={ago(entry.receivedAt, Date.now())}
      text={details.reason ?? details.description}
      meta={metaOf(entry, view, workspaces)}
      error={answering.error}
    >
      {details.outsideRewind && (
        <View style={{ marginTop: 6 }}>
          <StatusMark tone="warning" label="Outside rewind" />
        </View>
      )}
      <Facts facts={details.facts} />
      {details.choices.length > 0 && (
        <Buttons>
          {details.choices.includes("reject") && (
            <Button
              size="sm"
              icon={X}
              disabled={disabled}
              onPress={() => (view.requester === null ? void answer("reject") : setDenying(true))}
            >
              {t("waiting.button.deny")}
            </Button>
          )}
          {details.choices.includes("session") && (
            <Button
              size="sm"
              icon={Check}
              disabled={disabled}
              onPress={() => void answer("session")}
            >
              {t("conversation.button.approval-allow-session")}
            </Button>
          )}
          {details.choices.includes("always") && (
            <Button
              size="sm"
              icon={Check}
              disabled={disabled}
              onPress={() => void answer("always")}
            >
              {t("waiting.button.allow-always")}
            </Button>
          )}
          {details.choices.includes("once") && (
            <Button
              size="sm"
              variant="primary"
              icon={Check}
              disabled={disabled}
              onPress={() => void answer("once")}
            >
              {t("waiting.button.allow-once")}
            </Button>
          )}
        </Buttons>
      )}
      <DenySheet
        open={denying}
        agent={view.requester ?? ""}
        busy={disabled}
        onClose={() => setDenying(false)}
        onDeny={(reason) => {
          setDenying(false);
          void answer("reject", reason);
        }}
      />
    </Item>
  );
}

function QuestionItem({
  entry,
  inbox,
  names,
  workspaces,
  locked,
}: { entry: Kind<"question"> } & Shared) {
  const view = cardOf(entry, names);
  const answering = useAnswering();
  const openSession = useSessionTitle(entry);
  // undefined: reading. null: could not be read (answered elsewhere, or the computer dropped).
  const [questions, setQuestions] = useState<
    readonly AskQuestion[] | null | undefined
  >(undefined);
  useEffect(() => {
    let live = true;
    void inbox.questions(entry).then((read) => {
      if (live) setQuestions(read);
    });
    return () => {
      live = false;
    };
  }, [entry.id]);
  // One question with options to pick is answered here; anything else is answered in the session.
  const only =
    questions?.length === 1 && !questions[0].multiSelect ? questions[0] : null;
  const text =
    only !== null
      ? only.question
      : questions === undefined
        ? view.description
        : questions === null
          ? t("waiting.notice.question-in-session")
          : t("waiting.notice.question-multiple", { count: questions.length });
  const disabled = locked || answering.busy;
  return (
    <Item
      face={<Asker agent={entry.agent} />}
      title={view.title}
      onTitle={openSession}
      age={ago(entry.receivedAt, Date.now())}
      text={text}
      meta={metaOf(entry, view, workspaces)}
      error={answering.error}
    >
      <Buttons>
        {only === null && openSession !== undefined && (
          <Button size="sm" trailingIcon={ChevronRight} onPress={openSession}>
            {t("waiting.button.open-session")}
          </Button>
        )}
        {only !== null &&
          [...only.options].reverse().map((option) => (
            <Button
              key={option.label}
              size="sm"
              variant={option === only.options[0] ? "primary" : "secondary"}
              disabled={disabled}
              onPress={() =>
                answering.send(() =>
                  inbox.answer(entry, [
                    {
                      question: only.question,
                      status: "answered",
                      answer: [option.label],
                    },
                  ]),
                )
              }
            >
              {option.label}
            </Button>
          ))}
      </Buttons>
    </Item>
  );
}

function ActivationItem({
  entry,
  names,
  workspaces,
}: { entry: Kind<"activation"> } & Shared) {
  const nav = useNav();
  const view = cardOf(entry, names);
  const review = () => nav.open({ name: "app-update", id: entry.id });
  return (
    <Item
      face={<Asker agent={entry.agent} />}
      title={view.title}
      onTitle={review}
      age={ago(entry.receivedAt, Date.now())}
      text={view.description}
      meta={metaOf(entry, view, workspaces)}
    >
      <Buttons>
        <Button size="sm" trailingIcon={ChevronRight} onPress={review}>
          {t("waiting.toast-activation.button")}
        </Button>
      </Buttons>
    </Item>
  );
}

function JobHoldItem({
  entry,
  inbox,
  names,
  workspaces,
  locked,
}: { entry: Kind<"job_hold"> } & Shared) {
  const nav = useNav();
  const view = cardOf(entry, names);
  const answering = useAnswering();
  const answer = (choice: "run_now" | "skip") =>
    answering.send(() => inbox.jobHold(entry, choice));
  const disabled = locked || answering.busy;
  return (
    <Item
      face={<Asker agent={entry.agent} />}
      title={view.title}
      onTitle={() => nav.open({ name: "job", id: entry.hold.job.id })}
      age={ago(entry.receivedAt, Date.now())}
      text={jobHoldNote(entry.hold)}
      meta={view.description}
      error={answering.error}
    >
      <Buttons>
        <Button size="sm" disabled={disabled} onPress={() => answer("skip")}>
          {t("waiting.button.skip")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Play}
          disabled={disabled}
          onPress={() => answer("run_now")}
        >
          {t("waiting.button.start-now")}
        </Button>
      </Buttons>
    </Item>
  );
}

function MailHoldItem({
  entry,
  inbox,
  names,
  locked,
}: { entry: Kind<"mail_hold"> } & Shared) {
  const view = cardOf(entry, names);
  const answering = useAnswering();
  const answer = (choice: "run_now" | "skip") =>
    answering.send(() => inbox.mailHold(entry, choice));
  const disabled = locked || answering.busy;
  return (
    <Item
      face={<Asker agent={null} />}
      title={view.title}
      age={ago(entry.receivedAt, Date.now())}
      text={view.description}
      meta={`${view.meta}\n${view.times}`}
      error={answering.error}
    >
      <Buttons>
        <Button size="sm" disabled={disabled} onPress={() => answer("skip")}>
          {t("waiting.button.skip")}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={Play}
          disabled={disabled}
          onPress={() => answer("run_now")}
        >
          {t("waiting.button.start-now")}
        </Button>
      </Buttons>
    </Item>
  );
}

function JobApprovalItem({
  entry,
  inbox,
  names,
  workspaces,
  locked,
}: { entry: Kind<"job_approval"> } & Shared) {
  const nav = useNav();
  const machineNameOf = useMachineNameOf();
  const remoteAppNameOf = useRemoteAppNameOf();
  const view = cardOf(entry, names);
  const answering = useAnswering();
  const approve = () =>
    answering.send(() => inbox.jobApproval(entry, "approve"));
  const disabled = locked || answering.busy;
  const { job } = entry;
  const source =
    job.trigger !== null && job.trigger.source_machine !== undefined
      ? (remoteAppNameOf(
          job.trigger.source_machine,
          job.trigger.app ?? job.trigger.source,
        ) ?? job.trigger.source)
      : job.trigger?.source ?? "";
  const when =
    job.trigger !== null
      ? t(
          job.trigger.source_machine !== undefined
            ? "waiting.notice.job-approval-event-on"
            : job.trigger.source === "lophn"
              ? "waiting.notice.job-approval-lophn"
              : "waiting.notice.job-approval-event",
          {
            source,
            event: job.trigger.event,
            interval: intervalText(job.trigger.min_interval),
            // A computer this phone has not paired shows by id.
            machine:
              job.trigger.source_machine === undefined
                ? ""
                : (machineNameOf(job.trigger.source_machine) ??
                  job.trigger.source_machine),
          },
        )
      : t("waiting.notice.job-approval", {
          schedule: scheduleText(job.every!, job.at),
        });
  const { modeEscalated, participantModes } = jobApprovalModeInfo(job);
  return (
    <Item
      face={<Asker agent={entry.agent} />}
      title={view.title}
      onTitle={() => nav.open({ name: "job", id: job.id })}
      age={ago(entry.receivedAt, Date.now())}
      text={when}
      meta={view.description}
      error={answering.error}
    >
      {modeEscalated && (
        <View style={{ marginTop: 8, gap: 4 }}>
          <StatusMark tone="warning" label="Paused · re-approval required" />
          <Text variant="note" tone="secondary">
            Remembered workflow permission mode escalated to Full access. Review the participant modes below before approving.
          </Text>
        </View>
      )}
      {participantModes.length > 0 && (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Text variant="caption" tone="muted">
            Participant permission modes
          </Text>
          {participantModes.map((row) => (
            <View
              key={row.participant}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Text variant="note" mono style={{ flexShrink: 1 }}>
                {row.participant}
              </Text>
              {row.isFull ? (
                <StatusMark tone="warning" label={row.label} />
              ) : (
                <Tag>{row.label}</Tag>
              )}
            </View>
          ))}
        </View>
      )}
      <Buttons>
        <Button
          size="sm"
          variant="primary"
          disabled={disabled}
          onPress={approve}
        >
          {t("waiting.button.approve-job")}
        </Button>
      </Buttons>
    </Item>
  );
}

/** What an app or lophn told the person without asking anything. Dismissing removes it. */
function NoticeItem({ notice, inbox, locked }: { notice: Notice } & Shared) {
  const nav = useNav();
  const answering = useAnswering();
  const app = notice.app;
  return (
    <Item
      face={<Character look={LOPHN} size={24} />}
      title={notice.title}
      onTitle={
        app === null
          ? undefined
          : () =>
              nav.open({
                name: "workspace",
                workspace: { kind: "app", id: app },
              })
      }
      age={ago(notice.created_at, Date.now())}
      text={notice.body}
      meta={[
        notice.app_name,
        notice.kind === "app" ? null : t(KIND_LABEL[notice.kind]),
      ]
        .filter((part) => part !== null)
        .join(" · ")}
      error={answering.error}
    >
      <Buttons>
        <Button
          size="sm"
          disabled={locked || answering.busy}
          onPress={() => answering.send(() => inbox.dismiss(notice.id))}
        >
          {t("waiting.button.dismiss-notice")}
        </Button>
      </Buttons>
    </Item>
  );
}
