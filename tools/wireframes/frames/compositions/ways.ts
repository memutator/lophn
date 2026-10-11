// Context 탭을 여는 길 목록(C13). React·CSS 없이 두어 `deno test`가 그대로 읽는다. `tryIt`은 그 길을 눌러 볼 수 있는
// gallery page의 id다.
export interface Way {
  readonly title: string;
  /** 사람이 누르는 순서. 마지막 상자(Context 탭)는 그림이 따로 붙인다. */
  readonly steps: readonly string[];
  /** 이 길로 열리는 Context 탭의 모습. */
  readonly result: string;
  readonly tryIt: string;
}

export const WAYS: readonly Way[] = [
  {
    title: "Sidebar",
    steps: ["Sidebar › Contexts", "eval row"],
    result: "eval · Overview",
    tryIt: "new-project-tabs",
  },
  {
    title: "Shortcut rail",
    steps: ["Collapsed sidebar", "Contexts button", "Contexts tab", "[Open]"],
    result: "eval · Overview",
    tryIt: "new-sidebar-collapsed",
  },
  {
    title: "New tab menu",
    steps: ["Tab strip +", "Context ›", "eval"],
    result: "eval · Overview",
    tryIt: "new-project-tab-menu",
  },
  {
    title: "Search tab",
    steps: ["Search tab", "Open context link"],
    result: "eval · Overview",
    tryIt: "new-search-table",
  },
  {
    title: "Document",
    steps: ["Document tab", "Info icon", "Contexts", "[Open]"],
    result: "eval · Overview",
    tryIt: "new-document-tab-info",
  },
  {
    title: "Violation toast",
    steps: ["Toast", "[View]"],
    result: "eval · Violations",
    tryIt: "new-violation-toast",
  },
  {
    title: "Top bar search",
    steps: ["Magnifier or Ctrl+K", "type “eval”", "Contexts: eval"],
    result: "eval · Overview",
    tryIt: "new-project-tabs",
  },
  {
    title: "Conversation",
    steps: ["lophn or Context Engineer says “eval”", "name link"],
    result: "eval · Overview",
    tryIt: "new-project-tabs",
  },
  {
    title: "New context",
    steps: [
      "Contexts tab [New context]",
      "Context Engineer conversation",
    ],
    result: "release-notes · drafting",
    tryIt: "new-contexts",
  },
];
