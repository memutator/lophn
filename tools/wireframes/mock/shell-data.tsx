// shell 틀 gallery page의 고정 data. desk 셋(Main, Review, Release check)과 tab 일곱. 본문은 틀을 보이려는 간단한 그림이다.
// desk는 실제 desk model(`shell/desk-model.ts`)이고 group·float은 그 함수로 만든다.
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
import {
  type Desk,
  emptyDesk,
  floatTab,
  openTab,
  selectTab,
  setRatio,
  splitTab,
  type TabItem,
} from "../../../packages/shell/renderer/shell/desk-model.ts";
import type { FloatRect } from "../../../packages/shell/renderer/workspace/model.ts";
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

export interface MockDesk {
  key: string;
  label: string;
  workflow?: boolean;
  status?: string;
  /** 실제 desk model. tab의 title·dot 같은 그림 값은 `fields.mock`에 있다(`mockOf`). */
  model: Desk;
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

// gallery 창 크기(1280x800)에 맞춘 float 자리. 띄운 차례대로 쓴다.
export const FLOAT_RECTS: readonly FloatRect[] = [
  { x: 300, y: 56, width: 396, height: 300 },
  { x: 32, y: 420, width: 440, height: 220 },
  { x: 180, y: 240, width: 400, height: 260 },
];

const itemOf = (tab: MockTab): TabItem => ({
  key: tab.key,
  kind: "mock",
  title: tab.title,
  fields: { mock: tab },
});

export const mockOf = (item: TabItem): MockTab => item.fields!.mock as MockTab;

/** tabs를 차례로 연 desk. floats는 [tab, 펴 있나] 차례이고 그 차례가 위아래·접힌 칸의 차례다. */
const desk = (
  key: string,
  label: string,
  tabs: MockTab[],
  more: {
    selected?: string;
    floats?: readonly (readonly [MockTab, boolean])[];
    workflow?: boolean;
    status?: string;
  } = {},
): MockDesk => {
  const floats = more.floats ?? [];
  let model: Desk = {
    ...emptyDesk(key, label),
    tabs: [...tabs, ...floats.map(([tab]) => tab)].map(itemOf),
  };
  model = selectTab(model, more.selected ?? tabs[0]?.key ?? "");
  floats.forEach(([tab], at) => {
    model = floatTab(model, tab.key, FLOAT_RECTS[at % FLOAT_RECTS.length]!);
  });
  model = {
    ...model,
    floats: model.floats.map((item, at) => ({
      ...item,
      minimized: !floats[at]![1],
    })),
  };
  return {
    key,
    label,
    ...(more.workflow ? { workflow: true } : {}),
    ...(more.status === undefined ? {} : { status: more.status }),
    model,
  };
};

type Step = readonly [
  target: string,
  added: string,
  side: "left" | "right" | "top" | "bottom",
];

/** 나눔 하나를 더한다. 첫 인자 desk model은 이미 tabs에 든 tab으로 만든다. */
const grouped = (
  main: MockDesk,
  steps: readonly Step[],
  select?: string,
): MockDesk => {
  let model = main.model;
  for (const [target, added, side] of steps) {
    model = splitTab(model, target, added, side, { select: "target" });
  }
  return { ...main, model: select ? selectTab(model, select) : model };
};

export type Variant =
  | "project"
  | "split"
  | "split-down"
  | "group-top2"
  | "group-right2"
  | "group-columns"
  | "group-grid"
  | "group-menu"
  | "desk-close"
  | "floats"
  | "empty"
  | "overflow"
  | "overflow-end"
  | "long-title"
  | "split-compact"
  | "pane-stack"
  | "tabs-close"
  | "marks";

/** variant마다 Main desk의 상태가 다르다. Review와 workflow desk는 같다. */
export function mockDesks(variant: Variant): MockDesk[] {
  const main = desk("_default", "Main", [P1, C1, README, PLAN, TERM], {
    floats: [
      [P2, false],
      [DEV, false],
      [POSE, false],
    ],
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
  // Main의 tab을 나눠 group 하나로 만든다. ratios는 [path, 몫]이다.
  const groupMain = (
    steps: readonly Step[],
    ratios: readonly (readonly [readonly ("a" | "b")[], number])[] = [],
  ): MockDesk[] => {
    const made = grouped(main, steps, "p1");
    const model = ratios.reduce(
      (now, [path, ratio]) => setRatio(now, "p1", path, ratio),
      made.model,
    );
    return [{ ...made, model }, ...others];
  };
  switch (variant) {
    case "split":
      return [grouped(main, [["p1", "c1", "right"]]), ...others];
    case "pane-stack": {
      // coding agent(c1)가 문서 셋을 차례로 보냈다. 첫 것은 [c1 | brief] split을 만들고, 다음 것들은 그 칸에 쌓인다.
      const sent = [
        file("brief", "brief.md", "phroner", "plan"),
        file("gaze", "gaze-notes.md", "phroner", "plan"),
        file("diff", "body-refactor.md", "phroner", "plan"),
      ];
      let model = desk("_default", "Main", [C1, README, PLAN, TERM]).model;
      for (const doc of sent) {
        model = openTab(model, itemOf(doc), { after: "c1", beside: true });
      }
      return [{ ...main, model }, ...others];
    }
    case "tabs-close": {
      // [c1 | brief·gaze·diff] 칸 아래에 zsh를 붙인 group. gaze는 저장하지 못했다. Close group이 묻는 dialog를 띄운다.
      const sent = [
        file("brief", "brief.md", "phroner", "plan"),
        { ...file("gaze", "gaze-notes.md", "phroner", "plan"), unsaved: true },
        file("diff", "body-refactor.md", "phroner", "plan"),
      ];
      let model = desk("_default", "Main", [C1, README, PLAN, TERM]).model;
      for (const doc of sent) {
        model = openTab(model, itemOf(doc), { after: "c1", beside: true });
      }
      model = splitTab(model, "diff", "term", "bottom");
      return [{ ...main, model }, ...others];
    }
    case "split-down":
      return [grouped(main, [["p1", "c1", "bottom"]]), ...others];
    case "group-top2":
      // 위에 둘, 아래에 하나.
      return groupMain([
        ["p1", "readme", "bottom"],
        ["p1", "c1", "right"],
      ]);
    case "group-right2":
      // 왼쪽에 하나, 오른쪽에 위아래 둘.
      return groupMain(
        [
          ["p1", "c1", "right"],
          ["c1", "readme", "bottom"],
        ],
        [[[], 0.45]],
      );
    case "group-columns":
      // 세 열.
      return groupMain(
        [
          ["p1", "c1", "right"],
          ["c1", "readme", "right"],
        ],
        [[[], 1 / 3]],
      );
    case "group-grid":
      // 2 x 2.
      return groupMain([
        ["p1", "readme", "bottom"],
        ["p1", "c1", "right"],
        ["readme", "plan", "right"],
      ]);
    case "group-menu":
      // 세 칸 group의 둘째 칸 ⋯ menu를 연다. Remove from split과 Unsplit all이 나온다.
      return groupMain([
        ["p1", "c1", "right"],
        ["c1", "readme", "bottom"],
      ]);
    case "floats":
      return [
        {
          ...desk("_default", "Main", [P1, C1, README, PLAN, TERM], {
            selected: "readme",
            floats: [
              [P2, true],
              [DEV, true],
              [POSE, false],
            ],
          }),
        },
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
        desk("_default", "Main", [P1, C1, ...many], {
          floats: [P2, DEV, POSE, TERM, README, PLAN].map(
            (tab) => [tab, false] as const,
          ),
        }),
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
        desk("_default", "Main", [P1, C1, ...many, README, PLAN, last], {
          selected: "last",
          floats: [
            [P2, false],
            [DEV, false],
          ],
        }),
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
        desk(
          "_default",
          "Main",
          [
            file("doc1", "docs.md", "phroner"),
            file("doc2", "notes.md", "phroner"),
            long,
            file("doc3", "design.md", "phroner"),
            TERM,
          ],
          { selected: "long", floats: [[P2, false]] },
        ),
        ...others,
      ];
    }
    case "split-compact": {
      // 고르지 않은 group은 아이콘과 방향 표시만 보인다: 둘(좌우), 둘(위아래), 셋.
      const doc1 = file("doc1", "docs.md", "phroner");
      const ideas = file("ideas", "ideas.md", "phroner");
      const todo = file("todo", "todo.md", "phroner");
      const compact = desk(
        "_default",
        "Main",
        [doc1, README, P1, C1, PLAN, TERM, POSE, ideas, todo],
        { selected: "readme" },
      );
      return [
        grouped(
          compact,
          [
            ["p1", "c1", "right"],
            ["plan", "term", "bottom"],
            ["pose", "ideas", "right"],
            ["ideas", "todo", "bottom"],
          ],
          "readme",
        ),
        ...others,
      ];
    }
    case "marks":
      return [
        desk(
          "_default",
          "Main",
          [
            P1,
            C1,
            { ...README, preview: true },
            { ...PLAN, unsaved: true },
            TERM,
          ],
          {
            selected: "plan",
            floats: [
              [P2, false],
              [DEV, false],
              [POSE, false],
            ],
          },
        ),
        ...others,
      ];
    case "desk-close": {
      // 지우려는 Review desk: 저장이 남은 파일 둘, 터미널, 떠 있는 패널.
      const notes = {
        ...file("r-notes", "release-notes.md", "phroner"),
        unsaved: true,
      };
      const spec = {
        ...file("r-spec", "spec.ts", "phroner", "src"),
        unsaved: true,
      };
      return [
        main,
        desk(
          "review",
          "Review",
          [R1, notes, spec, terminal("r-term", "npm test")],
          {
            floats: [[file("r-todo", "todo.md", "phroner"), false]],
          },
        ),
        ...others.slice(1),
      ];
    }
    case "empty":
      return [{ ...main, model: emptyDesk("_default", "Main") }, ...others];
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
