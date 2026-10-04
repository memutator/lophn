import { useEffect, useState } from "react";

import type { ConfirmationFrameApi, ConfirmationView } from "./api.ts";

// 문구는 key로만 둔다. 화면 문장 조립은 wording catalog(T6)가 맡는다.
const COPY = {
  title: "confirmation-window.frame.title",
  checking: "confirmation-window.frame.checking",
  stale: "confirmation-window.frame.stale",
  expired: "confirmation-window.frame.expired",
  unknown: "confirmation-window.frame.unknown",
  second: "confirmation-window.frame.second",
  cancel: "confirmation-window.frame.cancel",
  refresh: "confirmation-window.frame.refresh",
} as const;

export interface FrameProps {
  api: ConfirmationFrameApi;
  /** 검증된 token 값. slot·fork는 받지 않는다. */
  theme: Record<string, string>;
}

/**
 * 첫 focus는 설명. 결정 기본 선택은 없고 Enter로 제출하지 않는다.
 * 닫기·Escape는 cancel이며 결정이 아니다.
 */
export function ConfirmationFrame(
  { api, theme }: FrameProps,
): React.JSX.Element {
  const [view, setView] = useState<ConfirmationView | null>(null);
  const [second, setSecond] = useState(false);

  useEffect(() => {
    let gone = false;
    void api.getDisplay().then((next) => {
      if (!gone) setView(next);
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

  const gate = view?.gate.state ?? "checking";
  const decisions = gate === "ready" && !second
    ? view?.gate.decisions ?? []
    : [];

  return (
    <section
      className="confirmation-frame"
      style={theme}
      data-state={second ? "second" : gate}
    >
      <h1
        tabIndex={-1}
        ref={focusFirst}
        data-copy={view?.display?.titleKey ?? COPY.title}
      >
        {view?.display?.titleKey ?? COPY.title}
      </h1>
      <p
        data-copy={view?.display?.bodyKey ?? COPY.checking}
        tabIndex={0}
        autoFocus
      >
        {gate === "stale"
          ? COPY.stale
          : gate === "expired"
          ? COPY.expired
          : gate === "unknown"
          ? COPY.unknown
          : second
          ? COPY.second
          : view?.display?.bodyKey ?? COPY.checking}
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
                decision: view.gate.decisions?.[0] ?? "",
                confirmedSecond: true,
              }).then(() => api.getDisplay().then(setView));
            }}
          >
            {COPY.second}
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
              if (view.gate.second) {
                setSecond(true);
                return;
              }
              void api.submit({ displayId: view.displayId, decision }).then(
                () => api.getDisplay().then(setView),
              );
            }}
          >
            {decision}
          </button>
        ))}
      </div>
      {gate === "stale" || gate === "expired"
        ? (
          <button
            type="button"
            data-action="refresh"
            onClick={() => void api.getDisplay().then(setView)}
          >
            {COPY.refresh}
          </button>
        )
        : null}
      <button
        type="button"
        data-action="cancel"
        onClick={() => void api.cancel()}
      >
        {COPY.cancel}
      </button>
    </section>
  );
}

function focusFirst(node: HTMLHeadingElement | null): void {
  node?.focus();
}
