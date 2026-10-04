import { useEffect, useState } from "react";

import type { ConfirmationFrameApi, ConfirmationView } from "./api.ts";

// wording catalog key. en 값은 packages/design/wording/en.ts에 있다.
// renderer가 catalog 모듈을 직접 import하면 상대 경로가 worktree 밖으로 나간다.
function copy(key: ConfirmationCopy): string {
  return key;
}

type ConfirmationCopy =
  | "confirmation-window.title.confirm"
  | "confirmation-window.body.checking"
  | "confirmation-window.body.review"
  | "confirmation-window.body.stale"
  | "confirmation-window.body.second"
  | "confirmation-window.button.cancel"
  | "confirmation-window.button.refresh"
  | "confirmation-window.button.decide";

export interface FrameProps {
  api: ConfirmationFrameApi;
  /** 검증된 token 값. slot·fork는 받지 않는다. */
  theme: Record<string, string>;
}

/**
 * 첫 focus는 설명. 결정 기본 선택은 없고 Enter로 제출하지 않는다.
 * 닫기·Escape는 cancel이며 결정이 아니다.
 * 문구는 wording key만 쓴다. 결정 이름은 화면에 쓰지 않는다.
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
        {copy("confirmation-window.title.confirm")}
      </h1>
      <p tabIndex={0} autoFocus>
        {showingStale
          ? copy("confirmation-window.body.stale")
          : second
          ? copy("confirmation-window.body.second")
          : view === null
          ? copy("confirmation-window.body.checking")
          : copy("confirmation-window.body.review")}
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
                if (!result.ok) setStale(true);
              });
            }}
          >
            {copy("confirmation-window.body.second")}
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
                  if (!result.ok) setStale(true);
                },
              );
            }}
          >
            {copy("confirmation-window.button.decide")}
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
            {copy("confirmation-window.button.refresh")}
          </button>
        )
        : null}
      <button
        type="button"
        data-action="cancel"
        onClick={() => void api.cancel()}
      >
        {copy("confirmation-window.button.cancel")}
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
