// 앱 place page들. 각 component는 인자 없이 한 상태를 고정해 그린다.
import { AppSpace } from "./space.tsx";

/** 앱 place를 처음 연 모양: 앱 화면 탭 하나, 오른쪽 Domain panel. */
export function AppPlaceScreen() {
  return <AppSpace />;
}

/** 앱 화면과 그 앱 place의 lophn session을 붙인 group. 오른쪽 sidebar는 접었다. */
export function AppPlaceSplit() {
  return <AppSpace layout="split" rightClosed />;
}

/** 앱 화면 탭과 session 탭이 따로 선 모양. session 탭을 골랐다. */
export function AppPlaceSession() {
  return <AppSpace layout="session" />;
}

/** Logs. agent run은 아래에 그 run이 연 session이 있고 tool run은 session 줄이 없다. job이 연 run(agent run 하나와 tool run 하나)은 이름 자리에 job 제목이 오고 둘째 줄에 agent 또는 tool 이름이 온다. 다른 앱과 lophn의 run은 없다. */
export function RunsList() {
  return <AppSpace panel="logs" runs="list" />;
}

export function RunsEmpty() {
  return <AppSpace panel="logs" runs="empty" />;
}

/** Domain panel. 앱이 쓰는 domain 목록이다. */
export function DomainPanel() {
  return <AppSpace panel="domain" />;
}

export function VersionApplied() {
  return <AppSpace ops="version" />;
}

export function VersionApplying() {
  return <AppSpace ops="version" version="applying" />;
}

export function VersionFailed() {
  return <AppSpace ops="version" version="failed" />;
}

export function AccessGrants() {
  return <AppSpace ops="access" />;
}

export function AccessRevoking() {
  return <AppSpace ops="access" revoking={["secret", "reserve"]} />;
}

export function AccessSecrets() {
  return <AppSpace ops="access" secrets="plain" />;
}

export function AccessOAuthSetup() {
  return <AppSpace ops="access" secrets="oauth-setup" />;
}

export function AccessOAuthReady() {
  return <AppSpace ops="access" secrets="oauth-ready" />;
}

export function AccessOAuthWaiting() {
  return <AppSpace ops="access" secrets="oauth-waiting" />;
}

export function AccessOAuthSignedIn() {
  return <AppSpace ops="access" secrets="oauth-signed-in" />;
}

export function AccessOAuthFailed() {
  return <AppSpace ops="access" secrets="oauth-failed" />;
}

export function ActivityLog() {
  return <AppSpace ops="activity" activity={{ open: "i-20" }} />;
}

export function RewindConfirm() {
  return <AppSpace ops="activity" activity={{ rewind: "confirm" }} />;
}

export function RewindRunning() {
  return <AppSpace ops="activity" activity={{ rewind: "running" }} />;
}

export function RewindDone() {
  return <AppSpace ops="activity" activity={{ rewind: "done" }} />;
}

export function RewindConflict() {
  return <AppSpace ops="activity" activity={{ rewind: "conflict" }} />;
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
