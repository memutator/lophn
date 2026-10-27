// Kit · reading. @lophn/ui/reading의 Markdown·CodeBlock·Toc·DiffMark와 예제(weekly-report).
import {
  CodeBlock,
  type CodeLine,
  DiffMark,
  type Highlighter,
  HighlighterProvider,
  Markdown,
  Toc,
} from "@lophn/ui/reading";

import { WeeklyReport } from "./weekly-report.tsx";
import { Example, kit, Page, Row, Section } from "../kit.tsx";

const CLIPBOARD = { writeText: () => Promise.resolve() };
const NOOP = () => {};
const TWO_LINES = ["orders show A-1001", "orders list --late"].join("\n");

// gallery는 Shiki를 싣지 않는다. 고정한 token으로 highlighter가 준 색만 본다.
const HIGHLIGHTED_LINES: readonly CodeLine[] = [
  [
    {
      text: "// orders that arrived late",
      color: "var(--code-token-comment)",
      italic: true,
    },
  ],
  [
    { text: "export ", color: "var(--code-token-keyword)" },
    { text: "function ", color: "var(--code-token-keyword)" },
    { text: "lateOrders", color: "var(--code-token-function)" },
    { text: "(", color: "var(--code-token-punctuation)" },
    { text: "orders", color: "var(--code-token-parameter)" },
    { text: ")", color: "var(--code-token-punctuation)" },
    { text: " {", color: "var(--code-token-punctuation)" },
  ],
  [
    { text: "  const ", color: "var(--code-token-keyword)" },
    { text: "limit", color: "var(--code-token-parameter)" },
    { text: " = ", color: "var(--code-token-punctuation)" },
    { text: "12", color: "var(--code-token-constant)" },
    { text: ";", color: "var(--code-token-punctuation)" },
  ],
  [
    { text: "  return ", color: "var(--code-token-keyword)" },
    { text: "orders", color: "var(--code-token-parameter)" },
    {
      text: ".filter((order) => order.status === ",
      color: "var(--code-token-punctuation)",
    },
    { text: '"late"', color: "var(--code-token-string)" },
    { text: ");", color: "var(--code-token-punctuation)" },
  ],
];
const HIGHLIGHTED_CODE = HIGHLIGHTED_LINES.map((line) =>
  line.map((token) => token.text).join(""),
).join("\n");
const HIGHLIGHTER: Highlighter = {
  highlight: () => Promise.resolve(HIGHLIGHTED_LINES),
};

// 제목·목록·task list·넓은 표·code·link와 raw HTML을 한 글에 담는다. raw HTML은 실행되지 않고 글로 보인다.
const SOURCE = [
  "## Heading",
  "",
  "Text with **bold**, *italic*, `inline code` and a [link](https://example.com).",
  "",
  "- first item",
  "- second item",
  "- [x] checked item",
  "- [ ] unchecked item",
  "",
  "| Item | Count | Owner | Last change | Status | Reference | Report | Notes |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| Orders | 12 | Mina Park | 2026-10-19 | open | domains/dom_01j9m3x2k7/artifacts/spending/index.html | reports/2026/10/orders-by-carrier.csv | Waiting for the warehouse count to settle |",
  "| Late | 2 | Jonas Lee | 2026-10-18 | review | domains/dom_01j9m3x2k7/artifacts/tax-deadlines/index.html | reports/2026/10/late-shipments-by-carrier.csv | Two carriers reported a delay on the same day |",
  "",
  "```ts title=app.ts",
  "const total = 12;",
  "```",
  "",
  "<script>alert(1)</script>",
].join("\n");

// 같은 글에 image를 더한다. chat은 image를 불러오지 않고 alt 글의 link로 그린다.
const CHAT_SOURCE = `${SOURCE}\n\n![chart](https://example.com/chart.png)`;

const OUTLINE = [
  { id: "summary", title: "Summary", level: 2 },
  { id: "late", title: "Late shipments", level: 2 },
  { id: "check", title: "How to check one", level: 3 },
];

export function KitReading() {
  return (
    <Page>
      <Section
        title="Markdown"
        note="글로 읽는 문서를 그린다. raw HTML은 실행하지 않고 글로 보인다."
      >
        <div className={kit.panel}>
          <Markdown source={SOURCE} clipboard={CLIPBOARD} onOpenLink={NOOP} />
        </div>
      </Section>
      <Section
        title="Markdown · chat"
        note="대화 글은 body 14/22와 좁은 간격으로 그린다. image는 불러오지 않고 alt 글의 link로 둔다."
      >
        <div className={kit.panel}>
          <Markdown
            source={CHAT_SOURCE}
            variant="chat"
            images="link"
            clipboard={CLIPBOARD}
            onOpenLink={NOOP}
          />
        </div>
      </Section>
      <Section
        title="CodeBlock"
        note="code 조각 하나와 복사 단추. language는 글로만 보인다. highlighter가 있으면 token 색으로 그린다."
      >
        <Row label="with language">
          <CodeBlock code={TWO_LINES} language="sh" clipboard={CLIPBOARD} />
        </Row>
        <Row label="highlighted">
          <HighlighterProvider value={HIGHLIGHTER}>
            <CodeBlock
              code={HIGHLIGHTED_CODE}
              language="ts"
              clipboard={CLIPBOARD}
            />
          </HighlighterProvider>
        </Row>
        <Row label="no language">
          <CodeBlock
            code="plain text without a language"
            clipboard={CLIPBOARD}
          />
        </Row>
      </Section>
      <Section
        title="Toc"
        note="두 단계 제목을 들여 쓴다. 지금 읽는 제목에 표시를 한다."
      >
        <div className={kit.panel}>
          <Toc items={OUTLINE} activeId="late" onSelect={NOOP} />
        </div>
      </Section>
      <Section title="DiffMark" note="색 없이도 + 와 −로 구별한다.">
        <div className={kit.row}>
          <DiffMark kind="add" />
          <DiffMark kind="delete" />
        </div>
      </Section>
      <Section
        title="weekly-report"
        note="목차와 문서 주소가 있는 읽기 틀로 주간 보고서를 그린다."
      >
        <Example>
          <WeeklyReport />
        </Example>
      </Section>
    </Page>
  );
}
