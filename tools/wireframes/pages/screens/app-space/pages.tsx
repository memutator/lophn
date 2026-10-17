// 앱 공간 page들. 각 component는 인자 없이 한 상태를 고정해 그린다.
import { AppSpace } from "./space.tsx";

export function AppSpaceFrame() {
  return <AppSpace agentMenu />;
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

export function IssuesList() {
  return <AppSpace panel="issues" />;
}

export function IssueRecurred() {
  return <AppSpace panel="issues" issue="iss-2" />;
}

export function ReportNew() {
  return <AppSpace report={{}} />;
}

export function ReportExisting() {
  return <AppSpace report={{ existing: true, chosen: "iss-2" }} />;
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

export function ProjectPickerInView() {
  return <AppSpace picker />;
}

// ---- agent와 coding 터미널 pane ----

/** 앱 화면 옆에 붙은 agent pane. title bar의 Agent select로 연다. */
export function AgentPaneOpen() {
  return <AppSpace pane={{ agent: "App Engineer" }} />;
}

/** App Engineer가 맡기자 lophn이 터미널을 열었다. focus는 agent에 그대로 두고 pane 위쪽 toast로 알린다. */
export function CodingOpenedToast() {
  return (
    <AppSpace
      pane={{ view: "agent", agent: "App Engineer" }}
      terminal="running"
      openedToast
    />
  );
}

export function CodingRunning() {
  return <AppSpace pane={{ view: "terminal" }} terminal="running" />;
}

/** 대기 목록에서 coding agent의 권한 요청을 눌러 왔다. 터미널에 focus가 오고 물음은 TUI 안에 있다. */
export function CodingPermission() {
  return <AppSpace pane={{ view: "terminal" }} terminal="permission" />;
}

export function CodingEnded() {
  return <AppSpace pane={{ view: "terminal" }} terminal="ended" />;
}
