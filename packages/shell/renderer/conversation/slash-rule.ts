// 입력칸에 친 `/이름 인자`를 무엇으로 하는지. desktop composer와 폰 대화가 같은 규칙을 쓰도록 DOM 없이 둔다.
// 명령 목록과 거르기는 `slashListOf`(agent-view-model.ts), composer 안 상태(model·effort·mode)는 `runComposerCommand`다.
import type { AcpCommandOpens } from "../../../protocol/acp/mod.ts";
import type { SlashEntryView } from "./slash-menu/types.ts";

/** 입력 글자가 `/`로 시작하고 공백이 아직 없으면 명령을 고르는 중이다. 그 뒤의 글자를 돌려준다. */
export function slashQuery(text: string): string | null {
  return text.startsWith("/") && !/\s/.test(text) ? text.slice(1) : null;
}

/** `/이름 인자`를 나눈다. `/`로 시작하지 않으면 null이다. `spaced`는 이름 뒤에 공백을 쳤다(인자를 쓰는 중)는 뜻이다. */
export function parseSlash(
  text: string,
): { name: string; spaced: boolean; argument: string } | null {
  const match = /^\/(\S*)(\s*)([\s\S]*)$/.exec(text);
  if (match === null) return null;
  return { name: match[1]!, spaced: match[2]! !== "", argument: match[3]! };
}

/**
 * 제출한 `/…`이 고르는 명령. `entries`는 이름으로 거른 목록의 보이는 순서다. 인자를 쳤으면 이름(없으면 별칭)이 같은
 * 것이다. 이름만 쳤으면 화살표로 고른 줄(`highlight`)이 우선이고, 고르지 않았으면(첫 줄) 이름이 꼭 맞는 명령이 이긴다.
 * `/status`는 설명에 "status"가 든 MCP가 첫 줄이라 MCP가 돌던 일이 있다.
 */
export function chooseSlash(
  entries: readonly SlashEntryView[],
  name: string,
  spaced: boolean,
  highlight = 0,
): SlashEntryView | undefined {
  const exact =
    entries.find((entry) => entry.name === name) ??
    entries.find((entry) => entry.alias === name);
  if (spaced) return exact;
  return highlight === 0 ? (exact ?? entries[0]) : entries[highlight];
}

/**
 * 명령이 하는 화면 동작. 이름은 해석하지 않고 `opens`만 본다. null이면 화면 동작이 없거나 인자를 CLI가 받는 명령이라
 * `run_command`로 보내고 출력은 대화의 명령 출력 줄로 온다. rename과 goal은 인자가 있어도 화면이 받는다.
 */
export function slashScreenOf(
  entry: Pick<SlashEntryView, "opens" | "argumentHint">,
  argument: string,
): AcpCommandOpens | null {
  const { opens } = entry;
  const sendsArgument =
    argument !== "" &&
    entry.argumentHint !== null &&
    opens !== "rename" &&
    opens !== "goal";
  return sendsArgument ? null : opens;
}
