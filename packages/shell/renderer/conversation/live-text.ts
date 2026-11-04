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
