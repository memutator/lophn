import { useState } from "react";
import { t } from "@lophn/wording";
import { Button } from "@lophn/design/components";

import type { Display } from "../../display.ts";
import { ConfirmationLayout } from "../../layout/layout.tsx";
import { type KindProps, obj, str } from "../exact.tsx";
import styles from "../kinds.module.css";

export const REVERT_RUN = "RevertRun";

type Capability = "reversible" | "retained" | "irreversible" | "conflict";

interface Group {
  ordinal: number;
  target: string | undefined;
  capability: Capability;
  reason: string | undefined;
  included: boolean;
}

function groupsOf(value: unknown): Group[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const group = obj(item);
    return {
      ordinal: Number(group.ordinal),
      target: str(group.target),
      capability: String(group.capability) as Capability,
      reason: str(group.reason),
      included: group.included === true,
    };
  });
}

function mark(capability: Capability): string {
  switch (capability) {
    case "reversible":
      return t("confirmation-window.label.will-undo");
    case "retained":
      return t("confirmation-window.label.stays");
    case "conflict":
      return t("confirmation-window.label.conflict");
    default:
      return t("confirmation-window.label.cannot-undo");
  }
}

/** 이유는 고정 코드다(revertReasonSchema). 코드로 문장을 고른다. */
export function reasonText(code: string | undefined): string | undefined {
  switch (code) {
    case "audit_fact":
      return t("confirmation-window.revert-why.audit-fact");
    case "external_effect":
      return t("confirmation-window.revert-why.external");
    case "later_change":
      return t("confirmation-window.revert-why.later-change");
    case "linked_document":
      return t("confirmation-window.revert-why.linked");
    case "not_agent_output":
      return t("confirmation-window.revert-why.not-lophn");
    case "title_change":
      return t("confirmation-window.revert-why.title-change");
    case "no_previous_version":
      return t("confirmation-window.revert-why.no-earlier");
    case "unclassified_document_event":
      return t("confirmation-window.revert-why.unknown-document");
    case "unclassified_event":
      return t("confirmation-window.revert-why.unknown");
    case "blocked_conflict":
      return t("confirmation-window.revert-why.conflict");
    case "blocked_irreversible":
      return t("confirmation-window.revert-why.irreversible");
    case "blocked_dependency":
      return t("confirmation-window.revert-why.dependency");
    case "blocked_not_prepared":
      return t("confirmation-window.revert-why.not-prepared");
    case "stale_preview":
      return t("confirmation-window.revert-why.stale");
    case "app_failed":
      return t("confirmation-window.revert-why.app-failed");
    case "app_uncertain":
      return t("confirmation-window.revert-why.app-uncertain");
    case "app_not_started":
      return t("confirmation-window.revert-why.app-not-started");
    default:
      return undefined;
  }
}

function Groups({ groups }: { groups: readonly Group[] }) {
  return (
    <ul className={styles.groups} data-groups="revert">
      {groups.map((group) => (
        <li
          key={group.ordinal}
          className={styles.group}
          data-capability={group.capability}
          data-included={group.included ? "true" : "false"}
        >
          <span className={styles.mark}>{mark(group.capability)}</span>
          {group.target === undefined
            ? null
            : <span className={styles.value}>{group.target}</span>}
          {reasonText(group.reason) === undefined
            ? null
            : <p className={styles.why}>{reasonText(group.reason)}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * 끝난 work 하나의 revert. 묶음마다 복원 가능·유지·불가·충돌과 이유를 먼저 보인다.
 * 안전하지 않은 묶음은 기본 적용에서 빠지고, 섞여 있으면 남는 영향을 다시 보이는 별도
 * 단계에서 확인한 뒤에만 나머지를 되돌린다(lophn-agent/revert#R7).
 */
export function RevertKind({ view, decide, cancel, busy }: KindProps) {
  const shown = obj(view.view);
  const groups = groupsOf(shown.groups);
  const kept = groups.filter((group) => !group.included);
  const can = (view.decisions ?? []).includes(REVERT_RUN);
  const partial = shown.allow_partial === true;
  const [second, setSecond] = useState(false);

  if (second && can) {
    const display: Display = {
      title: t("confirmation-window.revert-second.title"),
      subject: t("confirmation-window.revert-second.body"),
      effect: t("confirmation-window.revert.effect-partial"),
      reversible: true,
      revertNote: t("confirmation-window.revert.note"),
      noteOnly: true,
      action: t("confirmation-window.button.undo-rest"),
      details: [],
      noChange: true,
    };
    return (
      <ConfirmationLayout
        display={display}
        exact={<Groups groups={kept} />}
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
              data-decision={REVERT_RUN}
              data-step="second"
              disabled={busy}
              onClick={() => decide(REVERT_RUN, { confirmedSecond: true })}
            >
              {display.action}
            </Button>
          </>
        }
      />
    );
  }

  const display: Display = {
    title: t("confirmation-window.revert.title"),
    subject: t("confirmation-window.revert.subject", { count: groups.length }),
    effect: !can
      ? t("confirmation-window.revert.effect-none")
      : partial
      ? t("confirmation-window.revert.effect-partial")
      : t("confirmation-window.revert.effect-all"),
    reversible: can,
    revertNote: can ? t("confirmation-window.revert.note") : undefined,
    noteOnly: true,
    action: t("confirmation-window.button.undo"),
    details: [],
    noChange: true,
  };
  return (
    <ConfirmationLayout
      display={display}
      exact={<Groups groups={groups} />}
      actions={
        <>
          <Button variant="ghost" data-action="cancel" onClick={cancel}>
            {t("confirmation-window.button.cancel")}
          </Button>
          {can
            ? (
              <Button
                variant="danger"
                data-decision={REVERT_RUN}
                disabled={busy}
                onClick={() =>
                  view.second === true ? setSecond(true) : decide(REVERT_RUN)}
              >
                {display.action}
              </Button>
            )
            : null}
        </>
      }
    />
  );
}
