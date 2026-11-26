// A session: the conversation with an agent (tools/wireframes/drafts/phone/session.tsx). The desktop conversation's
// values (thread, live text, pending, queued) come from `useConversation`; this screen lays them out for the phone: the
// thread follows the newest text, what waits on the person docks above the composer, and the composer's words follow the
// state (Reply…, Queue a message…, Reply instead…). A coding session on the computer runs the same chat over
// the coding source, or stands in its terminal (screens/coding); a headless coding agent's session is only read here.
import { t } from "@lophn/i18n";
import {
  Chip,
  Composer,
  Icon,
  IconButton,
  MessageList,
  Screen,
  Text,
  TopBar,
  Working,
} from "@lophn/ui-native";
import { Ellipsis, Monitor } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import type { AcpCommandOpens } from "../../../../protocol/acp/mod.ts";
import { HOME_TERMINAL_PROJECT } from "../../../../protocol/coding-agent/terminals.ts";
import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import type { PermissionMode } from "../../../../protocol/lophn-agent/turn-values.ts";
import { codingBuiltinOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import { duration, useSecondTick } from "../../../../shell/renderer/conversation/activity/elapsed.ts";
import type { ToolCallView } from "../../../../shell/renderer/conversation/activity/model.ts";
import type {
  PermissionsView,
  QueuedView,
  ThreadSubagent,
} from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import { capabilitiesOf, clockOf, messagesOf, slashEntriesOf, textOfParts } from "../../../../shell/renderer/conversation/agent-view-model.ts";
import { runComposerCommand } from "../../../../shell/renderer/conversation/composer/slash-actions.ts";
import {
  afterReply,
  type Outgoing,
  seenOf,
  startSend,
  waitsInQueue,
} from "../../../../shell/renderer/conversation/delivery-state.ts";
import type { SlashEntryView } from "../../../../shell/renderer/conversation/slash-menu/types.ts";
import { chooseSlash, parseSlash, slashQuery, slashScreenOf } from "../../../../shell/renderer/conversation/slash-rule.ts";
import { useModelPicker } from "../../../../shell/renderer/conversation/use-model-picker.ts";
import { newId } from "../../../../shell/renderer/prefixed-id.ts";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import {
  type CodingSession,
  type CodingTarget,
  type ConversationTarget,
  type Attached,
  type SampleConversation,
  type SessionRow,
  useCodingSessions,
  useConversation,
  useCurrentComputer,
  useNames,
  useSampleConversation,
  useSessionDraft,
  useSessionPermissions,
  useWorkspaces,
  type WorkspaceView,
} from "../../data/mod.ts";
import { DIM, Face, LOPHN, OfflineBanner, type Look, useUnreachable } from "../../parts/mod.ts";
import { ContinueAsChat, harnessAvatar, TerminalSession } from "../coding/index.tsx";
import { Pending } from "./ask.tsx";
import { attachedAbove, useAttachments } from "./attach.tsx";
import {
  canSelectMode,
  isPermissionMode,
  permissionModeLabel,
} from "./permissions-model.ts";
import {
  AttachSheet,
  ChildSheet,
  CommandRows,
  CommandsSheet,
  ContextSheet,
  contextLine,
  FilesSheet,
  ModelSheet,
  PermissionsSheet,
  QueuedMenu,
  RenameSheet,
  RewindSheet,
  SessionMenu,
  StepsSheet,
  ThoughtSheet,
} from "./sheets.tsx";
import { Row, rowsOf, type ThreadActions, ThreadContext, type ThreadRow } from "./thread.tsx";

type SheetState =
  | { readonly kind: "steps"; readonly calls: readonly ToolCallView[]; readonly output: string | null }
  | { readonly kind: "thought"; readonly text: string }
  | { readonly kind: "queued"; readonly queued: QueuedView }
  | { readonly kind: "permissions"; readonly view: PermissionsView | null }
  | { readonly kind: "child"; readonly entry: ThreadSubagent }
  | { readonly kind: "rewind"; readonly message: string; readonly excerpt: string }
  | {
      readonly kind: "attach" | "files" | "commands" | "model" | "menu" | "rename" | "context";
    };

// Commands the phone can carry out: run as they are, or opened in one of this screen's sheets. The others (a new
// session, ...) are done on the computer; typed here they say so instead of going out as a message.
const OPENS: ReadonlySet<AcpCommandOpens | null> = new Set([
  null,
  "model",
  "effort",
  "mode",
  "permissions",
  "context",
  "status",
  "usage",
  "rename",
  "archive",
  "compact",
  "fork",
  "rewind",
]);

// Long-pressing the face on the sample computer steps through the four states the sample conversation can show.
const SAMPLE_STATES: readonly SampleConversation[] = ["done", "working", "approval", "question"];

const actKey = (prefix: string) => newId(prefix);

/** The session's row in the workspace list: who runs it (the sidebar's face), its title, and its desk. */
function rowOf(
  workspaces: readonly WorkspaceView[],
  session: string,
): { row: SessionRow; workspace: WorkspaceView; desk: string | null } | null {
  for (const workspace of workspaces) {
    for (const group of workspace.groups) {
      const row = group.rows.find((one) => one.id === session);
      if (row !== undefined) return { row, workspace, desk: group.label };
    }
    const row = workspace.recent.find((one) => one.id === session);
    if (row !== undefined) return { row, workspace, desk: null };
  }
  return null;
}

/** The working line under the last turn: what the agent waits for, or how long it has worked. */
function WorkingLine({
  waiting,
  clock,
}: {
  waiting: "approval" | "answer" | undefined;
  clock: { activeMs: number; at: number } | null;
}) {
  const [start] = useState(Date.now);
  useSecondTick(waiting === undefined);
  if (waiting !== undefined) {
    return (
      <Working tone="warning">
        {t(waiting === "approval" ? "conversation.label.status-waiting-approval" : "conversation.label.status-waiting-answer")}
      </Working>
    );
  }
  const elapsed = Math.max(0, clock === null ? Date.now() - start : clock.activeMs + Date.now() - clock.at);
  // Like the desktop's working row: a time only after 3 seconds, so short work does not flicker a number.
  return (
    <Working>
      {elapsed >= 3000
        ? t("mobile.session.label.working-for", { duration: duration(elapsed) })
        : t("conversation.label.status-working")}
    </Working>
  );
}

/** Instead of the composer: a line saying where this session goes on. */
function ReadOnlyLine({ children }: { children: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 14,
        paddingHorizontal: 20,
      }}
    >
      <Icon icon={Monitor} size={16} tone="muted" />
      <Text variant="detail" tone="muted" align="center" style={{ flexShrink: 1 }}>
        {children}
      </Text>
    </View>
  );
}

// A coding session on the computer (Claude Code, Codex, ...).
type CodingPlace = { readonly name: "session" } & CodingTarget;

export function SessionScreen({ place }: { place: PlaceOf<"session"> }) {
  return "coding" in place ? <CodingSessionScreen place={place} /> : <LophnSessionScreen place={place} />;
}

function LophnSessionScreen({ place }: { place: { readonly name: "session" } & ConversationTarget }) {
  const target = useMemo<ConversationTarget>(
    () => ({ session: place.session, agent: place.agent, workspace: place.workspace }),
    [place.session, place.agent, place.workspace],
  );
  return <ChatScreen target={target} coding={null} />;
}

/** In a terminal on the computer: that terminal, typed into from here. In chat: the same conversation as a lophn agent's. */
function CodingSessionScreen({ place }: { place: CodingPlace }) {
  const target = useMemo<CodingTarget>(
    () => ({ session: place.session, coding: place.coding }),
    [place.session, place.coding],
  );
  const row = useCodingSessions(place.coding.project).sessions.find((one) => one.session === place.session) ?? null;
  if (row?.view === "tui") return <TerminalSession session={row} />;
  return <ChatScreen target={target} coding={row} />;
}

function ChatScreen({
  target,
  coding: codingRow,
}: {
  target: ConversationTarget | CodingTarget;
  /** The coding session's row, when this is one and the list has it. */
  coding: CodingSession | null;
}) {
  const conversation = useConversation(target);
  const nav = useNav();
  const { session } = target;
  const lophn = "agent" in target ? target : null;
  // A relayed coding session: what the phone cannot do there (permissions, archive) is not offered.
  const relayed = "coding" in target ? target.coding : null;
  const { source, thread } = conversation;
  const computer = useCurrentComputer()?.name ?? "";
  const found = rowOf(useWorkspaces(), session);
  const names = useNames();
  const sample = useSampleConversation();
  const [sampleAt, setSampleAt] = useState(2);

  const face = conversation.agent ?? null;
  const who: { name: string; avatar: Look } = found?.row.who ??
    (face !== null
      ? { name: face.name, avatar: face.avatar }
      : codingRow !== null
        ? { name: codingRow.label, avatar: harnessAvatar(codingRow.harness, codingRow.label) }
        : { name: "", avatar: LOPHN });
  const entry = conversation.sessions.find((one) => one.id === session);
  const title =
    thread?.session?.title ??
    found?.row.title ??
    entry?.title ??
    codingRow?.title ??
    t("left-sidebar.label.untitled");
  const meta = thread?.session ?? null;
  const caps = capabilitiesOf(meta);
  // A headless coding agent's session (`coding_*`) is read here and continued on the computer.
  const builtin = lophn === null ? null : codingBuiltinOf(lophn.agent);
  const coding = builtin !== null;
  const archived = entry?.archived === true;
  const readOnly = coding || archived;

  const turn = thread?.turn ?? null;
  const active = turn !== null && turn.phase !== "ended" ? turn : null;
  const approval = thread?.pending.approval ?? null;
  const asked = thread?.pending.questions ?? null;
  const waiting: "approval" | "answer" | undefined =
    active?.phase === "waiting" ? (approval !== null ? "approval" : "answer") : undefined;

  const sessionDraft = useSessionDraft(session);
  const draft = sessionDraft.draft.text;
  const setDraft = useCallback(
    (text: string) => sessionDraft.save({ text }),
    [sessionDraft],
  );
  const updateAttachments = useCallback(
    (fn: (current: readonly Attached[]) => readonly Attached[]) =>
      sessionDraft.update((current) => ({ attachments: fn(current.attachments) })),
    [sessionDraft],
  );
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const [changed, setChanged] = useState(false);
  // A typed `/…` that ran nothing: an unknown name, or a command done on the computer. Typing clears it.
  const [slashNote, setSlashNote] = useState<string | null>(null);
  const edit = (text: string) => {
    setDraft(text);
    setSlashNote(null);
  };
  const attachments = useAttachments({
    items: sessionDraft.draft.attachments,
    update: updateAttachments,
  });
  // The pictures of the message being sent, to put back when the core does not take it (their uploads stay valid).
  const sentWith = useRef<{ id: string; items: readonly Attached[] } | null>(null);
  const { restore } = attachments;
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const close = useCallback(() => setSheet(null), []);

  // ---- sending

  const deliver = useCallback(
    async (message: Outgoing) => {
      setOutgoing(message);
      const reply = await source.send({
        session,
        id: message.id,
        key: message.key,
        content: message.content,
        delivery: message.delivery,
        seen: seenOf(
          thread === null ? null : messagesOf(thread),
          thread?.queued ?? [],
          outgoing?.phase === "accepted" ? outgoing.id : null,
        ),
      });
      const next = afterReply(message, reply.ok ? { ok: true } : { ok: false, code: reply.code });
      // Another device wrote first: no bubble, the words go back in the box and the conversation is read again.
      setOutgoing(next.phase === "changed_elsewhere" ? null : next);
      setChanged(next.phase === "changed_elsewhere");
      // Not taken: the words go back in the box to send again.
      if (next.phase === "not_sent" || next.phase === "changed_elsewhere") {
        setDraft(textOfOutgoing(next));
        if (sentWith.current?.id === message.id) restore(sentWith.current.items);
      }
      if (next.phase === "changed_elsewhere") void conversation.reload();
    },
    [source, session, restore, thread, outgoing, conversation],
  );

  const allCommands = meta?.commands ?? [];
  const commands = allCommands.filter((command) => OPENS.has(command.opens));
  const canCommand = caps.commands && commands.length > 0;

  // The desktop composer's rule (slash-rule.ts, runComposerCommand): model and effort first, then the command's screen
  // action, or the command goes to the agent as typed.
  const runCommand = (entry: SlashEntryView, argument: string) => {
    setSheet(null);
    const handled = runComposerCommand(entry, argument, {
      meta,
      mode: null,
      openPicker: () => setSheet({ kind: "model" }),
      openMode: () => {
        if (relayed === null) void openPermissions();
      },
      chooseModel: (model) => picker.onPick({ provider: "", modelName: model }),
      chooseOptions: (model, options) =>
        void source.act(session, { type: "set_model", session, key: actKey("model"), model, options }),
      onProblem: () => setSheet({ kind: "model" }),
    });
    if (handled) {
      setDraft("");
      return;
    }
    const screen = slashScreenOf(entry, argument);
    if (screen === null) {
      setDraft("");
      void source.act(session, { type: "run_command", session, key: actKey("cmd"), name: entry.name, argument });
      return;
    }
    if (!OPENS.has(screen)) {
      setSlashNote(t("mobile.session.notice.command-on-computer", { name: entry.name, computer }));
      return;
    }
    setDraft("");
    switch (screen) {
      case "rename":
        if (argument === "") setSheet({ kind: "rename" });
        else void source.act(session, { type: "rename", session, key: actKey("rename"), title: argument });
        return;
      case "archive":
        void archive();
        return;
      case "compact":
        void source.act(session, { type: "compact", session, key: actKey("compact") });
        return;
      case "fork":
        void fork(null);
        return;
      case "rewind":
        if (lastUser !== null) setSheet({ kind: "rewind", message: lastUser.id, excerpt: lastUser.text });
        return;
      case "mode":
      case "permissions":
        if (relayed === null) void openPermissions();
        return;
      default:
        setSheet({ kind: "context" });
    }
  };

  // A row picked from a list. A command that takes its argument as typed waits for it; the rest act at once.
  const pickCommand = (entry: SlashEntryView) => {
    if (entry.opens === null && entry.argumentHint !== null) {
      setSheet(null);
      edit(`/${entry.name} `);
      return;
    }
    runCommand(entry, "");
  };

  const send = async () => {
    const text = draft.trim();
    const pictures = attachments.items;
    if ((text === "" && pictures.length === 0) || attachments.uploading) return;
    // `/name argument` is a command, as in the desktop composer; a name that matches nothing is not sent as a message.
    const slash = canCommand && pictures.length === 0 ? parseSlash(text) : null;
    if (slash !== null) {
      const chosen = chooseSlash(slashEntriesOf(commands, slash.name, true), slash.name, slash.spaced);
      if (chosen === undefined) {
        setSlashNote(
          allCommands.some((one) => one.name === slash.name)
            ? t("mobile.session.notice.command-on-computer", { name: slash.name, computer })
            : t("conversation.label.slash-unknown", { name: slash.name }),
        );
      } else if (slash.spaced) runCommand(chosen, slash.argument.trim());
      else pickCommand(chosen);
      return;
    }
    // Pictures go up first; if one does not, nothing is sent and the words and pictures stay as they are.
    const uploaded = pictures.length === 0 ? [] : await attachments.upload(source);
    if (uploaded === null) return;
    setDraft("");
    attachments.clear();
    const id = newId("msg");
    sentWith.current = { id, items: pictures };
    void deliver(
      startSend({
        id,
        key: `session-messages-send-${id}`,
        content: [...(text === "" ? [] : textBlocks(text)), ...uploaded],
        delivery: "next_turn",
        queued: active !== null,
      }),
    );
  };

  const openPermissions = async () => {
    setSheet({ kind: "permissions", view: null });
    const read = await source.permissions(session);
    if (read.ok) setSheet((open) => (open?.kind === "permissions" ? { kind: "permissions", view: read.value } : open));
  };

  const archive = async () => {
    const done = await source.archiveSession(session);
    if (done.ok) nav.back();
  };

  const picker = useModelPicker({
    meta,
    effort: caps.effort,
    session,
    onChoose: async (model, options) =>
      (await source.act(session, { type: "set_model", session, key: actKey("model"), model, options })).ok,
    onProblem: () => {},
    canUseRole: false,
    onUseRole: async () => false,
  }).props;

  // ---- rows

  const entries = thread?.entries ?? null;
  const live = thread?.live ?? null;
  const settled = useMemo(() => (entries === null ? [] : rowsOf(entries, null)), [entries]);
  const rows = useMemo<readonly ThreadRow[]>(() => {
    const all: ThreadRow[] =
      live === null ? [...settled] : entries === null ? [] : rowsOf(entries, live);
    const known = (id: string) =>
      entries?.some((one) => one.id === id || (one.kind === "hidden" && one.entries.some((inner) => inner.id === id))) ??
      false;
    if (outgoing !== null && !waitsInQueue(outgoing) && !known(outgoing.id)) {
      all.push({ kind: "outgoing", id: outgoing.id, outgoing });
    }
    for (const queued of thread?.queued ?? []) all.push({ kind: "queued", id: queued.id, queued });
    return all;
  }, [settled, entries, live, outgoing, thread?.queued]);

  const sending = outgoing?.phase === "sending" || outgoing?.phase === "accepted";
  const working = active !== null || (sending && rows.at(-1)?.kind === "outgoing");

  const fork = useCallback(
    async (through: string | null) => {
      const result = await source.act(session, {
        type: "fork",
        session,
        key: actKey("fork"),
        message: through,
      });
      if (!result.ok) {
        setSlashNote(t("waiting.notice.action-failed"));
        return;
      }
      if (result.value.session !== undefined && lophn !== null) {
        nav.open({
          name: "session",
          session: result.value.session,
          agent: lophn.agent,
          workspace: lophn.workspace,
        });
      }
    },
    [source, session, lophn, nav],
  );

  // The last non-steer user message, for `/rewind` and the session menu's Rewind row.
  const lastUser = useMemo(() => {
    for (let at = rows.length - 1; at >= 0; at -= 1) {
      const one = rows[at]!;
      if (one.kind === "user" && one.message.delivery !== "steer") {
        return { id: one.message.id, text: textOfParts(one.message.parts) };
      }
    }
    return null;
  }, [rows]);

  // One value for the whole list: rows redraw only when what they show changes (the agent's face, read-only, Retry).
  const canRetry = caps.retry;
  const canFork = caps.fork;
  const canRewind = caps.rewind && !readOnly;
  const apps = names.apps;
  const whoKey = `${who.name}\0${JSON.stringify(who.avatar)}`;
  const actions = useMemo<ThreadActions>(
    () => ({
      session,
      source,
      agent: who,
      readOnly,
      canRetry,
      canFork,
      canRewind,
      apps,
      openSteps: (calls, output = null) => setSheet({ kind: "steps", calls, output }),
      openThought: (text) => setSheet({ kind: "thought", text }),
      openDiff: (entryId) => nav.open({ name: "diff", session: target, entry: entryId }),
      openChild: (entry) => setSheet({ kind: "child", entry }),
      openQueued: (queued) => setSheet({ kind: "queued", queued }),
      resend: (message) => void deliver({ ...message, phase: "sending", checked: false }),
      onFork: (messageId) => void fork(messageId),
      onRewind: (messageId, excerpt) => setSheet({ kind: "rewind", message: messageId, excerpt }),
    }),
    // `who` is a new object on every read of the workspace list; its name and face are what rows show.
    [session, source, whoKey, readOnly, canRetry, canFork, canRewind, apps, nav, target, deliver, fork],
  );

  // ---- top and bottom

  const workspaceName =
    (relayed === null ? undefined : names.projects.get(relayed.project)) ??
    face?.workspace?.name ??
    found?.workspace.name ??
    t("left-sidebar.label.home");
  // The head's quiet line: who runs the session and in which project. The session menu adds the desk.
  const under = t("mobile.session.label.where", { agent: who.name, workspace: workspaceName });
  const where =
    found?.desk == null
      ? under
      : t("mobile.session.label.where-desk", { agent: who.name, workspace: workspaceName, desk: found.desk });
  const sessionPermissions = useSessionPermissions(
    sheet?.kind === "permissions" && relayed === null ? session : null,
  );
  const currentMode: PermissionMode | null = isPermissionMode(meta?.mode)
    ? meta.mode
    : (sessionPermissions.data?.mode ?? null);
  const modeLabel = permissionModeLabel(currentMode ?? meta?.mode, meta?.modes);

  const changeMode = async (next: PermissionMode): Promise<boolean> => {
    if (relayed !== null || readOnly || !canSelectMode(currentMode, next)) {
      return false;
    }
    const result = await source.act(session, {
      type: "set_mode",
      session,
      key: actKey("mode"),
      mode: next,
    });
    if (result.ok) {
      void conversation.reload();
      sessionPermissions.reload();
    }
    return result.ok;
  };
  const project = lophn?.workspace?.kind === "project" ? lophn.workspace.id : (relayed === null || relayed.project === HOME_TERMINAL_PROJECT ? null : relayed.project);
  // A relayed coding session's pictures go to its terminal's temporary folder on the computer (the source's `uploadImage`).
  const pictures = caps.images;

  // While `/name` is typed (no space yet), the matching commands stand over the composer, as the + sheet lists them.
  const query = canCommand && attachments.items.length === 0 ? slashQuery(draft) : null;
  const typed = query === null ? null : slashEntriesOf(commands, query, true);
  const unreachable = useUnreachable();
  const placeholder =
    unreachable ??
    (asked !== null
      ? t("mobile.session.placeholder.reply-instead")
      : active?.phase === "working"
        ? t("mobile.session.placeholder.queue")
        : t("mobile.session.placeholder.reply"));

  const lead = (
    <Pressable
      disabled={sample === null}
      onLongPress={() => {
        const next = (sampleAt + 1) % SAMPLE_STATES.length;
        setSampleAt(next);
        sample?.(SAMPLE_STATES[next]!);
      }}
    >
      <Face look={who.avatar} size={26} />
    </Pressable>
  );

  const footer =
    builtin !== null && lophn?.workspace?.kind === "project" ? (
      <ContinueAsChat
        project={lophn.workspace.id}
        harness={builtin.harness}
        label={builtin.label}
        session={session}
      />
    ) : readOnly ? (
      <ReadOnlyLine>
        {coding ? t("mobile.session.notice.coding-on-computer", { computer }) : t("conversation.notice.session-archived")}
      </ReadOnlyLine>
    ) : (
    <>
      {/* While the computer is away an answer cannot go: the cards stay in view, dimmed and locked. */}
      <View pointerEvents={unreachable === null ? "auto" : "none"} style={{ opacity: unreachable === null ? 1 : DIM }}>
        <Pending conversation={conversation} session={session} agent={who.name} computer={computer} />
      </View>
      {changed && (
        <Text variant="note" tone="critical" style={{ marginHorizontal: 24, marginBottom: 4 }}>
          {t("conversation.error.changed-elsewhere")}
        </Text>
      )}
      {slashNote !== null && (
        <Text variant="note" tone="critical" style={{ marginHorizontal: 24, marginBottom: 4 }}>
          {slashNote}
        </Text>
      )}
      {typed !== null && (
        <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
          {typed.length === 0 ? (
            <Text variant="small" tone="muted" style={{ marginHorizontal: 24, marginVertical: 8 }}>
              {t("conversation.notice.slash-no-match")}
            </Text>
          ) : (
            <CommandRows commands={typed} onPick={pickCommand} />
          )}
        </ScrollView>
      )}
      <Composer
        value={draft}
        onChangeText={edit}
        onSend={() => void send()}
        above={attachedAbove(attachments)}
        canSend={attachments.items.length > 0}
        placeholder={placeholder}
        working={active?.phase === "working"}
        onStop={() => void conversation.stop()}
        onAttach={pictures || project !== null || canCommand ? () => setSheet({ kind: "attach" }) : undefined}
        disabled={unreachable !== null || conversation.connection === "reconnecting" || outgoing?.phase === "sending" || attachments.uploading}
        chips={
          unreachable === null &&
          ((caps.model && meta !== null) ||
            (relayed === null && modeLabel !== null)) ? (
            <>
              {caps.model && meta !== null && (
                <Chip onPress={() => setSheet({ kind: "model" })}>{picker.currentLabel}</Chip>
              )}
              {relayed === null && modeLabel !== null && (
                <Chip onPress={() => void openPermissions()}>{modeLabel}</Chip>
              )}
            </>
          ) : undefined
        }
      />
    </>
  );

  return (
    <ThreadContext value={actions}>
      <Screen
        top={
          <>
          <TopBar
            {...nav.menuButton}
            lead={lead}
            title={title}
            under={under}
            right={
              <IconButton
                icon={Ellipsis}
                label={t("conversation.label.more-actions")}
                onPress={() => setSheet({ kind: "menu" })}
              />
            }
          />
          <OfflineBanner note={t("mobile.offline.note")} />
          </>
        }
        footer={footer}
      >
        {thread !== null && rows.length === 0 && !readOnly && (
          <Text variant="small" tone="muted" align="center" style={{ position: "absolute", bottom: 16, left: 24, right: 24 }}>
            {t("conversation.empty.no-messages")}
          </Text>
        )}
        <MessageList
          items={rows}
          keyOf={(row) => row.id}
          renderItem={(row) => <Row row={row} />}
          tail={
            working && !readOnly ? (
              <WorkingLine waiting={waiting} clock={clockOf(active)} />
            ) : undefined
          }
        />
      </Screen>

      <StepsSheet
        agent={who.name}
        calls={sheet?.kind === "steps" ? sheet.calls : null}
        output={sheet?.kind === "steps" ? sheet.output : null}
        readBody={source.toolCallBody}
        onClose={close}
      />
      <ThoughtSheet text={sheet?.kind === "thought" ? sheet.text : null} onClose={close} />
      <AttachSheet
        open={sheet?.kind === "attach"}
        onClose={close}
        agent={who.name}
        workspace={project === null ? null : { name: workspaceName }}
        pictures={pictures}
        computer={computer}
        offline={conversation.connection === "reconnecting"}
        onPicked={(picked) => void attachments.add(picked)}
        onFile={project === null ? null : () => setSheet({ kind: "files" })}
        onCommands={canCommand ? () => setSheet({ kind: "commands" }) : null}
      />
      {project !== null && (
        <FilesSheet
          project={project}
          name={workspaceName}
          open={sheet?.kind === "files"}
          onClose={close}
          onPick={(path) => {
            edit(draft === "" || draft.endsWith(" ") ? `${draft}${path} ` : `${draft} ${path} `);
            setSheet(null);
          }}
        />
      )}
      <CommandsSheet
        commands={slashEntriesOf(commands, "", true)}
        open={sheet?.kind === "commands"}
        onClose={close}
        onPick={pickCommand}
      />
      <ChildSheet
        entry={sheet?.kind === "child" ? sheet.entry : null}
        state={sheet?.kind === "child" && sheet.entry.child !== null ? thread?.children[sheet.entry.child] : undefined}
        onClose={close}
      />
      <ModelSheet picker={picker} open={sheet?.kind === "model"} onClose={close} />
      <SessionMenu
        open={sheet?.kind === "menu"}
        onClose={close}
        look={who.avatar}
        title={title}
        where={where}
        mode={modeLabel}
        context={contextLine(meta)}
        canRename={caps.rename && !readOnly}
        onRename={() => setSheet({ kind: "rename" })}
        onFork={caps.fork ? () => void fork(null) : null}
        onRewind={canRewind && lastUser !== null ? () => setSheet({ kind: "rewind", message: lastUser.id, excerpt: lastUser.text }) : null}
        onPermissions={relayed === null ? () => void openPermissions() : null}
        onContext={() => setSheet({ kind: "context" })}
        onArchive={caps.sessions && !archived ? () => void archive() : null}
      />
      <RewindSheet
        open={sheet?.kind === "rewind"}
        source={source}
        session={session}
        message={sheet?.kind === "rewind" ? sheet.message : null}
        excerpt={sheet?.kind === "rewind" ? sheet.excerpt : ""}
        withFiles={caps.rewind_files}
        onClose={close}
        onRewind={async (choice) => {
          if (sheet?.kind !== "rewind") return { ok: false, code: "invalid_input" };
          const result = await source.act(session, {
            type: "rewind",
            session,
            key: actKey("rewind"),
            message: sheet.message,
            files: choice.files,
            apps: [...choice.apps],
          });
          if (result.ok) {
            if (sheet.excerpt !== "") edit(sheet.excerpt);
            void conversation.reload();
          }
          return result;
        }}
      />
      <RenameSheet
        open={sheet?.kind === "rename"}
        title={title}
        onClose={close}
        onSave={(next) => {
          setSheet(null);
          void source.act(session, { type: "rename", session, key: actKey("rename"), title: next });
        }}
      />
      <PermissionsSheet
        open={sheet?.kind === "permissions"}
        agent={who.name}
        mode={modeLabel}
        currentMode={currentMode}
        canChangeMode={!readOnly && relayed === null && currentMode !== null && unreachable === null}
        onChangeMode={changeMode}
        view={sheet?.kind === "permissions" ? sheet.view : null}
        sessionPermissions={sessionPermissions}
        onClose={close}
      />
      <ContextSheet open={sheet?.kind === "context"} meta={meta} onClose={close} />
      <QueuedMenu
        queued={sheet?.kind === "queued" ? sheet.queued : null}
        onClose={close}
        onSendNow={caps.steer ? (queued) => void source.sendQueuedNow(queued.id) : null}
        onRemove={(queued) => void source.removeQueued(queued.id)}
      />
    </ThreadContext>
  );
}

function textOfOutgoing(outgoing: Outgoing): string {
  return outgoing.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}
