// 다른 화면(app-space/side-pane)이 쓰는 Agent 대화의 틀과 부품. 안은 renderer의 대화 component이고, 이
// file은 이 화면들이 쓰는 이름과 props(agent 이름 글, 보기 상세를 받는 children)로 맞추는 얇은 adapter다.
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { ProgressChip } from "../../../../packages/shell/renderer/conversation/activity/progress-chip.tsx";
import type { ViewDetail } from "../../../../packages/shell/renderer/conversation/activity/model.ts";
import { ViewDetailSelect } from "../../../../packages/shell/renderer/conversation/activity/view-detail-select.tsx";
import { createFakeAgentTabSource } from "../../../../packages/shell/renderer/conversation/agent-tab-fake-source.ts";
import type {
  PermissionsView as PermissionsData,
  SessionEntry,
} from "../../../../packages/shell/renderer/conversation/agent-tab-source.ts";
import { AgentComposer } from "../../../../packages/shell/renderer/conversation/composer/agent-composer.tsx";
import { AgentHeader } from "../../../../packages/shell/renderer/conversation/header/agent-header.tsx";
import {
  AgentTurn as TurnBlock,
  Quiet,
  Said,
  UserMessage,
} from "../../../../packages/shell/renderer/conversation/message-list/agent-turn.tsx";
import { ThreadScroll } from "../../../../packages/shell/renderer/conversation/message-list/thread-scroll.tsx";
import { PermissionsView } from "../../../../packages/shell/renderer/conversation/permissions-view/permissions-view.tsx";
import { QueuedMessages } from "../../../../packages/shell/renderer/conversation/queued/queued-messages.tsx";
import { RecapCard } from "../../../../packages/shell/renderer/conversation/recap/recap-card.tsx";
import { ToolRow } from "../../../../packages/shell/renderer/conversation/activity/tool-line.tsx";
import turns from "../../../../packages/shell/renderer/conversation/message-list/turns.module.css";
import view from "../../../../packages/shell/renderer/conversation/agent-view.module.css";

import {
  type ChatInit,
  profileOf,
  type SessionRow,
  sessionsOf,
} from "../../mock/agents-data.ts";
import { click, useDrive } from "../../mock/drive.ts";

export { Quiet, Said, ToolRow, UserMessage };
type Detail = ViewDetail;

const NOW = new Date("2026-10-06T09:30:00Z");
const MINUTE = 60_000;

/** wireframe의 agent profile을 renderer avatar의 값으로. */
function faceOf(agent: string) {
  const profile = profileOf(agent);
  return {
    name: agent,
    profile: { kind: "icon" as const, icon: profile.icon },
  };
}

/** agent의 말 한 덩어리. agent는 이름 글이다. */
export function AgentTurn(
  { agent, time, children }: {
    agent: string;
    time: string;
    children: ReactNode;
  },
) {
  return <TurnBlock agent={faceOf(agent)} time={time}>{children}</TurnBlock>;
}

const TASKS = [
  { id: "t1", text: "Read last week's findings", state: "done" },
  { id: "t2", text: "Search eval", state: "done" },
  { id: "t3", text: "Write report", state: "now" },
  { id: "t4", text: "Link findings", state: "later" },
] as const;

function entryOf(row: SessionRow): SessionEntry {
  const day = row.group === "today" ? 0 : row.group === "earlier" ? 3 : 14;
  return {
    id: row.id,
    title: row.title,
    status: row.state,
    activeAt: new Date(NOW.getTime() - day * 24 * 60 * MINUTE - 5 * MINUTE)
      .toISOString(),
    archived: row.group === "archived",
    skip: false,
  };
}

/**
 * Agent 탭의 틀: agent header, 대화, 질문·승인 카드, composer. `children`은 보기 상세에 따라 대화를 그린다.
 * `panel`은 대화 화면 안에 열리는 panel이다. `/permissions`와 `/recap`은 이 틀이 직접 연다.
 */
export function ChatShell(
  {
    agent,
    session,
    chat = {},
    tasks = false,
    running = false,
    archived = false,
    placeholder,
    dock,
    panel,
    queued = [],
    onSession,
    onNewSession,
    children,
  }: {
    agent: string;
    /** 지금 session. 새 session이면 id가 없다. */
    session: { id: string; title: string };
    chat?: ChatInit;
    tasks?: boolean;
    running?: boolean;
    /** archive한 session. 기록만 보이고 입력칸이 없다. */
    archived?: boolean;
    placeholder: string;
    dock?: ReactNode;
    panel?: ReactNode;
    /** 일하는 중에 보내 다음 turn을 기다리는 메시지. */
    queued?: readonly string[];
    onSession?: (row: SessionRow) => void;
    onNewSession?: (agent: string) => void;
    children: (detail: Detail) => ReactNode;
  },
) {
  const source = useMemo(
    () => createFakeAgentTabSource({ scene: "report" }),
    [],
  );
  const [detail, setDetail] = useState<Detail>("compact");
  const [text, setText] = useState(chat.slash ?? "");
  const [view_, setView] = useState<ChatInit["view"]>(chat.view);
  const [waiting, setWaiting] = useState<readonly string[]>(queued);
  const [permissions, setPermissions] = useState<PermissionsData | null>(null);
  useEffect(() => {
    void source.permissions(null).then((read) => {
      if (read.ok) setPermissions(read.value);
    });
  }, [source]);

  const rows = sessionsOf(agent).map(entryOf);
  const current: SessionEntry | null = session.id === ""
    ? null
    : rows.find((row) => row.id === session.id) ?? {
      id: session.id,
      title: session.title,
      status: running ? "working" : "idle",
      activeAt: new Date(NOW.getTime() - 5 * MINUTE).toISOString(),
      archived,
      skip: false,
    };

  useDrive(async () => {
    if (chat.switcher !== undefined) {
      await click("[data-agent-header] button[aria-label]");
    }
    if (chat.modelDemo !== undefined) await click("[data-model-button]");
  });

  const layer = panel ??
    (view_ === "permissions" && permissions !== null
      ? (
        <PermissionsView
          agent={agent}
          permissions={permissions}
          onClose={() => setView(undefined)}
          onEdit={() => {}}
        />
      )
      : view_ === "recap"
      ? (
        <RecapCard
          lines={["Recap of this session."]}
          onDismiss={() => setView(undefined)}
        />
      )
      : null);

  return (
    <div className={view.view}>
      <AgentHeader
        agent={faceOf(agent)}
        session={current}
        sessions={rows}
        now={NOW}
        source={source}
        host={{
          switchSession: (id) => {
            const row = sessionsOf(agent).find((item) => item.id === id);
            if (row !== undefined) onSession?.(row);
          },
          newSession: () => onNewSession?.(agent),
          openForked: () => {},
        }}
        onChanged={() => {}}
        progress={tasks ? <ProgressChip tasks={TASKS} /> : null}
        detail={<ViewDetailSelect value={detail} onChange={setDetail} />}
      />
      <div className={view.stage}>
        <ThreadScroll count={1} initialScroll={null} onScroll={() => {}}>
          <div className={turns.turns}>{children(detail)}</div>
        </ThreadScroll>
        {layer === null ? null : <div className={view.layer}>{layer}</div>}
      </div>
      <div className={view.bottom}>
        {dock}
        <QueuedMessages
          items={waiting.map((item) => ({
            id: item,
            at: NOW.toISOString(),
            text: item,
          }))}
          onSendNow={(id) => setWaiting((now) => now.filter((x) => x !== id))}
          onRemove={(id) => setWaiting((now) => now.filter((x) => x !== id))}
        />
        <AgentComposer
          source={source}
          session={session.id === "" ? null : session.id}
          agentName={agent}
          draft={{ text, selection: [text.length, text.length] }}
          working={running}
          locked={false}
          tooLong={false}
          offline={false}
          readOnly={archived}
          hint={placeholder}
          place={{ kind: "project", name: "phroner" }}
          permissionSummary="2 apps assigned"
          permissions={permissions}
          onDraft={(patch) => {
            if (patch.text !== undefined) setText(patch.text);
          }}
          onAttach={() => {}}
          onLoadPermissions={() => {}}
          onEditPermissions={() => {}}
          onSend={() => {
            const body = text.trim();
            if (body === "") return;
            if (running) setWaiting((now) => [...now, body]);
            setText("");
          }}
          onStop={() => {}}
          onCommand={(entry) => {
            setText("");
            if (entry.name === "permissions") setView("permissions");
            if (entry.name === "recap") setView("recap");
          }}
          onProblem={() => {}}
        />
      </div>
    </div>
  );
}
