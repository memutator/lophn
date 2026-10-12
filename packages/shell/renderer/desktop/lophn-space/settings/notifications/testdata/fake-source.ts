// notification 자리 화면 테스트의 가짜 통로. core를 부르지 않고 부른 것을 기록한다. 실제 OS
// notification은 이 통로에 없다: apply만 기록한다.
import type { NotificationsSource, NotificationsView } from "../source.ts";

export interface FakeNotificationsOptions {
  enabled?: boolean | null;
  readFail?: boolean;
  /** 설정 저장 결과 code. 없으면 성공이다. */
  setCode?: string;
}

export function fakeNotifications(options: FakeNotificationsOptions = {}) {
  const calls: unknown[][] = [];
  let revision = 3;
  const defaultsRevision = "d1";
  let enabled = options.enabled ?? null;
  const view = (): NotificationsView => ({
    enabled,
    revision,
    defaultsRevision,
  });
  const source: NotificationsSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    notifications() {
      calls.push(["notifications"]);
      if (options.readFail) {
        return Promise.resolve({ ok: false, code: "unavailable" });
      }
      return Promise.resolve({ ok: true, value: view() });
    },
    setNotifications(was, next) {
      calls.push(["set", next, was.revision, was.defaultsRevision]);
      if (options.setCode) {
        return Promise.resolve({ ok: false, code: options.setCode });
      }
      enabled = next;
      revision += 1;
      return Promise.resolve({ ok: true, value: null });
    },
  };
  return { source, calls };
}
