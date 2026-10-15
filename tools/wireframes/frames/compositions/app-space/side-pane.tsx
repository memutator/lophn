// 앱 화면 옆 pane. agent와 coding 터미널이 같은 위치를 쓰고 pane 머리에서 바꾼다. 터미널은 App Engineer가 ticket을 맡기면 lophn이 연다.
// agent 대화는 project 창 Agent 탭과 같은 ChatShell을 쓴다.
import type { ReactNode } from "react";
import {
  IconButton,
  type TabDot,
  TabStrip,
  VendorIcon,
} from "@lophn/design/components";
import { workspaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import { Avatar } from "../agent-avatar.tsx";
import { AgentTurn, ChatShell, Said, UserMessage } from "../agent-chat.tsx";
import { CallBlock } from "../agent-tab/call-block.tsx";
import { type CodingScene, CodingTerminal } from "./coding-tab.tsx";
import { TICKET, TICKET_TITLE } from "./data.ts";
import styles from "./app-space.module.css";

export type PaneView = "agent" | "terminal";

// 대화 화면의 avatar와 같은 그림이다.
export const AGENT_ICON: Record<string, string> = {
  lophn: "dock",
  "App Engineer": "dock",
  "Order analyst": "dock",
  "Shipping planner": "dock",
};

const ASK = "Ask App Engineer…";

function EngineerThread({ handedOff }: { handedOff: boolean }) {
  return (
    <>
      <UserMessage>
        Totals with a discount are one cent off. Can you fix that?
      </UserMessage>
      <AgentTurn agent="App Engineer" time="15:12">
        <Said>
          I wrote a ticket for it and handed it to Claude Code. I'll tell you
          here once the fix is verified and applied.
        </Said>
        {handedOff
          ? (
            <CallBlock
              call={{
                to: "Claude Code",
                task: `${TICKET}: ${TICKET_TITLE}`,
                reply: "conversation",
                state: "accepted",
                time: "15:12",
              }}
            />
          )
          : null}
      </AgentTurn>
    </>
  );
}

function AgentBody(
  { agent, handedOff }: { agent: string; handedOff: boolean },
) {
  const engineer = agent === "App Engineer";
  return (
    <div className={styles.sideBody}>
      <ChatShell
        agent={agent}
        session={engineer
          ? { id: "discount", title: "Fix discount rounding" }
          : { id: "new", title: "New session" }}
        placeholder={engineer ? ASK : `Ask ${agent}…`}
      >
        {() => engineer ? <EngineerThread handedOff={handedOff} /> : null}
      </ChatShell>
    </div>
  );
}

export function SidePane(
  { view, agent, terminal, onView, onClose, toast }: {
    view: PaneView;
    agent: string;
    /** coding 터미널이 열려 있으면 그 장면. */
    terminal?: CodingScene;
    onView: (view: PaneView) => void;
    onClose: () => void;
    /** pane 위쪽에 뜨는 toast. */
    toast?: ReactNode;
  },
) {
  const dot: TabDot | undefined = terminal === "permission"
    ? "waiting"
    : terminal === "ended"
    ? "ended"
    : undefined;
  return (
    <aside className={styles.sidePane} aria-label="Agent and terminal">
      <TabStrip
        tabs={[
          {
            key: "agent",
            title: agent,
            icon: <Avatar agent={agent} size="sm" />,
          },
          ...(terminal === undefined ? [] : [{
            key: "terminal",
            title: `Claude Code · ${TICKET}`,
            icon: <VendorIcon vendor="claude-code" size={14} />,
            dot,
          }]),
        ]}
        selected={view}
        onSelect={(key) => onView(key as PaneView)}
        end={
          <IconButton
            icon={workspaceIcons.close}
            label="Close"
            size="sm"
            onClick={onClose}
          />
        }
      />
      {view === "terminal" && terminal !== undefined
        ? <CodingTerminal scene={terminal} />
        : <AgentBody agent={agent} handedOff={terminal !== undefined} />}
      {toast}
    </aside>
  );
}
