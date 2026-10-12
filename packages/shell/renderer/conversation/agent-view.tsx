// Agent 화면(shell/desktop#R37~R48): 한 agent의 한 session을 보이는 탭 본문. header, 대화, 대화 안 질문 묶음,
// composer 위의 승인 카드, 진행, composer를 부품 그대로 묶는다. core와는 AgentViewSource로만 말하고
// 탭을 열고 닫는 일, 문서와 설정으로 가는 일은 host가 한다.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconButton, retryIcon } from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { newId } from "../desktop/lophn-space/model.ts";
import type {
  SaveRequest,
  VisualHost,
} from "../workspace/visuals/block-frame.tsx";
import { ProgressChip } from "./activity/progress-chip.tsx";
import type { ViewDetail } from "./activity/model.ts";
import { ViewDetailSelect } from "./activity/view-detail-select.tsx";
import { AgentNotices } from "./agent-notices.tsx";
import type {
  AgentViewSource,
  RewindMenuView,
  SourceResult,
  ThreadView,
} from "./agent-source.ts";
import { AgentThread } from "./agent-thread.tsx";
import { intervalTicks, type Ticks, useAgentData } from "./agent-view-data.ts";
import {
  excerptOf,
  hiddenOf,
  messagesOf,
  newSessionKey,
  sessionGroup,
  visualSaveState,
} from "./agent-view-model.ts";
import { ApprovalCard } from "./approval-card/approval-card.tsx";
import {
  afterCheck,
  afterReply,
  composerLocked,
  fitsMessage,
  type Outgoing,
  resend,
  type SendMode,
  startSend,
} from "./delivery-state.ts";
import { loadBodies } from "./bodies.ts";
import {
  AgentComposer,
  type ContextChipView,
} from "./composer/agent-composer.tsx";
import type { DraftStore } from "./drafts.ts";
import { AgentHeader, type SessionLine } from "./header/agent-header.tsx";
import type { SlashEntryView } from "./slash-menu/slash-menu.tsx";
import type { ContextLinks } from "./result-links.tsx";
import { RewindMenu } from "./rewind/rewind-menu.tsx";
import { useModelPicker } from "./use-model-picker.ts";
import { useSlashMenu } from "./use-slash-menu.tsx";
import styles from "./agent-view.module.css";

/** Agent 화면이 자기 밖에 맡기는 일: 탭·문서·설정으로 가는 길. */
export interface AgentViewHost {
  /** 결과 링크와 편집 카드의 [Open]이 그 문서(의 판)를 연다. */
  openResult?: (document: string, version: string | null) => void;
  /** 대화 속 context 이름 링크가 그 context의 탭을 여는 길(shell/workspace#R31). */
  contexts?: ContextLinks;
  /** 권한 요약과 `/permissions`가 Agents 화면의 Permissions로 간다. */
  openPermissions: () => void;
  /** Change defaults…(defaults)와 `/skills`·`/mcp`가 Settings › Agents로 간다. */
  openAgentSettings: (target: "defaults" | "skills" | "mcp") => void;
  /** Fork가 만든 session을 같은 agent의 새 탭(앱 공간에서는 같은 칸)으로 연다(R48). */
  openForked: (session: string) => void;
  showUsage: () => void;
  /** 탭·칸만 닫는다. session은 그대로 남는다. */
  closeTab: () => void;
  /** composer의 [+]. */
  attach: () => void;
  /** 설정의 연결 자리로 간다. provider 끊김 줄의 행동이 쓴다. */
  openConnections?: () => void;
}

export interface AgentViewProps {
  source: AgentViewSource;
  /** 창마다 하나인 입력 메모리. 탭을 닫았다 열어도 쓰던 글이 남는다(desktop#R8). */
  drafts: DraftStore;
  /** 보고 있는 session. null은 아직 만들지 않은 새 session이고 첫 말을 보낼 때 만든다. */
  session: string | null;
  onSessionChange: (session: string | null) => void;
  host: AgentViewHost;
  /** 새 session의 첫 말을 보내기 전에 composer 위에 붙는 context(notification의 [Ask]). */
  contextChips?: readonly ContextChipView[];
  /** 대화가 비어 있는 동안 입력칸에 보이는 첫 안내. */
  hint?: string;
  /** 다시 읽는 박자. test가 직접 부른다. */
  ticks?: Ticks;
  now?: () => number;
}

type Problem = "open-failed" | "stop-failed" | "action-failed";

const PROBLEM_TEXT = {
  "open-failed": "conversation.error.open-failed",
  "stop-failed": "conversation.error.stop-failed",
  "action-failed": "conversation.error.action-failed",
} as const;

export function AgentView(props: AgentViewProps) {
  const { source, drafts, session, host } = props;
  // 보던 session이 사라진 읽기와 지운 쓰기가 같은 말을 두 번 하지 않게 한다.
  const current = useRef(session);
  current.current = session;
  const onSessionChange = (next: string | null) => {
    if (next === current.current) return;
    current.current = next;
    props.onSessionChange(next);
  };
  const ticks = props.ticks ?? intervalTicks;
  const now = props.now ?? Date.now;
  const draftsVersion = useSyncExternalStore(drafts.subscribe, drafts.version);
  const [detail, setDetail] = useState<ViewDetail>("compact");
  // 열려 있는 Rewind menu. message가 null이면 header의 Rewind…라 시점을 menu에서 고른다.
  const [rewind, setRewind] = useState<
    { message: string | null; menu: RewindMenuView } | null
  >(null);
  const [chips, setChips] = useState(props.contextChips ?? []);
  const [problem, setProblem] = useState<Problem | null>(null);

  const { loaded, connection, refresh } = useAgentData({
    source,
    drafts,
    session,
    ticks,
    now,
    onGone: () => onSessionChange(null),
  });
  const agent = loaded.agent;
  const entry = loaded.sessions.find((item) => item.id === session) ?? null;
  const thread: ThreadView | null = loaded.threadSession === session
    ? loaded.thread
    : null;
  const key = session ?? newSessionKey(agent?.assignment ?? "");
  const draft = drafts.draft(key);
  const run = thread?.run ?? null;
  const active = run !== null && run.phase !== "ended" ? run : null;
  const offline = connection.state !== "ready";
  const messages = messagesOf(thread);

  const fail = () => setProblem("action-failed");
  const picker = useModelPicker({
    source,
    session,
    onProblem: fail,
    onChangeDefaults: () => host.openAgentSettings("defaults"),
  });

  const perform = async (
    call: () => Promise<SourceResult<void>>,
  ): Promise<boolean> => {
    const result = await call();
    setProblem(result.ok ? null : "action-failed");
    void refresh();
    return result.ok;
  };

  // menu의 재료(시점·막힌 범위·실행 중 여부)는 열 때 한 번 읽는다. 읽지 못하면 열지 않고 그렇다고 말한다.
  const openRewind = async (message: string | null) => {
    if (session === null) return;
    const read = await source.rewindMenu(session);
    if (read.ok) {
      setProblem(null);
      setRewind({ message, menu: read.value });
    } else fail();
  };

  // rewind가 새로 숨긴 구간이 생기면 고른 메시지의 원문을 입력창에 채운다(lophn-agent/revert#R16). 처음 열었을 때
  // 이미 있던 구간이나, 이미 쓰던 글이 있으면 건드리지 않는다.
  const seenHidden = useRef<{ session: string; reverts: Set<string> } | null>(
    null,
  );
  const fillFrom = useRef<string | null>(null);
  const hidden = hiddenOf(thread);
  useEffect(() => {
    if (session === null || thread === null) return;
    const seen = seenHidden.current;
    if (seen === null || seen.session !== session) {
      seenHidden.current = {
        session,
        reverts: new Set(hidden.map((item) => item.revert)),
      };
      fillFrom.current = null;
      return;
    }
    for (const item of hidden) {
      if (seen.reverts.has(item.revert)) continue;
      seen.reverts.add(item.revert);
      if (item.redo) fillFrom.current = item.checkpoint;
    }
    const checkpoint = fillFrom.current;
    if (checkpoint === null) return;
    const body = drafts.body(checkpoint);
    // 본문을 읽는 중이면 읽힐 때 다시 본다.
    if (body === undefined || body.state === "loading") return;
    fillFrom.current = null;
    const current = drafts.draft(session);
    if (body.state !== "ready" || current.text !== "") return;
    const text = body.parts.flatMap((part) =>
      part.kind === "text" ? [part.text] : []
    ).join("\n");
    if (text === "") return;
    drafts.save(session, { text, selection: [text.length, text.length] });
  }, [thread, session, drafts, draftsVersion]);

  // 첫 말을 보낼 때 session을 만든다. 남은 chip이 그 session의 첫 context가 되고, 쓰던 글은 새 session의 것이 된다.
  const ensureSession = async (): Promise<string | null> => {
    if (session !== null) return session;
    const id = newId("ses", now());
    const opened = await source.openSession({ id, contexts: chips });
    if (!opened.ok) {
      setProblem("open-failed");
      return null;
    }
    setProblem(null);
    setChips([]);
    drafts.save(id, {
      text: draft.text,
      selection: draft.selection,
      mode: draft.mode,
    });
    drafts.save(key, { text: "", selection: [0, 0], mode: "request" });
    onSessionChange(id);
    return id;
  };

  const deliver = async (target: string, outgoing: Outgoing) => {
    const reply = await source.send({
      session: target,
      id: outgoing.id,
      key: outgoing.key,
      text: outgoing.text,
      mode: outgoing.mode,
      run: outgoing.run,
    });
    const next = afterReply(
      outgoing,
      reply.ok ? { ok: true } : { ok: false, code: reply.code },
    );
    if (next.phase === "accepted") {
      drafts.sent(target, next);
      void refresh();
    } else if (next.phase === "not_sent" && drafts.isSaveRequest(next.id)) {
      // 문서로 남기기 요청은 입력칸의 글이 아니다. 블록 틀이 실패를 보이고 다시 누르게 한다.
      drafts.saveFailed(next.id);
      drafts.save(target, { outgoing: null });
    } else {
      drafts.save(target, { outgoing: next });
    }
  };

  const dispatch = async (
    text: string,
    mode: SendMode,
    runId: string | null,
    target: string,
  ) => {
    const id = newId("msg", now());
    drafts.remember(id, text);
    const outgoing = startSend({
      id,
      key: `messages-receive-${id}`,
      text,
      mode,
      run: runId,
    });
    drafts.save(target, { outgoing });
    await deliver(target, outgoing);
    return id;
  };

  const readOnly = entry?.closed === true || agent?.state === "withdrawn";
  const sendable = agent?.state === "enabled" && !readOnly;
  const chipText = chips.map((chip) => chip.label).join("\n");

  const send = async (requested: SendMode) => {
    if (!sendable || composerLocked(draft.outgoing)) return;
    const text = draft.text.trim() === "" && session === null
      ? chipText
      : draft.text;
    if (text.trim() === "" || !fitsMessage(text)) return;
    const mode = requested === "correction" && active
      ? "correction"
      : "request";
    const target = await ensureSession();
    if (target === null) return;
    await dispatch(
      text,
      mode,
      mode === "correction" ? active!.id : null,
      target,
    );
  };

  // 시각 블록을 문서로 남겨 달라는 요청을 대화 입력으로 보낸다(lophn-agent Q45 (6)). 따로 저장
  // contract를 부르지 않고 agent가 visual.prepare_document와 문서 tool로 준비·저장한다. 작성 중인
  // 글과 focus·읽던 위치는 건드리지 않는다(shell/workspace#R13).
  const saveVisual = async (request: SaveRequest) => {
    if (session === null || !sendable || composerLocked(draft.outgoing)) return;
    const text = t("conversation.body.save-visual-request", {
      title: request.title,
      block: request.block,
      message: request.message,
    });
    if (!fitsMessage(text)) return;
    const id = newId("msg", now());
    drafts.remember(id, text);
    drafts.requestSave(request.message, request.block, id);
    const outgoing = startSend({
      id,
      key: `messages-receive-${id}`,
      text,
      mode: "request",
      run: null,
    });
    drafts.save(session, { outgoing });
    await deliver(session, outgoing);
  };

  // 결과를 모르는 말은 다시 보내기 전에 기록에서 먼저 찾는다(desktop#R8).
  const check = async () => {
    const outgoing = draft.outgoing;
    if (session === null || outgoing === null) return;
    const read = await source.thread(session);
    if (!read.ok) return;
    const found = messagesOf(read.value).some((item) =>
      item.id === outgoing.id
    );
    const next = afterCheck(outgoing, found);
    void loadBodies(source, drafts, messagesOf(read.value));
    if (next.phase === "accepted") drafts.sent(session, next);
    else drafts.save(session, { outgoing: next });
    void refresh();
  };

  const sendAgain = async () => {
    if (session === null || draft.outgoing === null) return;
    const next = resend(draft.outgoing);
    if (next === draft.outgoing) return;
    drafts.save(session, { outgoing: next });
    await deliver(session, next);
  };

  const stop = async () => {
    if (active === null) return;
    const stopped = await source.stop(active.id, newId("stop", now()));
    setProblem(stopped.ok ? null : "stop-failed");
    void refresh();
  };

  const fork = async (through: string | null) => {
    if (session === null) return;
    const id = newId("ses", now());
    if (await perform(() => source.forkSession({ id, session, through }))) {
      host.openForked(id);
    }
  };

  const startNew = () => {
    setChips([]);
    onSessionChange(null);
  };

  const runSlash = (command: SlashEntryView, argument: string) => {
    const clear = () =>
      drafts.save(key, { text: "", selection: [0, 0], mode: "request" });
    if (command.source === "builtin") {
      switch (command.name) {
        case "rename": {
          // 새 이름을 쓸 때까지 기다린다.
          if (argument === "") {
            drafts.save(key, { text: "/rename ", selection: [8, 8] });
            return;
          }
          clear();
          if (session !== null) {
            void perform(() => source.renameSession(session, argument));
          }
          return;
        }
        case "new":
          clear();
          return startNew();
        case "archive":
          clear();
          if (session !== null) {
            void perform(() => source.archiveSession(session));
          }
          return;
        case "compact":
          clear();
          if (session !== null) {
            void perform(() => source.compactSession(session));
          }
          return;
        case "fork":
          clear();
          return void fork(null);
        case "permissions":
          clear();
          return host.openPermissions();
        case "mcp":
        case "skills":
          clear();
          return host.openAgentSettings(command.name);
      }
      return;
    }
    // role 명령과 skill 명령은 사람이 보낸 말로 접수되므로 session이 있어야 한다.
    clear();
    void (async () => {
      const target = await ensureSession();
      if (target !== null) {
        await perform(() =>
          source.runCommand(target, command, newId("cmd", now()))
        );
      }
    })();
  };

  const slash = useSlashMenu({
    source,
    session,
    text: draft.text,
    agentName: agent?.name ?? "",
    working: active !== null,
    onRun: runSlash,
    onProblem: fail,
  });

  if (agent === undefined) {
    return (
      <section className={styles.view} data-agent-view="">
        {loaded.failed
          ? (
            <div className={styles.failed} data-load-failed="">
              <p>{t("conversation.error.load-failed")}</p>
              <IconButton
                icon={retryIcon}
                label={t("common.button.retry")}
                variant="secondary"
                size="sm"
                onClick={() => void refresh()}
              />
            </div>
          )
          : null}
      </section>
    );
  }
  if (agent === null) {
    return (
      <section className={styles.view} data-agent-view="">
        <p className={styles.noAgent} data-no-agent="">
          {t("conversation.empty.no-agent")}
        </p>
      </section>
    );
  }

  const lines: SessionLine[] = [...loaded.sessions]
    .sort((a, b) => b.activeAt.localeCompare(a.activeAt))
    .map((item) => ({
      id: item.id,
      assignment: item.assignment,
      title: item.title ?? t("conversation.label.session-untitled"),
      status: item.status,
      activeAt: item.activeAt,
      group: sessionGroup(item.activeAt, now()),
      archived: item.archived,
    }));

  const visuals: VisualHost = {
    documentTitle: source.documentTitle,
    ...(host.openResult === undefined ? {} : { open: host.openResult }),
    ...(readOnly
      ? {}
      : { save: (request: SaveRequest) => void saveVisual(request) }),
    saveLocked: offline || composerLocked(draft.outgoing),
    saveState: (message, block) =>
      visualSaveState(drafts.saveOf(message, block), draft.outgoing, messages),
    now: () => new Date(now()),
  };

  const empty = messages.length === 0 && draft.outgoing === null;
  const hint = empty && props.hint !== undefined
    ? props.hint
    : t("conversation.placeholder.ask", { agent: agent.name });
  const known = (message: string) =>
    messages.some((item) => item.id === message);

  return (
    <section className={styles.view} data-agent-view="">
      <AgentHeader
        agent={agent}
        session={{
          id: session ?? "",
          title: entry === null
            ? t("conversation.title.new-session")
            : entry.title ?? t("conversation.label.session-untitled"),
        }}
        sessions={lines}
        now={new Date(now())}
        // 아직 session이 없으면 고치거나 복사하거나 되돌릴 것이 없다.
        sessionClosed={session === null || entry?.closed === true}
        onSwitch={onSessionChange}
        onNew={startNew}
        onRename={(id, title) =>
          void perform(() => source.renameSession(id, title))}
        onArchive={(id) => void perform(() => source.archiveSession(id))}
        onUnarchive={(id) => void perform(() => source.unarchiveSession(id))}
        onDelete={(id) =>
          void perform(() => source.deleteSession(id)).then((deleted) => {
            if (deleted && id === session) onSessionChange(null);
          })}
        onForkSession={() => void fork(null)}
        onRewindMenu={() => void openRewind(null)}
        onUsage={host.showUsage}
        onCloseTab={host.closeTab}
      >
        <div className={styles.tools}>
          <ProgressChip tasks={thread?.tasks ?? []} />
          <ViewDetailSelect value={detail} onChange={setDetail} />
        </div>
      </AgentHeader>
      {offline || loaded.failed
        ? (
          <p className={styles.stale} data-stale="">
            {loaded.checkedAt === null
              ? t("conversation.notice.stale-never")
              : t("conversation.notice.stale", {
                age: formatRelativeTime(
                  new Date(loaded.checkedAt),
                  new Date(now()),
                ),
              })}
          </p>
        )
        : null}
      {problem === null
        ? null
        : (
          <p className={styles.problem} data-problem={problem}>
            {t(PROBLEM_TEXT[problem])}
          </p>
        )}
      <AgentThread
        key={key}
        agent={agent}
        entries={thread?.entries ?? []}
        detail={detail}
        outgoing={draft.outgoing}
        sessionClosed={readOnly}
        now={now()}
        offline={offline}
        drafts={drafts}
        titles={source}
        visuals={visuals}
        contexts={host.contexts}
        initialScroll={draft.scroll}
        onScroll={(position) => drafts.save(key, { scroll: position })}
        onOpenResult={host.openResult}
        onRewind={(message) => {
          if (known(message)) void openRewind(message);
        }}
        onFork={(message) => {
          if (known(message)) void fork(message);
        }}
        onCheck={() => void check()}
        onResend={() => void sendAgain()}
        onUndo={(edit) => {
          if (session !== null) {
            void perform(() => source.undoEdit(session, edit.id));
          }
        }}
        onRedo={(revert) => {
          if (session !== null) {
            void perform(() => source.redoRewind(session, revert));
          }
        }}
        onAnswer={(group, answers) =>
          void perform(() => source.answerQuestions({ group, answers }))}
        onSkip={(group) => void perform(() => source.deferQuestions(group))}
      />
      <div className={styles.bottom} onKeyDown={slash.onKeyDown}>
        <AgentNotices
          notices={loaded.notices}
          working={active !== null}
          onConnections={host.openConnections}
          onCheck={() => void refresh()}
        />
        {thread?.approval
          ? (
            <ApprovalCard
              request={thread.approval}
              onOpenConfirmation={(choice) =>
                void perform(() =>
                  source.openApproval({
                    approval: thread.approval!.id,
                    choice,
                  })
                )}
            />
          )
          : null}
        {readOnly
          ? (
            <p className={styles.notice} data-ended="">
              {t("conversation.notice.ended")}
            </p>
          )
          : agent.state === "paused"
          ? (
            <p className={styles.notice} data-paused="">
              {t("conversation.notice.agent-paused")}
            </p>
          )
          : (
            <AgentComposer
              key={key}
              draft={draft}
              working={active !== null}
              locked={composerLocked(draft.outgoing)}
              tooLong={!fitsMessage(draft.text)}
              offline={offline}
              hint={hint}
              contexts={session === null ? chips : []}
              picker={picker}
              slashMenu={slash.menu}
              place={agent.place}
              permissionSummary={agent.permissionSummary}
              onDraft={(patch) => drafts.save(key, patch)}
              onRemoveContext={(id) =>
                setChips((current) => current.filter((chip) => chip.id !== id))}
              onAttach={host.attach}
              onOpenPermissions={host.openPermissions}
              onSend={(mode) => {
                if (draft.text.startsWith("/")) void slash.submit();
                else void send(mode);
              }}
              onStop={() => void stop()}
            />
          )}
      </div>
      {rewind === null || session === null ? null : (
        <RewindMenu
          menu={rewind.menu}
          message={rewind.message}
          excerpt={(message) => excerptOf(drafts.body(message))}
          preview={(message, choice) =>
            source.rewindPreview(session, message, choice)}
          onRewind={async (input) => {
            const result = await source.rewind({ session, ...input });
            void refresh();
            return result;
          }}
          onClose={() => setRewind(null)}
        />
      )}
    </section>
  );
}
