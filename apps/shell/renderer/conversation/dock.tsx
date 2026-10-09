import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Button,
  conversationIcons,
  EmptyState,
  Icon,
  IconButton,
  iconPixels,
  Menu,
  retryIcon,
  StatusMark,
  Tooltip,
} from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import type {
  ConnectionState,
  CoreSource,
} from "../desktop/connection/connection.ts";
import {
  type ProviderFacts,
  readProviderFacts,
} from "../desktop/connection/provider-state.ts";
import { ProviderNotice } from "../desktop/connection/connection.tsx";
import { ExternalNotice } from "./external-guide.tsx";
import { type ExternalGuide, loadExternalGuide } from "./external-guide.ts";
import { newId } from "../desktop/lophn-space/model.ts";
import type {
  SaveRequest,
  VisualHost,
} from "../workspace/visuals/block-frame.tsx";
import {
  afterCheck,
  afterReply,
  composerLocked,
  fitsMessage,
  type Outgoing,
  resend,
  startSend,
  textContent,
} from "./delivery-state.ts";
import { loadBodies } from "./bodies.ts";
import type { DraftStore } from "./drafts.ts";
import {
  activeRun,
  defaultSession,
  DOCK_WIDTH,
  latestRun,
  listItems,
  sessionChoices,
  visualSaveState,
  type WorkStatus,
  workStatus,
} from "./model.ts";
import type {
  Agent,
  ConversationSource,
  MessageRow,
  RunRow,
  SessionRow,
  WorkPlace,
} from "./source.ts";
import { MessageList } from "./message-list/message-list.tsx";
import { Composer } from "./composer/composer.tsx";
import { QuestionStrip } from "./question-strip/question-strip.tsx";
import styles from "./dock.module.css";

export type Ticks = (listener: () => void) => () => void;

export interface DockProps {
  source: ConversationSource;
  drafts: DraftStore;
  placement: "docked" | "overlay";
  /** 본문 안에 놓는다(roles 화면의 대화 탭). 폭을 채우고 닫기 단추를 두지 않는다. */
  embedded?: boolean;
  /** 새 세션을 열 자리. 지금 공간이다(lophn-agent/conversation#R16). */
  workPlace: WorkPlace;
  onClose: () => void;
  onOpenResult?: (document: string, version: string | null) => void;
  /** 다시 읽는 박자. 테스트가 직접 부른다. */
  ticks?: Ticks;
  now?: () => number;
  /**
   * main의 core 통로. provider 계정 상태(desktop#R7의 provider 끊김)를 여기서 읽는다.
   * 없으면(통로 없는 테스트) provider 끊김 줄을 두지 않는다.
   */
  core?: CoreSource;
  /** 설정의 연결 자리로 간다. provider 끊김 줄의 행동이 쓴다. */
  onSettings?: () => void;
}

/** 기본 박자. 열린 도크만 3초마다 현재 기록을 읽는다. */
export const POLL_MS = 3000;

const intervalTicks: Ticks = (listener) => {
  const id = setInterval(listener, POLL_MS);
  return () => clearInterval(id);
};

interface Loaded {
  /** undefined는 아직 읽지 않았다. null은 대화할 lophn이 없다. */
  readonly agent: Agent | null | undefined;
  readonly sessions: readonly SessionRow[];
  readonly runs: readonly RunRow[];
  readonly messages: Readonly<Record<string, readonly MessageRow[]>>;
  /** 마지막으로 현재 기록을 확인한 시각. */
  readonly checkedAt: number | null;
  /** 마지막 읽기가 실패했다. 이전 내용은 그대로 둔다(desktop#R7). */
  readonly failed: boolean;
}

const EMPTY: Loaded = {
  agent: undefined,
  sessions: [],
  runs: [],
  messages: {},
  checkedAt: null,
  failed: false,
};

const STATUS_LABEL: Record<
  WorkStatus,
  | "conversation.label.status-in-progress"
  | "conversation.label.status-waiting"
  | "conversation.label.status-stopped"
  | "conversation.label.status-done"
> = {
  "in-progress": "conversation.label.status-in-progress",
  waiting: "conversation.label.status-waiting",
  stopped: "conversation.label.status-stopped",
  done: "conversation.label.status-done",
};

const STATUS_TONE = {
  "in-progress": "neutral",
  waiting: "warning",
  stopped: "serious",
  done: "good",
} as const;

// 대화 도크. 모든 공간 오른쪽 400px에서 열고 닫는다(shell/desktop#R1, R2). 상태는 core의
// 현재 기록을 다시 읽어 맞추고, 끊기면 마지막 내용과 확인 시각을 둔다(R7). provider 끊김은
// core가 살아 있어도 대화만 끊기므로 계정 상태를 따로 읽고 한 줄로 보인다(desktop#R7).
export function Dock(
  {
    source,
    drafts,
    placement,
    embedded = false,
    workPlace,
    onClose,
    onOpenResult,
    ticks = intervalTicks,
    now = Date.now,
    core,
    onSettings,
  }: DockProps,
) {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY);
  const [connection, setConnection] = useState<ConnectionState>({
    state: "starting",
    confirmedAt: null,
  });
  const [provider, setProvider] = useState<ProviderFacts | null>(null);
  const [guide, setGuide] = useState<ExternalGuide | null>(null);
  const [problem, setProblem] = useState<
    "open-failed" | "stop-failed" | null
  >(null);
  useSyncExternalStore(drafts.subscribe, drafts.version);
  const latest = useRef(loaded);
  latest.current = loaded;

  const selected = drafts.selected();
  const current = selected !== null &&
      loaded.sessions.some((session) => session.id === selected)
    ? selected
    : defaultSession(loaded.sessions);

  const refresh = useCallback(async () => {
    const agent = await source.agent();
    if (!agent.ok) {
      setLoaded((state) => ({ ...state, failed: true }));
      return;
    }
    if (agent.value === null) {
      setLoaded({ ...EMPTY, agent: null, checkedAt: now() });
      return;
    }
    const [sessions, runs] = await Promise.all([
      source.sessions(agent.value.id),
      source.runs(agent.value.id),
    ]);
    if (!sessions.ok || !runs.ok) {
      setLoaded((state) => ({ ...state, failed: true }));
      return;
    }
    const chosen = drafts.selected();
    const session = chosen !== null &&
        sessions.value.some((item) => item.id === chosen)
      ? chosen
      : defaultSession(sessions.value);
    let messages = latest.current.messages;
    if (session !== null) {
      const listed = await source.messages(session);
      if (!listed.ok) {
        setLoaded((state) => ({ ...state, failed: true }));
        return;
      }
      messages = { ...messages, [session]: listed.value };
      // 본문은 따로 읽는다. 목록 확인을 본문 읽기가 막지 않는다.
      void loadBodies(source, drafts, listed.value);
      // 접수 확인 안 된 말이 기록에 있으면 그것이 접수의 증거다.
      const outgoing = drafts.draft(session).outgoing;
      if (
        outgoing !== null && outgoing.phase !== "sending" &&
        listed.value.some((message) => message.id === outgoing.id)
      ) {
        drafts.sent(session, outgoing);
      }
    }
    setLoaded({
      agent: agent.value,
      sessions: sessions.value,
      runs: runs.value,
      messages,
      checkedAt: now(),
      failed: false,
    });
  }, [source, drafts, now]);

  useEffect(() => {
    let previous: ConnectionState["state"] | null = null;
    const stop = source.watch((state) => {
      setConnection(state);
      // 다시 붙으면 놓친 진행을 하나씩 다시 보이지 않고 현재 기록으로 맞춘다.
      if (state.state === "ready" && previous !== "ready") void refresh();
      previous = state.state;
    });
    return stop;
  }, [source, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh, current]);

  // provider 계정 상태(desktop#R7). core가 살아 있을 때만 읽고, 다시 살아나면 다시 읽는다.
  useEffect(() => {
    if (core === undefined) return;
    let live = true;
    if (connection.state === "ready") {
      void readProviderFacts(core).then((facts) => {
        if (live) setProvider(facts);
      });
    } else {
      setProvider(null);
    }
    return () => {
      live = false;
    };
  }, [core, connection.state, refresh]);

  useEffect(
    () =>
      ticks(() => {
        if (connection.state === "ready") void refresh();
      }),
    [ticks, refresh, connection.state],
  );

  const agent = loaded.agent;
  const session = loaded.sessions.find((item) => item.id === current) ?? null;
  const draft = current === null ? null : drafts.draft(current);
  const run = current === null ? null : latestRun(loaded.runs, current);
  const active = activeRun(run);
  const runId = run?.id ?? null;
  // core가 끊기면 마지막으로 읽은 안내를 둔다. 끊김을 연결 실패로 바꾸지 않는다.
  useEffect(() => {
    if (core === undefined || runId === null) {
      setGuide(null);
      return;
    }
    if (connection.state !== "ready") return;
    let live = true;
    void loadExternalGuide(core, runId).then((next) => {
      if (live) setGuide(next);
    });
    return () => {
      live = false;
    };
  }, [core, connection.state, runId, loaded.checkedAt]);
  const offline = connection.state !== "ready";

  const deliver = async (
    target: SessionRow,
    from: Agent,
    outgoing: Outgoing,
  ) => {
    const reply = await source.send({
      session: target,
      agent: from,
      id: outgoing.id,
      key: outgoing.key,
      content: textContent(outgoing.text),
      mode: outgoing.mode,
      run: outgoing.run,
    });
    const next = afterReply(
      outgoing,
      reply.ok ? { ok: true } : { ok: false, code: reply.code },
    );
    if (next.phase === "accepted") {
      drafts.sent(target.id, next);
      void refresh();
    } else if (next.phase === "not_sent" && drafts.isSaveRequest(next.id)) {
      // 문서로 남기기 요청은 입력칸의 글이 아니다. 블록 틀이 실패를 보이고 다시 누르게 한다.
      drafts.saveFailed(next.id);
      drafts.save(target.id, { outgoing: null });
    } else {
      drafts.save(target.id, { outgoing: next });
    }
  };

  const send = async () => {
    if (!session || !agent || !draft) return;
    const text = draft.text;
    if (text.trim().length === 0 || composerLocked(draft.outgoing)) return;
    // 상한을 넘는 글은 보내지 않는다. 입력칸이 이유를 보인다.
    if (!fitsMessage(text)) return;
    const mode = draft.mode === "correction" && active
      ? "correction"
      : "request";
    const id = newId("msg", now());
    drafts.remember(id, text);
    const outgoing = startSend({
      id,
      key: `messages-receive-${id}`,
      text,
      mode,
      run: mode === "correction" && active ? active.id : null,
    });
    drafts.save(session.id, { outgoing });
    await deliver(session, agent, outgoing);
  };

  // 시각 블록을 문서로 남겨 달라는 요청을 대화 입력으로 보낸다(lophn-agent Q45 (6)). 따로 저장
  // contract를 부르지 않고 agent가 visual.prepare_document와 문서 tool로 준비·저장한다. 작성 중인
  // 글과 focus·읽던 위치는 건드리지 않는다(shell/workspace#R13).
  const saveVisual = async (request: SaveRequest) => {
    if (!session || !agent || !draft || composerLocked(draft.outgoing)) return;
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
    drafts.save(session.id, { outgoing });
    await deliver(session, agent, outgoing);
  };

  // 결과를 모르는 말은 다시 보내기 전에 기록에서 먼저 찾는다(desktop#R8).
  const check = async () => {
    if (!session || !draft?.outgoing) return;
    const outgoing = draft.outgoing;
    const listed = await source.messages(session.id);
    if (!listed.ok) return;
    const next = afterCheck(
      outgoing,
      listed.value.some((message) => message.id === outgoing.id),
    );
    setLoaded((state) => ({
      ...state,
      messages: { ...state.messages, [session.id]: listed.value },
    }));
    void loadBodies(source, drafts, listed.value);
    if (next.phase === "accepted") drafts.sent(session.id, next);
    else drafts.save(session.id, { outgoing: next });
  };

  const sendAgain = async () => {
    if (!session || !agent || !draft?.outgoing) return;
    const next = resend(draft.outgoing);
    if (next === draft.outgoing) return;
    drafts.save(session.id, { outgoing: next });
    await deliver(session, agent, next);
  };

  const stop = async () => {
    if (!active) return;
    const stopped = await source.stop(active, newId("stop", now()));
    setProblem(stopped.ok ? null : "stop-failed");
    void refresh();
  };

  const openSession = async () => {
    if (!agent || agent.state === "withdrawn") return;
    const opened = await source.openSession({
      id: newId("ses", now()),
      agent,
      workPlace,
    });
    if (!opened.ok) {
      setProblem("open-failed");
      return;
    }
    setProblem(null);
    drafts.select(opened.value.id);
    setLoaded((state) => ({
      ...state,
      sessions: [...state.sessions, opened.value],
      messages: { ...state.messages, [opened.value.id]: [] },
    }));
  };

  const choices = sessionChoices(loaded.sessions);
  const choice = choices.find((item) => item.id === current);
  const canOpen = agent !== undefined && agent !== null &&
    agent.state !== "withdrawn";

  const header = (
    <div className={styles.head}>
      <div className={styles.title}>
        <Icon icon={conversationIcons.dock} pixels={iconPixels("base")} />
        {choice
          ? (
            <Menu
              trigger={
                <Button variant="ghost" size="sm" data-session-menu="">
                  {sessionLabel(choice.number, choice.ended)}
                </Button>
              }
              items={choices.map((item) => ({
                id: item.id,
                label: sessionLabel(item.number, item.ended),
              }))}
              onSelect={(id) => drafts.select(id)}
            />
          )
          : (
            <span className={styles.name}>
              {t("conversation.title.dock")}
            </span>
          )}
      </div>
      <div className={styles.tools}>
        {canOpen
          ? (
            <Tooltip content={t("conversation.button.new-session")}>
              <IconButton
                icon={conversationIcons.newSession}
                label={t("conversation.button.new-session")}
                size="sm"
                data-new-session=""
                disabled={offline}
                onClick={() => void openSession()}
              />
            </Tooltip>
          )
          : null}
        {embedded ? null : (
          <Tooltip content={t("conversation.button.close")}>
            <IconButton
              icon={conversationIcons.close}
              label={t("conversation.button.close")}
              size="sm"
              data-close-dock=""
              onClick={onClose}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );

  const stale = offline || loaded.failed
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
    : null;

  const body = (() => {
    if (agent === undefined) {
      return loaded.failed
        ? (
          <div className={styles.failed} data-load-failed="">
            <p>{t("conversation.error.load-failed")}</p>
            <Tooltip content={t("common.button.retry")}>
              <IconButton
                icon={retryIcon}
                label={t("common.button.retry")}
                variant="secondary"
                size="sm"
                onClick={() => void refresh()}
              />
            </Tooltip>
          </div>
        )
        : null;
    }
    if (agent === null) {
      return (
        <p className={styles.empty} data-no-agent="">
          {t("conversation.empty.no-agent")}
        </p>
      );
    }
    if (session === null || current === null || draft === null) {
      return (
        <div className={styles.center}>
          <EmptyState
            icon={conversationIcons.empty}
            message={t("conversation.empty.no-session")}
            action={{
              label: t("conversation.button.new-session"),
              onSelect: () => void openSession(),
            }}
          />
        </div>
      );
    }
    const readOnly = session.state === "closed" || agent.state === "withdrawn";
    const shown = loaded.messages[current] ?? [];
    const visuals: VisualHost = {
      documentTitle: source.documentTitle,
      open: onOpenResult,
      save: readOnly ? undefined : (request) => void saveVisual(request),
      saveLocked: offline || composerLocked(draft.outgoing),
      saveState: (message, block) =>
        visualSaveState(
          drafts.saveOf(message, block),
          draft.outgoing,
          shown,
          loaded.runs,
        ),
      now: () => new Date(now()),
    };
    return (
      <>
        {run
          ? (
            <div className={styles.status} data-work-status={workStatus(run)}>
              <StatusMark
                tone={STATUS_TONE[workStatus(run)]}
                label={t(STATUS_LABEL[workStatus(run)])}
              />
            </div>
          )
          : null}
        <MessageList
          key={current}
          items={listItems(shown, draft.outgoing)}
          textOf={(message) => drafts.textOf(message)}
          bodyOf={(message) => drafts.body(message)}
          source={source}
          initialScroll={draft.scroll}
          onScroll={(position) => drafts.save(current, { scroll: position })}
          onCheck={() => void check()}
          onResend={() => void sendAgain()}
          onOpenResult={onOpenResult}
          visuals={visuals}
        />
        <QuestionStrip session={current} offline={offline} />
        {readOnly
          ? <p className={styles.notice}>{t("conversation.notice.ended")}</p>
          : (
            <>
              {agent.state === "paused"
                ? (
                  <p className={styles.notice} data-paused="">
                    {t("conversation.notice.paused")}
                  </p>
                )
                : null}
              <Composer
                key={current}
                draft={draft}
                locked={composerLocked(draft.outgoing)}
                tooLong={!fitsMessage(draft.text)}
                offline={offline}
                canCorrect={active !== null && agent.state === "enabled"}
                canStop={active !== null}
                onDraft={(patch) => drafts.save(current, patch)}
                onSend={() => void send()}
                onStop={() => void stop()}
              />
            </>
          )}
      </>
    );
  })();

  return (
    <aside
      className={`${styles.dock} ${
        embedded
          ? styles.embedded
          : placement === "overlay"
          ? styles.overlay
          : ""
      }`}
      data-dock={embedded ? "embedded" : placement}
      aria-label={t("conversation.title.dock")}
      style={embedded ? undefined : { width: `${DOCK_WIDTH}px` }}
    >
      {header}
      {stale}
      {guide !== null
        ? (
          <ExternalNotice
            guide={guide}
            onReconnect={onSettings}
            onCheck={() => void refresh()}
          />
        )
        : <ProviderNotice facts={provider} onSettings={onSettings} />}
      {problem === null
        ? null
        : (
          <p className={styles.problem} data-problem={problem}>
            {problem === "open-failed"
              ? t("conversation.error.open-failed")
              : t("conversation.error.stop-failed")}
          </p>
        )}
      {body}
    </aside>
  );
}

function sessionLabel(number: number, ended: boolean): string {
  return ended
    ? t("conversation.label.session-ended", { number })
    : t("conversation.label.session", { number });
}
