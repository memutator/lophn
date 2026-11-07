// 쓰는 중인 글을 그릴 때 쓰는 code fence 규칙. 글 자체는 ACP의 `writing`이고 접는 일은 `reduceAcp`가 한다.
// 0~3개 공백 뒤의 fence 시작이다. 연 fence는 끝까지 같은 문자로만 닫힌다.
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

export interface OpenFence {
  /** 연 fence의 문자와 길이. */
  readonly fence: string;
  /** fence 정보줄 다음 글자의 위치. 여기부터가 code다. */
  readonly contentAt: number;
}

/**
 * 닫히지 않은 code fence. 쓰는 중인 글은 fence 가운데에서 끊기므로 그릴 때 이 자리를 알아야 한다.
 * fence가 닫혔으면 null이다.
 */
export function openFence(text: string): OpenFence | null {
  let open: OpenFence | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    const fence = FENCE_LINE.exec(line)?.[1] ?? null;
    if (fence !== null) {
      if (open === null) {
        open = { fence, contentAt: offset + line.length + 1 };
      } else {
        const closes =
          line.trim() === fence &&
          fence[0] === open.fence[0] &&
          fence.length >= open.fence.length;
        if (closes) open = null;
      }
    }
    offset += line.length + 1;
  }
  return open;
}

/**
 * 그릴 때만 쓰는 규칙: 닫히지 않은 code fence를 글 끝에서 닫는다. 그대로 그리면 code block이 아니게 된다.
 * 닫는 줄은 같은 문자를 연 길이 이상 쓰고 뒤에 공백만 둔다.
 */
export function closeOpenFence(text: string): string {
  const open = openFence(text);
  return open === null ? text : `${text}\n${open.fence}`;
}

/**
 * 닫히지 않은 fence 안의 code. 이 글은 아직 자라는 중이라 mermaid 같은 무거운 그리기를 미룬다.
 * fence가 닫혔으면 null이다.
 */
export function openFenceContent(text: string): string | null {
  const open = openFence(text);
  return open === null ? null : text.slice(open.contentAt);
}

// 빈 줄 뒤에 0칸 들여쓴 줄이 새 block을 연다. 목록 항목과 인용은 앞 block의 이어짐일 수 있어(느슨한 목록) 가르지 않는다.
const CONTINUES = /^(?:[-*+]\s|\d+[.)]\s|>)/;

// 링크 참조 정의·각주·$$는 떨어진 block을 묶는다. 이 글은 가르면 통째로 parse한 것과 달라지므로 가르지 않는다.
const SPANS_BLOCKS = /^ {0,3}(?:\[[^\]\n]+\]:|\$\$)|\[\^/m;

/**
 * 쓰는 중인 글을 끝난 block 묶음들과 아직 자라는 꼬리로 가른다. 끝난 묶음은 글이 자라도 바뀌지 않아 다시 parse하지
 * 않는다(긴 글을 delta마다 통째로 parse하면 글이 길수록 느려진다). code fence 안에서는 자르지 않으므로 열린 fence는
 * 늘 꼬리에 있다. block을 묶는 문법이 있으면 가르지 않고 전부 꼬리다. `done.join("") + tail`은 원문이다.
 */
export function splitLive(text: string): {
  readonly done: readonly string[];
  readonly tail: string;
} {
  if (SPANS_BLOCKS.test(text)) return { done: [], tail: text };
  const done: string[] = [];
  let from = 0;
  let offset = 0;
  let fence: string | null = null;
  let blank = false;
  for (const line of text.split("\n")) {
    const mark = FENCE_LINE.exec(line)?.[1] ?? null;
    if (
      fence === null &&
      blank &&
      offset > from &&
      line !== "" &&
      !/^\s/.test(line) &&
      !CONTINUES.test(line)
    ) {
      done.push(text.slice(from, offset));
      from = offset;
    }
    if (mark !== null) {
      if (fence === null) fence = mark;
      else if (
        line.trim() === mark &&
        mark[0] === fence[0] &&
        mark.length >= fence.length
      )
        fence = null;
    }
    blank = line.trim() === "";
    offset += line.length + 1;
  }
  return { done, tail: text.slice(from) };
}
