// 삭제 전 `impact.read`로 영향 범위를 조회하고, 1곳 이상이면 `[Delete & clean up now]`(기본) + `[Delete only]`(보조)를
// 그려 주는 공용 부품. App·Agent·Artifact·Workflow 삭제 dialog가 함께 쓴다.
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import { useEffect, useState } from "react";

import type {
  CleanUpMode,
  ImpactSummary,
} from "../../../protocol/base/follow-ups.ts";
import {
  type ImpactTarget,
  impactRead,
} from "../../../protocol/lophn-agent/follow-ups.ts";
import type { CoreSource } from "../desktop/connection/connection.ts";
import { useOptionalEventClient } from "../desktop/connection/events/hooks.tsx";
import { runToastAction } from "../desktop/connection/toasts/toast-actions.ts";
import { useScopeMachine } from "../desktop/machines/context.tsx";
import { actionIcons } from "../icons/mod.ts";
import styles from "./cascade-delete-confirm.module.css";

export interface ImpactReport {
  readonly target_label: string;
  readonly immediate: readonly string[];
  readonly impact: ImpactSummary;
}

export async function readImpact(
  core: CoreSource,
  target: ImpactTarget,
): Promise<ImpactReport | null> {
  const reply = await core
    .call({
      kind: impactRead.kind,
      resource: impactRead.resource,
      method: impactRead.method,
      body: target,
    })
    .catch(() => null);
  if (!reply?.ok) return null;
  const parsed = impactRead.output.safeParse(reply.value);
  return parsed.success ? parsed.data : null;
}

/** 삭제 dialog가 열려 있는 동안 대상의 `impact.read` 결과를 읽는다. core가 없거나 실패하면 null(가벼운 삭제)이다. */
export function useImpact(target: ImpactTarget | null): {
  readonly report: ImpactReport | null;
  readonly loading: boolean;
} {
  const client = useOptionalEventClient();
  const key = target === null ? null : JSON.stringify(target);
  const [state, setState] = useState<{
    readonly key: string | null;
    readonly report: ImpactReport | null;
    readonly loading: boolean;
  }>({ key: null, report: null, loading: false });

  useEffect(() => {
    if (key === null || target === null || client === null) {
      setState({ key: null, report: null, loading: false });
      return;
    }
    let live = true;
    setState({ key, report: null, loading: true });
    void readImpact(client.core, target).then((report) => {
      if (!live) return;
      setState({ key, report, loading: false });
    });
    return () => {
      live = false;
    };
  }, [key, client]);

  if (key === null || client === null) {
    return { report: null, loading: false };
  }
  if (state.key !== key) {
    return { report: null, loading: true };
  }
  return { report: state.report, loading: state.loading };
}

/** 삭제 응답이 `handoff_session`을 돌려주면 그 session을 열어 바로 이어 가게 한다. */
export function useOpenHandoffSession(): (
  session: string | null | undefined,
) => void {
  const machine = useScopeMachine();
  return (session) => {
    if (!session) return;
    runToastAction({
      kind: "session",
      session,
      ...(machine === null ? {} : { machine }),
    });
  };
}

/** 영향이 1곳 이상일 때 즉시 지워지는 것과 lophn이 고쳐야 할 곳을 보여 준다. */
export function CascadeImpactDetails({
  report,
  loading = false,
}: {
  report: ImpactReport | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <p className={styles.note} data-impact-loading="">
        {t("cascade.note.checking-impact")}
      </p>
    );
  }
  if (report === null) return null;
  const declared = report.impact.declared;
  const unreadable = report.impact.unreadable ?? 0;
  // 읽지 못한 자리가 있으면 목록이 모자랄 수 있다고 알린다. 동작은 막지 않는다.
  const unreadableNote =
    unreadable > 0 ? (
      <p className={styles.note} role="status" data-impact-unreadable="">
        {t("cascade.note.unreadable", { count: unreadable })}
      </p>
    ) : null;
  if (declared.length === 0) return unreadableNote;
  return (
    <div className={styles.section} data-cascade-impact="">
      {report.immediate.length === 0 ? null : (
        <div className={styles.group} role="group" data-cascade-immediate="">
          <p className={styles.heading}>{t("cascade.heading.immediate")}</p>
          <ul className={styles.list}>
            {report.immediate.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.group} role="group" data-cascade-declared="">
        <p className={styles.heading}>
          {t("cascade.heading.affected", { count: declared.length })}
        </p>
        <ul className={styles.list}>
          {declared.map((ref, index) => (
            <li key={`${ref.kind}:${ref.workspace_name}:${ref.label}:${index}`}>
              <span>
                {t("cascade.label.affected-item", {
                  workspace: ref.workspace_name,
                  label: ref.label,
                })}
              </span>
              {ref.detail ? (
                <>
                  {" "}
                  <span className={styles.detail}>{ref.detail}</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      {unreadableNote}
      <p className={styles.note}>{t("cascade.note.handoff")}</p>
    </div>
  );
}

/** declared 영향이 0곳이면 일반 삭제 단추 하나, 1곳 이상이면 `[Delete only]`(보조) + `[Delete & clean up now]`(기본)다. */
export function CascadeDeleteActions({
  report,
  loading = false,
  busy = false,
  confirmLabel,
  confirmAction = "confirm-delete",
  onCancel,
  onConfirm,
}: {
  report: ImpactReport | null;
  loading?: boolean;
  busy?: boolean;
  confirmLabel: string;
  confirmAction?: string;
  onCancel: () => void;
  onConfirm: (cleanUp: CleanUpMode) => void;
}) {
  const hasImpact = (report?.impact.declared.length ?? 0) >= 1;
  return (
    <>
      <Button disabled={busy} onClick={onCancel}>
        {t("common.button.cancel")}
      </Button>
      {hasImpact ? (
        <>
          <Button
            disabled={busy || loading}
            data-action="confirm-delete-only"
            onClick={() => onConfirm("later")}
          >
            {t("cascade.button.delete-only")}
          </Button>
          <Button
            variant="danger"
            icon={actionIcons.delete}
            disabled={busy || loading}
            data-action="confirm-delete-clean-up"
            onClick={() => onConfirm("now")}
          >
            {t("cascade.button.delete-and-clean-up")}
          </Button>
        </>
      ) : (
        <Button
          variant="danger"
          icon={actionIcons.delete}
          disabled={busy || loading}
          data-action={confirmAction}
          onClick={() => onConfirm("none")}
        >
          {confirmLabel}
        </Button>
      )}
    </>
  );
}
