// build_test가 @lophn/design/components와 @lophn/design/reading을 renderer bundle로 묶는지 보는 entry다.
import { createRoot } from "react-dom/client";
import {
  Button,
  Field,
  ReadingFrame,
  Select,
  Table,
} from "@lophn/design/components";
import { Markdown, Toc } from "@lophn/design/reading";
import { t } from "@lophn/wording";

export function mount(element: HTMLElement): void {
  createRoot(element).render(
    <ReadingFrame
      width="default"
      toc={<Toc items={[]} onSelect={() => {}} />}
    >
      <Field label={t("common.button.reload")}>
        <Select options={[]} />
        <Button>{t("common.button.reload")}</Button>
      </Field>
      <Markdown source="" />
      <Table
        columns={[]}
        rows={[]}
        rowKey={String}
        now={new Date(0)}
      />
    </ReadingFrame>,
  );
}
