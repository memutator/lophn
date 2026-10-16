// 읽기 모드(편집기가 아닌 Markdown 읽기 화면)에서 원문의 한 줄로 가는 규칙. 읽기 화면은 줄 번호를
// 모르므로 그 줄의 글을 화면 요소에서 찾고, 못 찾으면 줄이 문서 어디쯤인지로 scroll한다.
import { FLASH_MS } from "./line-flash.ts";

const BLOCKS = "h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td, th";

/** 원문 줄에서 markdown 표지를 걷어 읽기 화면에 보이는 글로 만든다. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s*)/, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}

/** 줄을 보이는 요소로 scroll하고 잠깐 표시한다. 표시는 `data-hit`이다. */
export function revealInReading(
  article: HTMLElement,
  scroller: HTMLElement,
  source: string,
  line: number,
): void {
  const lines = source.split("\n");
  const wanted = plainLine(
    lines[Math.min(Math.max(1, line), lines.length) - 1] ?? "",
  );
  const found = wanted.length < 2
    ? undefined
    : [...article.querySelectorAll(BLOCKS)]
      .find((element) => (element.textContent ?? "").includes(wanted));
  if (found instanceof HTMLElement) {
    const top = found.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 3);
    found.setAttribute("data-hit", "");
    setTimeout(() => found.removeAttribute("data-hit"), FLASH_MS);
    return;
  }
  scroller.scrollTop = Math.max(
    0,
    (scroller.scrollHeight * (line - 1)) / lines.length -
      scroller.clientHeight / 3,
  );
}
