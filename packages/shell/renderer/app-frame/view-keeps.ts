// 숨겨 둔 앱 native view의 보관소. 탭이 Float·Dock·접기로 EmbeddedView를 다시 mount해도
// view(page 상태, 로그인 popup의 window.opener)를 닫지 않고 같은 session을 다시 쓰기 위한 것이다.
// 닫는 때는 이 보관소가 아니라 Workspace가 정한다(탭이 layout에서 사라질 때).
import type { AppFrameViewState } from "../../ipc/app-frame.ts";

export interface KeptView {
  readonly session: string;
  /** 열기 입력을 이은 글. 입력이 바뀐 view를 다시 쓰지 않게 한다. */
  readonly signature: string;
  state: AppFrameViewState;
}

export interface ViewKeeps {
  /** signature가 같은 보관 view를 꺼낸다(꺼내면 보관에서 빠진다). signature가 다르면 그 view를 닫고 undefined. */
  take(key: string, signature: string): KeptView | undefined;
  /** 같은 key에 이미 있으면 먼저 것을 닫는다. */
  put(key: string, view: KeptView): void;
  /** key의 view를 닫는다(보관 중이면). */
  release(key: string): void;
  /** 보관 중인 key 모두. */
  keys(): readonly string[];
}

export function createViewKeeps(close: (session: string) => void): ViewKeeps {
  const kept = new Map<string, KeptView>();
  return {
    take(key, signature) {
      const view = kept.get(key);
      if (view === undefined) return undefined;
      kept.delete(key);
      if (view.signature !== signature) {
        close(view.session);
        return undefined;
      }
      return view;
    },
    put(key, view) {
      const previous = kept.get(key);
      if (previous !== undefined && previous.session !== view.session) {
        close(previous.session);
      }
      kept.set(key, view);
    },
    release(key) {
      const view = kept.get(key);
      if (view === undefined) return;
      kept.delete(key);
      close(view.session);
    },
    keys: () => [...kept.keys()],
  };
}
