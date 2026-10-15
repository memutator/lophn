// 고정 문구 검사의 규칙 상수.

const NAME = "[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*";

// key는 `<screen>.<part>.<name>`이고 세 구간 모두 kebab-case다. 앱 catalog는 자기 screen 목록을 줄 수 있다.
export function keyShape(screens?: readonly string[]): RegExp {
  const first = screens ? `(?:${screens.join("|")})` : NAME;
  return new RegExp(`^${first}\\.${NAME}\\.${NAME}$`);
}

export const KEY_SHAPE = keyShape();

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
  "grant",
  "call",
  "accepted",
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
