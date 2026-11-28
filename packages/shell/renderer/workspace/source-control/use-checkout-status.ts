// 고른 체크아웃의 `source_control/status`. 쓰기 뒤, worktree event, 창 focus, 보이는 동안 몇 초마다 다시 읽는다(Explorer tree와 같은 박자).
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventClient } from "../../desktop/connection/events/client.ts";
import {
  type CheckoutRef,
  checkoutKey,
  type GitFailure,
  type SourceControlSource,
  type SourceControlStatusValue,
  targetOf,
} from "../worktrees/source.ts";

const REFRESH_MS = 3000;
const REMOTE_REFRESH_MS = 15_000;

export interface CheckoutStatus {
  readonly status: SourceControlStatusValue | null;
  readonly failure: GitFailure | null;
  readonly loading: boolean;
  reload(): void;
}

export function useCheckoutStatus(input: {
  readonly source: SourceControlSource;
  readonly events: EventClient | null;
  readonly project: string;
  readonly checkout: CheckoutRef | null;
  readonly remote: boolean;
}): CheckoutStatus {
  const { source, events, project, checkout, remote } = input;
  const key = checkout === null ? null : checkoutKey(checkout);
  const [status, setStatus] = useState<SourceControlStatusValue | null>(null);
  const [failure, setFailure] = useState<GitFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const round = useRef(0);
  const latest = useRef(checkout);
  latest.current = checkout;

  const load = useCallback(async () => {
    const target = latest.current;
    const mine = ++round.current;
    if (target === null) {
      setStatus(null);
      setLoading(false);
      return;
    }
    const res = await source.status(targetOf(project, target));
    if (mine !== round.current) return;
    setLoading(false);
    if (res.ok) {
      setStatus(res.value);
      setFailure(null);
    } else {
      setStatus(null);
      setFailure(res.error);
    }
  }, [source, project]);

  // 대상이 바뀌면 앞 대상의 상태를 지우고 새로 읽는다.
  useEffect(() => {
    setStatus(null);
    setFailure(null);
    setLoading(true);
    void load();
  }, [key, load]);

  useEffect(() => {
    if (key === null) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(tick, remote ? REMOTE_REFRESH_MS : REFRESH_MS);
    globalThis.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener("focus", tick);
    };
  }, [key, load, remote]);

  useEffect(() => {
    if (events === null || key === null) return;
    return events.subscribe(
      { types: ["WorktreesChanged", "WorktreeStatusChanged"] },
      (message) => {
        if (message.kind !== "event") return;
        const ev = message.event;
        if (
          (ev.type === "WorktreesChanged" ||
            ev.type === "WorktreeStatusChanged") &&
          ev.payload.project === project
        ) {
          void load();
        }
      },
    );
  }, [events, key, project, load]);

  return { status, failure, loading, reload: () => void load() };
}
