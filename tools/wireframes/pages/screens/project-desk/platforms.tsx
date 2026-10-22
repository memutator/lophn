// OS마다 위쪽 바에서 비워야 하는 자리가 다르다: macOS는 왼쪽 신호등, Windows는 오른쪽 창 단추. 왼쪽 경로(project ▾ / desk ▾)는 둘 다 피해 신호등 오른쪽, 창 단추 왼쪽 안에 놓인다.
import { useState } from "react";

import type { WindowPlatform } from "../../../../../packages/shell/renderer/desktop/top-bar/platform.ts";
import { DeskBar, PathLeading } from "./frame.tsx";
import { OPTIONS_ALL, PROJECTS } from "./desks.ts";

// gallery에는 OS 창이 없어서 신호등 자리를 점 셋으로 보인다.
function TrafficLights() {
  return (
    <div
      style={{
        position: "absolute",
        top: "var(--space-6)",
        left: "var(--space-6)",
        display: "flex",
        gap: "var(--space-4)",
      }}
    >
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          style={{
            width: "var(--space-5)",
            height: "var(--space-5)",
            borderRadius: "50%",
            background: "var(--color-border-strong)",
          }}
        />
      ))}
    </div>
  );
}

function Bar({ platform }: { platform: WindowPlatform }) {
  const [project, setProject] = useState(PROJECTS[0]!.id);
  const [desk, setDesk] = useState("release-notes");
  return (
    <div style={{ position: "relative", width: 560 }}>
      {platform === "mac" ? <TrafficLights /> : null}
      <DeskBar
        platform={platform}
        leading={
          <PathLeading
            projects={PROJECTS}
            project={project}
            onProject={setProject}
            desks={OPTIONS_ALL}
            desk={desk}
            onDesk={setDesk}
          />
        }
      />
      <p
        style={{
          margin: "var(--space-4) var(--space-5)",
          color: "var(--color-text-muted)",
          fontSize: "var(--type-small-size)",
        }}
      >
        {platform === "mac" ? "macOS" : "Windows"}
      </p>
    </div>
  );
}

export function Platforms() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-8)",
        padding: "var(--space-8)",
        background: "var(--color-surface-floor)",
      }}
    >
      <Bar platform="mac" />
      <Bar platform="windows" />
    </div>
  );
}
