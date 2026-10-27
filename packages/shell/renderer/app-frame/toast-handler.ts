// 앱 공간이 보이는 동안 toast 행동 처리기를 등록한다. 이 공간이 처리하지 못하는 것(다른 앱, project)은 false를 돌려
// 기본 처리기가 다른 화면으로 가서 열게 한다.
import { useEffect, useRef } from "react";

import { useWaitingPanel } from "../desktop/connection/waiting/waiting-layer.tsx";
import {
  registerToastActionHandler,
  type ToastAction,
} from "../desktop/connection/toasts/toast-actions.ts";

interface SpaceReactionHost {
  readonly app: string;
  /**
   * session이 있으면 이 앱의 agent session일 때 pane을 그 session으로 열고 true. session이 없으면 이 앱의
   * App Engineer 새 대화를 연다. 이 앱의 것이 아니면 false.
   */
  openSession(session: string | null, app: string | undefined): boolean;
}

export function useToastHandler(host: SpaceReactionHost): void {
  const latest = useRef(host);
  latest.current = host;
  const { setOpen } = useWaitingPanel();
  useEffect(
    () =>
      registerToastActionHandler((action: ToastAction) => {
        switch (action.kind) {
          case "waiting":
            setOpen(true);
            return true;
          case "session":
            return latest.current.openSession(action.session, action.app);
        }
      }),
    [setOpen],
  );
}
