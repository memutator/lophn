// 결정 단추와 거절 이유 칸. 단추는 오른쪽 끝에 모이고 주 행동이 맨 오른쪽이다. 선택지는 card 값이 준 것을
// 그대로 그린다(화면이 따로 판정하지 않는다).
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Textarea } from "@lophn/ui/input";
import { t } from "@lophn/i18n";
import type { WaitingChoice } from "../decide.ts";
import styles from "../waiting.module.css";

/** 결정을 보내고 접수됐는지 돌려준다. */
export type OnDecide = (
  choice: WaitingChoice,
  reason?: string,
) => Promise<boolean>;

// 허락 단추의 왼쪽에서 오른쪽 순서. 맨 오른쪽이 주 행동이다.
const ALLOW_ORDER: readonly WaitingChoice[] = ["always", "once", "allow"];

function allowLabel(choice: WaitingChoice): string {
  switch (choice) {
    case "always":
      return t("waiting.button.allow-always");
    case "once":
      return t("waiting.button.allow-once");
    default:
      return t("waiting.button.allow");
  }
}

export function Decision({
  choices,
  requester,
  denying,
  reason,
  onDecide,
}: {
  choices: readonly WaitingChoice[];
  /** 요청한 agent. 없으면(activation 동의) 거절 이유 칸이 없다. */
  requester: string | null;
  denying?: boolean;
  reason?: string;
  onDecide: OnDecide;
}) {
  const [open, setOpen] = useState(denying ?? false);
  const [text, setText] = useState(reason ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function send(choice: WaitingChoice, why?: string) {
    setBusy(true);
    setFailed(false);
    const done = await onDecide(choice, why);
    setBusy(false);
    setFailed(!done);
  }

  const allows = ALLOW_ORDER.filter((choice) => choices.includes(choice));
  const primary = allows[allows.length - 1];
  const canReject = choices.includes("reject");

  if (open && requester !== null) {
    return (
      <>
        <div className={styles.reason}>
          <Field
            label={t("waiting.label.reason")}
            help={t("waiting.notice.reason-help", { agent: requester })}
          >
            <Textarea
              rows={2}
              maxLength={500}
              value={text}
              onChange={(event) =>
                setText(event.currentTarget.value.replace(/[\r\n]+/g, " "))
              }
            />
          </Field>
        </div>
        {failed ? (
          <p className={styles.error}>{t("waiting.notice.decide-failed")}</p>
        ) : null}
        <div className={styles.actions}>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t("waiting.button.cancel")}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => send("reject", text)}
          >
            {t("waiting.button.deny")}
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      {failed ? (
        <p className={styles.error}>{t("waiting.notice.decide-failed")}</p>
      ) : null}
      <div className={styles.actions}>
        {canReject ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              requester === null ? send("reject") : setOpen(true)
            }
          >
            {t("waiting.button.deny")}
          </Button>
        ) : null}
        {allows.map((choice) => (
          <Button
            key={choice}
            size="sm"
            variant={choice === primary ? "primary" : "secondary"}
            disabled={busy}
            onClick={() => send(choice)}
          >
            {allowLabel(choice)}
          </Button>
        ))}
      </div>
    </>
  );
}
