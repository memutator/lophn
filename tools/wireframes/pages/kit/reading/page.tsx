// Kit · reading. @lophn/ui/reading의 DiffMark와 예제(weekly-report).
import { DiffMark } from "@lophn/ui/reading";

import { WeeklyReport } from "./weekly-report.tsx";
import { Example, kit, Page, Section } from "../kit.tsx";

export function KitReading() {
  return (
    <Page>
      <Section title="DiffMark">
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
