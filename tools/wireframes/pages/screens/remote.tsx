// phone remote 화면. 진짜 RemoteApp을 390px 폭에 그리고 core 대신 fake source(대기 항목은 waiting fake Gateway)를 꽂는다.
import { useState } from "react";
import type { SessionSnapshot } from "../../../../packages/protocol/events/mod.ts";
import { lophnIdOf } from "../../../../packages/protocol/lophn-agent/workspaces.ts";
import type { CoreSource } from "../../../../packages/shell/renderer/desktop/connection/connection.ts";
import {
  allItems,
  createFakeWaiting,
} from "../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import {
  ChatPlaceholder,
  RemoteApp,
} from "../../../../packages/shell/renderer/remote/remote-app.tsx";
import { click, runSteps, type Step, useDrive } from "../../mock/drive.ts";
import type { Area } from "../types.ts";

// waiting fake와 같은 id 꼴이다. project 1, 앱 1, agent 1, Home lophn session 4는 대기 항목이 쓰는 것이다.
const id = (prefix: string, n: number) =>
  `${prefix}_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
const PROJECT = id("prj", 1);
const ORDERS = id("app", 1);
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

// 대기 항목이 없는 session. 하나는 도는 중이다.
const MORE: readonly SessionSnapshot[] = [
  {
    session: id("ses", 10),
    agent: lophnIdOf(null),
    workspace: null,
    state: "running",
    turn_requests: [],
    questions: [],
  },
  {
    session: id("ses", 11),
    agent: id("agt", 1),
    workspace: { kind: "project", id: PROJECT },
    state: "idle",
    turn_requests: [],
    questions: [],
  },
  {
    session: id("ses", 12),
    agent: `lophn_${ORDERS}`,
    workspace: { kind: "app", id: ORDERS },
    state: "idle",
    turn_requests: [],
    questions: [],
  },
];

// sessions/list가 아는 session 전부. 앞의 둘은 waiting fake의 대기 항목이 쓰는 session이다.
const SESSIONS: readonly Pick<
  SessionSnapshot,
  "session" | "agent" | "workspace"
>[] = [
  {
    session: id("ses", 1),
    agent: id("agt", 1),
    workspace: { kind: "project", id: PROJECT },
  },
  { session: id("ses", 4), agent: lophnIdOf(null), workspace: null },
  ...MORE,
];

const TITLES: Readonly<Record<string, readonly [string, number]>> = {
  [id("ses", 1)]: ["Refactor the query planner", 3],
  [id("ses", 4)]: ["Plan next week", 12],
  [id("ses", 10)]: ["Summarize inbox notes", 1],
  [id("ses", 11)]: ["Benchmark exp-008", 90],
  [id("ses", 12)]: ["Fix the refund total", 240],
};

const AGENTS: Readonly<Record<string, string>> = {
  [lophnIdOf(null)]: "lophn",
  [id("agt", 1)]: "Researcher",
  [`lophn_${ORDERS}`]: "lophn",
};

const ok = (value: unknown) => Promise.resolve({ ok: true, value });
const COMMON = { as_of_seq: "0", next_cursor: null };

function remoteFake(): CoreSource {
  const waiting = createFakeWaiting(allItems());
  return {
    ...waiting,
    async call(input) {
      const key = `${input.kind}:${input.resource}/${input.method}`;
      const body = input.body as Record<string, unknown>;
      if (key === "read:session_snapshots/list") {
        const base = await waiting.call(input);
        const value = base.value as { snapshots: SessionSnapshot[] };
        return ok({ ...value, snapshots: [...value.snapshots, ...MORE] });
      }
      if (key === "read:sessions/list") {
        const workspace = body.workspace as { id: string } | null;
        return ok({
          ...COMMON,
          sessions: SESSIONS.filter(
            (one) =>
              one.agent === body.agent &&
              (one.workspace?.id ?? null) === (workspace?.id ?? null),
          ).map((one) => ({
            id: one.session,
            title: TITLES[one.session]?.[0] ?? null,
            last_active_at: ago(TITLES[one.session]?.[1] ?? 600),
          })),
        });
      }
      if (key === "read:projects/list") {
        return ok({ ...COMMON, projects: [{ id: PROJECT, title: "phroner" }] });
      }
      if (key === "read:apps/list") {
        return ok({ ...COMMON, apps: [{ id: ORDERS, name: "Orders" }] });
      }
      if (key === "read:agents/read") {
        return ok({
          effective: { name: { value: AGENTS[String(body.agent)] ?? "Agent" } },
        });
      }
      return waiting.call(input);
    },
  };
}

// 폰 폭 기둥. 화면 root는 absolute라 이 상자를 채운다.
function Phone({ steps = [] }: { steps?: readonly Step[] }) {
  const [source] = useState(remoteFake);
  useDrive(() => runSteps(steps));
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        justifyContent: "center",
        background: "var(--color-surface-floor)",
      }}
    >
      <div style={{ position: "relative", width: "390px" }}>
        <RemoteApp source={source} chat={ChatPlaceholder} />
      </div>
    </div>
  );
}

export const remoteArea: Area = {
  id: "remote",
  title: "Phone remote",
  summary:
    "폰에서 여는 remote 화면. session 목록, Inbox, 대화 셋을 아래 탭으로 오간다.",
  pages: [
    {
      id: "remote-sessions",
      title: "Remote · sessions",
      description:
        "workspace마다 묶은 열린 session이다. Home이 먼저이고 나머지는 최근 활동 순이다. 줄마다 상태 점(기다림, 일하는 중), 제목, agent 이름, 기다리는 Inbox 항목 수가 보인다. 아래 탭 둘(Sessions, Inbox)의 Inbox에는 기다리는 수가 붙는다.",
      render: () => <Phone />,
    },
    {
      id: "remote-inbox",
      title: "Remote · Inbox",
      description:
        "desktop Inbox의 page와 card를 폰 폭으로 그린다. Now(답할 것과 휘발 알림)와 History(지난 알림)다. 끝난 터미널 줄은 폰에 없다. 질문 카드의 Open session은 대화로 들어간다.",
      render: () => <Phone steps={[() => click('[data-tab="inbox"]')]} />,
    },
    {
      id: "remote-chat",
      title: "Remote · conversation",
      description:
        "목록에서 session을 누르면 대화로 들어간다. 머리에 뒤로 단추, 제목, agent 이름이 있고 아래 탭은 숨는다. 본문은 대화 component가 채울 자리다.",
      render: () => <Phone steps={[() => click("[data-session]")]} />,
    },
  ],
};
