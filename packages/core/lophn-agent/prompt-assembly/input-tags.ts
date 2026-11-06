import {
  INPUT_TAG_ATTRIBUTES,
  INPUT_TAGS,
  type InputTagKind,
  type NoticeKind,
  type UntrustedSource,
} from "../../../protocol/lophn-agent/input-tags.ts";

// Router 입력을 user role로 넣을 때 출처를 밝히는 tag를 만든다. 순수 함수다.
// 고정 문장은 영어로 두고, 붙일 때는 tag 밖에 program이 쓴 줄로만 붙인다(reaction은 tag만 쓴다).

const ATTRIBUTE_MAX = 200;

const NOTICE_NOTE = "This is an automatic notice. A person did not write it.";

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

// program이 쓴 알림이다. 명령형 문장은 쓰지 않는다.
export function noticeInput(input: { kind: NoticeKind; body: string }): string {
  return [
    renderTag("notice", { kind: input.kind }, input.body),
    NOTICE_NOTE,
  ].join("\n");
}

// 사람이 turn 중에 직접 보낸 메시지다. tag가 출처를 밝히므로 고정 문장은 붙이지 않는다.
export function steerInput(text: string): string {
  return renderTag("steer", {}, text);
}

// 바깥 web 결과다. 본문은 escape되어 닫는 tag로 빠져나가지 못한다.
export function wrapUntrusted(source: UntrustedSource, text: string): string {
  return renderTag("untrusted", { source }, text);
}

// 사람이 `!`로 돌린 명령과 출력이다. 출력은 data이고 tag가 출처를 밝히므로 고정 문장은 붙이지 않는다.
// 명령 전체는 본문 첫 줄에 둔다(속성은 길이를 자른다).
export function shellInput(shell: {
  command: string;
  exit_code: number | null;
  timed_out: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
}): string {
  const lines = [`$ ${shell.command}`];
  if (shell.stdout !== "") lines.push(shell.stdout);
  if (shell.stderr !== "") lines.push("[stderr]", shell.stderr);
  if (shell.timed_out) lines.push("[timed out]");
  if (shell.truncated) lines.push("[output truncated]");
  return renderTag(
    "shell",
    {
      command: shell.command,
      ...(shell.exit_code === null ? {} : { exit_code: shell.exit_code }),
    },
    lines.join("\n"),
  );
}
