// Agent 탭의 agent header. card 안이면 card 머리 줄(parts/card-head)에 올린다: 가운데 칸(경로 자리)이
// "[avatar] 이름 · session 제목 ▾"(session switcher), ⋯ 앞에 "Archived" 표시와 보기 상세 menu, Rename·Fork·Archive는
// 탭 ⋯ 메뉴의 맨 위 묶음이다. card 밖(floated 패널, detached 창)이면 본문 위 view bar 한 줄에 그리고 더보기 menu가
// 그 줄에 있다. 더보기 menu는 열린 session이면 Rename·Fork·Archive, archive한 session이면 Fork뿐이다(기록만 읽고 입력칸이 없다).
// session을 바꾸는 일은 source를 부르고, 끝나면 `onChanged`로 목록을 다시 읽게 한다. agent를 고르는 칸은 없다.
// harness(capability `sessions`가 없고 `resume`이 있다)는 session menu가 그 CLI의 지난 session 목록·바꾸기·새로뿐이다.
// subagent 대화(`child`)를 읽는 동안은 머리 ←/→가 그 보기의 기록이 되고(`nav`) 제목이 "agent › subagent · subagent"로 바뀐다.
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, type MenuItem } from "@lophn/ui/overlay";
import { conversationIcons, editorIcons } from "../../icons/mod.ts";
import { type MessageKey, t } from "@lophn/i18n";

import { ViewBar } from "../../parts/view-bar/view-bar.tsx";
import { useCardHead } from "../../parts/card-head/card-head.tsx";
import { elapsedText, useSecondTick } from "../activity/elapsed.ts";
import type { ViewDetail } from "../activity/model.ts";
import { SubagentMark } from "../activity/subagent-row.tsx";
import type { AcpCapabilities } from "../../../../protocol/acp/mod.ts";
import { newId } from "../../prefixed-id.ts";
import type {
  AgentTabSource,
  SessionEntry,
  SourceResult,
  ThreadSubagent,
} from "../agent-tab-source.ts";
import styles from "./agent-header.module.css";
import { forkAndOpen } from "./fork.ts";
import {
  AgentFace,
  SessionSwitcher,
  type SessionSwitcherProps,
} from "./session-popover.tsx";

/** header가 자기 밖에 맡기는 일: 탭에서 session을 여는 길. */
interface AgentHeaderHost {
  /** 다른 session을 이 탭에서 연다. archive한 session이면 기록만 읽는다. */
  switchSession: (session: string) => void;
  /** 아직 만들지 않은 새 session으로 간다. */
  newSession: () => void;
  /** Fork가 만든 session을 같은 agent의 새 탭에 연다. */
  openForked: (session: string) => void;
  /** session 검색 결과의 메시지 줄을 눌렀다. 그 session을 열고 찾기 줄을 그 query로 연다. */
  openMatch: (session: string, query: string) => void;
}

/** 열려 있는 subagent 대화. 머리 제목과 상태·model·경과를 그린다. */
export interface HeaderChild {
  readonly info: ThreadSubagent | null;
  readonly now: () => number;
}

/** subagent 대화를 읽는 동안 머리 ←/→를 대신하는 기록. */
export interface HeaderNav {
  readonly canBack: boolean;
  readonly canForward: boolean;
  readonly onBack: () => void;
  readonly onForward: () => void;
}

/** harness 머리 session menu(capability `resume`). 목록은 `sessions`(id가 CLI session id)다. */
export interface HeaderResume {
  /** 지금 열린 CLI session. 아직 모르면 null이다. */
  readonly current: {
    readonly id: string;
    readonly title: string | null;
  } | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 바꾸는 중이다. */
  readonly busy: boolean;
  readonly onSwitch: (cliSession: string) => void;
  /** 새 session 명령이 없으면 null이라 새로 항목이 없다. */
  readonly onNew: (() => void) | null;
}

interface AgentHeaderProps {
  agent: SessionSwitcherProps["agent"] & {
    readonly workspace?: { readonly name: string } | null;
  };
  /** 지금 보는 session. null은 아직 만들지 않은 새 session이다. */
  session: SessionEntry | null;
  /** 그 agent의 session 전부(archive한 것 포함). */
  sessions: readonly SessionEntry[];
  now: Date;
  source: Pick<AgentTabSource, "act" | "deleteSession" | "searchMessages">;
  /** session을 archive한다. 도는 turn이 있으면 화면이 확인 dialog를 연다. */
  onArchive: (session: string) => void;
  /** 어떤 칸을 그릴지(`session.capabilities`). */
  capabilities: AcpCapabilities;
  /** source가 알려 준 session 제목(`session.title`). 없으면 null이다. */
  title: string | null;
  /** 단계 줄을 어디까지 보이는지. */
  detail: ViewDetail;
  /** 그 값을 바꾼다. session마다 기억한다. */
  onDetailChange: (detail: ViewDetail) => void;
  host: AgentHeaderHost;
  /** session 목록이나 제목이 바뀌었다. 목록을 다시 읽는다. */
  onChanged: () => void;
  /** menu 오른쪽 끝에 더할 조각 (예: home full mode controller). */
  trailing?: ReactNode;
  /** 열린 subagent 대화. null이면 이 session 자신의 머리다. */
  child?: HeaderChild | null;
  /** 있으면 머리 ←/→를 이 기록이 맡는다. 없으면 창 기록이다. */
  nav?: HeaderNav | null;
  /** harness의 session menu. 없으면 harness 머리는 menu 없이 제목만 보인다. */
  resume?: HeaderResume | null;
  /** ⋯ menu 끝에 더할 항목(터미널 탭의 "Open in terminal"). */
  extraMenu?: {
    readonly items: readonly MenuItem[];
    readonly onSelect: (id: string) => void;
  };
}

/** 열린 subagent의 상태 점·model·경과. 도는 동안은 1초마다 다시 센다. */
function ChildMeta({ child }: { child: HeaderChild }): ReactElement | null {
  const { info, now } = child;
  const running = info?.state === "running";
  useSecondTick(running);
  if (info === null) return null;
  return (
    <span className={styles.childMeta} data-child-meta="">
      <SubagentMark state={info.state} />
      {info.model === null ? null : <span>{info.model}</span>}
      <span>{elapsedText(running, info.startedAt, info.durationMs, now)}</span>
    </span>
  );
}

type MoreAction = "rename" | "fork" | "archive";

const MORE_ITEMS: readonly { id: MoreAction; label: MessageKey }[] = [
  { id: "rename", label: "conversation.button.rename" },
  { id: "fork", label: "conversation.button.fork" },
  { id: "archive", label: "conversation.button.archive" },
];

// archive한 session은 대화를 더 이을 수 없다. 이력을 복사하는 Fork만 남는다.
const ARCHIVED_ITEMS = MORE_ITEMS.filter(({ id }) => id === "fork");

// 단계 줄의 상세. Messages는 tool 줄을 숨기고, Compact는 묶음을 접고, Everything은 펼친다. 메시지와 카드는 그대로다.
const DETAIL_ITEMS: readonly { id: ViewDetail; label: MessageKey }[] = [
  { id: "messages", label: "conversation.label.view-messages" },
  { id: "compact", label: "conversation.label.view-compact" },
  { id: "everything", label: "conversation.label.view-everything" },
];

const DETAIL_LABEL: Readonly<Record<ViewDetail, MessageKey>> = {
  messages: "conversation.label.view-messages",
  compact: "conversation.label.view-compact",
  everything: "conversation.label.view-everything",
};

export function AgentHeader(props: AgentHeaderProps): ReactElement {
  const { agent, session, source, host } = props;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState(false);

  // 쓰기 결과를 보고 목록을 다시 읽거나 실패를 알린다.
  const settle = async (pending: Promise<SourceResult<unknown>>) => {
    const result = await pending;
    setProblem(!result.ok);
    if (result.ok) props.onChanged();
  };

  const rename = (id: string, title: string) =>
    void settle(
      source.act(id, {
        type: "rename",
        session: id,
        key: newId("rename"),
        title,
      }),
    );
  const saveRename = () => {
    const title = draft.trim();
    if (title === "" || session === null) return;
    rename(session.id, title);
    setRenaming(false);
  };
  const renameKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") saveRename();
    if (event.key === "Escape") setRenaming(false);
  };

  const onMore = (id: string) => {
    if (session === null) return;
    switch (id as MoreAction) {
      case "rename":
        setDraft(props.title ?? session.title ?? "");
        setRenaming(true);
        return;
      case "fork":
        void forkAndOpen(source, session.id, null, host.openForked).then(
          (result) => setProblem(!result.ok),
        );
        return;
      case "archive":
        props.onArchive(session.id);
        return;
    }
  };

  const chooseDetail = (id: string) => {
    const found = DETAIL_ITEMS.find((item) => item.id === id);
    if (found !== undefined) props.onDetailChange(found.id);
  };

  const archived = session?.archived === true;
  const { capabilities } = props;
  const items = (archived ? ARCHIVED_ITEMS : MORE_ITEMS).filter(
    (item) =>
      capabilities[
        item.id === "rename"
          ? "rename"
          : item.id === "fork"
            ? "fork"
            : "sessions"
      ],
  );

  // 머리에 올린 요소의 callback은 deps에 없는 최신 값을 읽는다.
  const act = useRef({
    settle,
    rename,
    renameKeys,
    onMore,
    chooseDetail,
  });
  act.current = { settle, rename, renameKeys, onMore, chooseDetail };
  const latest = useRef(props);
  latest.current = props;
  const renameInput = useRef<HTMLInputElement>(null);

  // card의 ⋯ 메뉴는 닫힐 때 focus를 ⋯로 돌려 Rename 입력의 focus를 빼앗는다. 닫힌 뒤에 다시 준다.
  useEffect(() => {
    if (!renaming) return;
    const timer = setTimeout(() => {
      renameInput.current?.focus();
      renameInput.current?.select();
    }, 200);
    return () => clearTimeout(timer);
  }, [renaming]);

  const lead = renaming ? (
    <span className={styles.face}>
      <AgentFace agent={agent} />
      <input
        ref={renameInput}
        className={styles.renameInput}
        data-header-rename
        data-key-context="modal"
        aria-label={t("conversation.label.rename-session", {
          title: session?.title ?? t("conversation.label.session-untitled"),
        })}
        value={draft}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => act.current.renameKeys(event)}
      />
    </span>
  ) : props.child != null ? (
    <span className={styles.face}>
      <AgentFace agent={agent} sep={false} />
      <span className={styles.crumb}>
        › {props.child.info?.agent ?? t("conversation.label.child-view")}
      </span>
      <span className={styles.sep}>
        · {t("conversation.label.subagent-tag")}
      </span>
      <ChildMeta child={props.child} />
    </span>
  ) : capabilities.sessions || props.resume != null ? (
    <SessionSwitcher
      agent={agent}
      current={
        capabilities.sessions ? session : (props.resume?.current ?? null)
      }
      sessions={props.sessions}
      now={props.now}
      manage={capabilities.sessions}
      {...(capabilities.sessions
        ? {}
        : {
            open: props.resume?.open ?? false,
            onOpenChange: (next: boolean) =>
              latest.current.resume?.onOpenChange(next),
            busy: props.resume?.busy ?? false,
          })}
      onSwitch={(id) =>
        capabilities.sessions
          ? latest.current.host.switchSession(id)
          : latest.current.resume?.onSwitch(id)
      }
      onNew={
        capabilities.sessions
          ? () => latest.current.host.newSession()
          : props.resume?.onNew == null
            ? null
            : () => latest.current.resume?.onNew?.()
      }
      onRename={(id, title) => act.current.rename(id, title)}
      onArchive={(id) => latest.current.onArchive(id)}
      onDelete={
        props.source.deleteSession === undefined
          ? undefined
          : (id) => {
              const remove = latest.current.source.deleteSession;
              if (remove !== undefined) void act.current.settle(remove(id));
            }
      }
      searchMessages={(...args) =>
        latest.current.source.searchMessages(...args)
      }
      onOpenMatch={(id, query) => latest.current.host.openMatch(id, query)}
    />
  ) : (
    <span className={styles.face}>
      <AgentFace agent={agent} />
      <span>{props.agent.workspace?.name}</span>
      {props.title === null ? null : <span>· {props.title}</span>}
    </span>
  );

  const status = (
    <>
      {problem ? (
        <span className={styles.problem} role="alert">
          {t("conversation.error.action-failed")}
        </span>
      ) : null}
      {archived ? (
        <span className={styles.archivedMark} data-archived-mark>
          {t("conversation.label.archived")}
        </span>
      ) : null}
      {session === null ? null : (
        <Menu
          items={DETAIL_ITEMS.map((item) => ({
            id: item.id,
            label: t(item.label),
            leading:
              props.detail === item.id ? (
                <MenuIcon icon={conversationIcons.current} />
              ) : (
                <MenuIcon />
              ),
          }))}
          onSelect={(id) => act.current.chooseDetail(id)}
          placement="beside"
          trigger={
            <Button
              size="sm"
              variant="ghost"
              trailingIcon={conversationIcons.expand}
              aria-label={t("conversation.label.steps-value", {
                detail: t(DETAIL_LABEL[props.detail]),
              })}
              data-steps-detail=""
            >
              {t(DETAIL_LABEL[props.detail])}
            </Button>
          }
        />
      )}
    </>
  );

  const extra = props.extraMenu;
  const withExtra = (own: readonly MenuItem[]): readonly MenuItem[] =>
    extra === undefined
      ? own
      : [
          ...own,
          ...extra.items.map((item, at) =>
            at === 0 && own.length > 0
              ? { ...item, separatorBefore: true }
              : item,
          ),
        ];
  const ownItems = session === null ? [] : items;
  const nav = props.nav ?? null;
  const inCard = useCardHead(
    {
      ...(nav === null
        ? {}
        : {
            nav: {
              canBack: nav.canBack,
              canForward: nav.canForward,
              onBack: () => latest.current.nav?.onBack(),
              onForward: () => latest.current.nav?.onForward(),
            },
          }),
      center: <div className={styles.lead}>{lead}</div>,
      actions: (
        <>
          {status}
          {props.trailing}
        </>
      ),
      ...(ownItems.length === 0 && extra === undefined
        ? {}
        : {
            menu: {
              // id는 탭 기본 항목(rename, close 같은)과 겹치지 않게 접두어를 단다.
              items: withExtra(
                ownItems.map((item) => ({
                  id: `agent:${item.id}`,
                  label: t(item.label),
                })),
              ),
              onSelect: (id) =>
                id.startsWith("agent:")
                  ? act.current.onMore(id.slice("agent:".length))
                  : latest.current.extraMenu?.onSelect(id),
            },
          }),
    },
    [
      agent,
      session?.id,
      session?.title,
      props.title,
      capabilities,
      archived,
      props.sessions,
      Math.floor(props.now.getTime() / 60_000),
      props.detail,
      props.trailing,
      renaming,
      draft,
      problem,
      props.child?.info?.state,
      props.child?.info?.agent,
      props.child?.info?.model,
      props.child?.info?.startedAt,
      props.child?.info?.durationMs,
      props.child == null,
      nav?.canBack,
      nav?.canForward,
      props.resume?.open,
      props.resume?.busy,
      props.resume?.current?.id,
      props.resume?.current?.title,
      props.resume?.onNew === null,
      extra,
    ],
  );
  if (inCard) return <></>;

  return (
    <div className={styles.gap} data-agent-header>
      <ViewBar
        lead={
          <>
            {nav === null ? null : (
              <IconButton
                icon={conversationIcons.back}
                label={t("conversation.label.child-back", {
                  agent: agent.name,
                })}
                size="sm"
                disabled={!nav.canBack}
                onClick={nav.onBack}
              />
            )}
            <div className={styles.lead}>{lead}</div>
          </>
        }
      >
        {status}
        {ownItems.length === 0 && extra === undefined ? null : (
          <Menu
            items={withExtra(
              ownItems.map((item) => ({ id: item.id, label: t(item.label) })),
            )}
            onSelect={(id) =>
              extra?.items.some((item) => item.id === id)
                ? extra.onSelect(id)
                : onMore(id)
            }
            placement="beside"
            returnFocus={!renaming}
            trigger={
              <IconButton
                icon={editorIcons.menu}
                label={t("conversation.label.more-actions")}
                size="sm"
              />
            }
          />
        )}
        {props.trailing}
      </ViewBar>
    </div>
  );
}
