// [Edit]의 dialog. 제목, 주기(숫자와 단위, 하루 단위일 때만 시각), 놓친 차례 정책만 고친다.
// 할 일(agent, 앱 tool, workflow)은 화면에서 고치지 않고 만든 agent에게 말한다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input, Select } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import { agentName, MISSED_OPTIONS } from "./model.ts";
import type { JobPatch, JobView, MissedPolicy } from "./source.ts";
import styles from "./jobs.module.css";

const UNITS = [
  { value: "m", label: "jobs.label.unit-minutes" },
  { value: "h", label: "jobs.label.unit-hours" },
  { value: "d", label: "jobs.label.unit-days" },
] as const;

export function EditDialog({
  job,
  onSave,
  onClose,
}: {
  job: JobView;
  onSave: (patch: Required<JobPatch>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(job.title);
  const [count, setCount] = useState(job.every.slice(0, -1));
  const [unit, setUnit] = useState(job.every.slice(-1));
  const [time, setTime] = useState(job.at ?? "09:00");
  const [missed, setMissed] = useState<string>(job.missed_policy);
  const valid =
    title.trim() !== "" &&
    /^[1-9][0-9]{0,4}$/.test(count) &&
    (unit !== "d" || time !== "");
  return (
    <Dialog
      open
      onOpenChange={(open) => open || onClose()}
      title={t("jobs.heading.edit")}
      actions={
        <>
          <Button onClick={onClose}>{t("settings.button.cancel")}</Button>
          <Button
            variant="primary"
            disabled={!valid}
            data-job-save=""
            onClick={() =>
              onSave({
                title: title.trim(),
                every: `${count}${unit}`,
                at: unit === "d" ? time : null,
                missed_policy: missed as MissedPolicy,
              })
            }
          >
            {t("settings.button.save")}
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label={t("jobs.label.title")}>
          <Input
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div className={styles.pair}>
          <Field label={t("jobs.label.every")}>
            <Input
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
          </Field>
          <Field label={t("jobs.label.unit")}>
            <Select
              options={UNITS.map((one) => ({
                value: one.value,
                label: t(one.label),
              }))}
              value={unit}
              onValueChange={setUnit}
            />
          </Field>
        </div>
        {unit === "d" ? (
          <Field label={t("jobs.label.at")} help={t("jobs.note.at-help")}>
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
        ) : null}
        <Field label={t("jobs.label.if-missed")}>
          <Select
            options={MISSED_OPTIONS.map((one) => ({
              value: one.value,
              label: t(one.label),
            }))}
            value={missed}
            onValueChange={setMissed}
          />
        </Field>
        <p className={styles.note}>
          {t("jobs.note.edit-readonly", { agent: agentName(job.creator) })}
        </p>
      </div>
    </Dialog>
  );
}
