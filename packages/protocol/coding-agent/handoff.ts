import { HARNESS_ADAPTERS } from "./harness-adapter.ts";
import type { HarnessId } from "./harness-id.ts";

/** 사람이 바꾼 실행 명령어가 없으면 harness의 첫 명령어다. */
export function codingCommand(
  commands: Readonly<Partial<Record<HarnessId, string>>>,
  id: HarnessId,
): string | undefined {
  return commands[id] ?? HARNESS_ADAPTERS[id].commands[0];
}

const HANDOFF_SENTENCE =
  "Read the handoff at {file} and continue the work it describes.";

/**
 * handoff를 첫 prompt로 주는 TUI 명령이다. 사람의 즐겨찾기 명령 뒤에 adapter의 첫 prompt 인자를 붙인다.
 * 터미널에 치는 글은 lophn이 정한 고정 영어 한 줄과 file 경로뿐이고 agent가 쓴 글은 들어가지 않는다.
 * 경로에 큰따옴표·`$`·backtick·겹친 backslash(`\\`)·줄바꿈이 있으면 shell이 다르게 읽을 수 있어 null이다.
 * 홑 backslash는 Windows 경로라 허용한다(큰따옴표 안에서 PowerShell은 글자 그대로이고 POSIX shell은 바로 뒤가 위 글자일 때만 특별하다).
 */
export function handoffCommand(
  commands: Readonly<Partial<Record<HarnessId, string>>>,
  id: HarnessId,
  file: string,
): string | null {
  const command = codingCommand(commands, id);
  const prompt = HARNESS_ADAPTERS[id]?.session.prompt;
  if (command === undefined || prompt === undefined) return null;
  if (/["$`\n\r]|\\\\/.test(file)) return null;
  const quoted = `"${HANDOFF_SENTENCE.replace("{file}", file)}"`;
  return [
    command,
    ...prompt.map((arg) => arg.replace("{prompt}", quoted)),
  ].join(" ");
}
