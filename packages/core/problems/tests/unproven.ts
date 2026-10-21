// app test가 pass 이유 끝에 붙이는 한 줄이다(`app-test/judge.ts`). 증명 못 한 tool이 없으면 빈 문자열이다.
const NOTE_HEAD = ". 증명 못 한 write tool: ";
const NOTE_TAIL = "(만든 입력의 호출이 실패했다)";

export function unprovenNote(tools: readonly string[]): string {
  return tools.length === 0
    ? ""
    : `${NOTE_HEAD}${tools.join(", ")}${NOTE_TAIL}`;
}
