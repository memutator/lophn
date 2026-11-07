// 쓰는 중인 글의 꼬리를 그리기 전에 다듬는다. 글이 더 오면 다르게 그려질 조각을 미리 숨겨 화면이 흔들리지 않게 한다.
// 닫히지 않은 `**`·`` ` ``·`$`·`$$`는 parser가 이미 글 그대로 두므로(닫혀야 강조·code·수식이 된다) 여기서 건드리지 않는다.
// 열린 code fence는 부르는 쪽이 먼저 닫는다(closeOpenFence). fence 안이면 이 함수는 글을 그대로 둔다.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;
// 쓰다 만 마지막 줄: marker만 있는 제목·목록 줄.
const MARKER_ONLY = /^ {0,3}(?:#{1,6}|[-*+]|\d{1,9}[.)]?)$/;
const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
// 구분 줄이 쓰이는 중인 모양(`|`, `|--`, `| :-`).
const DELIMITER_PARTIAL = /^[\s|:-]+$/;

function insideFence(lines: readonly string[]): boolean {
  let fence: string | null = null;
  for (const line of lines) {
    const mark = FENCE_LINE.exec(line)?.[1];
    if (mark === undefined) continue;
    if (fence === null) fence = mark;
    else if (
      line.trim() === mark &&
      mark[0] === fence[0] &&
      mark.length >= fence.length
    )
      fence = null;
  }
  return fence !== null;
}

// 표는 구분 줄이 끝나야 표다. 그 전의 줄은 `|`가 섞인 문단으로 보이므로 숨긴다.
function tableHoldStart(lines: readonly string[], end: number): number {
  let start = end;
  while (start > 0 && lines[start - 1]!.includes("|")) start -= 1;
  if (start === end) return end;
  if (start + 1 >= end) {
    return lines[start]!.trimStart().startsWith("|") ? start : end;
  }
  const second = lines[start + 1]!;
  // 구분 줄은 줄바꿈까지 받은 뒤에야 끝난 것이다.
  if (DELIMITER_ROW.test(second) && start + 1 < lines.length - 1) return end;
  return DELIMITER_PARTIAL.test(second) ? start : end;
}

export function presentStreamingTail(text: string): string {
  if (text === "") return text;
  const lines = text.split("\n");
  if (insideFence(lines)) return text;
  let end = lines.length;
  if (MARKER_ONLY.test(lines[end - 1]!)) end -= 1;
  end = tableHoldStart(lines, end);
  let kept = end === lines.length ? text : lines.slice(0, end).join("\n");
  // 주소를 쓰는 중인 link는 글만 보인다.
  kept = kept.replace(/(?<!!)\[([^\]\n]*)\]\([^)\n]*$/, "$1");
  // `**bold*`의 마지막 `*`는 닫는 `**`의 앞 절반이다. 그대로 두면 잠깐 기울임으로 그려진다.
  const closer = /[^\s*_~]([*_~])$/.exec(kept)?.[1];
  if (closer !== undefined) {
    const paragraph = kept
      .slice(kept.lastIndexOf("\n\n") + 1, -1)
      .replace(/`[^`]*`/g, "");
    const pairs = paragraph.split(closer + closer).length - 1;
    if (pairs % 2 === 1) kept = kept.slice(0, -1);
  }
  return kept;
}
