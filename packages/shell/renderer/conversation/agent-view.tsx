// Agent 화면: 한 agent의 한 session을 보이는 탭 본문. 위에서 아래로 header, 대화 줄, composer 위의 질문·승인 카드와
// "다음 turn" 줄, composer를 부품 그대로 묶는다. rewind·권한은 대화 위에 하나만 여는 panel 층이다. core와는
// AgentTabSource로만 말하고 탭을 열고 닫는 일, 파일과 설정으로 가는 일은 host가 한다.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { IconButton } from "@lophn/ui/primitives";
import { retryIcon } from "../icons/mod.ts";
import { formatRelativeTime, t } from "@lophn/wording";

import { newId } from "../prefixed-id.ts";
import { ProgressChip } from "./activity/progress-chip.tsx";
import type { ViewDetail } from "./activity/model.ts";
import { ViewDetailSelect } from "./activity/view-detail-select.tsx";
import type {
  AgentTabSource,
  EvidenceRef,
  PermissionsView as PermissionsData,
  SessionEntry,
  SourceResult,
} from "./agent-tab-source.ts";
import {
  type AgentTabData,
  useAgentTabData,
  useAgentTabList,
} from "./agent-tab-data.ts";
import { AgentThread } from "./agent-thread.tsx";
import {
  excerptOf,
  messagesOf,
  newSessionKey,
  textOfBody,
} from "./agent-view-model.ts";
import { ApprovalCard } from "./approval-card/approval-card.tsx";
import { loadBodies } from "./bodies.ts";
import { AgentComposer } from "./composer/agent-composer.tsx";
import {
  afterCheck,
  afterReply,
  composerLocked,
  fitsMessage,
  type Outgoing,
  resend,
  startSend,
} from "./delivery-state.ts";
import type { DraftStore } from "./drafts.ts";
import { composeAttachmentText } from "../../../protocol/lophn-agent/message-attachments.ts";
import { windowPathOf, windowReadImage } from "./window-paths.ts";
import { AgentHeader } from "./header/agent-header.tsx";
import { QuestionCard } from "./question-card/question-card.tsx";
import { QueuedMessages } from "./queued/queued-messages.tsx";
import { RewindPanel } from "./session-rewind/rewind-panel.tsx";
import { PermissionsView } from "./permissions-view/permissions-view.tsx";
import type { ArtifactsSlice } from "../workspace/kinds/host.ts";
import type { SlashEntryView } from "./slash-menu/types.ts";
import styles from "./agent-view.module.css";

/** Agent 화면이 자기 밖에 맡기는 일: 탭·파일·설정으로 가는 길. */
export interface AgentViewHost {
  /** 편집 카드의 [Open]이 그 파일(프로젝트 안 경로)의 탭을 연다. */
  openFile?: (path: string) => void;
  /** 글 안 artifact path의 link. 없는 창은 글 그대로 그린다. */
  artifacts?: ArtifactsSlice;
  /** 권한 요약과 `/permissions`가 Agents 화면의 Permissions로 간다. */
  openPermissions: () => void;
  /** `/skills`·`/mcp`가 Settings › Agents로 간다. */
  openAgentSettings: (target: "skills" | "mcp") => void;
  /** Fork가 만든 session을 같은 agent의 새 탭(앱 공간에서는 같은 칸)으로 연다. */
  openForked: (session: string) => void;
  showUsage: () => void;
  /** 탭·칸만 닫는다. session은 그대로 남는다. */
  closeTab: () => void;
  /** 설정의 연결 자리로 간다. */
  openConnections?: () => void;
}

interface AgentViewProps {
  source: AgentTabSource;
  /** 창마다 하나인 입력 메모리. 탭을 닫았다 열어도 쓰던 글이 남는다. */
  drafts: DraftStore;
  /** 보고 있는 session. null은 아직 만들지 않은 새 session이고 첫 말을 보낼 때 만든다. */
  session: string | null;
  onSessionChange: (session: string | null) => void;
  host: AgentViewHost;
  /** 대화가 비어 있는 동안 입력칸에 보이는 첫 안내. */
  hint?: string;
  now?: () => number;
}

/** 열려 있는 panel. 하나만 열린다. */
type Layer =
  | { readonly kind: "rewind"; readonly message: string }
  | { readonly kind: "permissions" };

type Problem =
  | "open-failed"
  | "stop-failed"
  | "action-failed"
  | "attach-failed";

const PROBLEM_TEXT = {
  "open-failed": "conversation.error.open-failed",
  "attach-failed": "conversation.error.attach-failed",
  "stop-failed": "conversation.error.stop-failed",
  "action-failed": "conversation.error.action-failed",
} as const;

/** 화면이 읽은 것. 새 session은 읽을 대화가 없다. */
type ViewData = Pick<
  AgentTabData,
  | "agent"
  | "sessions"
  | "failed"
  | "refresh"
  | "thread"
  | "connection"
  | "checkedAt"
  | "gone"
  | "reload"
>;

export function AgentView(props: AgentViewProps) {
  // 열린 session과 새 session은 읽는 것이 다르다. session이 바뀌면 화면 상태도 새로 시작한다.
  return props.session === null
    ? <NewSession key="new" {...props} />
    : <OpenSession key={props.session} {...props} session={props.session} />;
}

function NewSession(props: AgentViewProps) {
  const list = useAgentTabList(props.source);
  const data: ViewData = {
    ...list,
    thread: null,
    connection: "live",
    checkedAt: null,
    gone: false,
    reload: list.refresh,
  };
  return <Screen {...props} data={data} />;
}

function OpenSession(props: AgentViewProps & { session: string }) {
  const data = useAgentTabData(props.source, props.session, props.now);
  return <Screen {...props} data={data} />;
}

function Screen(props: AgentViewProps & { data: ViewData }) {
  const { source, drafts, session, host, data } = props;
  // 보던 session이 사라진 읽기와 지운 쓰기가 같은 말을 두 번 하지 않게 한다.
  const current = useRef(session);
  current.current = session;
  const onSessionChange = (next: string | null) => {
    if (next === current.current) return;
    current.current = next;
    props.onSessionChange(next);
  };
  const now = props.now ?? Date.now;
  useSyncExternalStore(drafts.subscribe, drafts.version);
  const [detail, setDetail] = useState<ViewDetail>("compact");
  const [layer, setLayer] = useState<Layer | null>(null);
  const [permissions, setPermissions] = useState<PermissionsData | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const { agent, thread, refresh } = data;
  const entry = data.sessions.find((item) => item.id === session) ?? null;
  const key = session ?? newSessionKey(agent ?? null);
  const draft = drafts.draft(key);
  const turn = thread?.turn ?? null;
  const active = turn !== null && turn.phase !== "ended" ? turn : null;
  const offline = data.connection === "reconnecting";
  const messages = messagesOf(thread);
  const readOnly = entry?.archived === true;
  const imageUrl = useCallback(
    (id: string) =>
      session === null ? Promise.resolve(null) : source.imageUrl(session, id),
    [source, session],
  );

  // 보던 session이 없어졌으면 새 session으로 간다.
  useEffect(() => {
    if (data.gone) onSessionChange(null);
  }, [data.gone]);

  // 본문은 한 번 읽으면 바뀌지 않는다. 새 메시지가 오면 그것만 읽는다.
  const messageIds = messages.map((message) => message.id).join();
  useEffect(() => {
    void loadBodies(source, drafts, messages);
  }, [source, drafts, messageIds]);

  // 보낸 말이 확정 메시지로 대화에 오면 임시로 보이던 것을 지운다.
  const sentId = draft.outgoing?.phase === "accepted"
    ? draft.outgoing.id
    : null;
  const arrived = sentId !== null && (
    messages.some((message) => message.id === sentId) ||
    (thread?.queued.some((item) => item.id === sentId) ?? false)
  );
  useEffect(() => {
    if (arrived) drafts.save(key, { outgoing: null });
  }, [arrived, key, drafts]);

  const fail = () => setProblem("action-failed");
  const perform = async (
    call: () => Promise<SourceResult<unknown>>,
  ): Promise<boolean> => {
    const result = await call();
    setProblem(result.ok ? null : "action-failed");
    return result.ok;
  };

  const loadPermissions = async () => {
    const read = await source.permissions(session);
    if (read.ok) setPermissions(read.value);
    else fail();
    return read.ok;
  };

  // rewind가 끝났다. 대화를 다시 읽고, 쓰던 글이 없으면 고른 시점의 원문을 입력칸에 채운다.
  const rewound = (message: string) => {
    void data.reload();
    if (session === null || drafts.draft(session).text !== "") return;
    const found = messages.find((item) => item.id === message);
    const text = textOfBody(drafts.body(message)) ?? found?.text ??
      drafts.textOf(message) ?? "";
    if (text !== "") {
      drafts.save(session, { text, selection: [text.length, text.length] });
    }
  };

  // 첫 말을 보낼 때 session을 만든다. 쓰던 글은 새 session의 것이 된다. chip은 말에 실려 간다.
  const ensureSession = async (): Promise<string | null> => {
    if (session !== null) return session;
    const id = newId("ses", now());
    const opened = await source.openSession({ id });
    if (!opened.ok) {
      setProblem("open-failed");
      return null;
    }
    setProblem(null);
    drafts.save(id, {
      text: draft.text,
      selection: draft.selection,
      attachments: draft.attachments,
    });
    drafts.save(key, { text: "", selection: [0, 0], attachments: [] });
    onSessionChange(id);
    return id;
  };

  const deliver = async (target: string, outgoing: Outgoing) => {
    const reply = await source.send({
      session: target,
      id: outgoing.id,
      key: outgoing.key,
      text: outgoing.text,
      delivery: outgoing.delivery,
    });
    const next = afterReply(
      outgoing,
      reply.ok ? { ok: true } : { ok: false, code: reply.code },
    );
    if (next.phase === "accepted") drafts.accepted(target, next);
    else drafts.save(target, { outgoing: next });
  };

  const dispatch = async (text: string, target: string) => {
    const id = newId("msg", now());
    drafts.remember(id, text);
    // 일하는 중에 보낸 말은 다음 turn을 기다린다. 도는 turn에 올리는 일은 "다음 turn" 줄의 [Send now]가 한다.
    const outgoing = startSend({
      id,
      key: `session-messages-send-${id}`,
      text,
      delivery: "next_turn",
    });
    drafts.save(target, { outgoing });
    await deliver(target, outgoing);
  };

  // 첨부한 이미지는 보내기 전에 그 session에 올리고, 파일 경로와 함께 글 끝의 줄로 싣는다. 하나라도 못 올리면
  // 보내지 않고 글과 첨부는 그대로 남는다.
  const send = async () => {
    if (readOnly || composerLocked(draft.outgoing)) return;
    const { attachments } = draft;
    if (draft.text.trim() === "" && attachments.length === 0) return;
    if (!fitsMessage(draft.text)) return;
    const target = await ensureSession();
    if (target === null) return;
    const images: string[] = [];
    for (const item of attachments) {
      if (item.kind !== "image") continue;
      const uploaded = await source.uploadImage(target, item.image);
      if (!uploaded.ok) {
        setProblem("attach-failed");
        return;
      }
      images.push(uploaded.value.id);
    }
    const files = attachments.flatMap((item) =>
      item.kind === "file" ? [item.path] : []
    );
    const text = composeAttachmentText(
      drafts.draft(target).text,
      files,
      images,
    );
    if (!fitsMessage(text)) return;
    await dispatch(text, target);
  };

  // 결과를 모르는 말은 다시 보내기 전에 기록에서 먼저 찾는다.
  const check = async () => {
    const outgoing = draft.outgoing;
    if (session === null || outgoing === null) return;
    const read = await source.thread(session);
    if (!read.ok) return;
    const found =
      messagesOf(read.value).some((item) => item.id === outgoing.id) ||
      read.value.queued.some((item) => item.id === outgoing.id);
    const next = afterCheck(outgoing, found);
    if (next.phase === "accepted") drafts.accepted(session, next);
    else drafts.save(session, { outgoing: next });
    void data.reload();
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
  };

  const fork = async (through: string | null) => {
    if (session === null) return;
    const id = newId("ses", now());
    if (await perform(() => source.forkSession({ id, session, through }))) {
      host.openForked(id);
    }
  };

  const startNew = () => {
    setLayer(null);
    onSessionChange(null);
  };

  const showPermissions = async () => {
    if (await loadPermissions()) setLayer({ kind: "permissions" });
  };

  const runSlash = (command: SlashEntryView, argument: string) => {
    const clear = () => drafts.save(key, { text: "", selection: [0, 0] });
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
            void perform(() => source.renameSession(session, argument))
              .then(() => refresh());
          }
          return;
        }
        case "new":
          clear();
          return startNew();
        case "archive":
          clear();
          if (session !== null) {
            void perform(() => source.archiveSession(session))
              .then(() => refresh());
          }
          return;
        case "compact":
          clear();
          if (session !== null) {
            void perform(() => source.compactSession(session))
              .then(() => data.reload());
          }
          return;
        case "fork":
          clear();
          return void fork(null);
        case "permissions":
          clear();
          return void showPermissions();
        case "mcp":
        case "skills":
          clear();
          return host.openAgentSettings(command.name);
      }
      return;
    }
    // skill 명령은 사람이 보낸 말로 접수되므로 session이 있어야 한다.
    clear();
    void (async () => {
      const target = await ensureSession();
      if (target !== null) {
        await perform(() =>
          source.runCommand(target, command, argument, newId("cmd", now()))
        );
      }
    })();
  };

  if (agent === undefined) {
    return (
      <section className={styles.view} data-agent-view="">
        {data.failed
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

  // 방금 만든 session이 목록에 오기 전에는 제목 없는 줄로 둔다. 아직 만들지 않은 새 session은 줄이 없다.
  const shown: SessionEntry | null = session === null ? null : entry ?? {
    id: session,
    title: null,
    status: "idle",
    activeAt: new Date(now()).toISOString(),
    archived: false,
    skip: false,
  };
  const empty = messages.length === 0 && draft.outgoing === null;
  // 보낸 말을 받기 전부터 turn이 끝날 때까지 일하는 중이다. 질문·승인을 기다리는 동안은 카드가 대신 말한다.
  const sending = draft.outgoing?.phase === "sending" ||
    draft.outgoing?.phase === "accepted";
  const working = active?.phase === "working" || (active === null && sending)
    ? {
      since: active?.startedAt == null ? null : Date.parse(active.startedAt),
    }
    : null;
  const hint = empty && props.hint !== undefined
    ? props.hint
    : t("conversation.placeholder.ask", { agent: agent.name });
  const approval = thread?.pending.approval ?? null;
  const asked = thread?.pending.questions ?? null;
  const accepted = (call: Promise<SourceResult<void>>) =>
    call.then((result) => result.ok);

  return (
    <section className={styles.view} data-agent-view="">
      <AgentHeader
        agent={agent}
        session={shown}
        sessions={data.sessions}
        now={new Date(now())}
        source={source}
        host={{
          switchSession: onSessionChange,
          newSession: startNew,
          openForked: host.openForked,
        }}
        onChanged={() => void refresh()}
        progress={<ProgressChip tasks={thread?.tasks ?? []} />}
        detail={<ViewDetailSelect value={detail} onChange={setDetail} />}
      />
      {offline || data.failed
        ? (
          <p className={styles.stale} data-stale="">
            {data.checkedAt === null
              ? t("conversation.notice.stale-never")
              : t("conversation.notice.stale", {
                age: formatRelativeTime(
                  new Date(data.checkedAt),
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
      <div className={styles.stage}>
        <AgentThread
          key={key}
          agent={agent}
          entries={thread?.entries ?? []}
          detail={detail}
          outgoing={draft.outgoing}
          working={working}
          now={now}
          imageUrl={imageUrl}
          readOnly={readOnly}
          drafts={drafts}
          source={source}
          initialScroll={draft.scroll}
          onScroll={(position) => drafts.save(key, { scroll: position })}
          rewindOpen={layer?.kind === "rewind" ? layer.message : null}
          onRewind={(message) =>
            setLayer(
              layer?.kind === "rewind" && layer.message === message
                ? null
                : { kind: "rewind", message },
            )}
          onFork={(message) => void fork(message)}
          onCheck={() => void check()}
          onResend={() => void sendAgain()}
          onOpenFile={host.openFile}
          onOpenRef={(ref: EvidenceRef) => {
            if (ref.kind === "file") host.openFile?.(ref.target);
          }}
          onOpenSession={undefined}
          artifacts={host.artifacts}
        />
        {layer === null
          ? null
          : (
            <div className={styles.layer} data-panel-layer={layer.kind}>
              {layer.kind === "rewind" && session !== null
                ? (
                  <RewindPanel
                    source={source}
                    session={session}
                    message={layer.message}
                    excerpt={excerptOf(drafts.body(layer.message))}
                    onClose={() => setLayer(null)}
                    onRewound={() => rewound(layer.message)}
                  />
                )
                : null}
              {layer.kind === "permissions" && permissions !== null
                ? (
                  <PermissionsView
                    agent={agent.name}
                    permissions={permissions}
                    onClose={() => setLayer(null)}
                    onEdit={host.openPermissions}
                  />
                )
                : null}
            </div>
          )}
      </div>
      <div className={styles.bottom}>
        {approval === null || session === null ? null : (
          <ApprovalCard
            key={approval.id}
            agent={agent.name}
            request={approval}
            onDecide={(choice, reason) =>
              accepted(
                source.decidePermission(session, approval.id, choice, reason),
              )}
          />
        )}
        {asked === null || asked.questions === null || session === null
          ? null
          : (
            <QuestionCard
              key={asked.group}
              agent={agent.name}
              questions={asked.questions}
              onSubmit={(answers) =>
                accepted(source.answerQuestions({
                  session,
                  toolCall: asked.toolCall,
                  answers,
                }))}
            />
          )}
        <QueuedMessages
          items={thread?.queued ?? []}
          disabled={offline}
          onSendNow={(id) => void perform(() => source.sendQueuedNow(id))}
          onRemove={(id) => void perform(() => source.removeQueued(id))}
        />
        <AgentComposer
          key={key}
          source={source}
          session={session}
          agentName={agent.name}
          draft={draft}
          pathOf={windowPathOf()}
          readImage={windowReadImage()}
          working={active !== null}
          locked={composerLocked(draft.outgoing)}
          tooLong={!fitsMessage(draft.text)}
          offline={offline}
          readOnly={readOnly}
          hint={hint}
          place={agent.place}
          permissionSummary={agent.permissionSummary}
          permissions={permissions}
          skip={session === null || entry === null || readOnly ? undefined : {
            on: entry.skip,
            onChange: (on) =>
              void perform(() => source.changeSkip(session, on)).then((ok) =>
                ok ? refresh() : undefined
              ),
          }}
          onDraft={(patch) => drafts.save(key, patch)}
          onLoadPermissions={() => void loadPermissions()}
          onEditPermissions={host.openPermissions}
          onSend={() => void send()}
          onStop={() => void stop()}
          onCommand={runSlash}
          onProblem={fail}
        />
      </div>
    </section>
  );
}
