// 앱 화면 예: 앱이 읽어 온 문서 하나를 주소·목차·Markdown 본문과 함께 읽는다.
import { useMemo, useState } from "react";
import {
  type Clipboard,
  DocumentAddress,
  Markdown,
  parseMarkdown,
  ReadingFrame,
  Toc,
} from "@lophn/ui-reading";
import styles from "./weekly-report.module.css";

// 앱의 read command가 돌려준 문서다. 본문은 사람이나 agent가 쓴 Markdown이다.
export const REPORT = {
  title: "Weekly report",
  address: "mahas/weekly-report#summary@3",
  body: [
    "## Summary",
    "",
    "Orders grew **12%** this week. Two shipments are late.",
    "",
    "## Late shipments",
    "",
    "- A-1001 waits for the carrier.",
    "- A-1007 needs a new address.",
    "",
    "### How to check one",
    "",
    "```sh",
    "orders show A-1001",
    "```",
    "",
    "## Next week",
    "",
    "Follow up with the carrier on Monday.",
  ].join("\n"),
};

export function WeeklyReport(
  { clipboard }: { clipboard?: Clipboard },
) {
  const outline = useMemo(() => parseMarkdown(REPORT.body).outline, []);
  const [active, setActive] = useState(outline[0]?.id);
  const header = (
    <div className={styles.header}>
      <h1 className={styles.title}>{REPORT.title}</h1>
      <DocumentAddress address={REPORT.address} clipboard={clipboard} />
    </div>
  );
  return (
    <ReadingFrame
      width="default"
      header={header}
      toc={
        <Toc
          items={outline}
          activeId={active}
          onSelect={(id) => {
            setActive(id);
            document.getElementById(id)?.scrollIntoView({ block: "start" });
          }}
        />
      }
    >
      <Markdown source={REPORT.body} clipboard={clipboard} />
    </ReadingFrame>
  );
}
