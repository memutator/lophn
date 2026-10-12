// Agent 화면 맨 위 머리와 그 session popover(shell/desktop#R38·R39).
// 화면 값은 lophn-agent/sessions contract에서 만든 view 값이다. renderer는 contracts를 type check하지
// 않으므로 id는 문자열로 받는다.
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useRef,
  useState,
} from "react";
import {
  Avatar,
  editorIcons,
  Icon,
  IconButton,
  iconPixels,
  lophnSpaceIcons,
  Menu,
  Popover,
} from "@lophn/design/components";
import { type MessageKey, t } from "@lophn/wording";

import styles from "./agent-header.module.css";
import { SessionPopover } from "./session-popover.tsx";
import type { HeaderAgent, SessionLine } from "./types.ts";

export type {
  AgentProfile,
  HeaderAgent,
  SessionGroup,
  SessionLine,
  SessionStatus,
} from "./types.ts";

export interface AgentHeaderProps {
  agent: HeaderAgent;
  /** 지금 보는 session. 제목이 머리에 보이고 popover 줄에 ✓가 붙는다. */
  session: { readonly id: string; readonly title: string };
  /** 그 자리에서 읽은 session 목록(archived 포함). 정렬은 부르는 쪽이 한다. */
  sessions: readonly SessionLine[];
  /** 상대 시각의 기준. */
  now: Date;
  /** 줄을 눌렀다. popover는 닫힌다. */
  onSwitch: (session: string) => void;
  /** [+ New session]을 눌렀다. popover는 닫힌다. */
  onNew: () => void;
  /** 이름 입력칸에서 Enter(또는 Save). 앞뒤 공백을 뺀 비지 않은 제목만 부른다. */
  onRename: (session: string, title: string) => void;
  onArchive: (session: string) => void;
  /** Archived 줄의 Restore. */
  onUnarchive: (session: string) => void;
  /** 확인 dialog의 Delete를 누른 뒤에만 부른다. */
  onDelete: (session: string) => void;
  /** closed session이면 true. ⋯ 메뉴에서 Rename·Fork·Rewind…가 빠지고 Usage·Close tab만 남는다. */
  sessionClosed: boolean;
  /** ⋯ 메뉴 Fork. 마지막 확정 메시지까지 복사한다(R48). */
  onForkSession: () => void;
  /** ⋯ 메뉴 Rewind…. 되돌리기 menu를 여는 일은 부르는 쪽 몫이다(내 메시지의 Rewind to here와 같은 menu). */
  onRewindMenu: () => void;
  onUsage: () => void;
  /** 탭·칸만 닫는다. session은 그대로 남는다. */
  onCloseTab: () => void;
  /** ⋯ 메뉴 왼쪽의 진행 chip·보기 상세 select는 다른 task 몫이라 자리만 연다. */
  children?: ReactNode;
}

/**
 * 약속하는 DOM(test가 단언):
 * - 머리: `[data-agent-header]` 안에 avatar(`[data-avatar]`), agent 이름, `·`, session 제목이 이 순서로 있고
 *   trigger `button[data-session-trigger]`(aria-haspopup)가 이 글을 품는다. agent를 고르는 칸은 없다.
 * - ⋯ 메뉴: 머리 오른쪽 `button[aria-label="More"]`(children 자리 뒤)가 `role=menu`를 열고 항목
 *   `role=menuitem`이 Rename, Fork, Rewind…, Usage, Close tab 순서다. closed session이면 Usage, Close tab뿐.
 *   Rename은 머리의 session 제목을 `input[data-header-rename][aria-label="Rename <제목>"]`(현재 제목이 값)로
 *   바꾸고 Enter로 `onRename(session.id, 앞뒤 공백을 뺀 제목)`, Escape로 취소(공백뿐이면 부르지 않는다).
 *   Fork `onForkSession()`, Rewind… `onRewindMenu()`, Usage `onUsage()`, Close tab `onCloseTab()`.
 * - popover: `[data-session-popover]`(portal). 맨 위 검색 `input[aria-label="Search <agent 이름> sessions"]`,
 *   `[role=listbox]` 안에 `[data-session-group]`(`Today`·`Earlier`) 머리와 줄
 *   `[role=option][data-session=<id>]`. 줄 안에 `[data-check]`(현재 줄만 ✓, 아니면 빈 글),
 *   상태 점(`role=img`, aria-label "Waiting for you"·"Working", idle은 점 없음),
 *   `[data-session-title]`, `[data-session-when]`(상대 시각, 영어 Intl). 현재 줄은 `aria-selected=true`.
 *   맞는 줄이 없으면 `[data-no-match]` "No sessions match.".
 * - 줄 단추: 줄 안의 aria-label "Rename"·"Archive"·"Delete" 단추가 이 순서로 있다(hover 노출은 CSS 몫).
 *   단추를 눌러도 줄을 누른 것으로 치지 않는다.
 * - Rename: 줄이 `input[aria-label="Rename <제목>"]`로 바뀌고 Enter 저장, Escape 취소.
 * - Delete: 줄이 `role=alertdialog`가 되어 `Delete "<제목>"? This can't be undone.`와 Delete·Cancel.
 * - 아래: `Archived (n)` 단추(aria-expanded), 펼치면 줄 `[data-archived-session=<id>]`마다
 *   `[data-session-title]`과 Restore. `New session` 단추.
 */
type MoreAction = "rename" | "fork" | "rewind" | "usage" | "close";

const MORE_ITEMS: readonly { id: MoreAction; label: MessageKey }[] = [
  { id: "rename", label: "conversation.button.rename" },
  { id: "fork", label: "conversation.button.fork" },
  { id: "rewind", label: "conversation.button.rewind" },
  { id: "usage", label: "conversation.button.usage" },
  { id: "close", label: "conversation.button.close-tab" },
];

// closed session은 대화를 더 이을 수 없어 Usage·Close tab만 남는다.
const CLOSED_ITEMS = MORE_ITEMS.filter(({ id }) =>
  id === "usage" || id === "close"
);

export function AgentHeader(props: AgentHeaderProps): ReactElement {
  const { agent, session, sessionClosed } = props;
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  // 열린 popover가 Escape·바깥 누름을 먼저 받아 안쪽 편집만 접게 한다.
  const dismiss = useRef<(() => boolean) | null>(null);

  const lines = props.sessions.filter((line) =>
    line.assignment === agent.assignment
  );

  const startRename = () => {
    setDraft(session.title);
    setRenaming(true);
  };
  const saveRename = () => {
    const title = draft.trim();
    if (title === "") return;
    props.onRename(session.id, title);
    setRenaming(false);
  };
  const renameKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") saveRename();
    if (event.key === "Escape") setRenaming(false);
  };

  const onMore = (id: string) => {
    switch (id as MoreAction) {
      case "rename":
        return startRename();
      case "fork":
        return props.onForkSession();
      case "rewind":
        return props.onRewindMenu();
      case "usage":
        return props.onUsage();
      case "close":
        return props.onCloseTab();
    }
  };

  const face = (
    <>
      <Avatar profile={agent.profile} size="md" />
      <span className={styles.name}>{agent.name}</span>
      <span className={styles.sep}>·</span>
    </>
  );

  return (
    <header className={styles.bar} data-agent-header>
      <div className={styles.who}>
        {renaming
          ? (
            <span className={styles.titleSlot}>
              {face}
              <input
                className={styles.renameInput}
                data-header-rename
                aria-label={t("conversation.label.rename-session", {
                  title: session.title,
                })}
                value={draft}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={renameKeys}
              />
            </span>
          )
          : (
            <Popover
              open={open}
              onOpenChange={(next) => {
                if (!next && dismiss.current?.()) return;
                setOpen(next);
              }}
              placement="beside"
              trigger={
                <button
                  type="button"
                  className={styles.trigger}
                  data-session-trigger
                >
                  {face}
                  <span className={styles.title}>{session.title}</span>
                  <Icon
                    icon={lophnSpaceIcons.collapse}
                    pixels={iconPixels("small")}
                  />
                </button>
              }
            >
              <SessionPopover
                agentName={agent.name}
                lines={lines}
                currentId={session.id}
                now={props.now}
                dismiss={dismiss}
                onSwitch={(id) => {
                  props.onSwitch(id);
                  setOpen(false);
                }}
                onNew={() => {
                  props.onNew();
                  setOpen(false);
                }}
                onRename={props.onRename}
                onArchive={props.onArchive}
                onUnarchive={props.onUnarchive}
                onDelete={props.onDelete}
              />
            </Popover>
          )}
      </div>
      <div className={styles.tools}>
        {props.children}
        <Menu
          items={(sessionClosed ? CLOSED_ITEMS : MORE_ITEMS).map((item) => ({
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
      </div>
    </header>
  );
}
