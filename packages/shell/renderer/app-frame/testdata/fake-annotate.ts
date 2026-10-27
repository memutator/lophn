// gallery와 dev-mock이 쓰는 annotate 통로. 목록을 메모리에 들고 구독자에게 알린다. 앱 view가 없으니 고르기는 흉내 내지 않고
// 처음 가진 목록만 지우고 보낼 수 있다.
import type {
  AnnotateErrorCode,
  AnnotateState,
  LophnShellAnnotateApi,
} from "../../../ipc/annotation.ts";

interface FakeAnnotateOptions {
  /** 처음 모아 둔 목록. */
  readonly items?: AnnotateState["items"];
  /** 보내기가 이 code로 거절된다. */
  readonly sendFails?: AnnotateErrorCode;
}

const SESSION = "ses_01h455vb4pex5v6nkc6gd5fd01";

export function fakeAnnotate(
  options: FakeAnnotateOptions = {},
): LophnShellAnnotateApi {
  let state: AnnotateState = {
    view_session: "",
    on: false,
    phase: "idle",
    items: options.items ?? [],
  };
  const listeners = new Set<(state: AnnotateState) => void>();
  const push = (next: AnnotateState) => {
    state = next;
    for (const listener of [...listeners]) listener(state);
    return state;
  };
  return {
    setMode: ({ view_session, on }) =>
      Promise.resolve(push({ ...state, view_session, on })),
    remove: ({ view_session, n }) =>
      Promise.resolve(
        push({
          ...state,
          view_session,
          items: n === "all" ? [] : state.items.filter((item) => item.n !== n),
        }),
      ),
    send: ({ view_session }) => {
      if (options.sendFails !== undefined) {
        return Promise.reject(new Error(options.sendFails));
      }
      const sent = state.items.length;
      push({ ...state, view_session, on: false, items: [] });
      return Promise.resolve({ sent, session: SESSION });
    },
    subscribeState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
