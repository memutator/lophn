// [Start]가 여는 dialog. 입력 글(필수)과 시작할 step(기본은 첫 step)을 받는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Select, Textarea } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";

import type { WorkflowEntry } from "../../../../packages/protocol/workflows/mod.ts";
import styles from "./workflow.module.css";

export function StartDialog(
  { entry, onCancel, onStart }: {
    entry: WorkflowEntry;
    onCancel: () => void;
    onStart: (text: string, step: string) => void;
  },
) {
  const steps = entry.steps ?? [];
  const [text, setText] = useState("");
  const [step, setStep] = useState(steps[0]?.name ?? "");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`Start ${entry.name}`}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={text.trim() === ""}
            onClick={() => onStart(text, step)}
          >
            Start
          </Button>
        </>
      }
    >
      <div className={styles.dialogFields}>
        <Field label="Input" help="What the first step should work on.">
          <Textarea
            rows={5}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Field label="First step">
          <Select
            value={step}
            onValueChange={setStep}
            options={steps.map((item) => ({
              value: item.name,
              label: item.name,
            }))}
          />
        </Field>
      </div>
    </Dialog>
  );
}
