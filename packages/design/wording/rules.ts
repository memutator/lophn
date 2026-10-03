// 고정 문구 검사의 규칙 상수. 화면 이름·안쪽 말 목록은 docs/ui-ux/README.md를 따른다.

export const SCREENS = [
  "launcher",
  "project-workspace",
  "document",
  "terminal",
  "app-panel",
  "app-space",
  "app-detail",
  "projects",
  "documents",
  "contexts",
  "apps",
  "things-to-confirm",
  "roles",
  "settings",
  "conversation",
  "app-card",
  "confirmation-window",
  "report-problem",
  "common",
];

export const KEY_SHAPE = new RegExp(
  `^(?:${
    SCREENS.join("|")
  })\\.[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*\\.[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$`,
);

export const TEXT_ATTRIBUTES = new Set([
  "title",
  "aria-label",
  "placeholder",
  "alt",
  "label",
]);

// ui-ux README 3절에서 화면에 내보이지 않기로 한 안쪽 개념.
export const INTERNAL_WORDS = [
  "ledger",
  "release",
  "invocation",
  "assignment",
  "snapshot",
  "redaction",
  "claim",
  "handoff",
  "run",
  "ticket",
  "provider",
  "grant",
];

export const INTERNAL_WORD = new RegExp(
  `(?<![a-z])(?:${INTERNAL_WORDS.join("|")})(?![a-z])`,
  "i",
);

export const SNAKE_WORD = /(?<![a-z0-9])[a-z]+(?:_[a-z0-9]+)+(?![a-z0-9])/;

export const ID_PREFIX = /(?<![a-z])[a-z]{2,}_(?=[a-z0-9])/;

export const RAW_ENUM =
  /(?<![A-Za-z])[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+(?![A-Za-z])/;

export const SHORT_PARTS = new Set([
  "button",
  "title",
  "heading",
  "label",
  "view",
  "models",
  "activity",
]);
