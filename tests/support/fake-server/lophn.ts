// fake model이 `lophn` tool을 부르는 각본과, 요청에서 그 place가 부를 수 있는 명령을 읽는 도구다.
// 입력이 있는 명령은 `--input <JSON>`으로 준다. 위치 인자와 flag 풀이는 parser의 일이라 여기서 다시 풀지 않는다.

import type { JournalEntry } from "./types.ts";

export type LophnCall = { id: string; name: string; arguments: string };

// `line`은 명령과 위치 인자를 띄어 쓴 것("call send", "release prepare app_..."), `input`은 그 명령의 입력 object다.
export function lophnCall(
  id: string,
  line: string,
  input?: unknown,
): LophnCall {
  const words = line.split(" ");
  const args =
    input === undefined ? words : [...words, "--input", JSON.stringify(input)];
  return { id, name: "lophn", arguments: JSON.stringify({ args }) };
}

export function lophnReply(id: string, line: string, input?: unknown) {
  return { kind: "tool" as const, calls: [lophnCall(id, line, input)] };
}

// `lophn` tool 설명 끝의 "Commands:" 목록에서 그 place가 부를 수 있는 명령(낱말을 띄어 쓴 이름)을 읽는다.
export function lophnCommands(request: JournalEntry): string[] {
  const tools = ((request.body ?? {}) as { tools?: Block[] }).tools ?? [];
  const description = tools.find((t) => t.name === "lophn")?.description ?? "";
  const at = description.indexOf("\nCommands:\n");
  if (at < 0) return [];
  return description
    .slice(at + "\nCommands:\n".length)
    .split("\n")
    .map((line) => line.split(" - ")[0]);
}

type Block = { name?: string; description?: string };
