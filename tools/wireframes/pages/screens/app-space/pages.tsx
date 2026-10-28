// 앱 공간 page들. 각 component는 인자 없이 한 상태를 고정해 그린다.
import { AppSpace } from "./space.tsx";

export function AppSpaceFrame() {
  return <AppSpace agentMenu />;
}

/** Background 목록. agent run은 아래에 그 run이 연 session이 있고 tool run은 session 줄이 없다. job이 연 run(agent run 하나와 tool run 하나)은 이름 자리에 job 제목이 오고 둘째 줄에 agent 또는 tool 이름이 온다. 다른 앱과 lophn의 run은 없다. */
export function RunsList() {
  return <AppSpace runs="list" />;
}

export function RunsEmpty() {
  return <AppSpace runs="empty" />;
}

export function VersionApplied() {
  return <AppSpace panel="version" />;
}

export function VersionApplying() {
  return <AppSpace panel="version" version="applying" />;
}

export function VersionFailed() {
  return <AppSpace panel="version" version="failed" />;
}

export function AccessGrants() {
  return <AppSpace panel="access" />;
}

export function AccessRevoking() {
  return <AppSpace panel="access" revoking={["secret", "reserve"]} />;
}

export function AccessSecrets() {
  return <AppSpace panel="access" secrets="plain" />;
}

export function AccessOAuthSetup() {
  return <AppSpace panel="access" secrets="oauth-setup" />;
}

export function AccessOAuthReady() {
  return <AppSpace panel="access" secrets="oauth-ready" />;
}

export function AccessOAuthWaiting() {
  return <AppSpace panel="access" secrets="oauth-waiting" />;
}

export function AccessOAuthSignedIn() {
  return <AppSpace panel="access" secrets="oauth-signed-in" />;
}

export function AccessOAuthFailed() {
  return <AppSpace panel="access" secrets="oauth-failed" />;
}

export function ActivityLog() {
  return <AppSpace panel="activity" activity={{ open: "i-20" }} />;
}

export function RewindConfirm() {
  return <AppSpace panel="activity" activity={{ rewind: "confirm" }} />;
}

export function RewindRunning() {
  return <AppSpace panel="activity" activity={{ rewind: "running" }} />;
}

export function RewindDone() {
  return <AppSpace panel="activity" activity={{ rewind: "done" }} />;
}

export function RewindConflict() {
  return <AppSpace panel="activity" activity={{ rewind: "conflict" }} />;
}

export function AnnotatePicking() {
  return (
    <AppSpace
      annotate={{
        items: [],
        marks: {
          picked: {
            ship: { n: 1, memo: "Ask which carrier before it ships." },
          },
          hover: { id: "total", label: "cell · $41.99" },
          area: { left: 1.5, top: 7.8, width: 64.5, height: 9.5 },
        },
      }}
    />
  );
}

export function AnnotateList() {
  return (
    <AppSpace
      annotate={{
        list: true,
        marks: {
          picked: {
            ship: { n: 1 },
            total: { n: 2 },
          },
          area: { left: 1.5, top: 7.8, width: 64.5, height: 9.5, n: 3 },
        },
        items: [
          {
            n: 1,
            target: "Button · Mark shipped (order #1042)",
            memo: "Ask which carrier before it ships.",
          },
          {
            n: 2,
            target: "Cell · $41.99 (order #1042)",
            memo: "Should be 42.00 with the 10% discount.",
          },
          {
            n: 3,
            target: "Area · the three summary tiles",
            memo: "Add yesterday's numbers under each one.",
          },
        ],
      }}
    />
  );
}

// ---- 오른쪽 패널: App details, agent 탭 ----

/** 두 탭이 한 줄에 선 패널. App details를 보고 있다. */
export function SidePanelTabs() {
  return (
    <AppSpace panel="version" pane={{ view: "details", agent: "lophn" }} />
  );
}

/** 앱 화면 옆에 붙은 agent 탭. title bar의 Agent select로 연다. */
export function AgentPaneOpen() {
  return <AppSpace pane={{ agent: "lophn" }} />;
}
