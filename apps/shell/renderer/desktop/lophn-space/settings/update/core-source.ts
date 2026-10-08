// UpdateSource를 main의 core 통로로 만든다. metadata 파일 선택은 main의 OS 선택기고, notice는
// main이 core의 신뢰 입구(updateNotice)로 계산해 돌려준다. 정상 정지도 main의 core 입구다.
// 이 source는 뭘 다운로드·설치하지 않는다: 안내와 정상 정지 요청만 있다.
import type { CoreSource } from "../../../connection/connection.ts";
import type { FolderPickerApi } from "../../../../../ipc/folder-picker.ts";
import { windowFolderPicker } from "../../../launcher/core-source.ts";
import type {
  UpdateNoticeResult,
  UpdatePackageView,
  UpdateSource,
} from "./source.ts";

/** preload의 update 통로. 없는 창이면 undefined다. */
export type UpdateTransport = {
  readPackage(path: string): Promise<unknown>;
  notice(candidate: unknown): Promise<unknown>;
  stop(): Promise<unknown>;
};

export function windowUpdate(): UpdateTransport | undefined {
  const shell = (globalThis as {
    lophnUpdate?: { readPackage: unknown; notice: unknown; stop: unknown };
  }).lophnUpdate;
  return shell !== undefined &&
      typeof shell.readPackage === "function" &&
      typeof shell.notice === "function" &&
      typeof shell.stop === "function"
    ? (shell as unknown as UpdateTransport)
    : undefined;
}

export interface UpdateDeps {
  update: UpdateTransport | undefined;
  picker: FolderPickerApi | undefined;
}

export function coreUpdateSource(
  core: CoreSource,
  deps: Partial<UpdateDeps> = {},
): UpdateSource {
  const update = "update" in deps ? deps.update : windowUpdate();
  const picker = "picker" in deps ? deps.picker : windowFolderPicker();

  return {
    watch: (listener) => core.subscribe(listener),

    async choosePackage() {
      // OS 선택기로 고른 파일의 경로를 main이 읽는다. 기본 로딩 대화상자 없이 바로 고른다.
      const picked = picker === undefined
        ? { ok: false as const, code: "unavailable" }
        : await picker.pick();
      if (!picked.ok) return { ok: false, code: picked.code };
      if (picked.path === null) return { ok: true, value: null };
      if (update === undefined) return { ok: false, code: "unavailable" };
      try {
        const read = await update.readPackage(picked.path) as
          | { ok: true; value: UpdatePackageView }
          | { ok: false; code: string };
        if (!read.ok) return { ok: false, code: read.code };
        return { ok: true, value: read.value };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },

    async notice(candidate) {
      if (update === undefined) {
        return { state: "failed", code: "unavailable" };
      }
      try {
        const reply = await update.notice(candidate) as
          | { ok: true; value: UpdateNoticeResult }
          | { ok: false; code: string };
        if (!reply.ok) return { state: "failed", code: reply.code };
        return reply.value;
      } catch (error) {
        // OS 불일치 거절은 main이 mismatch로 구별해 보낸다. transport 오류는 code다.
        const stop = error as { mismatch?: unknown } | undefined;
        return typeof stop === "object" && stop !== null &&
            stop.mismatch === true
          ? { state: "failed", mismatch: true }
          : { state: "failed", code: "unavailable" };
      }
    },

    async stopForUpdate() {
      if (update === undefined) return { ok: false, code: "unavailable" };
      try {
        const reply = await update.stop() as
          | { ok: true; value: boolean }
          | { ok: false; code: string };
        if (!reply.ok) return { ok: false, code: reply.code };
        return { ok: true, value: reply.value };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}
