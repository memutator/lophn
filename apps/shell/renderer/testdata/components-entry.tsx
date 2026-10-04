// build_test가 @lophn/design/components를 renderer bundle로 묶는지 보는 entry다.
import { createRoot } from "react-dom/client";
import { Button, Field, Select } from "@lophn/design/components";
import { t } from "@lophn/wording";

export function mount(element: HTMLElement): void {
  createRoot(element).render(
    <Field label={t("common.button.reload")}>
      <Select options={[]} />
      <Button>{t("common.button.reload")}</Button>
    </Field>,
  );
}
