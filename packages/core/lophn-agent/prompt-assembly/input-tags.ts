import {
  type NoticeKind,
  renderTag,
} from "../../../protocol/lophn-agent/input-tags.ts";

// Router 입력을 user role로 넣을 때 출처를 밝히는 tag를 만든다. 순수 함수다.
// 고정 문장은 영어로 두고, 붙일 때는 tag 밖에 program이 쓴 줄로만 붙인다(reaction은 tag만 쓴다).

const NOTICE_NOTE = "This is an automatic notice. A person did not write it.";

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
