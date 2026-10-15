// 제보 dialog. 글만 보낸다. 새 문제가 되거나, 사람이 고른 기존 문제의 발생이 된다.
// screenshot과 화면 상태는 보내지 않는다.
import { useState } from "react";
import {
  Button,
  Dialog,
  Field,
  List,
  ListItem,
  Select,
  Textarea,
} from "@lophn/design/components";

import { ISSUES } from "./data.ts";
import styles from "./app-space.module.css";

const TARGETS = [
  { value: "new", label: "A new problem" },
  { value: "existing", label: "Another report of an existing problem" },
];

export function ReportDialog(
  { open, onOpenChange, existing = false, chosen = null }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** 처음부터 기존 문제에 붙이는 쪽을 고른 채로 연다. */
    existing?: boolean;
    /** 처음에 고른 기존 문제. */
    chosen?: string | null;
  },
) {
  const [target, setTarget] = useState(existing ? "existing" : "new");
  const [issue, setIssue] = useState<string | null>(chosen);
  const [text, setText] = useState(
    existing
      ? "Happened again today. The total shows 41.99 for the 10% discount."
      : "",
  );
  const open_ = ISSUES.filter((item) => item.status !== "ignored");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Report a problem in Orders"
      actions={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={text.trim() === "" ||
              (target === "existing" && issue === null)}
            onClick={() => onOpenChange(false)}
          >
            Send
          </Button>
        </>
      }
    >
      <div className={styles.reportBody}>
        <Field
          label="What went wrong?"
          help="Only this text is sent. No screenshot and no screen state."
        >
          <Textarea
            rows={4}
            value={text}
            placeholder="Describe what you did and what you expected."
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <Field label="Send it as">
          <Select
            value={target}
            onValueChange={setTarget}
            options={TARGETS}
          />
        </Field>
        {target === "existing"
          ? (
            <Field label="Which problem?">
              <div className={styles.pickList}>
                <List>
                  {open_.map((item) => (
                    <ListItem
                      key={item.id}
                      title={item.impact}
                      meta={`${item.count} ${
                        item.count === 1 ? "report" : "reports"
                      }`}
                      selected={issue === item.id}
                      onSelect={() => setIssue(item.id)}
                    />
                  ))}
                </List>
              </div>
            </Field>
          )
          : null}
      </div>
    </Dialog>
  );
}
