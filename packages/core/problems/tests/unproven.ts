// examples run이 끝난 뒤 앱의 problem으로 알릴 "되돌리기를 증명 못 한 write tool"을 구한다.
// 같은 (app, bundle_hash) app test가 만든 입력으로 증명하지 못한 tool에서 이 examples가 되돌리기까지 증명한
// tool을 뺀 것이다. 입력은 모두 호출하는 쪽이 읽어 넘기는 값이라 순수 함수다.

export const UNPROVEN_PROBLEM = "rewind_unproven";

// app test가 pass 이유 끝에 붙이는 한 줄이다(`app-test/judge.ts`). 쓰는 쪽과 읽는 쪽(`unprovenOfReason`)이 한
// 파일에 있어 어긋나지 않는다. 증명 못 한 tool이 없으면 빈 문자열이다.
const NOTE_HEAD = ". 증명 못 한 write tool: ";
const NOTE_TAIL = "(만든 입력의 호출이 실패했다)";

export function unprovenNote(tools: readonly string[]): string {
  return tools.length === 0
    ? ""
    : `${NOTE_HEAD}${tools.join(", ")}${NOTE_TAIL}`;
}

// pass 이유에서 증명 못 한 tool 이름을 꺼낸다. 한 줄이 없으면 없다.
export function unprovenOfReason(reason: string): string[] {
  const at = reason.lastIndexOf(NOTE_HEAD);
  if (at < 0 || !reason.endsWith(NOTE_TAIL)) return [];
  return reason.slice(at + NOTE_HEAD.length, -NOTE_TAIL.length).split(", ");
}

// appTestUnproven가 undefined면 같은 bundle의 통과한 app test가 없다. examples가 pass가 아니면 증명한 것이
// 없다. inconclusive는 아무것도 알지 못한 run이라 알리지 않는다.
export function unprovenAfterExamples(input: {
  appTestUnproven: readonly string[] | undefined;
  examples: { result: "pass" | "fail" | "inconclusive"; proven: string[] };
}): string[] {
  const { appTestUnproven, examples } = input;
  if (appTestUnproven === undefined || examples.result === "inconclusive") {
    return [];
  }
  const proven = new Set(examples.result === "pass" ? examples.proven : []);
  return appTestUnproven.filter((tool) => !proven.has(tool));
}

export function unprovenMessage(tools: readonly string[]): string {
  return `${
    tools.join(", ")
  }: 만든 입력의 호출이 실패하고 ticket examples도 그 write를 부르지 않아 되돌리기를 증명하지 못했다`;
}
