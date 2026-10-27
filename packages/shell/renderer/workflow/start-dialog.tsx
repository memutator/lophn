// [Start]가 여는 dialog. 입력 글(필수)과 시작할 step(기본은 첫 step)을 받는다. flow는 입력 글만 받는다.
// 시작이 실패하면 열어 둔 채로 입력을 지키고(알림은 탭 위쪽 toast), 성공하면 닫는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Select, Textarea } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { WorkflowEntryView } from "../workspace/source.ts";
import styles from "./start-dialog.module.css";

export function StartDialog({
  entry,
  onCancel,
  onStart,
}: {
  entry: WorkflowEntryView;
  onCancel: () => void;
  /** 성공하면 true. 이 dialog를 닫는 것은 부른 쪽이다. */
  onStart: (text: string, step: string | undefined) => Promise<boolean>;
}) {
  const isFlow = entry.kind === "flow";
  const steps = entry.steps ?? [];
  const [text, setText] = useState("");
  const [step, setStep] = useState(steps[0]?.name ?? "");
  const [starting, setStarting] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t("workflow.heading.start", { workflow: entry.name })}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={text.trim() === "" || starting}
            onClick={() => {
              setStarting(true);
              void onStart(text, isFlow ? undefined : step).finally(() =>
                setStarting(false),
              );
            }}
          >
            {t("workflow.button.start")}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <Field
          label={t("workflow.label.input")}
          help={t(
            isFlow
              ? "workflow.note.input-help-flow"
              : "workflow.note.input-help",
          )}
        >
          <Textarea
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        {isFlow ? null : (
          <Field label={t("workflow.label.first-step")}>
            <Select
              value={step}
              onValueChange={setStep}
              options={steps.map((item) => ({
                value: item.name,
                label: item.name,
              }))}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
