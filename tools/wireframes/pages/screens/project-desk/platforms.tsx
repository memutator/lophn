// OS마다 위쪽 바에서 비워야 하는 자리가 다르다: macOS는 왼쪽 신호등, Windows는 오른쪽 창 단추. selector는 둘 다 피한다.
import { useState } from "react";

import type { WindowPlatform } from "../../../../../packages/shell/renderer/desktop/top-bar/platform.ts";
import { Breadcrumbs } from "../../../../../packages/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import { DeskSelector } from "../../../../../packages/shell/renderer/workspace/top-path/desk-selector.tsx";
import { DeskBar } from "./frame.tsx";
import { OPTIONS_ALL } from "./desks.ts";

const CRUMBS = [{ label: "phroner" }, { label: "notes.md" }];

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
  const [active, setActive] = useState("release-notes");
  return (
    <div style={{ position: "relative", width: 560 }}>
      {platform === "mac" ? <TrafficLights /> : null}
      <DeskBar
        platform={platform}
        leading={<Breadcrumbs crumbs={CRUMBS} />}
        center={
          <DeskSelector
            options={OPTIONS_ALL}
            active={active}
            onSelect={setActive}
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
