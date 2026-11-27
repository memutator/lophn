// Router 입력을 user role로 넣을 때 출처를 밝히는 tag의 이름과 속성 이름이다.
// tag를 만드는 쪽은 core의 `prompt-assembly/input-tags.ts`고, 바깥 글을 감싸는 `wrapUntrusted`는 binary(CLI)도 써서 여기에 둔다.

export const INPUT_TAGS = {
  call: "lophn-call",
  reply: "lophn-reply",
  reaction: "lophn-reaction",
  notice: "lophn-notice",
  step: "lophn-step",
  run: "lophn-run",
  steer: "lophn-steer",
  annotation: "lophn-annotation",
  untrusted: "lophn-untrusted",
  shell: "lophn-shell",
} as const;
export type InputTagKind = keyof typeof INPUT_TAGS;

export const INPUT_TAG_ATTRIBUTES = {
  call: ["from", "call", "reply"],
  reply: ["call", "from", "status", "reason"],
  reaction: ["event"],
  notice: ["kind"],
  step: ["instance", "step"],
  run: ["from"],
  annotation: [
    "n",
    "kind",
    "app",
    "release",
    "preview",
    "view",
    "project",
    "artifact",
  ],
  untrusted: ["source"],
  shell: ["command", "exit_code"],
  steer: [],
} as const;

const NOTICE_KINDS = [
  "instructions_changed",
  "tools_changed",
  "agents_changed",
  "team_changed",
  "call_cancelled",
  "activation_finished",
  "files_arrived",
  "date",
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

// lophn agent는 이 tool 이름(명령 호출은 명령 이름)으로 history가 감싸고, harness·사람 CLI는 binary가 찍는 글을 감싼다.
export const UNTRUSTED_SOURCES = [
  "web.search",
  "web.fetch",
  "browser.read",
  "browser.snapshot",
  "browser.act",
  "browser.navigate",
  "browser.evaluate",
  "browser.logs",
  "browser.wait",
  "tab.list",
] as const;
export type UntrustedSource = (typeof UNTRUSTED_SOURCES)[number];

const ATTRIBUTE_MAX = 200;

// 본문이 tag를 위조하지 못하게 여는 tag와 닫는 tag의 `<`를 바꾼다.
export function escapeTagBody(text: string): string {
  return text.replace(/<(\/?)lophn-/gi, "&lt;$1lophn-");
}

// 속성 값이 한 줄로 남고 따옴표나 꺾쇠로 tag를 빠져나가지 못하게 한다.
export function scrubAttribute(value: string): string {
  const flat = value
    .replace(/\p{Cc}|[\u2028\u2029]/gu, " ")
    .replace(/["<>&]/g, "");
  return Array.from(flat).slice(0, ATTRIBUTE_MAX).join("");
}

// 속성은 INPUT_TAG_ATTRIBUTES 순서로 쓰고, 없는 속성은 호출하는 쪽의 결함이라 throw한다.
export function renderTag(
  kind: InputTagKind,
  attributes: Partial<Record<string, string | number>>,
  body: string,
): string {
  const name = INPUT_TAGS[kind];
  const declared: readonly string[] = INPUT_TAG_ATTRIBUTES[kind];
  for (const key of Object.keys(attributes)) {
    if (!declared.includes(key)) {
      throw new Error(`${name}에 없는 속성: ${key}`);
    }
  }
  const attrs = declared
    .filter((key) => attributes[key] !== undefined)
    .map((key) => ` ${key}="${scrubAttribute(String(attributes[key]))}"`)
    .join("");
  return `<${name}${attrs}>\n${escapeTagBody(body)}\n</${name}>`;
}

// 바깥 글(web 결과, browser page 글)이다. 본문은 escape되어 닫는 tag로 빠져나가지 못한다.
export function wrapUntrusted(source: UntrustedSource, text: string): string {
  return renderTag("untrusted", { source }, text);
}
