// Kit · reading. @lophn/ui/reading의 Markdown·CodeBlock·Toc·DiffMark와 예제(weekly-report).
import { CodeBlock, DiffMark, Markdown, Toc } from "@lophn/ui/reading";

import { WeeklyReport } from "./weekly-report.tsx";
import { Example, kit, Page, Row, Section } from "../kit.tsx";

const CLIPBOARD = { writeText: () => Promise.resolve() };
const NOOP = () => {};
const TWO_LINES = ["orders show A-1001", "orders list --late"].join("\n");

// 제목·목록·표·code·link와 raw HTML을 한 글에 담는다. raw HTML은 실행되지 않고 글로 보인다.
const SOURCE = [
  "## Heading",
  "",
  "Text with **bold**, *italic*, `inline code` and a [link](https://example.com).",
  "",
  "- first item",
  "- second item",
  "",
  "| Item | Count |",
  "| --- | --- |",
  "| Orders | 12 |",
  "| Late | 2 |",
  "",
  "```sh",
  "orders show A-1001",
  "```",
  "",
  "<script>alert(1)</script>",
].join("\n");

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
        title="CodeBlock"
        note="code 조각 하나와 복사 단추. language는 글로만 보인다."
      >
        <Row label="with language">
          <CodeBlock
            code={TWO_LINES}
            language="sh"
            clipboard={CLIPBOARD}
          />
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
