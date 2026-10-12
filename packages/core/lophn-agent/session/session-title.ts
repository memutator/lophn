import { err, ok, type Result } from "../../../base/mod.ts";
import {
  SESSION_AUTO_TITLE_MAX,
  sessionTitleSchema,
} from "../../../protocol/lophn-agent/mod.ts";

// session 제목 만들기(domain model lophn-agent/conversation Session.title).
// 순수 함수이며 저장·redaction·event는 command가 한다.
//
// 글자는 사람이 보는 글자(grapheme cluster)다: 결합 문자나 이모지 묶음을 중간에서 자르지 않는다.
// 길이 규칙은 contracts의 `sessionTitleSchema`(rename 120자 `SESSION_RENAME_TITLE_MAX`)와
// `SESSION_AUTO_TITLE_MAX`(자동 60자)를 따른다.

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

// 줄바꿈 문자를 포함한 공백 묶음(앞뒤 공백 포함)이다.
const LINE_BREAK_RUN = /\s*(?:[\n\r]|\p{Zl}|\p{Zp})\s*/gu;

function firstGraphemes(text: string, max: number): string {
  let head = "";
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (count === max) break;
    head += segment;
    count += 1;
  }
  return head;
}

// 첫 사람 request 본문의 앞 60자로 자동 제목을 만든다.
//
// 1. 줄바꿈(CRLF·LF·CR·U+2028·U+2029)을 포함하는 연속 공백은 공백 하나로 바꾼다.
//    줄바꿈이 없는 공백은 그대로 둔다.
// 2. 앞뒤 공백을 뺀다.
// 3. 앞 60자(글자)를 자른다. 자른 자리가 공백이면 끝 공백을 뺀다.
//
// 뺀 뒤 남은 글이 없으면(빈 본문·공백뿐) null이다. 번호 이름("Conversation N")은 만들지 않는다.
export function autoSessionTitle(text: string): string | null {
  const flat = text.replace(LINE_BREAK_RUN, " ").trim();
  const title = firstGraphemes(flat, SESSION_AUTO_TITLE_MAX).trimEnd();
  return title === "" ? null : title;
}

// 사람의 rename. 앞뒤 공백을 뺀 글이 비었거나 120자를 넘으면 `invalid_input`이다. 통과하면
// 앞뒤 공백을 뺀 글을 돌려준다. 안쪽 글은 바꾸지 않는다.
export function renameSessionTitle(text: string): Result<string> {
  const title = text.trim();
  if (!sessionTitleSchema.safeParse(title).success) {
    return err({
      code: "invalid_input",
      message: "a session title must be 1 to 120 characters and not blank",
    });
  }
  return ok(title);
}

// 사람의 request 하나를 접수할 때 session 제목이 어떻게 되는지.
//
// 자동 제목은 첫 사람 request를 접수하는 transaction에서 제목이 null일 때만 정한다.
// 이미 제목이 있으면(자동이든 rename이든) 다시 정하지 않고, correction은 정하지 않으며,
// 첫 request가 아니면 정하지 않는다. 본문에서 제목이 나오지 않으면 null을 유지한다.
export function titleOnReceive(input: {
  title: string | null;
  first_request: boolean;
  mode: "request" | "correction";
  text: string;
}): string | null {
  if (
    input.title !== null || input.mode !== "request" || !input.first_request
  ) {
    return input.title;
  }
  return autoSessionTitle(input.text);
}
