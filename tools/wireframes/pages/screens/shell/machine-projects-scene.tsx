// 다른 기계(Home server)의 창의 왼쪽 sidebar. 그 기계의 project 셋이 이 컴퓨터(Studio)의 project와 어떻게 묶이는지를 줄 하나씩으로 보인다:
// 같은 id(Also on this computer), 그 기계에만 있음([Clone here]), remote만 같음(제안). 두 core는 fake이고 Studio 쪽은 기계 source의 `thisRead`가 답한다.
import { useState } from "react";

import { agentList } from "../../../../../packages/protocol/lophn-agent/agent-definitions.ts";
import { workspaceSessionList } from "../../../../../packages/protocol/lophn-agent/agent-sessions.ts";
import { projectApi } from "../../../../../packages/protocol/projects/project-api.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import {
  createFakeSource,
  fakeAnswer,
} from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { MachinesProvider } from "../../../../../packages/shell/renderer/desktop/machines/context.tsx";
import { MachineSwitcher } from "../../../../../packages/shell/renderer/desktop/machines/machine-switcher.tsx";
import {
  fakeMachines,
  sampleMachines,
} from "../../../../../packages/shell/renderer/desktop/machines/testdata/fake-source.ts";
import { RemoteGroupsProvider } from "../../../../../packages/shell/renderer/desktop/workspaces/projects/remote-group.tsx";
import { LeftSidebar } from "../../../../../packages/shell/renderer/shell/left-sidebar.tsx";
import type { SidebarWorkspace } from "../../../../../packages/shell/renderer/shell/left-sidebar-model.ts";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { press, useDrive } from "../../../mock/drive.ts";

const noop = () => {};
const COMMON = { as_of_seq: "0", next_cursor: null };
const HOUR = 60 * 60 * 1000;

// Home server(그 기계)의 project. phroner는 Studio에도 같은 id로 있고, grocery는 그 기계에만 있고, orders-api는 remote만 같다.
const THERE = [
  {
    id: "prj_there_phroner",
    title: "phroner",
    identity: "pri_01jx00000000000000000phron",
    remote: {
      key: "github.com/me/phroner",
      url: "git@github.com:me/phroner.git",
    },
  },
  {
    id: "prj_there_grocery",
    title: "Grocery",
    identity: "pri_01jx00000000000000000grocr",
    remote: {
      key: "github.com/me/grocery",
      url: "git@github.com:me/grocery.git",
    },
  },
  {
    id: "prj_there_orders",
    title: "orders-api",
    identity: null,
    remote: {
      key: "github.com/me/orders-api",
      url: "git@github.com:me/orders-api.git",
    },
  },
];

// Studio(이 컴퓨터)의 project.
const HERE = [
  {
    id: "prj_here_phroner",
    title: "phroner",
    identity: "pri_01jx00000000000000000phron",
    remote: {
      key: "github.com/me/phroner",
      url: "git@github.com:me/phroner.git",
    },
  },
  {
    id: "prj_here_orders",
    title: "Orders API",
    identity: "pri_01jx00000000000000000order",
    remote: {
      key: "github.com/me/orders-api",
      url: "git@github.com:me/orders-api.git",
    },
  },
];

const record = (row: (typeof THERE)[number]) => ({
  ...row,
  name: row.title.toLowerCase().replace(/\W+/g, "-"),
  purpose: "",
  revision: "1",
  status: "active",
  folders: [],
  repo: "git",
});

const session = (id: string, title: string, ago: number) => ({
  id,
  title,
  last_active_at: new Date(Date.now() - ago * HOUR).toISOString(),
});

const SESSIONS: Record<string, ReturnType<typeof session>[]> = {
  lophn_prj_there_phroner: [
    session("ses_there_1", "Release notes for 0.9", 1),
    session("ses_there_2", "Nightly scenario failures", 5),
    session("ses_there_3", "Plan the retry rewrite", 30),
  ],
  lophn_prj_here_phroner: [
    session("ses_here_1", "Fix flaky retry in the runner", 2),
    session("ses_here_2", "Review the dashboard copy", 26),
  ],
  agt_reviewer: [session("ses_here_3", "Review the retry PR", 4)],
};

// 각 기계의 그 project workspace에 둔 agent. Studio에는 사람이 만든 Reviewer도 있다.
const agentsOf = (input: unknown) => {
  const { id } = (input as { workspace: { id: string } }).workspace;
  return {
    ...COMMON,
    agents: [
      { agent: `lophn_${id}`, name: "lophn" },
      ...(id === "prj_here_phroner"
        ? [{ agent: "agt_reviewer", name: "Reviewer" }]
        : []),
    ],
  };
};

const sessionsOf = (input: unknown) => ({
  ...COMMON,
  sessions: SESSIONS[(input as { agent: string }).agent] ?? [],
});

const WORKSPACES: readonly SidebarWorkspace[] = [
  { ref: { kind: "home" }, name: "Home", current: [], recent: [] },
  ...THERE.map(
    (row): SidebarWorkspace => ({
      ref: { kind: "project", id: row.id },
      name: row.title,
      current: [],
      recent: [],
    }),
  ),
];

export function MachineProjectsScene({
  open,
}: {
  /** mount 뒤 펼칠 것: 같은 project의 기계마다 session 목록, 또는 자격이 없어 실패한 [Clone here]. */
  open?: "sessions" | "git-auth";
}) {
  const [machines] = useState(
    () =>
      fakeMachines({
        machines: sampleMachines(),
        window: { id: "mch_homeserver", name: "Home server" },
        thisRead: (route, input) =>
          route === "project.list"
            ? { ...COMMON, projects: HERE.map(record) }
            : route === "ListAgents"
              ? agentsOf(input)
              : sessionsOf(input),
        ...(open === "git-auth"
          ? {
              clone: {
                ok: false,
                reason: "git_auth",
                command: "ssh -T git@github.com",
              } as const,
            }
          : {}),
      }).source,
  );
  const [client] = useState(() =>
    createEventClient(
      createFakeSource({
        snapshots: [],
        consents: [],
        answers: [
          fakeAnswer(projectApi.list, {
            ...COMMON,
            projects: THERE.map(record),
          } as never),
          fakeAnswer(agentList, agentsOf as never),
          fakeAnswer(workspaceSessionList, sessionsOf as never),
        ],
      }),
    ),
  );
  useDrive(async () => {
    if (open === "sessions") await press('[data-remote-group="same"]');
    if (open === "git-auth") await press("[data-clone-here]");
  });
  return (
    <MachinesProvider source={machines}>
      <EventsProvider client={client}>
        <RemoteGroupsProvider>
          <ShellFrame
            left
            onToggleLeft={noop}
            right={false}
            onToggleRight={noop}
            machineSwitcher={<MachineSwitcher onPairAnother={noop} />}
            tabs={null}
            leftSidebar={
              <LeftSidebar
                workspaces={WORKSPACES}
                current={{ kind: "home" }}
                choices={() => []}
                onNewSession={noop}
                onNewSessionWith={noop}
                onOpenSession={noop}
                onInbox={noop}
                onJobs={noop}
                onWorkspace={noop}
                onSession={noop}
              />
            }
          >
            <div
              style={{
                flex: 1,
                borderRadius: "var(--radius-lg)",
                background: "var(--color-surface-base)",
              }}
            />
          </ShellFrame>
        </RemoteGroupsProvider>
      </EventsProvider>
    </MachinesProvider>
  );
}
