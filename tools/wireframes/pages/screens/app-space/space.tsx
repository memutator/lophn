// 앱 공간 gallery 화면. 진짜 AppSpace(renderer app-frame)를 fake source로 그린다. 상태는 fake source의 설정과 mount 뒤 단추 누르기로 정하고
// (drive.ts), AppSpace에는 gallery 전용 prop을 더하지 않는다. 앱 view는 main의 native view라 gallery에는 없고, 앱 view 자리 안에
// Orders 앱이 그린 고정 그림(orders-view.tsx)을 넣는다. 고른 곳의 윤곽과 번호 표지는 실제로는 앱 view 안 preload가 그린다.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { AppSpace as RealAppSpace } from "../../../../../packages/shell/renderer/app-frame/app-space.tsx";
import {
  fakeDetail,
  GRANT_HOST,
  GRANT_RESERVE,
  GRANT_SECRET,
  type SecretsFake,
} from "../../../../../packages/shell/renderer/app-frame/app-detail/testdata/fake-source.ts";
import { fakeAnnotate } from "../../../../../packages/shell/renderer/app-frame/testdata/fake-annotate.ts";
import type { AnnotateState } from "../../../../../packages/shell/ipc/annotation.ts";
import {
  type SessionSnapshot,
  sessionSnapshotsList,
} from "../../../../../packages/protocol/events/mod.ts";
import type { CoreSource } from "../../../../../packages/shell/renderer/desktop/connection/connection.ts";
import type { LophnShellViewsApi } from "../../../../../packages/shell/ipc/app-frame.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import {
  CODING_ASK,
  createFakeWaiting,
} from "../../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import { mockViews } from "../../../../../packages/shell/renderer/desktop/dev-mock/app-space.ts";
import { mockAgentTabSource } from "../../../../../packages/shell/renderer/desktop/dev-mock/agent.ts";
import {
  appRow,
  fakeApps,
} from "../../../../../packages/shell/renderer/apps/testdata/fake-apps.ts";
import { createFakeAgentsSource } from "../../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { TerminalStore } from "../../../../../packages/shell/renderer/terminal/store.ts";
import { createXtermView } from "../../../../../packages/shell/renderer/terminal/xterm-view.ts";
import { t } from "@lophn/wording";
// 터미널 탭이 쓰는 xterm 기본 배치.
import "@xterm/xterm/css/xterm.css";

import {
  codingBridge,
  type CodingScene,
} from "../../../mock/app-space/coding-terminal.ts";
import { APP_NAME, fixedRuns } from "../../../mock/app-space/data.ts";
import { click, find, press, useDrive, wait } from "../../../mock/drive.ts";
import {
  OrdersView,
  type ViewMarks,
} from "../../../mock/app-space/orders-view.tsx";

type OpsTab = "version" | "access" | "activity";
type ActivationState = "applied" | "applying" | "failed";
type RewindStage = "confirm" | "running" | "done" | "conflict";
type PaneView = "agent" | "terminal" | "details";

interface Annotation {
  readonly n: number;
  /** 고른 곳의 이름. */
  readonly target: string;
  readonly memo: string;
}

interface AppSpaceProps {
  /** 처음에 열린 운영 패널 탭. 없으면 패널이 닫혀 있다. */
  readonly panel?: OpsTab;
  readonly version?: ActivationState;
  /** Access 탭에서 이미 거두기를 요청한 항목. */
  readonly revoking?: readonly string[];
  /** Access 탭의 secret 줄들. 없으면 plain secret 하나다. */
  readonly secrets?: SecretsFake;
  readonly activity?: {
    readonly open?: string | null;
    readonly rewind?: RewindStage | null;
  };
  /** agent select를 펼친 채 시작한다. */
  readonly agentMenu?: boolean;
  /** 오른쪽 패널의 Agent 탭에 Background 목록을 연 채 시작한다. empty면 기록이 없는 목록이다. */
  readonly runs?: "list" | "empty";
  /** annotate mode를 켠 채 시작한다. */
  readonly annotate?: {
    readonly marks: ViewMarks;
    readonly items: readonly Annotation[];
    /** 모은 annotation 목록을 보인다. */
    readonly list?: boolean;
  };
  /** 오른쪽 패널에 agent 탭을 열어 둔다. 보이는 탭(details는 panel과 함께 쓴다)과 agent. */
  readonly pane?: { readonly view?: PaneView; readonly agent?: string };
  /** lophn이 연 coding 터미널이 있다. 패널 탭 줄에서 agent와 바꿔 본다. */
  readonly terminal?: CodingScene;
  /** 열려 있는 pane 위쪽에 toast를 띄운 채 시작한다. */
  readonly openedToast?: boolean;
}

const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fd07";
const PROJECTS = [
  {
    id: "prj_01h455vb4pex5v6nkc6gd5fd01",
    name: "phroner",
    folder: "~/Documents/phroner",
  },
  {
    id: "prj_01h455vb4pex5v6nkc6gd5fd02",
    name: "grocery",
    folder: "~/Documents/grocery",
  },
  {
    id: "prj_01h455vb4pex5v6nkc6gd5fd03",
    name: "taxes-2026",
    folder: "~/Documents/taxes-2026",
  },
] as const;
const GRANTS: Record<string, string> = {
  host: GRANT_HOST,
  secret: GRANT_SECRET,
  reserve: GRANT_RESERVE,
};
const AGENT_KEY: Record<string, string> = {
  lophn: "lophn",
  "App Engineer": "app_engineer",
};
const TAB_LABEL = {
  version: "app-detail.label.tab-version",
  access: "app-detail.label.tab-access",
  activity: "app-detail.label.tab-activity",
} as const satisfies Record<OpsTab, string>;
const CALL_ID: Record<string, string> = { "i-20": "inv_38" };
const REWIND_FROM = "inv_32";

const noop = () => {};

// run이 연 session은 열린 채 남는다. 일하는 중인 run의 session만 running이고 나머지는 쉬는 중이라, session store가 이 snapshot으로
// 각 session의 상태를 안다(run 줄 아래 session의 점).
const RUN_SNAPSHOTS: readonly SessionSnapshot[] = fixedRuns(APP).flatMap(
  (run) =>
    "agent" in run.target && run.session !== null && run.session_opened
      ? [{
        session: run.session,
        agent: run.target.agent,
        place: { kind: "app" as const, id: APP },
        state: run.state === "running" ? "running" as const : "idle" as const,
        turn_requests: [],
        questions: [],
      }]
      : [],
);

function withRunSessions(source: CoreSource): CoreSource {
  return {
    ...source,
    async call(input) {
      const reply = await source.call(input);
      if (
        !reply.ok || input.kind !== "read" ||
        input.resource !== sessionSnapshotsList.resource ||
        input.method !== sessionSnapshotsList.method
      ) return reply;
      const value = reply.value as { snapshots: readonly SessionSnapshot[] };
      return {
        ok: true,
        value: { ...value, snapshots: [...value.snapshots, ...RUN_SNAPSHOTS] },
      };
    },
  };
}

function build(props: AppSpaceProps, onRegion: (region: HTMLElement) => void) {
  const base = mockViews();
  // native view는 DOM 위에 덮이므로 gallery에서는 가짜 상자 대신 앱 view 자리(EmbeddedView의 region) 안에 Orders 화면을 그린다.
  // 그래야 위에 얹는 알림이 보인다.
  const views: LophnShellViewsApi = {
    ...base,
    async openApp(input) {
      const state = await base.openApp(input);
      document.querySelectorAll("[data-mock-app-view]").forEach((box) =>
        box.remove()
      );
      const region = document.querySelector<HTMLElement>(
        '[data-space="app"] [data-phase]',
      );
      if (region !== null) onRegion(region);
      return state;
    },
  };
  const scene = props.terminal;
  const bridge = scene === undefined
    ? undefined
    : codingBridge(scene, PROJECTS[0].id);
  return {
    views,
    bridge,
    terminal: bridge === undefined ? undefined : {
      bridge,
      store: new TerminalStore(null, bridge),
      createView: createXtermView,
      confirmClose: () => Promise.resolve(false),
    },
    source: fakeApps({
      rows: [appRow(APP, APP_NAME, { release: RELEASE })],
      runs: { [APP]: "running" },
      screen: "home",
    }).source,
    detail: fakeDetail({
      ...(props.version === undefined ? {} : { activation: props.version }),
      ...(props.secrets === undefined ? {} : { secrets: props.secrets }),
      ...(props.revoking === undefined ? {} : {
        revoking: props.revoking.map((id) => GRANTS[id] ?? id),
      }),
      rewind: props.activity?.rewind === "running"
        ? "pending"
        : props.activity?.rewind === "conflict"
        ? "conflict"
        : "applied",
    }).source,
    agents: createFakeAgentsSource(),
    agentViewSource: mockAgentTabSource(),
    runs: () =>
      Promise.resolve({
        ok: true as const,
        value: props.runs === "empty" ? [] : fixedRuns(APP),
      }),
    annotate: fakeAnnotate({
      items: (props.annotate?.items ?? []).map((item) => ({
        n: item.n,
        kind: "element" as const,
        label: item.target,
        note: item.memo,
      })),
    }),
    events: createEventClient(
      withRunSessions(
        createFakeWaiting(scene === "permission" ? [CODING_ASK()] : []),
      ),
    ),
  };
}

// 모은 목록에서 지운 번호의 표지는 앱 화면에서도 사라진다.
function shownMarks(
  props: AppSpaceProps,
  state: AnnotateState | null,
): ViewMarks {
  const marks = props.annotate?.marks ?? {};
  if (state === null || !state.on) return {};
  const initial = props.annotate?.items ?? [];
  const alive = new Set(state.items.map((item) => item.n));
  const removed = new Set(
    initial.filter((item) => !alive.has(item.n)).map((item) => item.n),
  );
  return {
    ...marks,
    picked: Object.fromEntries(
      Object.entries(marks.picked ?? {}).filter(([, mark]) =>
        !removed.has(mark.n)
      ),
    ),
    area: marks.area?.n !== undefined && removed.has(marks.area.n)
      ? undefined
      : marks.area,
  };
}

export function AppSpace(props: AppSpaceProps = {}) {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const [annotating, setAnnotating] = useState<AnnotateState | null>(null);
  const fakes = useMemo(() => build(props, setRegion), []);

  useEffect(() => fakes.annotate.subscribeState(setAnnotating), [fakes]);

  useDrive(async () => {
    const { panel, activity, pane, terminal } = props;
    if (panel !== undefined) {
      await click('[data-app-bar="app-details"]');
      await press('[role="tab"]', t(TAB_LABEL[panel]));
      if (activity?.open) {
        const call = CALL_ID[activity.open] ?? activity.open;
        await click(`[data-invocation="${call}"] button`);
      }
      if (activity?.rewind) {
        await click(`[data-rewind-start="${REWIND_FROM}"]`);
        if (activity.rewind !== "confirm") await click("[data-rewind-confirm]");
      }
    }
    if (props.agentMenu === true) await press("[data-agent-select]");
    if (props.runs !== undefined) {
      await press("[data-agent-select]");
      await click("[data-agent-runs]");
    }
    // 터미널만 있는 장면은 coding 요청이 agent 탭을 함께 연다. panel과 함께 쓰면 요청이 탭을 더하지 않으니 select로 연다.
    if (pane !== undefined && (terminal === undefined || panel !== undefined)) {
      await press("[data-agent-select]");
      await click(`[data-agent="${AGENT_KEY[pane.agent ?? "App Engineer"]}"]`);
    }
    if (props.annotate !== undefined) {
      await click('[data-app-bar="annotate"]');
    }
    if (terminal !== undefined) {
      // 터미널을 연다는 알림은 늘 뜬다. 보여 달라는 쪽이 아니면 닫아 둔다.
      await wait(150);
      fakes.bridge!.emit();
      await find("[data-agent-pane-toast]");
      if (pane?.view === "terminal") {
        await click("[data-agent-pane-toast] button", "Show terminal");
      } else if (props.openedToast !== true) {
        await click('[data-agent-pane-toast] button[aria-label="Close"]');
      }
      if (pane?.view === "details") await click('[data-tab-key="details"]');
    }
  });

  return (
    <EventsProvider client={fakes.events}>
      <RealAppSpace
        app={APP}
        source={fakes.source}
        views={fakes.views}
        detail={fakes.detail}
        agents={fakes.agents}
        agentViewSource={fakes.agentViewSource}
        runs={fakes.runs}
        annotate={fakes.annotate}
        {...(fakes.terminal === undefined ? {} : { terminal: fakes.terminal })}
        windowWidth={1280}
        onLauncher={noop}
      />
      {region === null ? null : createPortal(
        <OrdersView marks={shownMarks(props, annotating)} />,
        region,
      )}
    </EventsProvider>
  );
}
