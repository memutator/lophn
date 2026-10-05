// 문서 읽기·편집 화면의 순수 규칙. 화면은 이 값을 그대로 그린다.

/** 본문 page 하나에서 이어 붙일 때 쓰는 것. */
export interface BodyPage {
  readonly text: string;
  readonly ranges: readonly { start_line: number; end_line: number }[];
}

export interface JoinedBody {
  readonly text: string;
  /** 지금까지 읽은 마지막 줄. 다음 page가 같은 줄에서 이어지는지 본다. */
  readonly lastLine: number | null;
}

/**
 * documents.read page를 이어 붙인다. page 안 줄은 "\n"으로 붙어 온다. 긴 한 줄이 page
 * 경계에서 잘리면 다음 page는 같은 줄에서 이어지므로 줄바꿈 없이 붙인다.
 */
export function joinPage(previous: JoinedBody | null, page: BodyPage): JoinedBody {
  const first = page.ranges[0]?.start_line ?? null;
  const last = page.ranges.at(-1)?.end_line ?? previous?.lastLine ?? null;
  if (previous === null) return { text: page.text, lastLine: last };
  if (page.ranges.length === 0) return previous;
  const sameLine = previous.lastLine !== null && first === previous.lastLine;
  return {
    text: `${previous.text}${sameLine ? "" : "\n"}${page.text}`,
    lastLine: last,
  };
}

/** 상대 경로의 마지막 이름. */
export function fileNameOf(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  return parts.at(-1) ?? path;
}

export interface HeadingTop {
  readonly title: string;
  /** scroll 칸 안 위치(px). */
  readonly top: number;
}

export interface StickyHead {
  readonly shown: boolean;
  /** 지금 읽는 절의 제목. 첫 절 위면 null이다. */
  readonly section: string | null;
}

/**
 * 문서 제목이 scroll 칸 위로 사라지면 32px sticky 머리를 붙이고 지금 절을 보인다
 * (shell/editor#R4). 지금 절은 sticky 머리 아래 선을 넘은 마지막 제목이다.
 */
export function stickyHead(
  titleBottom: number,
  scrollTop: number,
  headings: readonly HeadingTop[],
  headHeight: number,
): StickyHead {
  const shown = scrollTop >= titleBottom;
  if (!shown) return { shown: false, section: null };
  const line = scrollTop + headHeight;
  let section: string | null = null;
  for (const heading of headings) {
    if (heading.top <= line) section = heading.title;
    else break;
  }
  return { shown, section };
}

/**
 * 링크 주소에서 documents/addressing의 address 모양(place/document[#section][@n])만 고른다.
 * 외부 URL과 상대 파일 경로는 문서 주소가 아니다.
 */
export function documentAddress(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:#[^#@]+)?(?:@[1-9][0-9]*)?$/
      .test(href)
    ? href
    : null;
}
