import type { CommandEntry } from "../../../protocol/lophn-agent/mod.ts";
import type { CommandRegistry } from "./registry.ts";

// 제출 해석(concern lophn-agent/commands). registry 하나에서 메뉴·자동완성·이름 검사가 모두
// 나오게 한다. `/` 뒤 글자로 거르는 메뉴 규칙은 화면과 같이 쓰므로
// contracts/lophn-agent/command-filter.ts에 있다. IO가 없는 순수 함수다.

export type Submission =
  // `/`로 시작하지 않는 입력이다. 일반 메시지다.
  | { kind: "message" }
  // 실행할 명령 하나다. `argument`는 이름 뒤 글자를 앞뒤 공백 없이 준 것이다(없으면 "").
  | { kind: "command"; entry: CommandEntry; argument: string }
  // 맞는 명령이 없다. 명령으로도 일반 메시지로도 접수하지 않는다.
  | { kind: "unknown_command"; name: string };

// 제출한 입력을 registry로 푼다. registry에 없는 이름은 실행되지 않는다.
export function resolveSubmission(
  registry: CommandRegistry,
  text: string,
): Submission {
  if (!text.startsWith("/")) return { kind: "message" };
  const body = text.slice(1);
  const split = body.search(/\s/);
  const name = split === -1 ? body : body.slice(0, split);
  const argument = split === -1 ? "" : body.slice(split).trim();
  const entry = registry.entries.find((candidate) => candidate.name === name);
  if (entry === undefined) return { kind: "unknown_command", name };
  return { kind: "command", entry, argument };
}
