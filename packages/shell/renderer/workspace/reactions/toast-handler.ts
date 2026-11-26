// workspace 창이 보이는 동안 toast 행동 처리기를 등록한다. 이 창이 처리하지 못하는 것(다른 project, 앱 공간)은
// false를 돌려 기본 처리기가 다른 화면으로 가서 열게 한다.
import { useEffect, useRef } from "react";
import {
  registerToastActionHandler,
  type ToastAction,
} from "../../desktop/connection/toasts/toast-actions.ts";
import { useWaitingPanel } from "../../desktop/connection/waiting/waiting-layer.tsx";

interface ReactionHost {
  /** 이 workspace의 기계. null은 이 컴퓨터다. */
  machine: string | null;
  /** 이 workspace의 session이면 그 Agent 탭을 열고 true. 아니면 false. */
  openSession(session: string): boolean;
  /** 이 workspace에 이미 열린 그 터미널 탭이 있으면 고르고 true. 아니면 false. */
  revealTerminal?(terminal: string): boolean;
}

export function useToastHandler(host: ReactionHost): void {
  const latest = useRef(host);
  latest.current = host;
  const { setOpen } = useWaitingPanel();
  useEffect(
    () =>
      registerToastActionHandler((action: ToastAction) => {
        const current = latest.current;
        switch (action.kind) {
          case "waiting":
            setOpen(true);
            return true;
          case "session":
            // session이 없는 쪽은 앱 재시작 중단 toast다. 다른 기계의 session도 기본 처리기가 그 기계의 workspace로 가서 연다.
            return (
              action.session !== null &&
              (action.machine ?? null) === current.machine &&
              current.openSession(action.session)
            );
          case "terminal":
            return (
              action.machine === current.machine &&
              (current.revealTerminal?.(action.terminal) ?? false)
            );
        }
      }),
    [setOpen],
  );
}
