// Agent 화면: 한 agent의 한 session을 보이는 탭 본문. 위에서 아래로 header, 대화 줄, composer 위의 질문·승인 카드와
// "다음 turn" 줄, composer를 부품 그대로 묶는다. 권한·자식 대화는 대화 위에 하나만 여는 panel 층이고, rewind는 대화가 보이는 modal dialog다. core와는
// AgentTabSource로만 말하고 탭을 열고 닫는 일, 파일과 설정으로 가는 일은 host가 한다.

import { formatRelativeTime, t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import type { MenuItem } from "@lophn/ui/overlay";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AcpCommandOpens,
  AcpInput,
  AcpSessionMeta,
} from "../../../protocol/acp/mod.ts";
import { EMPTY_ACP_CHILD_STATE } from "../../../protocol/acp/mod.ts";
import {
  blocksSummary,
  type ContentBlock,
  textBlocks,
} from "../../../protocol/lophn-agent/content-block.ts";
import { actionIcons } from "../icons/mod.ts";
import { newId } from "../prefixed-id.ts";
import {
  type AgentTabData,
  useAgentTabData,
  useAgentTabList,
} from "./agent-tab-data.ts";
import type {
  AgentTabSource,
  EvidenceRef,
  PermissionsView as PermissionsData,
  RewindChoice,
  SessionEntry,
  SourceResult,
  ThreadEntry,
} from "./agent-tab-source.ts";
import { AgentThread } from "./agent-thread.tsx";
import {
  providerKeyFix,
  providerOfModel,
  useProviderAuthKind,
} from "./thread/provider-key.ts";
import { type FocusRoutes, useFocusRoutes } from "./agent-keys.ts";
import styles from "./agent-view.module.css";
import {
  capabilitiesOf,
  clockOf,
  decideChoiceOf,
  excerptOf,
  flatEntries,
  historyOf,
  messagesOf,
  newSessionKey,
  subagentOfChild,
  subagentsOf,
  textOfParts,
} from "./agent-view-model.ts";
import { ToolDetailsContext } from "./activity/tool-line.tsx";
import { type DesktopParts, DesktopPartsProvider } from "./desktop-parts.ts";
import type { ArtifactsSlice } from "./message-list/artifact-text.tsx";
import { useThreadBookmarks } from "./thread-index/bookmarks.ts";
import { ThreadIndexContext } from "./thread-index/context.ts";
import { threadIndexOf } from "./thread-index/model.ts";
import { ApprovalCard } from "./approval-card/approval-card.tsx";
import { PlanCard } from "./approval-card/plan-card.tsx";
import { fileBlock } from "./attachments.ts";
import {
  AgentComposer,
  type ComposerKeys,
} from "./composer/agent-composer.tsx";
import { useDraftFill } from "./composer/use-draft-fill.ts";
import {
  afterCheck,
  afterReply,
  composerLocked,
  type Delivery,
  fitsMessage,
  type Outgoing,
  resend,
  seenOf,
  startSend,
  waitsInQueue,
} from "./delivery-state.ts";
import type { DraftStore } from "./drafts.ts";
import { ChildView } from "./dock/child-view.tsx";
import { ComposerDock, type DockCardId } from "./dock/composer-dock.tsx";
import { ConversationFindBar } from "./find/conversation-find.tsx";
import { useConversationFind } from "./find/use-conversation-find.ts";
import { AgentHeader } from "./header/agent-header.tsx";
import { forkAndOpen } from "./header/fork.ts";
import { FillShellProvider, RunCodeProvider } from "./message-list/run-code.ts";
import type { ThreadScrollHandle } from "./message-list/thread-scroll.tsx";
import type { ThreadPosition } from "./message-list/virtual-rows.ts";
import { PermissionsView } from "./permissions-view/permissions-view.tsx";
import {
  InputRequestCard,
  openInputRequestWindow,
} from "./input-request-card/input-request-card.tsx";
import { useScopeMachine } from "../desktop/machines/scope.tsx";
import { QuestionCard } from "./question-card/question-card.tsx";
import { RewindPanel } from "./session-rewind/rewind-panel.tsx";
import type { SlashEntryView } from "./slash-menu/types.ts";
import { slashScreenOf } from "./slash-rule.ts";
import { StatusFooter } from "./status-view/status-footer.tsx";
import type { StatusData } from "./status-view/status-summary.ts";
import { StatusView } from "./status-view/status-view.tsx";
import { createLayoutCache, layoutOf } from "./thread-layout.ts";
import { windowPathOf, windowReadImage } from "./window-paths.ts";

/** Agent 화면이 자기 밖에 맡기는 일: 탭·파일·설정으로 가는 길. 없는 길은 그리로 가는 단추와 명령이 빠진다. */
export interface AgentViewHost {
  /** 편집 카드의 [Open]이 그 파일(프로젝트 안 경로)의 탭을 연다. */
  openFile?: (path: string) => void;
  /** 대화의 shell 코드 블록을 새 터미널에서 실행한다. 없거나 null이면 실행 단추가 없다. */
  runCommand?: ((command: string) => void) | null;
  /** 글 안 artifact path의 link. 없는 창은 글 그대로 그린다. */
  artifacts?: ArtifactsSlice;
  /** 권한 요약과 `/permissions`의 [Edit]가 Agents 화면의 Permissions로 간다. */
  openPermissions?: () => void;
  /** `/skills`·`/mcp`가 Settings › Agents로 간다. */
  openAgentSettings?: (target: "skills" | "mcp") => void;
  /** Fork가 만든 session을 같은 agent의 새 탭(앱 공간에서는 같은 칸)으로 연다. */
  openForked: (session: string) => void;
  /** 다른 session(맡긴 call을 받은 session, 보낸 쪽 session)을 그 session의 창에서 연다. */
  openSession?: (session: string) => void;
  /** 설정의 연결 자리로 간다. */
  openConnections?: () => void;
  /** desktop 창만 가진 조각(diagram, 앱 카드, 링크 열기, provider key 입력). 없으면 그 조각이 빠진다. */
  desktop?: DesktopParts;
}

interface AgentViewProps {
  source: AgentTabSource;
  /** GUI 탭의 harness(`claude|codex|opencode|omp`). 있으면 키 context가 `agentView:<harness>`이고 CLI의 key가 먼저 든다. */
  harness?: string;
  /** 창마다 하나인 입력 메모리. 탭을 닫았다 열어도 쓰던 글이 남는다. */
  drafts: DraftStore;
  /** 보고 있는 session. null은 아직 만들지 않은 새 session이고 첫 말을 보낼 때 만든다. */
  session: string | null;
  onSessionChange: (session: string | null) => void;
  host: AgentViewHost;
  /** 대화가 비어 있는 동안 입력칸에 보이는 첫 안내. */
  hint?: string;
  now?: () => number;
  /** 지금 보는 session의 제목. 새 session이거나 제목이 없으면 null이다. 탭 제목이 따라간다. */
  onSessionTitle?: (title: string | null) => void;
  /** header 오른쪽 끝(Compact 우측)에 놓을 조각. */
  trailing?: ReactNode;
  /** header ⋯ menu 끝에 더할 항목(터미널 탭의 "Open in terminal"). */
  extraMenu?: {
    readonly items: readonly MenuItem[];
    readonly onSelect: (id: string) => void;
  };
}

/** 열려 있는 panel. 하나만 열린다. */
type Layer =
  | { readonly kind: "rewind"; readonly message: string }
  | { readonly kind: "permissions" }
  | { readonly kind: "status" }
  /** 자식 대화. `path`는 연 순서의 자식 id이고 마지막이 보이는 것이다(자식의 자식도 연다). */
  | { readonly kind: "child"; readonly path: readonly string[] };

type Problem =
  | "open-failed"
  | "stop-failed"
  | "action-failed"
  | "attach-failed"
  | "changed-elsewhere";

const NO_ENTRIES: readonly ThreadEntry[] = [];

const PROBLEM_TEXT = {
  "open-failed": "conversation.error.open-failed",
  "attach-failed": "conversation.error.attach-failed",
  "stop-failed": "conversation.error.stop-failed",
  "action-failed": "conversation.error.action-failed",
  "changed-elsewhere": "conversation.error.changed-elsewhere",
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

/** session 검색 결과를 눌러 다른 session으로 넘어갈 때 같이 넘기는 것. */
interface ViewSeed {
  /** 찾기 줄을 이 글로 열어야 하면 그 글. */
  readonly findSeed: string | null;
  /** 열었으니 지운다. session을 다시 열 때 또 열지 않게 한다. */
  readonly onFindSeedUsed: () => void;
  /** session 검색 결과의 메시지 줄. 그 session을 열고 찾기 줄을 연다. */
  readonly openMatch: (session: string, query: string) => void;
}

export function AgentView(props: AgentViewProps) {
  const [seed, setSeed] = useState<{ session: string; query: string } | null>(
    null,
  );
  const openMatch = (session: string, query: string) => {
    setSeed({ session, query });
    if (session !== props.session) props.onSessionChange(session);
  };
  const shared: ViewSeed = {
    findSeed:
      seed !== null && seed.session === props.session ? seed.query : null,
    onFindSeedUsed: () => setSeed(null),
    openMatch,
  };
  // 열린 session과 새 session은 읽는 것이 다르다. session이 바뀌면 화면 상태도 새로 시작한다.
  return props.session === null ? (
    <NewSession key="new" {...props} {...shared} />
  ) : (
    <OpenSession
      key={props.session}
      {...props}
      {...shared}
      session={props.session}
    />
  );
}

function NewSession(props: AgentViewProps & ViewSeed) {
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

function OpenSession(props: AgentViewProps & ViewSeed & { session: string }) {
  const data = useAgentTabData(props.source, props.session, props.now);
  return <Screen {...props} data={data} />;
}

function Screen(props: AgentViewProps & ViewSeed & { data: ViewData }) {
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
  const [layer, setLayer] = useState<Layer | null>(null);
  // 전체 펼치기(`agent.toggle-details`). tool 줄의 본문을 모두 펼친다. 이 화면 안에서만 쓰고 저장하지 않는다.
  const [details, setDetails] = useState(false);
  // 머리 ←로 물러난 자식들(앞으로 갈 곳). 물러난 뒤의 path(`base`)에서만 쓰이고 새 자식을 열거나 다른 층을 열면 비운다.
  // 탭 안 상태라 저장하지 않는다.
  const [forward, setForward] = useState<{
    readonly base: readonly string[];
    readonly stack: readonly string[];
  }>({ base: [], stack: [] });
  // harness 머리 session menu(`/resume`이 연다)와, 다른 CLI session으로 바꾸는 동안.
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  // dock에서 펼친 card. `/goal`·`/subagents`·`/tasks`가 열 수 있게 여기서 쥔다.
  const [dock, setDock] = useState<DockCardId | null>(null);
  const childCache = useRef(createLayoutCache());
  const [permissions, setPermissions] = useState<PermissionsData | null>(null);
  // 새 session에서 고른 model. session을 만들 때 저장한다.
  const [pendingModel, setPendingModel] = useState<{
    readonly model: string;
    readonly options: Record<string, string>;
  } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  // 보냈지만 아직 끝나지 않은 사람 shell 명령. lophn은 끝나야 답하고 item도 그때 오므로 그동안 도는 줄을 보인다.
  const [shells, setShells] = useState<
    readonly { id: string; session: string; command: string }[]
  >([]);
  const stage = useRef<HTMLDivElement>(null);
  const find = useConversationFind(stage, props.findSeed, props.onFindSeedUsed);
  // agent command가 이 화면을 부르는 길: composer의 일과, focus를 받은 화면의 동작(`routes`).
  const keys = useRef<ComposerKeys | null>(null);
  const routes = useRef<FocusRoutes>({});
  const claimFocus = useFocusRoutes(routes);
  const scroller = useRef<ThreadScrollHandle>(null);

  const { agent, thread, refresh } = data;
  const entry = data.sessions.find((item) => item.id === session) ?? null;
  // 열린 대화는 제목이 바뀐 것을 갱신(`session_changed`)으로 바로 안다: 이름 바꾸기, 첫 말의 자동 제목, 조금 뒤에 오는
  // AI 제목. session 목록은 다시 읽어야 따라오므로 갱신이 준 제목이 먼저다.
  const sessionTitle =
    session === null ? null : (thread?.session?.title ?? entry?.title ?? null);
  useEffect(() => {
    props.onSessionTitle?.(sessionTitle);
  }, [session, sessionTitle]);
  const key = session ?? newSessionKey(agent ?? null);
  // 이 session의 draft가 바뀔 때만 다시 그린다. 다른 탭에서 치는 글에는 반응하지 않는다.
  const subscribeDraft = useCallback(
    (listener: () => void) => drafts.subscribe(key, listener),
    [drafts, key],
  );
  useSyncExternalStore(subscribeDraft, () => drafts.version(key));
  const draft = drafts.draft(key);
  const turn = thread?.turn ?? null;
  const active = turn !== null && turn.phase !== "ended" ? turn : null;
  const offline = data.connection === "reconnecting";
  const locked = composerLocked(draft.outgoing);
  const messages = messagesOf(thread);
  // 입력 history는 ↑↓나 Ctrl+R을 쓸 때만 읽는다. 스트리밍마다 대화를 훑지 않게 값이 아니라 읽는 함수다.
  const history = useLatest(() => historyOf(thread));
  const readOnly = entry?.archived === true;
  const imageUrl = useCallback(
    (id: string) =>
      session === null ? Promise.resolve(null) : source.imageUrl(session, id),
    [source, session],
  );

  const drafted = useDraftMeta(source, session === null);
  // 아직 만들지 않은 새 session은 session meta가 없다. source가 agent와 workspace로 읽은 draft에 새 session에서 고른 model을 얹는다.
  const meta: AcpSessionMeta | null =
    session !== null
      ? (thread?.session ?? null)
      : drafted === null || pendingModel === null
        ? drafted
        : {
            ...drafted,
            model: {
              model: pendingModel.model,
              label:
                drafted.models
                  .flatMap((group) => group.models)
                  .find((one) => one.id === pendingModel.model)?.label ??
                pendingModel.model,
              options: pendingModel.options,
              layer: "session",
            },
          };
  const caps = capabilitiesOf(meta);
  const failedProvider = providerOfModel(meta);
  const authKind = useProviderAuthKind(source, failedProvider?.id ?? null);
  const scopeMachine = useScopeMachine();
  const providerKey = useMemo(
    () =>
      providerKeyFix(
        failedProvider,
        authKind,
        host.openConnections,
        host.desktop === undefined
          ? undefined
          : (provider) =>
              host.desktop?.enterProviderKey(provider, scopeMachine),
      ),
    // meta는 갱신마다 새 객체라 값(id, 이름)으로만 다시 만든다. AgentThread가 memo다.
    [
      failedProvider?.id,
      failedProvider?.name,
      authKind,
      host.openConnections,
      host.desktop,
      scopeMachine,
    ],
  );
  // thread index: harness는 CLI 자신의 session id가 bookmark의 session key이고 lophn은 session id다.
  const harness = meta?.harness ?? null;
  const bookmarks = useThreadBookmarks(
    session === null
      ? null
      : harness === null
        ? session
        : meta?.cli_session == null
          ? null
          : `${harness}:${meta.cli_session}`,
  );
  const threadIndex = useMemo(
    () => ({
      items: threadIndexOf(thread?.entries ?? [], harness !== null),
      bookmarks,
    }),
    [thread?.entries, harness, bookmarks],
  );
  const status: StatusData | null =
    session !== null && caps.usage && meta?.usage != null
      ? {
          session: meta.cli_session ?? session,
          model: meta.model,
          usage: meta.usage,
        }
      : null;

  const actKey = (prefix: string) => newId(prefix, now());
  // 접수되었는지만 돌려준다. 결과로 바뀌는 칸은 ACP 갱신이 알린다.
  const act = async (target: string, input: AcpInput) => {
    const result = await source.act(target, input);
    setProblem(result.ok ? null : "action-failed");
    return result;
  };

  // OpenCode `/undo`가 되돌린 글을 composer에 돌려준다.
  useDraftFill(thread, (text) => {
    if (session === null || drafts.draft(session).text !== "") return;
    drafts.save(session, { text, selection: [text.length, text.length] });
  });

  // 대화의 `!` 코드 블록 단추. 보내지 않고 composer를 shell mode 글로 채워 focus만 옮긴다.
  const [focusSignal, setFocusSignal] = useState(0);
  // Context 값이라 commit마다 새로 만들면 대화의 모든 markdown(`useFillShell`)이 다시 그려진다.
  const fillShell = useMemo(
    () =>
      caps.shell && !readOnly
        ? (text: string) => {
            drafts.save(key, { text, selection: [text.length, text.length] });
            setFocusSignal((n) => n + 1);
          }
        : null,
    [caps.shell, readOnly, drafts, key],
  );

  // dock과 자식 대화가 harness에 보내는 조작. source가 가졌는지는 capability가 알려 단추를 그린다.
  const openChild = (child: string) => {
    setForward({ base: [], stack: [] });
    setLayer({
      kind: "child",
      path: layer?.kind === "child" ? [...layer.path, child] : [child],
    });
  };
  // 머리 ←/→: path 한 칸을 빼 forward에 쌓고, forward에서 꺼내 path에 다시 넣는다.
  const childPath = layer?.kind === "child" ? layer.path : [];
  const forwardStack =
    forward.base.length === childPath.length &&
    forward.base.every((id, at) => id === childPath[at])
      ? forward.stack
      : [];
  const childBack = () => {
    const last = childPath.at(-1);
    if (last === undefined) return;
    const path = childPath.slice(0, -1);
    setForward({ base: path, stack: [...forwardStack, last] });
    setLayer(path.length === 0 ? null : { kind: "child", path });
  };
  const childForward = () => {
    const next = forwardStack.at(-1);
    if (next === undefined) return;
    const stack = forwardStack.slice(0, -1);
    const path = [...childPath, next];
    setForward({ base: path, stack });
    setLayer({ kind: "child", path });
  };
  // harness 머리 session menu: 그 CLI의 지난 session으로 같은 탭에서 바꾸고(`open_session`), 새 session은 CLI의 `new` 명령이다.
  const openCliSession = async (cliSession: string) => {
    if (session === null) return;
    setMenuOpen(false);
    setLayer(null);
    setSwitching(true);
    await act(session, {
      type: "open_session",
      session,
      key: actKey("open"),
      cli_session: cliSession,
    });
    setSwitching(false);
    void refresh();
  };
  const newCommand = meta?.commands.find(
    (one) => one.name === "new" || one.aliases.includes("new"),
  );
  const newCliSession =
    newCommand === undefined || session === null
      ? null
      : async () => {
          setMenuOpen(false);
          setLayer(null);
          setSwitching(true);
          await act(session, {
            type: "run_command",
            session,
            key: actKey("cmd"),
            name: newCommand.name,
            argument: "",
          });
          setSwitching(false);
          void refresh();
        };
  const actHere = (input: (target: string) => AcpInput) => {
    if (session !== null) void act(session, input(session));
  };
  const stopChild = (child: string) =>
    actHere((target) => ({
      type: "stop_child",
      session: target,
      key: actKey("child"),
      child,
    }));
  const steerChild = (child: string, text: string) =>
    actHere((target) => ({
      type: "steer_child",
      session: target,
      key: actKey("child"),
      child,
      text,
    }));
  const stopTask = (task: string) =>
    actHere((target) => ({
      type: "stop_task",
      session: target,
      key: actKey("task"),
      task,
    }));
  const stopShell = (item: string) =>
    actHere((target) => ({ type: "stop_shell", session: target, item }));
  const setGoal = (objective: string | null, paused: boolean) =>
    actHere((target) => ({
      type: "set_goal",
      session: target,
      key: actKey("goal"),
      objective,
      paused,
    }));

  // 자식 대화가 아닌 다른 층(rewind·권한·상태)을 열면 앞으로 갈 곳은 없다.
  useEffect(() => {
    if (layer !== null && layer.kind !== "child") {
      setForward({ base: [], stack: [] });
    }
  }, [layer?.kind]);

  // 보던 session이 없어졌으면 새 session으로 간다.
  useEffect(() => {
    if (data.gone) onSessionChange(null);
  }, [data.gone]);

  // 보낸 말이 확정 메시지로 대화에 오면 임시로 보이던 것을 지운다.
  const sentId =
    draft.outgoing?.phase === "accepted" ? draft.outgoing.id : null;
  const arrived =
    sentId !== null &&
    (messages.some((message) => message.id === sentId) ||
      (thread?.queued.some((item) => item.id === sentId) ?? false));
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
    const text = found === undefined ? "" : textOfParts(found.parts);
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
    if (pendingModel !== null) {
      // 저장하지 못해도 session은 열렸다. 그 session은 agent 기본 model을 따른다.
      await source.act(id, {
        type: "set_model",
        session: id,
        key: actKey("model"),
        ...pendingModel,
      });
      setPendingModel(null);
    }
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
      content: outgoing.content,
      delivery: outgoing.delivery,
      // 새 session은 아직 아는 메시지가 없다.
      seen:
        target === session
          ? seenOf(
              thread === null ? null : messages,
              thread?.queued ?? [],
              sentId,
            )
          : null,
    });
    const next = afterReply(
      outgoing,
      reply.ok ? { ok: true } : { ok: false, code: reply.code },
    );
    if (next.phase === "accepted") {
      drafts.accepted(target, next);
      setProblem((was) => (was === "changed-elsewhere" ? null : was));
    } else if (next.phase === "changed_elsewhere") {
      // 쓴 글은 입력칸에 그대로 있다. 보낸 말 줄만 치우고 대화를 다시 읽는다.
      drafts.save(target, { outgoing: null });
      setProblem("changed-elsewhere");
      void data.reload();
    } else drafts.save(target, { outgoing: next });
  };

  const dispatch = async (
    content: ContentBlock[],
    target: string,
    delivery: Delivery,
  ) => {
    const id = newId("msg", now());
    // 일하는 중에 보낸 말은 다음 turn을 기다린다(`next_turn`). 도는 turn에 넣는 `steer`는 agent command `agent.send-now`가 보낸다.
    const outgoing = startSend({
      id,
      key: `session-messages-send-${id}`,
      content,
      delivery,
      queued: delivery === "next_turn" && active !== null,
    });
    drafts.save(target, { outgoing });
    await deliver(target, outgoing);
  };

  // 첨부한 이미지는 보내기 전에 올려 image block으로, 파일은 resource_link block으로 글 뒤에 싣는다. 하나라도 못
  // 올리면 보내지 않고 글과 첨부는 그대로 남는다.
  const send = async (delivery: Delivery = "next_turn") => {
    if (readOnly || composerLocked(draft.outgoing)) return;
    const { attachments } = draft;
    if (draft.text.trim() === "" && attachments.length === 0) return;
    if (!fitsMessage(draft.text)) return;
    const target = await ensureSession();
    if (target === null) return;
    const text = drafts.draft(target).text;
    const content: ContentBlock[] = text.trim() === "" ? [] : textBlocks(text);
    for (const item of attachments) {
      if (item.kind === "file") {
        content.push(fileBlock(item.path));
        continue;
      }
      const uploaded = await source.uploadImage(item.image);
      if (!uploaded.ok) {
        setProblem("attach-failed");
        return;
      }
      content.push(uploaded.value.block);
    }
    await dispatch(content, target, delivery);
  };

  // composer의 shell mode(`!`). 명령은 모델 메시지가 아니라 `run_shell`로 간다.
  const runShell = async (command: string) => {
    if (readOnly || composerLocked(draft.outgoing)) return;
    const text = draft.text;
    const target = await ensureSession();
    if (target === null) return;
    const id = actKey("shl");
    drafts.save(target, { text: "", selection: [0, 0] });
    setShells((list) => [...list, { id, session: target, command }]);
    const result = await source.act(target, {
      type: "run_shell",
      session: target,
      key: id,
      command,
    });
    setShells((list) => list.filter((item) => item.id !== id));
    if (result.ok) {
      setProblem(null);
      return;
    }
    // 못 돌렸으면 친 글을 돌려준다.
    setProblem("action-failed");
    if (drafts.draft(target).text === "") {
      drafts.save(target, { text, selection: [text.length, text.length] });
    }
  };

  // 결과를 모르는 말은 다시 보내기 전에 기록에서 먼저 찾는다.
  const check = async () => {
    const outgoing = draft.outgoing;
    if (session === null || outgoing === null) return;
    const read = await source.acp(session);
    if (!read.ok) return;
    const view = layoutOf(read.value);
    const found =
      messagesOf(view).some((item) => item.id === outgoing.id) ||
      view.queued.some((item) => item.id === outgoing.id);
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
    await perform(() =>
      forkAndOpen(source, session, through, host.openForked, now()),
    );
  };

  const startNew = () => {
    setLayer(null);
    onSessionChange(null);
  };

  const showPermissions = async () => {
    if (await loadPermissions()) setLayer({ kind: "permissions" });
  };

  const showStatus = () => {
    if (status === null) return fail();
    setLayer({ kind: "status" });
  };

  // 화면 동작은 `slashScreenOf`가 고른다. model·effort·mode는 composer가 먼저 열어 보았다.
  const runSlash = (command: SlashEntryView, argument: string) => {
    const clear = () => drafts.save(key, { text: "", selection: [0, 0] });
    const opens = slashScreenOf(command, argument);
    if (opens !== null) {
      const screen: Record<AcpCommandOpens, () => void> = {
        // 새 이름을 쓸 때까지 기다린다.
        rename: () => {
          if (argument === "") {
            const text = `/${command.name} `;
            drafts.save(key, { text, selection: [text.length, text.length] });
            return;
          }
          clear();
          if (session !== null) {
            void act(session, {
              type: "rename",
              session,
              key: actKey("rename"),
              title: argument,
            }).then(() => refresh());
          }
        },
        new: () => {
          clear();
          startNew();
        },
        archive: () => {
          clear();
          if (session !== null) {
            void perform(() => source.archiveSession(session)).then(() =>
              refresh(),
            );
          }
        },
        compact: () => {
          clear();
          if (session !== null) {
            void act(session, {
              type: "compact",
              session,
              key: actKey("compact"),
            }).then(() => data.reload());
          }
        },
        fork: () => {
          clear();
          void fork(null);
        },
        permissions: () => {
          clear();
          void showPermissions();
        },
        status: () => {
          clear();
          showStatus();
        },
        usage: () => {
          clear();
          showStatus();
        },
        context: () => {
          clear();
          showStatus();
        },
        mcp: () => {
          clear();
          host.openAgentSettings?.("mcp");
        },
        skills: () => {
          clear();
          host.openAgentSettings?.("skills");
        },
        rewind: () => {
          clear();
          const last = messages.findLast(
            (item) => item.actor === "user" && item.delivery === "next_turn",
          );
          if (last === undefined) fail();
          else setLayer({ kind: "rewind", message: last.id });
        },
        // composer가 열었거나 열 menu가 없는 경우다.
        model: clear,
        effort: clear,
        mode: clear,
        subagents: () => {
          clear();
          setDock("running");
        },
        tasks: () => {
          clear();
          setDock("running");
        },
        // 인자가 있으면 목표를 정한다. 없고 목표가 있으면 Goal card를 펼친다. 목표가 없으면 새 목표를 기다린다.
        goal: () => {
          if (argument !== "") {
            clear();
            setGoal(argument, false);
          } else if (meta?.goal == null) {
            const text = `/${command.name} `;
            drafts.save(key, { text, selection: [text.length, text.length] });
          } else {
            clear();
            setDock("goal");
          }
        },
        // harness 머리의 session menu. 목록은 열 때 다시 읽는다.
        resume: () => {
          clear();
          void refresh();
          setMenuOpen(true);
        },
      };
      return screen[opens]();
    }
    // CLI와 skill 명령은 사람이 보낸 말로 접수되므로 session이 있어야 한다.
    clear();
    void (async () => {
      const target = await ensureSession();
      if (target !== null) {
        await act(target, {
          type: "run_command",
          session: target,
          key: actKey("cmd"),
          name: command.name,
          argument,
        });
      }
    })();
  };

  // agent command가 이 화면에서 하는 일. focus가 이 화면에 있을 때만 창이 부른다. `when`은 키를 삼키기 전에 보므로 싸게 둔다.
  const selectedText = () =>
    (keys.current?.selected() ?? false) ||
    (window.getSelection()?.toString() ?? "") !== "";
  const typing = () => keys.current?.focused() === true && draft.text !== "";
  const lastUser = messages.findLast(
    (item) => item.actor === "user" && item.delivery === "next_turn",
  );
  const queued = thread?.queued ?? [];
  const modeReady =
    session !== null &&
    !readOnly &&
    caps.mode &&
    source.fixedMode !== true &&
    meta !== null &&
    meta.modes.length >= 2;
  routes.current = {
    "agent.send": {
      run: () => keys.current?.send("next_turn"),
      when: () => keys.current?.focused() === true,
    },
    "agent.newline": {
      run: () => keys.current?.newline(),
      when: () => keys.current?.focused() === true && !locked,
    },
    "agent.interrupt": {
      run: () => void stop(),
      when: () => active !== null && !selectedText(),
    },
    "agent.model-picker": {
      run: () => keys.current?.togglePicker(),
      when: () => keys.current?.canPicker === true,
    },
    "agent.find": { run: () => find.show(), when: () => true },
    // 층(rewind·자식 대화·권한)이 열려 있으면 그 안의 PageUp·PageDown이 제 일을 한다.
    "agent.scroll-page-up": {
      run: () => scroller.current?.scroll("page-up"),
      when: () => layer === null,
    },
    "agent.scroll-page-down": {
      run: () => scroller.current?.scroll("page-down"),
      when: () => layer === null,
    },
    "agent.scroll-top": {
      run: () => scroller.current?.scroll("top"),
      when: () => layer === null,
    },
    "agent.scroll-bottom": {
      run: () => scroller.current?.scroll("bottom"),
      when: () => layer === null,
    },
    "agent.cycle-mode": {
      run: () => {
        if (session === null || meta === null) return;
        const at = meta.modes.findIndex((mode) => mode.id === meta.mode);
        const next = meta.modes[(at + 1) % meta.modes.length];
        if (next === undefined) return;
        void act(session, {
          type: "set_mode",
          session,
          key: actKey("mode"),
          mode: next.id,
        });
      },
      when: () => modeReady && keys.current?.slashOpen === false,
    },
    // 다음 turn 줄의 첫 글을 지금 올린다(줄의 [Send now]와 같은 길). 줄이 없으면 입력칸의 글을 steer로 보낸다.
    "agent.send-now": {
      run: () => {
        const first = queued[0];
        if (first !== undefined) {
          void perform(async () => {
            const result = await source.sendQueuedNow(first.id);
            if (result.ok) await data.reload();
            return result;
          });
        } else keys.current?.send("steer");
      },
      when: () =>
        caps.steer &&
        !offline &&
        (queued.length > 0 || (active !== null && typing())),
    },
    "agent.queue": {
      run: () => keys.current?.send("next_turn"),
      when: () => active !== null && typing() && !locked,
    },
    "agent.rewind": {
      run: () => {
        if (lastUser !== undefined) {
          setLayer({ kind: "rewind", message: lastUser.id });
        }
      },
      when: () =>
        active === null &&
        lastUser !== undefined &&
        caps.rewind &&
        !readOnly &&
        session !== null,
    },
    "agent.clear-input": {
      run: () => keys.current?.clear(),
      when: () => typing() && !locked && !selectedText(),
    },
    "agent.history-previous": {
      run: () => keys.current?.historyPrevious(),
      when: () => keys.current?.canHistoryPrevious() === true,
    },
    "agent.history-next": {
      run: () => keys.current?.historyNext(),
      when: () => keys.current?.canHistoryNext() === true,
    },
    // 항상 듣는다: 이 화면의 context 안에서 Ctrl+R이 window 새로고침으로 새지 않게 한다. history가 없으면 검색 상자가
    // "없음"만 보인다.
    "agent.history-search": {
      run: () => keys.current?.openHistorySearch(),
      when: () => true,
    },
    // 도는 root tool을 background로 보낸다. adapter가 tool을 고르므로 화면은 도는 tool이 있는지만 본다.
    "agent.background": {
      run: () => {
        if (session === null) return;
        void act(session, {
          type: "background_tool",
          session,
          key: actKey("background"),
        });
      },
      when: () =>
        caps.background &&
        active !== null &&
        flatEntries(thread?.entries ?? []).some(
          (one) =>
            (one.kind === "tools" &&
              one.calls.some((call) => call.state === "running")) ||
            (one.kind === "subagent" && one.state === "running"),
        ),
    },
    "agent.toggle-details": {
      run: () => setDetails((on) => !on),
      when: () =>
        flatEntries(thread?.entries ?? []).some((one) => one.kind === "tools"),
    },
  };

  // 대화 줄은 memo다. 글을 칠 때마다 새로 만들어지는 함수를 넘기면 그 memo가 깨지므로 늘 같은 함수가 최신 것을 부른다.
  const threadHandlers = {
    onScroll: useLatest((position: ThreadPosition | null) =>
      drafts.save(key, { scroll: position }),
    ),
    onRewind: useLatest((message: string) =>
      setLayer(
        layer?.kind === "rewind" && layer.message === message
          ? null
          : { kind: "rewind", message },
      ),
    ),
    onFork: useLatest((message: string) => void fork(message)),
    onOpenChild: useLatest(openChild),
    onStopShell: useLatest(stopShell),
    onCheck: useLatest(() => void check()),
    onResend: useLatest(() => void sendAgain()),
    onOpenRef: useLatest((ref: EvidenceRef) => {
      if (ref.kind === "file") host.openFile?.(ref.target);
    }),
  };

  if (agent === undefined) {
    return (
      <section className={styles.view} data-agent-view="">
        {data.failed ? (
          <div className={styles.failed} data-load-failed="">
            <p>{t("conversation.error.load-failed")}</p>
            <IconButton
              icon={actionIcons.retry}
              label={t("common.button.retry")}
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
            />
          </div>
        ) : null}
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
  const shown: SessionEntry | null =
    session === null
      ? null
      : (entry ?? {
          id: session,
          title: null,
          status: "idle",
          activeAt: new Date(now()).toISOString(),
          archived: false,
        });
  const empty = messages.length === 0 && draft.outgoing === null;
  // 보낸 말을 받기 전부터 turn이 끝날 때까지 일하는 중이다. 사람이 답할 것(허락·질문)을 기다리는 동안은
  // 카드가 답을 받지만, 대화 끝 줄은 그 사실을 말해야 멈춘 것처럼 보이지 않는다.
  const sending =
    draft.outgoing?.phase === "sending" || draft.outgoing?.phase === "accepted";
  const waiting: "approval" | "answer" | undefined =
    active?.phase === "waiting"
      ? thread?.pending.approval !== null
        ? "approval"
        : "answer"
      : undefined;
  const working =
    active?.phase === "working" ||
    (active === null && sending) ||
    waiting !== undefined
      ? {
          clock: clockOf(active),
          ...(waiting === undefined ? {} : { waiting }),
        }
      : null;
  const hint =
    empty && props.hint !== undefined
      ? props.hint
      : t(
          caps.sessions
            ? "conversation.placeholder.ask"
            : "conversation.placeholder.message",
          { agent: agent.name },
        );
  const approval = thread?.pending.approval ?? null;
  const asked = thread?.pending.questions ?? null;
  const runningSubagents = subagentsOf(thread?.entries ?? []).filter(
    (entry) => entry.state === "running",
  );
  const runningTasks = (thread?.tasks ?? []).filter(
    (task) => task.state === "running",
  );
  // 자식 대화 층. 자식 상태를 아직 모르면 빈 대화로 연다.
  const childId = layer?.kind === "child" ? (layer.path.at(-1) ?? null) : null;
  const childThread =
    childId === null
      ? null
      : layoutOf(
          thread?.children[childId] ?? EMPTY_ACP_CHILD_STATE,
          childCache.current,
        );
  const childInfo =
    thread === null || childId === null
      ? null
      : subagentOfChild(thread, childId);
  // 자식 대화를 읽는 동안 머리 ←/→는 그 보기의 기록이다. 방금 ←로 나왔다면 →로 다시 들어갈 수 있다.
  const harnessMenu = caps.resume && !caps.sessions;
  const accepted = (call: Promise<SourceResult<unknown>>) =>
    call.then((result) => result.ok);

  const view = (
    // 입력칸 밖(대화 글)을 누르면 focus가 body로 빠져 key context와 이 화면의 command(Escape의 멈추기 등)가 사라진다.
    // 화면 자신이 focus를 받게 한다(tab 순서에는 넣지 않는다).
    <section
      className={styles.view}
      data-agent-view=""
      data-key-context={
        props.harness === undefined ? "agentView" : `agentView:${props.harness}`
      }
      tabIndex={-1}
      onFocus={claimFocus}
    >
      <AgentHeader
        agent={agent}
        session={shown}
        sessions={data.sessions}
        now={new Date(now())}
        source={source}
        detail={draft.detail}
        onDetailChange={(next) => drafts.save(key, { detail: next })}
        host={{
          switchSession: onSessionChange,
          newSession: startNew,
          openForked: host.openForked,
          openMatch: props.openMatch,
        }}
        onChanged={() => void refresh()}
        trailing={props.trailing}
        capabilities={caps}
        title={meta?.title ?? null}
        child={childId === null ? null : { info: childInfo, now }}
        nav={
          childId === null && forwardStack.length === 0
            ? null
            : {
                canBack: childId !== null,
                canForward: forwardStack.length > 0,
                onBack: childBack,
                onForward: childForward,
              }
        }
        resume={
          harnessMenu
            ? {
                current:
                  meta?.cli_session == null
                    ? null
                    : { id: meta.cli_session, title: meta.title },
                open: menuOpen,
                onOpenChange: (next) => {
                  setMenuOpen(next);
                  if (next) void refresh();
                },
                busy: switching,
                onSwitch: (cli) => void openCliSession(cli),
                onNew:
                  newCliSession === null ? null : () => void newCliSession(),
              }
            : null
        }
        extraMenu={props.extraMenu}
      />
      {offline || data.failed ? (
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
      ) : null}
      {problem === null ? null : (
        <p className={styles.problem} data-problem={problem}>
          {t(PROBLEM_TEXT[problem])}
        </p>
      )}
      <div className={styles.stage} ref={stage}>
        {find.open ? (
          <ConversationFindBar
            query={find.query}
            onQuery={find.setQuery}
            current={find.current}
            total={find.total}
            onNext={() => find.step(1)}
            onPrevious={() => find.step(-1)}
            onClose={find.close}
          />
        ) : null}
        <RunCodeProvider value={host.runCommand ?? null}>
          <FillShellProvider value={fillShell}>
            <ThreadIndexContext.Provider value={threadIndex}>
              <AgentThread
                key={key}
                agent={agent}
                entries={thread?.entries ?? NO_ENTRIES}
                detail={draft.detail}
                live={thread?.live ?? null}
                outgoing={draft.outgoing}
                scroll={scroller}
                pendingShell={shells.filter((item) => item.session === session)}
                working={working}
                now={now}
                imageUrl={imageUrl}
                readOnly={readOnly}
                can={{
                  rewind: caps.rewind,
                  fork: caps.fork,
                  retry: caps.retry,
                }}
                source={source}
                providerKey={providerKey}
                initialScroll={draft.scroll}
                renderAll={find.open}
                rewindOpen={layer?.kind === "rewind" ? layer.message : null}
                {...threadHandlers}
                onStopShell={
                  caps.shell && !caps.sessions
                    ? threadHandlers.onStopShell
                    : undefined
                }
                onOpenFile={host.openFile}
                onOpenSession={host.openSession}
                artifacts={host.artifacts}
              />
            </ThreadIndexContext.Provider>
          </FillShellProvider>
        </RunCodeProvider>
        {layer === null ||
        layer.kind === "status" ||
        layer.kind === "rewind" ? null : (
          <div
            className={styles.layer}
            data-panel-layer={layer.kind}
            data-key-context="modal"
          >
            {layer.kind === "child" &&
            thread !== null &&
            childId !== null &&
            childThread !== null ? (
              <ChildView
                info={childInfo}
                canSteer={caps.steer_child}
                canStop={caps.stop_child}
                onSteer={(text) => steerChild(childId, text)}
                onStop={() => stopChild(childId)}
              >
                <AgentThread
                  key={childId}
                  agent={agent}
                  entries={childThread.entries}
                  detail={draft.detail}
                  live={childThread.live}
                  outgoing={null}
                  working={
                    childThread.turn !== null &&
                    childThread.turn.phase !== "ended"
                      ? { clock: clockOf(childThread.turn) }
                      : null
                  }
                  now={now}
                  imageUrl={imageUrl}
                  readOnly
                  can={{ rewind: false, fork: false, retry: false }}
                  source={source}
                  initialScroll={null}
                  onScroll={() => undefined}
                  rewindOpen={null}
                  onRewind={() => undefined}
                  onFork={() => undefined}
                  onOpenChild={openChild}
                  onCheck={() => undefined}
                  onResend={() => undefined}
                  onOpenFile={host.openFile}
                  onOpenRef={(ref: EvidenceRef) => {
                    if (ref.kind === "file") host.openFile?.(ref.target);
                  }}
                  onOpenSession={host.openSession}
                  artifacts={host.artifacts}
                />
              </ChildView>
            ) : null}
            {layer.kind === "permissions" && permissions !== null ? (
              <PermissionsView
                agent={agent.name}
                permissions={permissions}
                onClose={() => setLayer(null)}
                onEdit={host.openPermissions}
              />
            ) : null}
          </div>
        )}
        {/* rewind는 대화를 덮지 않는 modal dialog다. 뒤의 대화가 보인다. */}
        {layer?.kind === "rewind" && session !== null ? (
          <RewindPanel
            source={source}
            withFiles={caps.rewind_files}
            rewind={(choice: RewindChoice) =>
              act(session, {
                type: "rewind",
                session,
                key: actKey("rewind"),
                message: layer.message,
                files: choice.files,
                apps: [...choice.apps],
              })
            }
            session={session}
            message={layer.message}
            excerpt={excerptOf(
              messages.find((item) => item.id === layer.message)?.parts,
            )}
            onClose={() => setLayer(null)}
            onRewound={() => rewound(layer.message)}
          />
        ) : null}
      </div>
      <div className={styles.bottom}>
        {approval === null || session === null ? null : approval.subject
            .kind === "plan" ? (
          <PlanCard
            key={approval.id}
            agent={agent.name}
            id={approval.id}
            subject={approval.subject}
            artifacts={host.artifacts}
            onDecide={(choice, reason) =>
              accepted(
                act(session, {
                  type: "decide",
                  session,
                  request: approval.id,
                  choice: decideChoiceOf(choice, reason),
                }),
              )
            }
          />
        ) : (
          <ApprovalCard
            key={approval.id}
            agent={agent.name}
            request={approval}
            focusOnMount={draft.text === "" && draft.attachments.length === 0}
            onDecide={(choice, reason) =>
              accepted(
                act(session, {
                  type: "decide",
                  session,
                  request: approval.id,
                  choice: decideChoiceOf(choice, reason),
                }),
              )
            }
          />
        )}
        {asked !== null &&
        asked.questions === null &&
        session !== null &&
        source.readInputRequest !== undefined ? (
          // 질문 내용이 없는 대기 항목이다. agent의 입력 요청이면 card가 읽어 보이고, 아니면 아무것도 그리지 않는다.
          <InputRequestCard
            key={asked.group}
            agent={agent.name}
            session={session}
            toolCall={asked.toolCall}
            source={source}
            onEnter={(machine) =>
              openInputRequestWindow(
                { session, tool_call: asked.toolCall },
                machine,
              )
            }
          />
        ) : null}
        {asked === null ||
        asked.questions === null ||
        session === null ? null : (
          <QuestionCard
            key={asked.group}
            agent={agent.name}
            questions={asked.questions}
            onSubmit={(answers) =>
              accepted(
                source.answerQuestions({
                  session,
                  toolCall: asked.toolCall,
                  answers,
                }),
              )
            }
          />
        )}
        <ComposerDock
          open={dock}
          onOpenChange={setDock}
          goal={meta?.goal ?? null}
          canSetGoal={caps.goal}
          onSetGoal={({ objective, paused }) => setGoal(objective, paused)}
          plan={thread?.plan ?? null}
          subagents={runningSubagents}
          tasks={runningTasks}
          canStopChild={caps.stop_child}
          canStopTask={caps.tasks}
          onOpenChild={openChild}
          onStopChild={stopChild}
          onStopTask={stopTask}
          now={now}
          queue={{
            items: thread?.queued ?? [],
            pending: waitsInQueue(draft.outgoing)
              ? {
                  id: draft.outgoing!.id,
                  summary: blocksSummary(draft.outgoing!.content),
                }
              : null,
            disabled: offline,
            canSteer: caps.steer,
            canEdit: caps.queue_edit,
            onSendNow: (id) =>
              void perform(async () => {
                const result = await source.sendQueuedNow(id);
                // 옮기는 event를 놓쳐도 줄이 남지 않게 기록을 다시 읽는다.
                if (result.ok) await data.reload();
                return result;
              }),
            onRemove: (id) =>
              void perform(async () => {
                const result = await source.removeQueued(id);
                if (result.ok) await data.reload();
                return result;
              }),
            onEdit: (id, text) =>
              void perform(async () => {
                const result = await source.editQueued(id, text);
                if (result.ok) await data.reload();
                return result;
              }),
            onMove: (id, direction) =>
              void perform(async () => {
                const result = await source.moveQueued(id, direction);
                if (result.ok) await data.reload();
                return result;
              }),
          }}
        />
        <div className={styles.composerAnchor}>
          {layer?.kind === "status" && status !== null ? (
            <div
              className={styles.statusOverlay}
              data-panel-layer="status"
              data-key-context="modal"
            >
              <StatusView status={status} onClose={() => setLayer(null)} />
            </div>
          ) : null}
          <AgentComposer
            key={key}
            keys={keys}
            focusSignal={focusSignal}
            source={source}
            meta={withoutCommands(meta, host.openAgentSettings === undefined)}
            capabilities={caps}
            history={history}
            onChooseModel={async (model, options) => {
              if (session === null) {
                setPendingModel({ model, options });
                return true;
              }
              const result = await source.act(session, {
                type: "set_model",
                session,
                key: actKey("model"),
                model,
                options,
              });
              return result.ok;
            }}
            session={session}
            agentName={agent.name}
            draft={draft}
            pathOf={windowPathOf()}
            readImage={windowReadImage()}
            working={active !== null}
            locked={locked}
            tooLong={!fitsMessage(draft.text)}
            offline={offline}
            readOnly={readOnly}
            hint={hint}
            workspace={agent.workspace}
            permissionSummary={agent.permissionSummary}
            permissions={permissions}
            mode={
              !modeReady || session === null || meta === null
                ? undefined
                : {
                    current: meta.mode,
                    choices: meta.modes,
                    onChange: (mode) =>
                      void act(session, {
                        type: "set_mode",
                        session,
                        key: actKey("mode"),
                        mode,
                      }),
                  }
            }
            toggles={
              session === null ||
              readOnly ||
              !caps.toggles ||
              meta === null ||
              meta.toggles.length === 0
                ? undefined
                : {
                    items: meta.toggles,
                    onToggle: (id, on) =>
                      actHere((target) => ({
                        type: "set_toggle",
                        session: target,
                        key: actKey("toggle"),
                        id,
                        on,
                      })),
                  }
            }
            onUseRole={async (role) => {
              if (session === null) return false;
              const result = await source.act(session, {
                type: "use_role",
                session,
                key: actKey("role"),
                role,
              });
              return result.ok;
            }}
            onDraft={(patch) => drafts.save(key, patch)}
            onLoadPermissions={loadPermissions}
            onEditPermissions={host.openPermissions}
            onSend={(delivery) => void send(delivery)}
            onShell={(command) => void runShell(command)}
            onStop={() => void stop()}
            onCommand={runSlash}
            onProblem={fail}
            usage={
              status === null ? null : (
                <StatusFooter
                  status={status}
                  onOpen={() =>
                    layer?.kind === "status" ? setLayer(null) : showStatus()
                  }
                />
              )
            }
          />
        </div>
      </div>
    </section>
  );
  // 전체 펼치기 값은 tool 줄만 읽는다. 그 값이 바뀌어도 대화의 나머지는 다시 그리지 않는다.
  return (
    <DesktopPartsProvider value={host.desktop ?? null}>
      <ToolDetailsContext.Provider value={details}>
        {view}
      </ToolDetailsContext.Provider>
    </DesktopPartsProvider>
  );
}

/** 이 창에서 열 수 없는 명령을 `/` 창에 보이지 않는다. Settings › Agents로 가는 길이 없으면 `/skills`·`/mcp`다. */
function withoutCommands(
  meta: AcpSessionMeta | null,
  noSettings: boolean,
): AcpSessionMeta | null {
  if (meta === null || !noSettings) return meta;
  return {
    ...meta,
    commands: meta.commands.filter(
      (one) => !(one.opens === "mcp" || one.opens === "skills"),
    ),
  };
}

/** 부르는 순간의 최신 함수를 부르는, 늘 같은 함수. */
function useLatest<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  latest.current = fn;
  return useCallback((...args: Args) => latest.current(...args), []);
}

/** 새 session 화면의 session 기능. 첫 메시지 전이라 snapshot이 없어 source가 agent와 workspace로 읽는다. */
function useDraftMeta(
  source: AgentTabSource,
  enabled: boolean,
): AcpSessionMeta | null {
  const [meta, setMeta] = useState<AcpSessionMeta | null>(null);
  useEffect(() => {
    if (!enabled || source.draft === undefined) return;
    let live = true;
    void source.draft().then((read) => {
      if (live && read.ok) setMeta(read.value);
    });
    return () => {
      live = false;
    };
  }, [source, enabled]);
  return enabled ? meta : null;
}
