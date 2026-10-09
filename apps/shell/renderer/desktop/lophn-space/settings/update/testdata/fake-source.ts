// update 자��� 화면 테스트의 가짜 통로. OS 선택기와 main update 통로를 부르지 않고 부른 것을
// 기록한다. 실제 설치·다운로드는 이 통로에 없다.
import type { UpdatePackageView, UpdateSource } from "../source.ts";

export interface FakeUpdateOptions {
  /** OS 선택기가 고른 경로. null이면 그만두었다. */
  picked?: string | null;
  /** 선택기로 고른 파일을 읽은 결과. null이면 읽지 못한다. */
  candidate?: UpdatePackageView | null;
  /** notice 결과(ok 값). 없으면 unavailable이다. */
  notice?: {
    readonly ok: true;
    readonly currentVersion: string;
    readonly newVersion: string;
    readonly os: string;
    readonly schema:
      | "compatible"
      | "migration_required"
      | "newer_than_package";
    readonly restartRequired: boolean;
  };
  noticeCode?: string;
  noticeMismatch?: boolean;
  stopCode?: string;
}

export function fakeUpdate(options: FakeUpdateOptions = {}) {
  const calls: unknown[][] = [];
  const source: UpdateSource = {
    watch(listener) {
      listener({ state: "ready" });
      return () => {};
    },
    choosePackage() {
      calls.push(["picked"]);
      // 선탠자가 그만두면 null이다.
      if (options.picked === null) {
        return Promise.resolve({ ok: true as const, value: null });
      }
      if (options.candidate === undefined) {
        return Promise.resolve({ ok: false as const, code: "invalid_input" });
      }
      // 파일이 update metadata가 아니면 null이다(업데이트가 아닌 파일).
      if (options.candidate === null) {
        return Promise.resolve({ ok: false as const, code: "invalid_input" });
      }
      return Promise.resolve({ ok: true as const, value: options.candidate });
    },
    notice(candidate) {
      calls.push(["notice", candidate]);
      if (options.noticeCode) {
        return Promise.resolve(
          options.noticeMismatch
            ? { ok: false as const, state: "failed" as const, mismatch: true }
            : {
              ok: false as const,
              state: "failed" as const,
              code: options.noticeCode,
            },
        );
      }
      if (options.notice === undefined) {
        return Promise.resolve({
          ok: false as const,
          state: "failed" as const,
          code: "unavailable",
        });
      }
      return Promise.resolve({
        ok: true as const,
        state: "ready" as const,
        currentVersion: options.notice.currentVersion,
        newVersion: options.notice.newVersion,
        os: options.notice.os,
        schema: options.notice.schema,
        restartRequired: options.notice.restartRequired,
      });
    },
    stopForUpdate() {
      calls.push(["stop"]);
      if (options.stopCode) {
        return Promise.resolve({ ok: false as const, code: options.stopCode });
      }
      return Promise.resolve({ ok: true as const, value: true });
    },
  };
  return { source, calls };
}
