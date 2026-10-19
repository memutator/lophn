// Router 입력을 user role로 넣을 때 출처를 밝히는 tag의 이름과 속성 이름이다.
// tag를 만들고 escape하는 코드는 core 몫이다.

export const INPUT_TAGS = {
  call: "lophn-call",
  reply: "lophn-reply",
  reaction: "lophn-reaction",
  notice: "lophn-notice",
  steer: "lophn-steer",
  annotation: "lophn-annotation",
  untrusted: "lophn-untrusted",
} as const;
export type InputTagKind = keyof typeof INPUT_TAGS;

export const INPUT_TAG_ATTRIBUTES = {
  call: ["from", "call", "reply"],
  reply: ["call", "from", "status", "reason"],
  reaction: ["event", "seq"],
  notice: ["kind"],
  annotation: ["n", "kind", "app", "release", "view", "project", "artifact"],
  untrusted: ["source"],
  steer: [],
} as const;

const NOTICE_KINDS = [
  "instructions_changed",
  "tools_changed",
  "kinds_changed",
  "agents_changed",
  "call_cancelled",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const UNTRUSTED_SOURCES = ["web.search", "web.fetch"] as const;
export type UntrustedSource = (typeof UNTRUSTED_SOURCES)[number];
