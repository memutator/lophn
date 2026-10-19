// project 창이 보이는 동안 toast 행동 처리기를 등록한다. 이 창이 처리하지 못하는 것(다른 project, 앱 공간)은
// false를 돌려 기본 처리기가 다른 화면으로 가서 열게 한다.
import { useEffect, useRef } from "react";

import { useWaitingPanel } from "../../desktop/connection/waiting/waiting-layer.tsx";
import {
  registerToastActionHandler,
  type ToastAction,
} from "../../desktop/connection/toasts/toast-actions.ts";

interface ReactionHost {
  readonly project: string;
  /** 이 project의 session이면 그 Agent 탭을 열고 true. 아니면 false. */
  openSession(session: string): boolean;
}

export function useToastHandler(host: ReactionHost): void {
  const latest = useRef(host);
  latest.current = host;
  const { setOpen } = useWaitingPanel();
  useEffect(() =>
    registerToastActionHandler((action: ToastAction) => {
      const current = latest.current;
      switch (action.kind) {
        case "waiting":
          setOpen(true);
          return true;
        case "session":
          // session이 없는 쪽은 앱 재시작 중단 반응이다. 앱 공간으로 가는 기본 처리기가 맡는다.
          return action.session !== null && current.openSession(action.session);
      }
    }), [setOpen]);
}
