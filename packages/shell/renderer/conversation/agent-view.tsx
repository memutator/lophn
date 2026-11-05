// Agent 화면: 한 agent의 한 session을 보이는 탭 본문. 위에서 아래로 header, 대화 줄, composer 위의 질문·승인 카드와
// "다음 turn" 줄, composer를 부품 그대로 묶는다. rewind·권한은 대화 위에 하나만 여는 panel 층이다. core와는
// AgentTabSource로만 말하고 탭을 열고 닫는 일, 파일과 설정으로 가는 일은 host가 한다.

import { formatRelativeTime, t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import {
  type KeyboardEvent,
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
  type ContentBlock,
  textBlocks,
} from "../../../protocol/lophn-agent/content-block.ts";
import { actionIcons } from "../icons/mod.ts";
import { newId } from "../prefixed-id.ts";
import type { ArtifactsSlice } from "../workspace/kinds/host.ts";
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
} from "./agent-tab-source.ts";
import { AgentThread } from "./agent-thread.tsx";
import styles from "./agent-view.module.css";
import {
  capabilitiesOf,
  clockOf,
  decideChoiceOf,
  excerptOf,
  messagesOf,
  newSessionKey,
  subagentOfChild,
  subagentsOf,
  textOfParts,
} from "./agent-view-model.ts";
import { useThreadBookmarks } from "./thread-index/bookmarks.ts";
import { ThreadIndexContext } from "./thread-index/context.ts";
import { threadIndexOf } from "./thread-index/model.ts";
import { ApprovalCard } from "./approval-card/approval-card.tsx";
import { PlanCard } from "./approval-card/plan-card.tsx";
import { fileBlock } from "./attachments.ts";
import { AgentComposer } from "./composer/agent-composer.tsx";
import { useDraftFill } from "./composer/use-draft-fill.ts";
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
import { ChildView } from "./dock/child-view.tsx";
import { ComposerDock, type DockCardId } from "./dock/composer-dock.tsx";
import { ConversationFindBar } from "./find/conversation-find.tsx";
import { useConversationFind } from "./find/use-conversation-find.ts";
import { AgentHeader } from "./header/agent-header.tsx";
import { forkAndOpen } from "./header/fork.ts";
import { RunCodeProvider } from "./message-list/run-code.ts";
import { PermissionsView } from "./permissions-view/permissions-view.tsx";
import { QuestionCard } from "./question-card/question-card.tsx";
import { RewindPanel } from "./session-rewind/rewind-panel.tsx";
import type { SlashEntryView } from "./slash-menu/types.ts";
import { StatusFooter } from "./status-view/status-footer.tsx";
import type { StatusData } from "./status-view/status-summary.ts";
import { StatusView } from "./status-view/status-view.tsx";
import { createLayoutCache, layoutOf } from "./thread-layout.ts";
import { windowPathOf, windowReadImage } from "./window-paths.ts";

/** Agent 화면이 자기 밖에 맡기는 일: 탭·파일·설정으로 가는 길. */
export interface AgentViewHost {
  /** 편집 카드의 [Open]이 그 파일(프로젝트 안 경로)의 탭을 연다. */
  openFile?: (path: string) => void;
  /** 대화의 shell 코드 블록을 새 터미널에서 실행한다. 없거나 null이면 실행 단추가 없다. */
  runCommand?: ((command: string) => void) | null;
  /** 글 안 artifact path의 link. 없는 창은 글 그대로 그린다. */
  artifacts?: ArtifactsSlice;
  /** 권한 요약과 `/permissions`가 Agents 화면의 Permissions로 간다. */
  openPermissions: () => void;
  /** `/skills`·`/mcp`가 Settings › Agents로 간다. */
  openAgentSettings: (target: "skills" | "mcp") => void;
  /** Fork가 만든 session을 같은 agent의 새 탭(앱 공간에서는 같은 칸)으로 연다. */
  openForked: (session: string) => void;
  /** 다른 session(맡긴 call을 받은 session, 보낸 쪽 session)을 그 session의 창에서 연다. */
  openSession?: (session: string) => void;
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
  /** 지금 보는 session의 제목. 새 session이거나 제목이 없으면 null이다. 탭 제목이 따라간다. */
  onSessionTitle?: (title: string | null) => void;
  /** header 오른쪽 끝(Compact 우측)에 놓을 조각. */
  trailing?: ReactNode;
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
  useSyncExternalStore(drafts.subscribe, drafts.version);
  const [layer, setLayer] = useState<Layer | null>(null);
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
  const stage = useRef<HTMLDivElement>(null);
  const find = useConversationFind(stage, props.findSeed, props.onFindSeedUsed);

  // Ctrl/Cmd+F는 이 화면이 focus를 가질 때만 받는다. 편집기·browser 탭의 같은 키와 겹치지 않게 표에 넣지 않는다.
  const findKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.altKey || event.shiftKey || event.code !== "KeyF") return;
    event.preventDefault();
    event.stopPropagation();
    find.show();
  };

  const { agent, thread, refresh } = data;
  const entry = data.sessions.find((item) => item.id === session) ?? null;
  const sessionTitle = session === null ? null : (entry?.title ?? null);
  // 머리글 이름 바꾸기 뒤의 refresh도 이 읽기를 거치므로 탭 제목이 같은 길로 따라간다.
  useEffect(() => {
    props.onSessionTitle?.(sessionTitle);
  }, [session, sessionTitle]);
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

  // dock과 자식 대화가 harness에 보내는 조작. source가 가졌는지는 capability가 알려 단추를 그린다.
  const openChild = (child: string) =>
    setLayer({
      kind: "child",
      path: layer?.kind === "child" ? [...layer.path, child] : [child],
    });
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
  const setGoal = (objective: string | null, paused: boolean) =>
    actHere((target) => ({
      type: "set_goal",
      session: target,
      key: actKey("goal"),
      objective,
      paused,
    }));

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
    });
    const next = afterReply(
      outgoing,
      reply.ok ? { ok: true } : { ok: false, code: reply.code },
    );
    if (next.phase === "accepted") drafts.accepted(target, next);
    else drafts.save(target, { outgoing: next });
  };

  const dispatch = async (content: ContentBlock[], target: string) => {
    const id = newId("msg", now());
    // 일하는 중에 보낸 말은 다음 turn을 기다린다. 도는 turn에 올리는 일은 "다음 turn" 줄의 [Send now]가 한다.
    const outgoing = startSend({
      id,
      key: `session-messages-send-${id}`,
      content,
      delivery: "next_turn",
    });
    drafts.save(target, { outgoing });
    await deliver(target, outgoing);
  };

  // 첨부한 이미지는 보내기 전에 올려 image block으로, 파일은 resource_link block으로 글 뒤에 싣는다. 하나라도 못
  // 올리면 보내지 않고 글과 첨부는 그대로 남는다.
  const send = async () => {
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
    await dispatch(content, target);
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

  // 명령이 여는 화면 동작(`opens`)만 보고 이름은 해석하지 않는다. `opens`가 null이거나 인자를 CLI가 받는 명령이면
  // CLI에 보내고 출력은 대화의 명령 출력 줄로 온다. model·effort·mode는 composer가 먼저 열어 보았다.
  const runSlash = (command: SlashEntryView, argument: string) => {
    const clear = () => drafts.save(key, { text: "", selection: [0, 0] });
    const opens = command.opens;
    const sendsArgument =
      argument !== "" &&
      command.argumentHint !== null &&
      opens !== "rename" &&
      opens !== "goal";
    if (opens !== null && !sendsArgument) {
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
          host.openAgentSettings("mcp");
        },
        skills: () => {
          clear();
          host.openAgentSettings("skills");
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
        // 머리 session menu는 다음 wave의 화면 task가 연다.
        resume: () => {},
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
  const accepted = (call: Promise<SourceResult<unknown>>) =>
    call.then((result) => result.ok);

  return (
    <section
      className={styles.view}
      data-agent-view=""
      onKeyDownCapture={findKeys}
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
          <ThreadIndexContext.Provider value={threadIndex}>
            <AgentThread
              key={key}
              agent={agent}
              entries={thread?.entries ?? []}
              detail={draft.detail}
              live={thread?.live ?? null}
              outgoing={draft.outgoing}
              working={working}
              now={now}
              imageUrl={imageUrl}
              readOnly={readOnly}
              can={{ rewind: caps.rewind, fork: caps.fork, retry: caps.retry }}
              source={source}
              initialScroll={draft.scroll}
              onScroll={(position) => drafts.save(key, { scroll: position })}
              rewindOpen={layer?.kind === "rewind" ? layer.message : null}
              onRewind={(message) =>
                setLayer(
                  layer?.kind === "rewind" && layer.message === message
                    ? null
                    : { kind: "rewind", message },
                )
              }
              onFork={(message) => void fork(message)}
              onOpenChild={openChild}
              onCheck={() => void check()}
              onResend={() => void sendAgain()}
              onOpenFile={host.openFile}
              onOpenRef={(ref: EvidenceRef) => {
                if (ref.kind === "file") host.openFile?.(ref.target);
              }}
              onOpenSession={host.openSession}
              artifacts={host.artifacts}
            />
          </ThreadIndexContext.Provider>
        </RunCodeProvider>
        {layer === null || layer.kind === "status" ? null : (
          <div className={styles.layer} data-panel-layer={layer.kind}>
            {layer.kind === "child" &&
            thread !== null &&
            childId !== null &&
            childThread !== null ? (
              <ChildView
                info={subagentOfChild(thread, childId)}
                now={now}
                canSteer={caps.steer_child}
                canStop={caps.stop_child}
                onBack={() =>
                  setLayer(
                    layer.path.length > 1
                      ? { kind: "child", path: layer.path.slice(0, -1) }
                      : null,
                  )
                }
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
            {layer.kind === "rewind" && session !== null ? (
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
            <div className={styles.statusOverlay} data-panel-layer="status">
              <StatusView status={status} onClose={() => setLayer(null)} />
            </div>
          ) : null}
          <AgentComposer
            key={key}
            source={source}
            meta={meta}
            capabilities={caps}
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
            locked={composerLocked(draft.outgoing)}
            tooLong={!fitsMessage(draft.text)}
            offline={offline}
            readOnly={readOnly}
            hint={hint}
            workspace={agent.workspace}
            permissionSummary={agent.permissionSummary}
            permissions={permissions}
            mode={
              session === null ||
              readOnly ||
              !caps.mode ||
              meta === null ||
              meta.modes.length < 2
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
            onLoadPermissions={() => void loadPermissions()}
            onEditPermissions={host.openPermissions}
            onSend={() => void send()}
            onStop={() => void stop()}
            onCommand={runSlash}
            onProblem={fail}
            usage={
              status === null ? null : (
                <StatusFooter status={status} onOpen={showStatus} />
              )
            }
          />
        </div>
      </div>
    </section>
  );
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
