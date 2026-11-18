// PTY 출력에서 program이 OSC 0·2로 낸 터미널 제목을 읽는다. 제목을 창의 xterm이 읽으면 그 탭을 그린 창만 알고
// 창이 다시 뜨면 잊는다. core가 읽어 runtime에 실으면 탭을 그리지 않은 창도, 다시 뜬 창도 같은 이름을 안다.

// agent TUI가 제목 앞에 붙이는 상태 글리프: braille spinner, 반원 spinner, Claude의 ✳, ASCII `* `·`. `.
// spinner 한 프레임이 제목에 남아도(herdr #5358) 이름이 흔들리지 않게 앞에서 걷어 낸다.
const STATUS_PREFIX = /^(?:[⠀-⣿◐-◓✳]\s*|[*.]\s+)+/;

/** 터미널 제목에서 앞의 상태 글리프를 뗀 이름. harness별 손질은 하지 않는다. */
export function stripStatusGlyphs(title: string): string {
  return title.replace(STATUS_PREFIX, "").trim();
}

const ESC = "\x1b";
const BEL = "\x07";
const OSC_START = `${ESC}]`;
// 끝나지 않은 OSC를 다음 chunk까지 들고 있는 상한. 넘으면 제목이 아니라고 보고 버린다.
const CARRY_MAX = 4096;

/**
 * chunk를 차례로 받아 그 안에서 마지막으로 완성된 제목(`ESC ] 0|2 ; 글 (BEL | ESC \)`)을 준다(없으면 null).
 * chunk 경계에 걸친 OSC는 이어 읽는다.
 */
export function createTitleScanner(): (chunk: string) => string | null {
  let carry = "";
  return (chunk) => {
    const text = carry + chunk;
    carry = "";
    let last: string | null = null;
    let at = 0;
    for (;;) {
      const open = text.indexOf(OSC_START, at);
      if (open < 0) break;
      const bel = text.indexOf(BEL, open + 2);
      const st = text.indexOf(`${ESC}\\`, open + 2);
      const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);
      if (end < 0) {
        // 끝이 아직 안 왔다. 다음 chunk와 이어 읽는다.
        if (text.length - open <= CARRY_MAX) carry = text.slice(open);
        return last;
      }
      const body = text.slice(open + 2, end);
      if (body.startsWith("0;") || body.startsWith("2;")) last = body.slice(2);
      at = end + 1;
    }
    // OSC를 여는 ESC만 chunk 끝에 걸렸다.
    if (text.endsWith(ESC)) carry = ESC;
    return last;
  };
}
