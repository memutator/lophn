// annotate mode의 shell 쪽 상태. 고른 요소와 메모는 앱 view 안 preload가 들고 있고, 여기서는 main이 미는 목록만 듣고 단추 동작을 보낸다.
import { useCallback, useEffect, useState } from "react";

import type {
  AnnotateSendResult,
  AnnotateState,
  LophnShellAnnotateApi,
} from "../../../ipc/annotation.ts";

/** 보내기가 거절된 이유. conflict는 보관한 앱이다. */
export type SendFailure = "archived" | "failed";

interface Annotate {
  readonly state: AnnotateState | null;
  readonly failure: SendFailure | null;
  setMode(on: boolean): void;
  remove(n: number | "all"): void;
  /** 받는 쪽. agent는 앱 화면에서만 고르고(artifact·file은 core가 정한다) session은 그 agent의 열린 session, 없으면 null이다. */
  send(to: {
    session: string | null;
    agent?: string;
  }): Promise<AnnotateSendResult | null>;
}

export function useAnnotate(
  api: LophnShellAnnotateApi | undefined,
  viewSession: string | null,
): Annotate {
  const [state, setState] = useState<AnnotateState | null>(null);
  const [failure, setFailure] = useState<SendFailure | null>(null);

  useEffect(() => {
    setState(null);
    setFailure(null);
    if (api === undefined || viewSession === null) return;
    return api.subscribeState((next) => {
      if (next.view_session === viewSession) setState(next);
    });
  }, [api, viewSession]);

  const call = useCallback(
    (
      run: (
        api: LophnShellAnnotateApi,
        view_session: string,
      ) => Promise<AnnotateState>,
    ) => {
      if (api === undefined || viewSession === null) return;
      void run(api, viewSession).then(setState, () => {});
    },
    [api, viewSession],
  );

  return {
    state,
    failure,
    setMode: (on) => {
      setFailure(null);
      call((api, view_session) => api.setMode({ view_session, on }));
    },
    remove: (n) => {
      setFailure(null);
      call((api, view_session) => api.remove({ view_session, n }));
    },
    async send({ session, agent }) {
      if (api === undefined || viewSession === null) return null;
      setFailure(null);
      try {
        return await api.send({
          view_session: viewSession,
          session,
          ...(agent === undefined ? {} : { agent }),
        });
      } catch (error) {
        setFailure(
          error instanceof Error && error.message === "conflict"
            ? "archived"
            : "failed",
        );
        return null;
      }
    },
  };
}
