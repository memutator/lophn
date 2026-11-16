// A session: the conversation with an agent (tools/wireframes/drafts/phone/session.tsx). The desktop conversation's
// values (thread, live text, pending, queued) come from `useConversation`; this screen lays them out for the phone: the
// thread follows the newest text, what waits on the person docks above the composer, and the composer's words follow the
// state (Reply…, Queue a message…, Reply instead…). A coding session of the computer's lophn app runs the same chat over
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
import { Pressable, View } from "react-native";
import type { AcpCommand, AcpCommandOpens } from "../../../../protocol/acp/mod.ts";
import { textBlocks } from "../../../../protocol/lophn-agent/content-block.ts";
import { codingBuiltinOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { ToolCallView } from "../../../../shell/renderer/conversation/activity/model.ts";
import type {
  PermissionsView,
  QueuedView,
} from "../../../../shell/renderer/conversation/agent-tab-source.ts";
import { capabilitiesOf, clockOf } from "../../../../shell/renderer/conversation/agent-view-model.ts";
import {
  afterReply,
  type Outgoing,
  startSend,
  waitsInQueue,
} from "../../../../shell/renderer/conversation/delivery-state.ts";
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
  useWorkspaces,
  type WorkspaceView,
} from "../../data/mod.ts";
import { DIM, Face, LOPHN, OfflineBanner, type Profile, useUnreachable } from "../../parts/mod.ts";
import { ContinueAsChat, harnessProfile, TerminalSession } from "../coding/index.tsx";
import { Pending } from "./ask.tsx";
import { attachedAbove, useAttachments } from "./attach.tsx";
import { duration, useTick } from "./parts.tsx";
import {
  AttachSheet,
  CommandsSheet,
  ContextSheet,
  contextLine,
  FilesSheet,
  ModelSheet,
  PermissionsSheet,
  QueuedMenu,
  RenameSheet,
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
  | {
      readonly kind: "attach" | "files" | "commands" | "model" | "menu" | "rename" | "context";
    };

// Commands the phone can carry out from the list: run as they are, or opened in one of this screen's sheets.
const OPENS: ReadonlySet<AcpCommandOpens | null> = new Set([
  null,
  "model",
  "effort",
  "permissions",
  "context",
  "status",
  "usage",
  "rename",
  "archive",
  "compact",
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
  useTick(waiting === undefined);
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

// A coding session of the computer's lophn app (Claude Code, Codex, ...).
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

/** In a terminal on the computer: its line and Switch to chat. In chat: the same conversation as a lophn agent's. */
function CodingSessionScreen({ place }: { place: CodingPlace }) {
  const target = useMemo<CodingTarget>(
    () => ({ session: place.session, coding: place.coding }),
    [place.session, place.coding],
  );
  const nav = useNav();
  const computer = useCurrentComputer()?.name ?? "";
  const row = useCodingSessions(place.coding.project).sessions.find((one) => one.session === place.session) ?? null;
  if (row?.view === "tui") {
    return (
      <TerminalSession
        session={row}
        computer={computer}
        top={
          <>
            <TopBar
              {...nav.menuButton}
              lead={<Face profile={harnessProfile(row.harness, row.label)} size={26} />}
              title={row.label}
              sub={row.title ?? undefined}
            />
            <OfflineBanner note={t("mobile.offline.note")} />
          </>
        }
      />
    );
  }
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
  // A relayed coding session: what the phone cannot do there (pictures, permissions, archive) is not offered.
  const relayed = "coding" in target ? target.coding : null;
  const { source, thread } = conversation;
  const computer = useCurrentComputer()?.name ?? "";
  const found = rowOf(useWorkspaces(), session);
  const names = useNames();
  const sample = useSampleConversation();
  const [sampleAt, setSampleAt] = useState(2);

  const face = conversation.agent ?? null;
  const who: { name: string; profile: Profile } = found?.row.who ??
    (face !== null
      ? { name: face.name, profile: face.profile }
      : codingRow !== null
        ? { name: codingRow.label, profile: harnessProfile(codingRow.harness, codingRow.label) }
        : { name: "", profile: LOPHN });
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

  const [draft, setDraft] = useState("");
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const attachments = useAttachments();
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
      });
      const next = afterReply(message, reply.ok ? { ok: true } : { ok: false, code: reply.code });
      setOutgoing(next);
      // Not taken: the words go back in the box to send again.
      if (next.phase === "not_sent") {
        setDraft(textOfOutgoing(next));
        if (sentWith.current?.id === message.id) restore(sentWith.current.items);
      }
    },
    [source, session, restore],
  );

  const commands = (meta?.commands ?? []).filter((command) => OPENS.has(command.opens));

  const run = (command: AcpCommand, argument: string) =>
    void source.act(session, { type: "run_command", session, key: actKey("cmd"), name: command.name, argument });

  const send = async () => {
    const text = draft.trim();
    const pictures = attachments.items;
    if ((text === "" && pictures.length === 0) || attachments.uploading) return;
    // `/name argument` runs a command the source lists, as the desktop composer does.
    const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text);
    const command =
      slash === null || pictures.length > 0
        ? undefined
        : commands.find((one) => one.name === slash[1] && one.opens === null);
    if (command !== undefined) {
      setDraft("");
      run(command, slash![2]!.trim());
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

  const pickCommand = (command: AcpCommand) => {
    switch (command.opens) {
      case null:
        if (command.argument_hint === null) {
          setSheet(null);
          run(command, "");
        } else {
          setDraft(`/${command.name} `);
          setSheet(null);
        }
        return;
      case "model":
      case "effort":
        setSheet({ kind: "model" });
        return;
      case "permissions":
        void openPermissions();
        return;
      case "rename":
        setSheet({ kind: "rename" });
        return;
      case "archive":
        setSheet(null);
        void archive();
        return;
      case "compact":
        setSheet(null);
        void source.act(session, { type: "compact", session, key: actKey("compact") });
        return;
      default:
        setSheet({ kind: "context" });
    }
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

  // One value for the whole list: rows redraw only when what they show changes (the agent's face, read-only, Retry).
  const canRetry = caps.retry;
  const apps = names.apps;
  const whoKey = `${who.name}\0${JSON.stringify(who.profile)}`;
  const actions = useMemo<ThreadActions>(
    () => ({
      session,
      source,
      agent: who,
      readOnly,
      canRetry,
      apps,
      openSteps: (calls, output = null) => setSheet({ kind: "steps", calls, output }),
      openThought: (text) => setSheet({ kind: "thought", text }),
      openDiff: (entryId) => nav.open({ name: "diff", session: target, entry: entryId }),
      openQueued: (queued) => setSheet({ kind: "queued", queued }),
      resend: (message) => void deliver({ ...message, phase: "sending", checked: false }),
    }),
    // `who` is a new object on every read of the workspace list; its name and face are what rows show.
    [session, source, whoKey, readOnly, canRetry, apps, nav, target, deliver],
  );

  // ---- top and bottom

  const workspaceName =
    (relayed === null ? undefined : names.projects.get(relayed.project)) ??
    face?.workspace?.name ??
    found?.workspace.name ??
    t("left-sidebar.label.home");
  const where =
    found?.desk == null
      ? t("mobile.session.label.where", { agent: who.name, workspace: workspaceName })
      : t("mobile.session.label.where-desk", { agent: who.name, workspace: workspaceName, desk: found.desk });
  const modeLabel = meta?.modes.find((mode) => mode.id === meta.mode)?.label ?? null;
  const project = lophn?.workspace?.kind === "project" ? lophn.workspace.id : null;

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
      <Face profile={who.profile} size={26} />
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
      <Composer
        value={draft}
        onChangeText={setDraft}
        onSend={() => void send()}
        above={attachedAbove(attachments)}
        canSend={attachments.items.length > 0}
        placeholder={placeholder}
        working={active?.phase === "working"}
        onStop={() => void conversation.stop()}
        onAttach={relayed === null ? () => setSheet({ kind: "attach" }) : undefined}
        disabled={unreachable !== null || conversation.connection === "reconnecting" || outgoing?.phase === "sending" || attachments.uploading}
        chips={
          caps.model && meta !== null && unreachable === null ? (
            <Chip onPress={() => setSheet({ kind: "model" })}>{picker.currentLabel}</Chip>
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
            title={who.name}
            sub={title}
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
        pictures={caps.images}
        computer={computer}
        offline={conversation.connection === "reconnecting"}
        onPicked={(picked) => void attachments.add(picked)}
        onFile={project === null ? null : () => setSheet({ kind: "files" })}
        onCommands={caps.commands && commands.length > 0 ? () => setSheet({ kind: "commands" }) : null}
      />
      {project !== null && (
        <FilesSheet
          project={project}
          name={workspaceName}
          open={sheet?.kind === "files"}
          onClose={close}
          onPick={(path) => {
            setDraft((text) => (text === "" || text.endsWith(" ") ? `${text}${path} ` : `${text} ${path} `));
            setSheet(null);
          }}
        />
      )}
      <CommandsSheet commands={commands} open={sheet?.kind === "commands"} onClose={close} onPick={pickCommand} />
      <ModelSheet picker={picker} open={sheet?.kind === "model"} onClose={close} />
      <SessionMenu
        open={sheet?.kind === "menu"}
        onClose={close}
        profile={who.profile}
        title={title}
        where={where}
        mode={modeLabel}
        context={contextLine(meta)}
        canRename={caps.rename && !readOnly}
        onRename={() => setSheet({ kind: "rename" })}
        onPermissions={relayed === null ? () => void openPermissions() : null}
        onContext={() => setSheet({ kind: "context" })}
        onArchive={caps.sessions && !archived ? () => void archive() : null}
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
        view={sheet?.kind === "permissions" ? sheet.view : null}
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
