// Agent 탭의 agent header. card 안이면 card 머리 줄(shell/card-head.tsx)에 올린다: 가운데 칸(경로 자리)이
// "[avatar] 이름 · session 제목 ▾"(session switcher), ⋯ 앞에 "Archived" 표시와 보기 상세 menu, Rename·Fork·Archive는
// 탭 ⋯ 메뉴의 맨 위 묶음이다. card 밖(floated 패널, detached 창)이면 본문 위 view bar 한 줄에 그리고 더보기 menu가
// 그 줄에 있다. 더보기 menu는 열린 session이면 Rename·Fork·Archive, archive한 session이면 Fork뿐이다(기록만 읽고 입력칸이 없다).
// session을 바꾸는 일은 source를 부르고, 끝나면 `onChanged`로 목록을 다시 읽게 한다. agent를 고르는 칸은 없다.
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon } from "@lophn/ui/overlay";
import { conversationIcons, editorIcons } from "../../icons/mod.ts";
import { type MessageKey, t } from "@lophn/i18n";

import { ViewBar } from "../../editor/view-bar.tsx";
import { useCardHead } from "../../shell/card-head.tsx";
import type { ViewDetail } from "../activity/model.ts";
import type {
  AgentTabSource,
  SessionEntry,
  SourceResult,
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

interface AgentHeaderProps {
  agent: SessionSwitcherProps["agent"] & {
    readonly place?: { readonly name: string } | null;
  };
  /** 지금 보는 session. null은 아직 만들지 않은 새 session이다. */
  session: SessionEntry | null;
  /** 그 agent의 session 전부(archive한 것 포함). */
  sessions: readonly SessionEntry[];
  now: Date;
  source: Pick<
    AgentTabSource,
    | "renameSession"
    | "archiveSession"
    | "deleteSession"
    | "forkSession"
    | "searchMessages"
  >;
  /** 단계 줄을 어디까지 보이는지. */
  detail: ViewDetail;
  /** 그 값을 바꾼다. session마다 기억한다. */
  onDetailChange: (detail: ViewDetail) => void;
  host: AgentHeaderHost;
  /** session 목록이나 제목이 바뀌었다. 목록을 다시 읽는다. */
  onChanged: () => void;
  /** menu 오른쪽 끝에 더할 조각 (예: home full mode controller). */
  trailing?: ReactNode;
  /** lophn session이 아니다(`AgentTabSource.external`). session을 고르고 고치는 칸이 없고 누구의 어디인지만 보인다. */
  external?: boolean;
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
    void settle(source.renameSession(id, title));
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
        setDraft(session.title ?? "");
        setRenaming(true);
        return;
      case "fork":
        void forkAndOpen(source, session.id, host.openForked).then((result) =>
          setProblem(!result.ok),
        );
        return;
      case "archive":
        return void settle(source.archiveSession(session.id));
    }
  };

  const chooseDetail = (id: string) => {
    const found = DETAIL_ITEMS.find((item) => item.id === id);
    if (found !== undefined) props.onDetailChange(found.id);
  };

  const archived = session?.archived === true;
  const items = archived ? ARCHIVED_ITEMS : MORE_ITEMS;

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

  const lead = props.external ? (
    <span className={styles.face}>
      <AgentFace agent={agent} />
      <span>{props.agent.place?.name}</span>
    </span>
  ) : renaming ? (
    <span className={styles.face}>
      <AgentFace agent={agent} />
      <input
        ref={renameInput}
        className={styles.renameInput}
        data-header-rename
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
  ) : (
    <SessionSwitcher
      agent={agent}
      current={session}
      sessions={props.sessions}
      now={props.now}
      onSwitch={(id) => latest.current.host.switchSession(id)}
      onNew={() => latest.current.host.newSession()}
      onRename={(id, title) => act.current.rename(id, title)}
      onArchive={(id) =>
        void act.current.settle(latest.current.source.archiveSession(id))
      }
      onDelete={(id) =>
        void act.current.settle(latest.current.source.deleteSession(id))
      }
      searchMessages={(...args) =>
        latest.current.source.searchMessages(...args)
      }
      onOpenMatch={(id, query) => latest.current.host.openMatch(id, query)}
    />
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

  const inCard = useCardHead(
    {
      center: <div className={styles.lead}>{lead}</div>,
      actions: (
        <>
          {status}
          {props.trailing}
        </>
      ),
      ...(session === null || props.external
        ? {}
        : {
            menu: {
              // id는 탭 기본 항목(rename, close 같은)과 겹치지 않게 접두어를 단다.
              items: items.map((item) => ({
                id: `agent:${item.id}`,
                label: t(item.label),
              })),
              onSelect: (id) => act.current.onMore(id.slice("agent:".length)),
            },
          }),
    },
    [
      agent,
      session?.id,
      session?.title,
      archived,
      props.sessions,
      Math.floor(props.now.getTime() / 60_000),
      props.detail,
      props.trailing,
      renaming,
      draft,
      problem,
    ],
  );
  if (inCard) return <></>;

  return (
    <div className={styles.gap} data-agent-header>
      <ViewBar lead={<div className={styles.lead}>{lead}</div>}>
        {status}
        {session === null || props.external ? null : (
          <Menu
            items={items.map((item) => ({
              id: item.id,
              label: t(item.label),
            }))}
            onSelect={onMore}
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
