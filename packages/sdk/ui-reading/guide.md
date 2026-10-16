# @lophn/ui-reading

## 목적

문서를 읽는 화면의 Markdown 본문·목차 tree·code block이다. Markdown·code
block·목차와 읽기 틀은 lophn 문서 화면과 같은 component이고 시각 값의 정본은
shell/design-system이다.

## 공개 API와 type

```tsx
import { Markdown, parseMarkdown, ReadingFrame, Toc } from "@lophn/ui-reading";
```

- `Markdown({source, onOpenLink?, clipboard?})` — CommonMark·GFM 본문을 그린다.
  raw HTML과 script는 실행하지 않고 글로 보인다. 허용하지 않은 주소의
  link·image는 글로만 보인다. `onOpenLink`가 있으면 link를 창 안에서 따라가지
  않고 앱이 연다(앱 view의 바깥 link는 `lophnApp.openExternal`).
- `parseMarkdown(source)` — `{blocks, outline}`. `outline`은 제목의
  `id`·`title`· `level`이고 `Toc`에 그대로 준다. 본문 제목의 `id`와 같다.
- `Toc({items, activeId?, onSelect})` — 목차 tree. 3단(`TOC_MAX_LEVEL`)까지
  단계만큼 들여 쓴다. `ReadingFrame` 안에서는 칸이 넓으면 본문 옆 목록, 좁으면
  머리의 선택 칸으로 그린다.
- `CodeBlock({code, language?, clipboard?})` — code 한 덩이와 [Copy code].
  code는 글로만 넣어 실행하지 않는다.
- `ReadingFrame({width, header?, toc?, children})` — 읽기 폭(`READING_WIDTHS`:
  narrow·default·wide)과 목차 자리를 정하는 읽기 틀이다.
- `systemClipboard`, type `Clipboard` — 복사에 쓰는 clipboard다. 테스트가 바꿔
  끼운다.
- type: `MarkdownProps`, `MarkdownDocument`, `Block`, `Inline`, `OutlineItem`,
  `ParseOptions`, `TocProps`, `CodeBlockProps`, `ReadingFrameProps`,
  `ReadingWidth`

## 요구 permission

없다. 복사는 사람이 누를 때만 OS clipboard에 쓴다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다.

| peer            | version |
| --------------- | ------- |
| `react`         | 19.3.0  |
| `lucide-react`  | 1.51.0  |
| `@lophn/tokens` | 1.0.0   |

## 예제

`examples/weekly-report.tsx`가 read command로 읽은 문서 하나를 목차·본문과 함께
보인다.

```tsx
import { Markdown, parseMarkdown, ReadingFrame, Toc } from "@lophn/ui-reading";

const outline = parseMarkdown(report.body).outline;

<ReadingFrame
  width="default"
  header={<h1>{report.title}</h1>}
  toc={<Toc items={outline} activeId={active} onSelect={setActive} />}
>
  <Markdown source={report.body} />
</ReadingFrame>;
```

문구는 앱의 message key로 준다.

## version 정책

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 component·prop 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
