// 앱 workspace gallery 화면. 진짜 Desktop(MockDesktop)의 앱 workspace를 그린다: 앱 화면 탭, 그 앱 workspace의 lophn session 탭, App details 탭, 오른쪽 Logs panel.
// 상태는 layout(tab 배치)과 fake source의 설정, mount 뒤 단추 누르기(drive.ts)로 정하고 화면에는 gallery 전용 prop을 더하지 않는다.
// 앱 화면은 <webview>라 gallery에서 돌 수 없으므로 앱 화면 탭의 webview 자리(빈 div) 안에 Orders 앱이 그린 고정 그림(orders-view.tsx)을 넣는다.
// 고른 곳의 윤곽과 번호 표지는 실제로는 앱 view 안 preload가 그린다.

import { t } from "@lophn/i18n";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  type SessionSnapshot,
  sessionSnapshotsList,
} from "../../../../../packages/protocol/events/mod.ts";
import type { AnnotateState } from "../../../../../packages/shell/ipc/annotation.ts";
import {
  fakeDetail,
  GRANT_HOST,
  GRANT_RESERVE,
  GRANT_SECRET,
  type SecretsFake,
} from "../../../../../packages/shell/renderer/app-frame/app-detail/testdata/fake-source.ts";
import {
  type PreviewSource,
  PreviewSourceProvider,
} from "../../../../../packages/shell/renderer/workspace/app-preview-tab.tsx";
import { fakeAnnotate } from "../../../../../packages/shell/renderer/app-frame/testdata/fake-annotate.ts";
import type { CoreSource } from "../../../../../packages/shell/renderer/desktop/connection/connection.ts";
import { APP_BUDGET } from "../../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { openApp } from "../../../../../packages/shell/renderer/desktop/router.ts";
import { fixedRuns } from "../../../mock/scenarios/orders-shop.ts";
import {
  OrdersView,
  type ViewMarks,
} from "../../../mock/app-space/orders-view.tsx";
import { click, press, useDrive } from "../../../mock/drive.ts";
import { MockDesktop } from "../../../mock/mock-desktop.tsx";

type OpsTab = "version" | "access" | "activity";
type ActivationState = "applied" | "applying" | "failed";
type RewindStage = "confirm" | "running" | "done" | "conflict";

interface Annotation {
  readonly n: number;
  /** 고른 곳의 이름. */
  readonly target: string;
  readonly memo: string;
}

interface AppWorkspaceProps {
  /** tab 배치. screen은 앱 화면 탭 하나, split은 앱 화면과 lophn session을 붙인 것, session은 둘이 따로 서고 session을 골랐다. */
  readonly layout?: "screen" | "split" | "session";
  /** 주면 App details 탭을 고른 채 그 안의 이 탭을 연다. */
  readonly ops?: OpsTab;
  readonly version?: ActivationState;
  /** App details 위쪽 Run 절의 상태. 없으면 running이다. */
  readonly run?: "running" | "stopped" | "halted";
  /** Access 탭에서 이미 거두기를 요청한 항목. */
  readonly revoking?: readonly string[];
  /** Access 탭의 secret 줄들. 없으면 plain secret 하나다. */
  readonly secrets?: SecretsFake;
  readonly activity?: {
    readonly open?: string | null;
    readonly rewind?: RewindStage | null;
  };
  /** Logs에 run 기록을 둔다. empty면 기록이 없다. */
  readonly runs?: "list" | "empty";
  /** annotate mode를 켠 채 시작한다. */
  readonly annotate?: {
    readonly marks: ViewMarks;
    readonly items: readonly Annotation[];
  };
  /** 오른쪽 sidebar를 접은 채 시작한다. */
  readonly rightClosed?: boolean;
  /** 앱 화면 탭 머리 줄의 ⋯ 메뉴를 연 채 둔다. */
  readonly menu?: boolean;
  /** 탭 줄 끝의 + 메뉴를 연 채 둔다. */
  readonly newTab?: boolean;
  /**
   * preview가 돌고 있다. button은 앱 화면 탭 머리 줄에 [Preview]가 선 모양, tab은 그것을 눌러 preview 탭을 연 모양,
   * stopped는 그 탭에서 [Stop]을 누른 뒤, device는 등록한 기기를 골라 폰 테두리 안에 놓은 모양이다.
   */
  readonly preview?: "button" | "tab" | "stopped" | "device";
}

const APP = APP_BUDGET;
const GRANTS: Record<string, string> = {
  host: GRANT_HOST,
  secret: GRANT_SECRET,
  reserve: GRANT_RESERVE,
};
const TAB_LABEL = {
  version: "app-detail.label.tab-version",
  access: "app-detail.label.tab-access",
  activity: "app-detail.label.tab-activity",
} as const satisfies Record<OpsTab, string>;
const DEVICES = [
  { name: "iPhone 15", width: 390, height: 844, dpr: 3, os: "ios" },
  { name: "Pixel 8", width: 412, height: 915, dpr: 2.6, os: "android" },
] as const;
const PREVIEW_RELEASE = "rel_01h455vb4pex5v6nkc6gd5fd91";
const CALL_ID: Record<string, string> = { "i-20": "inv_38" };
const REWIND_FROM = "inv_32";

const SCREEN = {
  key: `app-screen:${APP}`,
  kind: "app_screen",
  title: "Grocery budget",
  app: APP,
} as const;
const DETAIL = {
  key: "app-detail",
  kind: "app_detail",
  title: "App details",
} as const;
const SESSION = {
  key: "agent:lophn:1",
  kind: "agent",
  title: "Fix the monthly total",
  agent: "lophn",
  workspace: { kind: "app", id: APP },
} as const;

// run이 연 session은 열린 채 남는다. 일하는 중인 run의 session만 running이고 나머지는 쉬는 중이라, session store가 이 snapshot으로
// 각 session의 상태를 안다(run 줄 아래 session의 점).
const RUN_SNAPSHOTS: readonly SessionSnapshot[] = fixedRuns(APP).flatMap(
  (run) =>
    "agent" in run.target && run.session !== null && run.session_opened
      ? [
          {
            session: run.session,
            agent: run.target.agent.agent,
            workspace: { kind: "app" as const, id: APP },
            state:
              run.state === "running"
                ? ("running" as const)
                : ("idle" as const),
            turn_requests: [],
            questions: [],
          },
        ]
      : [],
);

function withRunSessions(source: CoreSource): CoreSource {
  return {
    ...source,
    async call(input) {
      const reply = await source.call(input);
      if (
        !reply.ok ||
        input.kind !== "read" ||
        input.resource !== sessionSnapshotsList.resource ||
        input.method !== sessionSnapshotsList.method
      )
        return reply;
      const value = reply.value as { snapshots: readonly SessionSnapshot[] };
      return {
        ok: true,
        value: { ...value, snapshots: [...value.snapshots, ...RUN_SNAPSHOTS] },
      };
    },
  };
}

// 모은 목록에서 지운 번호의 표지는 앱 화면에서도 사라진다.
function shownMarks(
  props: AppWorkspaceProps,
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
      Object.entries(marks.picked ?? {}).filter(
        ([, mark]) => !removed.has(mark.n),
      ),
    ),
    area:
      marks.area?.n !== undefined && removed.has(marks.area.n)
        ? undefined
        : marks.area,
  };
}

// <webview>가 없는 gallery에서 webview 그릇은 앱 화면을 빈 div로 그리고 view 자리 위를 덮는다. 그 div를 찾는다.
function useScreenRegion(preview: boolean): HTMLElement | null {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const look = () =>
      setRegion(
        document.querySelector<HTMLElement>(
          preview
            ? '[data-webview-kind="app"]:not([data-webview-key^="app-screen:"])'
            : '[data-webview-kind="app"][data-webview-key^="app-screen:"]',
        ),
      );
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  return region;
}

export function AppSpace(props: AppWorkspaceProps = {}) {
  const region = useScreenRegion(
    props.preview === "tab" ||
      props.preview === "stopped" ||
      props.preview === "device",
  );
  const [annotating, setAnnotating] = useState<AnnotateState | null>(null);
  const fakes = useMemo(
    () => ({
      annotate: fakeAnnotate({
        items: (props.annotate?.items ?? []).map((item) => ({
          n: item.n,
          kind: "element" as const,
          label: item.target,
          note: item.memo,
        })),
      }),
      detail: fakeDetail({
        ...(props.version === undefined ? {} : { activation: props.version }),
        ...(props.run === undefined ? {} : { run: props.run }),
        ...(props.secrets === undefined ? {} : { secrets: props.secrets }),
        ...(props.revoking === undefined
          ? {}
          : { revoking: props.revoking.map((id) => GRANTS[id] ?? id) }),
        rewind:
          props.activity?.rewind === "running"
            ? "pending"
            : props.activity?.rewind === "conflict"
              ? "conflict"
              : "applied",
      }).source,
      runs: () =>
        Promise.resolve({
          ok: true as const,
          value: props.runs === "empty" ? [] : fixedRuns(APP),
        }),
    }),
    [],
  );
  useEffect(() => fakes.annotate.subscribeState(setAnnotating), [fakes]);
  // preview 한 개가 돌고 있다. [Stop]이 멈춘다.
  const preview = useMemo<PreviewSource>(() => {
    let running = true;
    return {
      current: () =>
        Promise.resolve(
          running ? { nonce: "pv1", release: PREVIEW_RELEASE } : null,
        ),
      devices: () => Promise.resolve(DEVICES),
      stop: () => {
        running = false;
        return Promise.resolve();
      },
    };
  }, []);

  const layout = props.layout ?? "screen";
  const panes = useMemo(
    () =>
      props.ops !== undefined
        ? [{ tabs: [SCREEN, DETAIL], selected: DETAIL.key }]
        : layout === "screen"
          ? [{ tabs: [SCREEN], selected: SCREEN.key }]
          : layout === "split"
            ? [
                { tabs: [SCREEN], selected: SCREEN.key },
                { tabs: [SESSION], selected: SESSION.key },
              ]
            : [{ tabs: [SCREEN, SESSION], selected: SESSION.key }],
    [layout],
  );

  useDrive(async () => {
    const { ops, activity } = props;
    if (ops !== undefined) {
      await press('[data-app-detail] [role="tab"]', t(TAB_LABEL[ops]));
      if (activity?.open) {
        const call = CALL_ID[activity.open] ?? activity.open;
        await click(`[data-invocation="${call}"] button`);
      }
      if (activity?.rewind) {
        await click(`[data-rewind-start="${REWIND_FROM}"]`);
        if (activity.rewind !== "confirm") await click("[data-rewind-confirm]");
      }
    }
    if (props.annotate !== undefined) {
      await press("[data-tab-menu]");
      await click('[role="menuitem"]', t("app-space.button.annotate"));
    }
    if (
      props.preview === "tab" ||
      props.preview === "stopped" ||
      props.preview === "device"
    ) {
      await click("[data-open-preview]");
    }
    if (props.preview === "device") {
      await press('[data-preview-notice] [role="combobox"]');
      await click('[role="option"]', DEVICES[0].name);
    }
    if (props.preview === "stopped") await click("[data-preview-stop]");
    if (props.menu === true) await press("[data-tab-menu]");
    if (props.newTab === true) await press("[data-new-tab]");
    if (props.rightClosed === true) {
      await click("button", new RegExp(`^${t("shell.button.toggle-right")}$`));
    }
  });

  return (
    <PreviewSourceProvider value={props.preview === undefined ? null : preview}>
      <MockDesktop
        route={openApp(APP)}
        panes={panes}
        appDetail={fakes.detail}
        annotate={fakes.annotate}
        runs={fakes.runs}
        events={withRunSessions}
      />
      {region === null
        ? null
        : createPortal(
            <OrdersView marks={shownMarks(props, annotating)} />,
            region,
          )}
    </PreviewSourceProvider>
  );
}
