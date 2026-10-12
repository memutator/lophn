import { useState } from "react";
import { t } from "@lophn/wording";
import { Button } from "@lophn/design/components";

import type { Display } from "../../display.ts";
import { ConfirmationLayout } from "../../layout/layout.tsx";
import { itemLabel, reasonText } from "../../../conversation/rewind/text.ts";
import { type KindProps, obj, str } from "../exact.tsx";
import styles from "../kinds.module.css";

/** 확인 창이 허용하는 결정 이름(= command route 이름). 누르면 main이 `Rewind`를 session·checkpoint·범위·preview 지문에 묶은 handle로 보낸다. */
export const REWIND = "Rewind";

type Choice = "restore_all" | "messages_only" | "summarize";

interface Item {
  readonly kind: "file" | "app" | "fact";
  readonly target: string;
  readonly reason: string | null;
}

const CHOICES: readonly Choice[] = [
  "restore_all",
  "messages_only",
  "summarize",
];

function choiceOf(value: unknown): Choice | undefined {
  return CHOICES.find((choice) => choice === value);
}

function itemsOf(value: unknown): Item[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = obj(entry);
    const kind = item.class === "app" || item.class === "fact"
      ? item.class
      : "file";
    return {
      kind,
      target: str(item.target) ?? "",
      reason: str(item.reason) ?? null,
    };
  });
}

function Groups(
  { groups }: {
    groups: readonly (readonly [string, string, readonly Item[]])[];
  },
) {
  return (
    <div className={styles.parts} data-groups="rewind">
      {groups.map(([name, title, items]) =>
        items.length === 0
          ? null
          : (
            <section key={name} className={styles.part} data-group={name}>
              <h3 className={styles.partHead}>{title}</h3>
              <ul className={styles.list}>
                {items.map((item, index) => {
                  const why = reasonText(item.reason);
                  return (
                    <li key={index} className={styles.item} data-item="">
                      <span>{itemLabel(item)}</span>
                      {why === null ? null : <>{" "}{why}</>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )
      )}
    </div>
  );
}

/**
 * session 되돌리기(rewind) 확인. main이 preview에서 만든 view는
 * `{ kind: "rewind", choice, redo, restore, skip, remain }`이고 항목은 종류·대상·이유 코드뿐이다(앱 receipt 원문은
 * 오지 않는다). 복원할 것·건너뛰는 것·남는 영향을 이유와 함께 따로 보이고, 건너뛰는 것이나 남는 영향이 있으면(`second`)
 * Rewind가 먼저 그 목록을 다시 보이는 단계를 열며, 거기서 확인해야 결정을 보낸다.
 */
export function RewindKind({ view, decide, cancel, busy }: KindProps) {
  const shown = obj(view.view);
  const choice = choiceOf(shown.choice);
  const [second, setSecond] = useState(false);
  if (choice === undefined) {
    return (
      <p data-change="missing">{t("confirmation-window.change.missing")}</p>
    );
  }
  const restore = itemsOf(shown.restore);
  const skip = itemsOf(shown.skip);
  const remain = itemsOf(shown.remain);
  const can = (view.decisions ?? []).includes(REWIND);
  const action = choice === "summarize"
    ? t("confirmation-window.button.summarize")
    : t("confirmation-window.button.rewind");

  if (second && can) {
    const display: Display = {
      title: t("confirmation-window.title.rewind-second"),
      subject: t("confirmation-window.rewind.second-body"),
      effect: t("conversation.rewind.note"),
      reversible: true,
      revertNote: shown.redo === true
        ? t("conversation.rewind.redo-yes")
        : t("conversation.rewind.redo-no"),
      noteOnly: true,
      action: t("confirmation-window.button.rewind-anyway"),
      details: [],
      noChange: true,
    };
    return (
      <ConfirmationLayout
        display={display}
        exact={
          <Groups
            groups={[
              ["skip", t("conversation.label.rewind-skip"), skip],
              ["remain", t("conversation.label.rewind-remain"), remain],
            ]}
          />
        }
        actions={
          <>
            <Button
              variant="ghost"
              data-action="back"
              onClick={() => setSecond(false)}
            >
              {t("confirmation-window.button.back")}
            </Button>
            <Button
              variant="danger"
              data-decision={REWIND}
              data-step="second"
              disabled={busy}
              onClick={() => decide(REWIND, { confirmedSecond: true })}
            >
              {display.action}
            </Button>
          </>
        }
      />
    );
  }

  const display: Display = {
    title: choice === "restore_all"
      ? t("confirmation-window.title.rewind-restore-all")
      : choice === "messages_only"
      ? t("confirmation-window.title.rewind-messages-only")
      : t("confirmation-window.title.rewind-summarize"),
    subject: choice === "restore_all"
      ? t("confirmation-window.rewind.subject-restore-all")
      : choice === "messages_only"
      ? t("confirmation-window.rewind.subject-messages-only")
      : t("confirmation-window.rewind.subject-summarize"),
    // 바깥 변경은 되돌리지 않는다는 말이 늘 보인다.
    effect: t("conversation.rewind.note"),
    reversible: shown.redo === true,
    revertNote: shown.redo === true
      ? t("conversation.rewind.redo-yes")
      : t("conversation.rewind.redo-no"),
    noteOnly: true,
    action,
    details: [],
    noChange: true,
  };
  return (
    <ConfirmationLayout
      display={display}
      exact={
        <Groups
          groups={[
            ["restore", t("conversation.label.rewind-restore"), restore],
            ["skip", t("conversation.label.rewind-skip"), skip],
            ["remain", t("conversation.label.rewind-remain"), remain],
          ]}
        />
      }
      actions={
        <>
          <Button variant="ghost" data-action="cancel" onClick={cancel}>
            {t("confirmation-window.button.cancel")}
          </Button>
          {can
            ? (
              <Button
                variant="danger"
                data-decision={REWIND}
                disabled={busy}
                onClick={() =>
                  view.second === true ? setSecond(true) : decide(REWIND)}
              >
                {action}
              </Button>
            )
            : null}
        </>
      }
    />
  );
}
