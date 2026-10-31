// shell 틀 gallery page의 고정 data. desk 셋(Main, Review, Release check)과 tab 일곱. 본문은 틀을 보이려는 간단한 그림이다.
import type { ReactNode } from "react";
import { FileIcon, Icon } from "@lophn/ui/primitives";
import { Markdown } from "@lophn/ui/reading";
import { shellIcons } from "../../../packages/shell/renderer/icons/mod.ts";
import { Avatar } from "../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import type { TabDot } from "../../../packages/shell/renderer/parts/tab-state-dot/tab-state-dot.tsx";
import {
  type Vendor,
  VendorIcon,
} from "../../../packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx";
import type { CardPane } from "../../../packages/shell/renderer/shell/content-card.tsx";
import type { TabMenuState } from "../../../packages/shell/renderer/shell/tab-menu.tsx";
import type { StripTab } from "../../../packages/shell/renderer/shell/tab-strip.tsx";

type Agent =
  | { kind: "lophn"; shape: "square" | "round"; color: "coral" | "blue" }
  | { kind: "coding"; vendor: Vendor };

export interface MockTab {
  key: string;
  kind: "chat" | "file" | "terminal";
  title: string;
  crumbs: string[];
  agent?: Agent;
  dot?: TabDot;
  status?: string;
  /** preview tab. 이름이 italic이다. */
  preview?: boolean;
  /** 저장 안 된 변경. */
  unsaved?: boolean;
}

export interface MockEntry {
  key: string;
  a: MockTab;
  b?: MockTab;
  /** split의 방향과 a의 몫. 없으면 좌우 반반이다. */
  dir?: "row" | "column";
  ratio?: number;
}

export interface MockDesk {
  key: string;
  label: string;
  workflow?: boolean;
  status?: string;
  entries: MockEntry[];
  selected: string | null;
  focus: "a" | "b";
  minimized: MockTab[];
  floating: string[];
}

const LOPHN: Agent = { kind: "lophn", shape: "square", color: "coral" };

const chat = (
  key: string,
  title: string,
  place: string,
  agent: Agent = LOPHN,
): MockTab => ({
  key,
  kind: "chat",
  title,
  crumbs: [place, title],
  agent,
  status: "Ready",
});
const file = (key: string, title: string, ...crumbs: string[]): MockTab => ({
  key,
  kind: "file",
  title,
  crumbs: [...crumbs, title],
});
const terminal = (key: string, title: string): MockTab => ({
  key,
  kind: "terminal",
  title,
  crumbs: ["phroner", title],
});
const single = (tab: MockTab): MockEntry => ({ key: tab.key, a: tab });

export const P1 = chat("p1", "Pick up the body refactor", "phroner");
export const P2 = chat("p2", "Check the gaze on running", "phroner");
export const C1: MockTab = {
  ...chat("c1", "Fix gaze interpolation", "phroner", {
    kind: "coding",
    vendor: "claude",
  }),
  dot: "waiting",
};
export const README = file("readme", "README.md", "phroner");
export const PLAN = file("plan", "072-architecture.md", "phroner", "plan");
export const POSE = file("pose", "pose.ts", "phroner", "body");
export const TERM = terminal("term", "zsh");
export const DEV = terminal("dev", "npm run dev");
const R1: MockTab = {
  ...chat("r1", "Review PR #42", "phroner", {
    kind: "lophn",
    shape: "round",
    color: "blue",
  }),
  dot: "finished",
};
const REL = chat("rel", "Release check · step 2", "phroner");

const desk = (
  key: string,
  label: string,
  tabs: MockTab[],
  more: Partial<MockDesk> = {},
): MockDesk => ({
  key,
  label,
  entries: tabs.map(single),
  selected: tabs[0]?.key ?? null,
  focus: "a",
  minimized: [],
  floating: [],
  ...more,
});

export type Variant =
  | "project"
  | "split"
  | "split-down"
  | "floats"
  | "empty"
  | "overflow"
  | "overflow-end"
  | "long-title"
  | "split-compact"
  | "marks";

/** variant마다 Main desk의 상태가 다르다. Review와 workflow desk는 같다. */
export function mockDesks(variant: Variant): MockDesk[] {
  const main = desk("_default", "Main", [P1, C1, README, PLAN, TERM], {
    minimized: [P2, DEV, POSE],
  });
  const others = [
    desk("review", "Review", [R1]),
    desk("release", "Release check", [REL], {
      workflow: true,
      status: "step 2/4 · your turn",
    }),
    desk(
      "weekly",
      "Weekly summary",
      [chat("weekly", "Weekly summary", "phroner")],
      {
        workflow: true,
        status: "done · Oct 30",
      },
    ),
  ];
  switch (variant) {
    case "split":
      return [
        {
          ...main,
          entries: [{ key: "p1", a: P1, b: C1 }, single(README), single(PLAN)],
        },
        ...others,
      ];
    case "split-down":
      return [
        {
          ...main,
          entries: [
            { key: "p1", a: P1, b: C1, dir: "column" },
            single(README),
            single(PLAN),
          ],
        },
        ...others,
      ];
    case "floats":
      return [
        { ...main, selected: "readme", floating: ["p2", "dev"] },
        ...others,
      ];
    case "overflow": {
      const names = [
        "notes",
        "design",
        "api",
        "schema",
        "roadmap",
        "changelog",
        "todo",
        "ideas",
        "faq",
      ];
      const many = names.map((name) => file(name, `${name}.md`, "phroner"));
      return [
        {
          ...main,
          ...desk("_default", "Main", [P1, C1, ...many]),
          minimized: [P2, DEV, POSE, TERM, README, PLAN],
        },
        ...others,
      ];
    }
    case "overflow-end": {
      // 많은 tab 끝의 긴 이름을 골라 scroll로 보이는지 본다.
      const names = [
        "notes",
        "design",
        "api",
        "schema",
        "roadmap",
        "changelog",
      ];
      const many = names.map((name) => file(name, `${name}.md`, "phroner"));
      const last = file(
        "last",
        "2026-11-01-quarterly-planning-notes-final.md",
        "phroner",
      );
      return [
        {
          ...desk("_default", "Main", [P1, C1, ...many, README, PLAN, last], {
            selected: "last",
            minimized: [P2, DEV],
          }),
        },
        ...others,
      ];
    }
    case "long-title": {
      const long = file(
        "long",
        "architecture-decision-record-0072-tab-strip.md",
        "phroner",
      );
      return [
        {
          ...desk(
            "_default",
            "Main",
            [
              file("doc1", "docs.md", "phroner"),
              file("doc2", "domain.md", "phroner"),
              long,
              file("doc3", "design.md", "phroner"),
              TERM,
            ],
            { selected: "long", minimized: [P2] },
          ),
        },
        ...others,
      ];
    }
    case "split-compact":
      return [
        {
          ...main,
          entries: [
            single(file("doc1", "docs.md", "phroner")),
            single(README),
            { key: "p1", a: P1, b: C1 },
            { key: "plan", a: PLAN, b: TERM, dir: "column" },
          ],
          selected: "readme",
        },
        ...others,
      ];
    case "marks":
      return [
        {
          ...desk(
            "_default",
            "Main",
            [
              P1,
              C1,
              { ...README, preview: true },
              { ...PLAN, unsaved: true },
              TERM,
            ],
            { selected: "plan", minimized: [P2, DEV, POSE] },
          ),
        },
        ...others,
      ];
    case "empty":
      return [
        { ...main, entries: [], selected: null, minimized: [] },
        ...others,
      ];
    default:
      return [main, ...others];
  }
}

export function tabIcon(tab: MockTab): ReactNode {
  if (tab.kind === "file") return <FileIcon name={tab.title} size={14} />;
  if (tab.kind === "terminal") {
    return <Icon icon={shellIcons.terminal} pixels={14} />;
  }
  const agent = tab.agent ?? LOPHN;
  return agent.kind === "lophn" ? (
    <Avatar
      profile={{ kind: "character", shape: agent.shape, color: agent.color }}
      size="sm"
    />
  ) : (
    <VendorIcon vendor={agent.vendor} size={16} />
  );
}

export const stripTab = (tab: MockTab): StripTab => ({
  key: tab.key,
  title: tab.title,
  icon: tabIcon(tab),
  dot: tab.dot,
  preview: tab.preview,
  unsaved: tab.unsaved,
  renamable: tab.kind !== "file",
});

const fill = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-6)",
  width: "100%",
  maxWidth: "calc(var(--space-12) * 11)",
  marginInline: "auto",
  padding: "var(--space-6) var(--space-8)",
} as const;

const README_TEXT = `# phroner

A body that moves with the person in front of the camera.

- \`body/\` holds the joints and the pose solver
- \`gaze/\` interpolates where the eyes look
`;

const CHAT_USER = "Where did we stop on the body refactor?";
const CHAT_AGENT =
  "The joint solver is moved into `body/`. **Gaze interpolation** is the next step; it still jumps on fast turns.";

const TERMINAL = ["$ npm run dev", "ready in 312 ms", "watching body/ gaze/"];

function Body({ tab }: { tab: MockTab }): ReactNode {
  if (tab.kind === "file") {
    return (
      <div style={fill}>
        <Markdown source={README_TEXT} variant="reading" />
      </div>
    );
  }
  if (tab.kind === "terminal") {
    return (
      <pre
        style={{
          margin: 0,
          padding: "var(--space-4) var(--space-8)",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--type-small-size)",
        }}
      >
        {TERMINAL.join("\n")}
      </pre>
    );
  }
  return (
    <div style={fill}>
      <div
        style={{
          alignSelf: "flex-end",
          padding: "var(--space-4) var(--space-6)",
          background: "var(--color-surface-muted)",
          borderRadius: "var(--radius-xl)",
        }}
      >
        {CHAT_USER}
      </div>
      <Markdown source={CHAT_AGENT} variant="chat" />
    </div>
  );
}

export function cardPane(tab: MockTab, menu?: TabMenuState): CardPane {
  return {
    key: tab.key,
    crumbs: tab.crumbs,
    status: tab.status,
    ...(menu === undefined ? {} : { menu }),
    body: <Body tab={tab} />,
  };
}

export function floatBody(tab: MockTab): ReactNode {
  return <Body tab={tab} />;
}
