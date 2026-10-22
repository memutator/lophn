// [Edit]의 dialog. 제목, 주기(숫자와 단위, 하루 단위일 때만 시각), 놓친 차례 정책만 고친다.
// 할 일(agent, 앱 tool, workflow)은 화면에서 고치지 않고 만든 agent에게 말한다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input, Select } from "@lophn/ui/input";
import { Dialog } from "@lophn/ui/overlay";

import type { JobView } from "../../mock/jobs-screen-data.ts";
import { MISSED_OPTIONS } from "./jobs-text.ts";
import styles from "./jobs.module.css";

export interface JobChange {
  readonly title: string;
  readonly every: string;
  readonly at: string | null;
  readonly missed_policy: JobView["missed_policy"];
}

const UNITS = [
  { value: "m", label: "Minutes" },
  { value: "h", label: "Hours" },
  { value: "d", label: "Days" },
];

export function EditDialog(
  { job, creator, onSave, onClose }: {
    job: JobView;
    /** "Project Manager" 같은 만든 agent 이름. 안내 글에 쓴다. */
    creator: string;
    onSave: (change: JobChange) => void;
    onClose: () => void;
  },
) {
  const [title, setTitle] = useState(job.title);
  const [count, setCount] = useState(job.every.slice(0, -1));
  const [unit, setUnit] = useState(job.every.slice(-1));
  const [time, setTime] = useState(job.at ?? "09:00");
  const [missed, setMissed] = useState<string>(job.missed_policy);
  const valid = title.trim() !== "" && /^[1-9][0-9]{0,4}$/.test(count) &&
    (unit !== "d" || time !== "");
  return (
    <Dialog
      open
      onOpenChange={(open) => open || onClose()}
      title="Edit scheduled job"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            data-job-save=""
            onClick={() =>
              onSave({
                title: title.trim(),
                every: `${count}${unit}`,
                at: unit === "d" ? time : null,
                missed_policy: missed as JobView["missed_policy"],
              })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        <Field label="Title">
          <Input
            value={title}
            maxLength={80}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <div className={styles.pair}>
          <Field label="Every">
            <Input
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
          </Field>
          <Field label="Unit">
            <Select options={UNITS} value={unit} onValueChange={setUnit} />
          </Field>
        </div>
        {unit === "d"
          ? (
            <Field
              label="At"
              help="The time of day on this computer."
            >
              <Input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </Field>
          )
          : null}
        <Field label="If missed">
          <Select
            options={MISSED_OPTIONS}
            value={missed}
            onValueChange={setMissed}
          />
        </Field>
        <p className={styles.note}>
          What the job does cannot be changed here. Ask {creator} to change it.
        </p>
      </div>
    </Dialog>
  );
}
