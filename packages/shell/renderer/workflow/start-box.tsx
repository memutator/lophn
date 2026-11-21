// workflow 화면의 새 run 칸. 입력 글을 적고 [Start]를 누르면 run이 시작된다. flow는 입력 글만 받고,
// step이 여럿인 agent workflow는 시작할 step을 고를 수 있다(기본은 첫 step).
// 시작이 실패하면 적은 글을 지키고(알림은 탭 위쪽 toast), 성공하면 비운다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Select, Textarea } from "@lophn/ui/input";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { actionIcons } from "../icons/mod.ts";
import type { WorkflowEntryView } from "../workspace/source.ts";
import styles from "./start-box.module.css";

export function StartBox({
  entry,
  onStart,
}: {
  entry: WorkflowEntryView;
  /** 성공하면 true. */
  onStart: (text: string, step: string | undefined) => Promise<boolean>;
}) {
  const isFlow = entry.kind === "flow";
  const steps = entry.steps ?? [];
  const [text, setText] = useState("");
  const [step, setStep] = useState(steps[0]?.name ?? "");
  const [starting, setStarting] = useState(false);
  const ready = entry.startable && text.trim() !== "" && !starting;
  const start = () => {
    if (!ready) return;
    setStarting(true);
    void onStart(text, isFlow ? undefined : step)
      .then((started) => {
        if (started) setText("");
      })
      .finally(() => setStarting(false));
  };
  const button = (
    <Button
      variant="primary"
      icon={actionIcons.run}
      disabled={!ready}
      onClick={start}
      data-start=""
    >
      {t("workflow.button.start")}
    </Button>
  );
  return (
    <section className={styles.box} data-start-box="">
      <Field
        label={t("workflow.label.new-run")}
        help={t(
          isFlow ? "workflow.note.input-help-flow" : "workflow.note.input-help",
        )}
      >
        <Textarea
          rows={3}
          value={text}
          disabled={!entry.startable}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              start();
            }
          }}
        />
      </Field>
      <div className={styles.row}>
        {isFlow || steps.length < 2 ? null : (
          <div className={styles.step}>
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
          </div>
        )}
        <span className={styles.actions}>
          {entry.startable ? (
            button
          ) : (
            <Tooltip content={entry.problem?.message ?? ""}>
              <span className={styles.tipTarget} tabIndex={0} data-start-tip="">
                {button}
              </span>
            </Tooltip>
          )}
        </span>
      </div>
    </section>
  );
}
