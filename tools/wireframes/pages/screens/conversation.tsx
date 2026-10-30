// Agent 탭 본문. 화면은 renderer의 AgentView이고, 여기서는 탭의 `sub`가 고른 장면의 fake source(메모리 대화)를 끼워 그린다.
// `sub`는 장면 이름이거나(`working`, `question`, …), Weekly report의 진행(`weekly`와 `chat.stage`), 새 session(`new`),
// 이전 session(`conv:<id>`)이다. 한 탭은 agent 하나에 고정이고 같은 agent의 다른 session은 header에서 바꾼다.
import { useMemo, useState } from "react";

import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import {
  AGENT_TAB_SCENES,
  type AgentTabScene,
  createFakeAgentTabSource,
  SESSION_ARCHIVED,
  SESSION_MAIN,
} from "../../../../packages/shell/renderer/conversation/agent-tab-fake-source.ts";
import { AgentView } from "../../../../packages/shell/renderer/conversation/agent-view.tsx";
import { DraftStore } from "../../../../packages/shell/renderer/conversation/drafts.ts";
import type { SessionRow } from "../../mock/agents-data.ts";
import {
  click,
  runSteps,
  type Step,
  type,
  useDrive,
} from "../../mock/drive.ts";
import { documentTab } from "../../mock/phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";

type Open = (tab: TabSpec) => void;

/** 탭 줄의 상태 점에 알리는 session 상태(사람을 기다림·일하는 중). */
export type TabState = "waiting" | "working" | null;

/** 탭 안에서 session을 바꾸거나 새로 연다. */
interface SessionHandlers {
  readonly onSession: (row: SessionRow) => void;
  readonly onNewSession: (agent: string) => void;
  readonly onState: (state: TabState) => void;
}

/** 장면 이름은 아니지만 장면 하나에 손을 더해 열린 모양으로 고정하는 `sub`. */
const COMPOSER = "[data-composer-input]";
const DEMOS: Readonly<
  Record<string, { scene: AgentTabScene; steps: readonly Step[] }>
> = {
  "sender-chips": {
    scene: "sender-chips",
    steps: [() => click("[data-actor=received] button", undefined, 2)],
  },
  "approval-deny": {
    scene: "approval",
    steps: [
      () => click("[data-approval-id] button", /^Deny$/),
      () =>
        type("[data-approval-id] input", "The issue already exists as #212."),
    ],
  },
  rewind: {
    scene: "rewind",
    steps: [() => click("button", /^Rewind to here$/)],
  },
};

const STAGE_SCENE = {
  question: "question",
  answered: "question-answered",
  approval: "approval",
  report: "report",
} as const;

function isScene(sub: string): sub is AgentTabScene {
  return (AGENT_TAB_SCENES as readonly string[]).includes(sub);
}

/** 이 탭이 어느 장면이고 어느 session을 여는지. */
function sceneOf(tab: TabSpec): { scene: AgentTabScene; archived: boolean } {
  const sub = tab.sub ?? "";
  if (DEMOS[sub] !== undefined) {
    return { scene: DEMOS[sub].scene, archived: false };
  }
  if (isScene(sub)) return { scene: sub, archived: false };
  if (sub === "weekly") {
    return {
      scene: STAGE_SCENE[tab.chat?.stage ?? "question"],
      archived: false,
    };
  }
  if (sub === "new") return { scene: "empty", archived: false };
  if (sub === "conv:harness") return { scene: "working", archived: false };
  if (sub === "conv:old-1") return { scene: "report", archived: true };
  return { scene: "report", archived: false };
}

/** 장면 위에 사람이 하는 것처럼 얹는 손. */
function stepsOf(tab: TabSpec): readonly Step[] {
  const demo = DEMOS[tab.sub ?? ""];
  if (demo !== undefined) return demo.steps;
  const chat = tab.chat ?? {};
  const steps: Step[] = [];
  if (chat.switcher === "open" || chat.switcher === "edit") {
    steps.push(() => click("[data-agent-header] button[aria-label]"));
  }
  if (chat.switcher === "edit") {
    steps.push(() =>
      click("[data-session-popover] [role=option] button[aria-label=Delete]"),
    );
  }
  if (chat.modelDemo !== undefined) {
    steps.push(() => click("[data-model-button]"));
  }
  if (chat.modelDemo === "manage") {
    steps.push(() => click("[data-picker-section=foot] button"));
    steps.push(...(chat.afterManage ?? []));
  }
  if (chat.slash !== undefined) {
    const slash = chat.slash;
    steps.push(() => type(COMPOSER, slash));
  }
  if (chat.view !== undefined) {
    const view = chat.view;
    steps.push(() => type(COMPOSER, `/${view}`, true));
  }
  return steps;
}

// 장면의 시각은 모두 이 날의 아침이다.
const NOW = Date.parse("2026-10-06T09:05:00Z");
const now = () => NOW;

/** Agent 탭. */
export function Conversation({
  tab,
  open,
  handlers,
}: {
  tab: TabSpec;
  open: Open;
  answer?: string | null;
  onAnswer?: (answer: string) => void;
  handlers: SessionHandlers;
}) {
  const { scene, archived } = sceneOf(tab);
  const source = useMemo(
    () => createFakeAgentTabSource({ scene, picker: tab.chat?.picker }),
    [scene, tab.key],
  );
  const [drafts] = useState(() => new DraftStore());
  const [client] = useState(() => createEventClient(createFakeSource()));
  const [session, setSession] = useState<string | null>(
    scene === "empty" ? null : archived ? SESSION_ARCHIVED : SESSION_MAIN,
  );
  useDrive(() => runSteps(stepsOf(tab)), [tab.key]);
  return (
    <EventsProvider client={client}>
      <AgentView
        source={source}
        drafts={drafts}
        session={session}
        onSessionChange={(next) => {
          setSession(next);
          handlers.onState(null);
        }}
        host={{
          openFile: (path) => open(documentTab(path)),
          openPermissions: () => {},
          openAgentSettings: () => {},
          openForked: setSession,
          openSession: () => {},
          showUsage: () => {},
          closeTab: () => {},
        }}
        now={now}
      />
    </EventsProvider>
  );
}
