import { useEffect, useState } from "react";
import { t } from "@lophn/wording";

import {
  type ConfirmationFrameApi,
  type ConfirmationView,
  failedSubmit,
} from "./api.ts";

export interface FrameProps {
  api: ConfirmationFrameApi;
  /** 검증된 token 값. slot·fork는 받지 않는다. */
  theme: Record<string, string>;
}

/**
 * 첫 focus는 설명. 결정 기본 선택은 없고 Enter로 제출하지 않는다.
 * 닫기·Escape는 cancel이며 결정이 아니다.
 * 문구는 wording catalog의 en 문장이다. 결정 이름은 화면에 쓰지 않는다.
 */
export function ConfirmationFrame(
  { api, theme }: FrameProps,
): React.JSX.Element {
  const [view, setView] = useState<ConfirmationView | null>(null);
  const [second, setSecond] = useState(false);
  const [stale, setStale] = useState(false);
  const showingStale = stale || view?.step === "stale";

  useEffect(() => {
    let gone = false;
    void api.getDisplay().then((next) => {
      if (!gone) setView(next);
    }).catch(() => {
      if (!gone) setStale(true);
    });
    return () => {
      gone = true;
    };
  }, [api]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void api.cancel();
      }
      if (event.key === "Enter") event.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [api]);

  const decisions = view !== null && !second && !showingStale
    ? decisionsOf(view)
    : [];

  return (
    <section
      className="confirmation-frame"
      style={theme}
      data-state={second ? "second" : showingStale ? "stale" : "ready"}
    >
      <h1 tabIndex={-1} ref={focusFirst}>
        {t("confirmation-window.title.confirm")}
      </h1>
      <p tabIndex={0} autoFocus>
        {showingStale
          ? t("confirmation-window.body.stale")
          : second
          ? t("confirmation-window.body.second")
          : view === null
          ? t("confirmation-window.body.checking")
          : t("confirmation-window.body.review")}
      </p>
      {second
        ? (
          <button
            type="button"
            data-decision="confirm-scope"
            onClick={() => {
              if (view === null) return;
              void api.submit({
                displayId: view.displayId,
                decision: decisionsOf(view)[0] ?? "",
                confirmedSecond: true,
              }).then((result) => {
                if (failedSubmit(result)) setStale(true);
              });
            }}
          >
            {t("confirmation-window.body.second")}
          </button>
        )
        : null}
      <div role="group">
        {decisions.map((decision) => (
          <button
            key={decision}
            type="button"
            data-decision={decision}
            onClick={() => {
              if (view === null) return;
              if (needsSecond(view)) {
                setSecond(true);
                return;
              }
              void api.submit({ displayId: view.displayId, decision }).then(
                (result) => {
                  if (failedSubmit(result)) setStale(true);
                },
              );
            }}
          >
            {t("confirmation-window.button.decide")}
          </button>
        ))}
      </div>
      {showingStale
        ? (
          <button
            type="button"
            data-action="refresh"
            onClick={() => {
              setStale(false);
              void api.getDisplay().then(setView).catch(() => setStale(true));
            }}
          >
            {t("confirmation-window.button.refresh")}
          </button>
        )
        : null}
      <button
        type="button"
        data-action="cancel"
        onClick={() => void api.cancel()}
      >
        {t("confirmation-window.button.cancel")}
      </button>
    </section>
  );
}

function decisionsOf(view: ConfirmationView): string[] {
  if (view.request.kind === "owner_decision") return [view.request.decision];
  if (view.request.kind === "secret_input") return ["provide_secret"];
  return ["grant_approval_request", "reject_approval_request"];
}

function needsSecond(view: ConfirmationView): boolean {
  return view.step === "second" || view.request.kind === "owner_decision";
}

function focusFirst(node: HTMLHeadingElement | null): void {
  node?.focus();
}
