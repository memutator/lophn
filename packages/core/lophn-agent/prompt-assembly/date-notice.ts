import { noticeInput } from "./input-tags.ts";
import type { HistoryMessage } from "./model.ts";

// model이 오늘 날짜를 알게 하는 notice. system prompt에 두면 날짜가 바뀔 때 tools·system 전체의 prompt cache가
// 깨지므로 turn 이력(사람 요청 바로 뒤)에 덧붙인다. 이력은 다음 turn에도 같은 bytes로 이어져 cache가 맞는다.
// 이미 보낸 날짜를 따로 저장하지 않고 이력에서 읽는다: 재기동·resume·Compact 뒤에도 이력이 곧 model이 아는 것이다.
// 시각(시·분)은 싣지 않는다: 매 turn 글이 붙고, 정확한 시각이 필요하면 shell로 읽을 수 있다.

const DATE_LINE =
  /Today's date is (\d{4}-\d{2}-\d{2}) \(time zone ([^)\n]+)\)/g;

export function localDate(ms: number, timeZone: string): string {
  // en-CA는 YYYY-MM-DD 모양을 낸다.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

function lastDateLine(
  history: readonly HistoryMessage[],
): { date: string; zone: string } | null {
  let last: { date: string; zone: string } | null = null;
  for (const message of history) {
    if (message.role !== "user") continue;
    for (const part of message.parts) {
      if (part.kind !== "text") continue;
      for (const match of part.text.matchAll(DATE_LINE)) {
        last = { date: match[1]!, zone: match[2]! };
      }
    }
  }
  return last;
}

// 이력이 마지막으로 알린 날짜·time zone과 지금이 같으면 null이다. 처음이거나 바뀌었으면 notice 글이다.
export function dateNotice(input: {
  history: readonly HistoryMessage[];
  now_ms: number;
  time_zone: string;
}): string | null {
  const date = localDate(input.now_ms, input.time_zone);
  const last = lastDateLine(input.history);
  if (last !== null && last.date === date && last.zone === input.time_zone) {
    return null;
  }
  const line = `Today's date is ${date} (time zone ${input.time_zone}).`;
  return noticeInput({
    kind: "date",
    body: last === null ? line : `The date changed. ${line}`,
  });
}
