// Agent 탭 맨 위의 agent header. 탭 안 view bar의 왼쪽에 "[avatar] 이름 · session 제목 ▾"(session switcher),
// 오른쪽에 "Archived" 표시, 보기 상세 menu, 더보기 menu가 있다. 더보기 menu는 열린 session이면
// Rename·Fork·Archive, archive한 session이면 Fork뿐이다(기록만 읽고 입력칸이 없다).
// session을 바꾸는 일은 source를 부르고, 끝나면 `onChanged`로 목록을 다시 읽게 한다. agent를 고르는 칸은 없다.
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Menu } from "@lophn/ui/overlay";
import { editorIcons } from "../../icons/mod.ts";
import { type MessageKey, t } from "@lophn/wording";

import { ViewBar } from "../../editor/view-bar.tsx";
import type {
  AgentTabSource,
  SessionEntry,
  SourceResult,
} from "../agent-tab-source.ts";
import styles from "./agent-header.module.css";
import { forkAndOpen } from "./fork.ts";
import {
  AgentFace,
  type QueuedCodingView,
  SessionSwitcher,
  type SessionSwitcherProps,
} from "./session-popover.tsx";

export type { QueuedCodingView } from "./session-popover.tsx";

/** header가 자기 밖에 맡기는 일: 탭에서 session을 여는 길. */
interface AgentHeaderHost {
  /** 다른 session을 이 탭에서 연다. archive한 session이면 기록만 읽는다. */
  switchSession: (session: string) => void;
  /** 아직 만들지 않은 새 session으로 간다. */
  newSession: () => void;
  /** Fork가 만든 session을 같은 agent의 새 탭에 연다. */
  openForked: (session: string) => void;
}

interface AgentHeaderProps {
  agent: SessionSwitcherProps["agent"];
  /** 지금 보는 session. null은 아직 만들지 않은 새 session이다. */
  session: SessionEntry | null;
  /** 그 agent의 session 전부(archive한 것 포함). */
  sessions: readonly SessionEntry[];
  queuedCoding?: readonly QueuedCodingView[];
  now: Date;
  source: Pick<
    AgentTabSource,
    "renameSession" | "archiveSession" | "deleteSession" | "forkSession"
  >;
  host: AgentHeaderHost;
  /** session 목록이나 제목이 바뀌었다. 목록을 다시 읽는다. */
  onChanged: () => void;
  /** 보기 상세 menu 자리(Messages·Compact·Everything). */
  detail?: ReactNode;
}

type MoreAction = "rename" | "fork" | "archive";

const MORE_ITEMS: readonly { id: MoreAction; label: MessageKey }[] = [
  { id: "rename", label: "conversation.button.rename" },
  { id: "fork", label: "conversation.button.fork" },
  { id: "archive", label: "conversation.button.archive" },
];

// archive한 session은 대화를 더 이을 수 없다. 이력을 복사하는 Fork만 남는다.
const ARCHIVED_ITEMS = MORE_ITEMS.filter(({ id }) => id === "fork");

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

  const archived = session?.archived === true;
  const items = archived ? ARCHIVED_ITEMS : MORE_ITEMS;

  const lead = renaming ? (
    <span className={styles.face}>
      <AgentFace agent={agent} />
      <input
        className={styles.renameInput}
        data-header-rename
        aria-label={t("conversation.label.rename-session", {
          title: session?.title ?? t("conversation.label.session-untitled"),
        })}
        value={draft}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={renameKeys}
      />
    </span>
  ) : (
    <SessionSwitcher
      agent={agent}
      current={session}
      sessions={props.sessions}
      queuedCoding={props.queuedCoding}
      now={props.now}
      onSwitch={host.switchSession}
      onNew={host.newSession}
      onRename={rename}
      onArchive={(id) => void settle(source.archiveSession(id))}
      onDelete={(id) => void settle(source.deleteSession(id))}
    />
  );

  return (
    <div className={styles.gap} data-agent-header>
      <ViewBar lead={<div className={styles.lead}>{lead}</div>}>
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
        {props.detail}
        {session === null ? null : (
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
      </ViewBar>
    </div>
  );
}
