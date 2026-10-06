import { useCallback, useEffect, useState } from "react";
import { t } from "@lophn/wording";
import { Button } from "@lophn/design/components";

import {
  type ConfirmationFrameApi,
  type ConfirmationView,
  failedSubmit,
  type SubmitResult,
} from "./frame/api.ts";
import { ConfirmationFrame } from "./frame/frame.tsx";
import { OwnerDecision } from "./kinds/owner-decision/owner-decision.tsx";
import {
  ApprovalKind,
  CANCEL_REQUEST,
  GRANT,
  REJECT,
} from "./kinds/approval/approval.tsx";
import { OptionActionKind } from "./kinds/option-action/option-action.tsx";
import { RevertKind } from "./kinds/revert/revert.tsx";
import { SecretInputKind } from "./kinds/secret-input/secret-input.tsx";
import type { KindProps } from "./kinds/exact.tsx";
import layout from "./layout/layout.module.css";
import styles from "./kinds/kinds.module.css";

export interface ScreenProps {
  api: ConfirmationFrameApi;
  theme: Record<string, string>;
}

type Done = { decision: string; result: SubmitResult };

function isView(value: unknown): value is ConfirmationView {
  return value !== null && typeof value === "object" &&
    typeof (value as { displayId?: unknown }).displayId === "string";
}

/** 결정 접수와 실제 적용을 구별해 말한다(platform/approvals#R9). */
export function outcomeText(
  kind: string | undefined,
  done: Done,
): string {
  const result = done.result as {
    result?: string;
    secret_ref?: string;
  };
  if (kind === "secret") {
    return t("confirmation-window.result.saved", {
      name: result.secret_ref ?? "",
    });
  }
  if (kind === "revert") {
    switch (result.result) {
      case "applied":
        return t("confirmation-window.result.undone");
      case "partial":
        return t("confirmation-window.result.partly-undone");
      case "blocked":
        return t("confirmation-window.result.not-undone");
      case "uncertain":
        return t("confirmation-window.result.undo-unknown");
      default:
        return t("confirmation-window.result.undoing");
    }
  }
  if (kind === "option_action") return t("confirmation-window.result.answered");
  if (done.decision === GRANT) return t("confirmation-window.result.allowed");
  if (done.decision === REJECT) return t("confirmation-window.result.rejected");
  if (done.decision === CANCEL_REQUEST) {
    return t("confirmation-window.result.cancelled");
  }
  return t("confirmation-window.body.review");
}

function errorText(kind: string | undefined, code: string): string {
  if (code === "unavailable") return t("confirmation-window.error.unavailable");
  if (code === "invalid_input") {
    return kind === "secret"
      ? t("confirmation-window.error.save")
      : t("confirmation-window.error.too-long");
  }
  return kind === "secret"
    ? t("confirmation-window.error.save")
    : t("confirmation-window.error.send");
}

/** 결정이 끝났거나 표시가 무효일 때의 한 문단 화면. 옛 결정 버튼은 없다. */
function Notice(
  { body, onRefresh, onClose, state }: {
    body: string;
    onRefresh?: () => void;
    onClose: () => void;
    state: string;
  },
) {
  return (
    <article className={layout.layout} data-layout="notice" data-state={state}>
      <h1 className={layout.title} tabIndex={-1}>
        {t("confirmation-window.title.confirm")}
      </h1>
      <p className={styles.message} tabIndex={0} data-focus="first">{body}</p>
      <div className={layout.actions} role="group">
        {onRefresh === undefined ? null : (
          <Button variant="secondary" data-action="refresh" onClick={onRefresh}>
            {t("confirmation-window.button.refresh")}
          </Button>
        )}
        <Button variant="ghost" data-action="cancel" onClick={onClose}>
          {t("confirmation-window.button.close")}
        </Button>
      </div>
    </article>
  );
}

/**
 * 표시의 view 종류로 화면을 고른다. 첫 focus는 설명이고 Enter로 제출하지 않으며
 * Escape·닫기는 결정이 아니다(confirmation-window#R4). 무효·만료·결과 모름이면 옛 결정
 * 버튼 없이 이유와 최신 내용 열기만 남긴다(R5).
 */
export function ConfirmationScreen({ api, theme }: ScreenProps) {
  const [view, setView] = useState<ConfirmationView | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    void api.getDisplay().then((next) => {
      if (isView(next)) {
        setView(next);
        setError(null);
      } else setFailed(true);
    }).catch(() => setFailed(true));
  }, [api]);

  useEffect(() => {
    let gone = false;
    void api.getDisplay().then((next) => {
      if (gone) return;
      if (isView(next)) setView(next);
      else setFailed(true);
    }).catch(() => {
      if (!gone) setFailed(true);
    });
    const release = api.subscribe?.((next) => {
      if (!gone && isView(next)) setView(next);
    });
    return () => {
      gone = true;
      release?.();
    };
  }, [api]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void api.cancel();
      }
      // 여러 줄 이유 칸 말고는 Enter가 아무것도 제출하지 않는다.
      const target = event.target as { tagName?: string } | null;
      if (event.key === "Enter" && target?.tagName !== "TEXTAREA") {
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [api]);

  useEffect(() => {
    const first = document.querySelector<HTMLElement>("[data-focus=first]");
    first?.focus();
  }, [view?.displayId, done, failed]);

  const kind = typeof view?.view?.kind === "string"
    ? view.view.kind
    : undefined;
  const close = () => void api.cancel();

  if (failed) {
    return (
      <Notice
        state="stale"
        body={t("confirmation-window.body.stale")}
        onRefresh={load}
        onClose={close}
      />
    );
  }
  if (view === null) {
    return (
      <Notice
        state="checking"
        body={t("confirmation-window.body.checking")}
        onClose={close}
      />
    );
  }
  if (done !== null) {
    return (
      <Notice
        state="submitted"
        body={outcomeText(kind, done)}
        onClose={close}
      />
    );
  }
  if (view.state === "stale" || view.state === "expired") {
    return (
      <Notice
        state={view.state}
        body={view.state === "expired"
          ? t("confirmation-window.body.expired")
          : t("confirmation-window.body.stale")}
        onRefresh={load}
        onClose={close}
      />
    );
  }
  if (view.state === "unknown") {
    return (
      <Notice
        state="unknown"
        body={t("confirmation-window.body.unknown")}
        onClose={close}
      />
    );
  }

  const decide: KindProps["decide"] = (decision, options) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void api.submit({
      displayId: view.displayId,
      decision,
      ...(options?.input === undefined ? {} : { input: options.input }),
      ...(options?.confirmedSecond === undefined
        ? {}
        : { confirmedSecond: options.confirmedSecond }),
    }).then((result) => {
      setBusy(false);
      if (failedSubmit(result)) {
        setError(errorText(kind, result.error.code));
        if (result.error.code === "conflict") load();
        return;
      }
      setDone({ decision, result });
    }).catch(() => {
      setBusy(false);
      setError(errorText(kind, "unavailable"));
    });
  };
  const props: KindProps = { view, decide, cancel: close, busy };
  const body = kind === "approval"
    ? <ApprovalKind {...props} />
    : kind === "option_action"
    ? <OptionActionKind {...props} />
    : kind === "revert"
    ? <RevertKind {...props} />
    : kind === "secret"
    ? <SecretInputKind {...props} />
    : view.request.kind === "owner_decision"
    ? (
      <OwnerDecision
        view={view}
        onDecide={(decision) => decide(decision)}
        onCancel={close}
      />
    )
    : null;
  if (body === null) return <ConfirmationFrame api={api} theme={theme} />;
  return (
    <div style={theme} data-kind={kind ?? view.request.kind}>
      {error === null
        ? null
        : <p className={styles.message} role="alert">{error}</p>}
      {body}
    </div>
  );
}
