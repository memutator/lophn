// 사람 파일 작업의 목표 풀이. FileTarget을 준비 worker가 열 실제 root와 경로로 바꾼다.
// 범위 밖·없는 project·허용하지 않는 종류는 모두 같은 invalid_input이다(존재를 새지 않는다).
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type { FileTarget } from "../../../packages/contracts/documents/mod.ts";
import type { FileOps } from "../../../packages/documents/file-tracking/file-ops.ts";
import type { FileLocation } from "../../../packages/documents/file-tracking/file-ipc.ts";
import {
  type WorkingCopyLocation,
  workingCopyLocation,
} from "../../../packages/documents/file-tracking/working-copy.ts";
import type { BasisStore } from "./basis.ts";

export function notAvailable(): Result<never, LophnError> {
  return err({ code: "invalid_input", message: "target is not available" });
}

export type Located = {
  location: FileLocation;
  copy?: WorkingCopyLocation;
  // 같은 목표의 작업을 줄 세우는 key.
  key: string;
};

export type LocatorDeps = {
  // LOPHN_HOME. working copy 폴더의 근원이다.
  dataRoot: string;
  // 파일을 쓸 수 있는 폴더는 관측 root(tracking)가 아니라 등록 폴더 전부다.
  basis: Pick<BasisStore, "folders" | "instructions">;
  ops: Pick<FileOps, "realPath" | "makeDirectory">;
};

export type Locator = {
  locate(target: FileTarget): Promise<Result<Located, LophnError>>;
  // 등록한 project 폴더 중 경로를 담은 것. project가 다르거나 폴더 밖이면 없다.
  rootOf(project: string, path: string): string | undefined;
  canonicalKey(path: string): Promise<string>;
  // working copy 폴더는 첫 쓰기에서 만든다. 부모는 coordinator가 미리 만든다.
  ensureCopyDirectories(
    copy: WorkingCopyLocation,
  ): Promise<Result<void, LophnError>>;
};

export function createLocator(deps: LocatorDeps): Locator {
  async function canonicalKey(path: string): Promise<string> {
    const slash = path.lastIndexOf("/");
    const parent = await deps.ops.realPath(
      slash <= 0 ? "/" : path.slice(0, slash),
    );
    return parent === undefined
      ? path
      : `${parent === "/" ? "" : parent}${path.slice(slash)}`;
  }

  function rootOf(project: string, path: string): string | undefined {
    return deps.basis.folders().find((entry) =>
      entry.project === project &&
      path.startsWith(entry.path === "/" ? "/" : `${entry.path}/`)
    )?.path;
  }

  return {
    rootOf,
    canonicalKey,
    async locate(target) {
      if (target.kind === "project_file") {
        const root = rootOf(target.project, target.path);
        if (root === undefined) return notAvailable();
        return ok({
          location: { root, path: target.path },
          key: await canonicalKey(target.path),
        });
      }
      if (target.kind === "instruction_file") {
        // 사람이 [Instructions]로 연 exact 등록 파일만이다. 임의 경로·다른 target 참조는 같은
        // invalid_input이다. 전역 파일의 폴더(data root)는 쓸 수 없어 임시 파일은 staging에 둔다.
        const entry = deps.basis.instructions().find((item) =>
          item.path === target.path &&
          item.instruction_target === target.instruction_target &&
          item.project === target.project
        );
        if (entry === undefined) return notAvailable();
        if (entry.project === null) {
          try {
            await deps.ops.makeDirectory(`${deps.dataRoot}/documents`);
            await deps.ops.makeDirectory(`${deps.dataRoot}/documents/staging`);
          } catch {
            return notAvailable();
          }
        }
        const slash = entry.path.lastIndexOf("/");
        return ok({
          location: {
            root: slash <= 0 ? "/" : entry.path.slice(0, slash),
            path: entry.path,
            ...(entry.project === null
              ? { temp_root: `${deps.dataRoot}/documents/staging` }
              : {}),
          },
          key: await canonicalKey(entry.path),
        });
      }
      if (target.kind === "working_copy") {
        const copy = workingCopyLocation(deps.dataRoot, target.document);
        if (!copy.ok) return notAvailable();
        return ok({
          location: {
            root: copy.value.root,
            path: copy.value.content,
            meta: copy.value.meta,
          },
          copy: copy.value,
          key: copy.value.content,
        });
      }
      return notAvailable();
    },
    async ensureCopyDirectories(copy) {
      try {
        // `documents`·`working-copies`·doc 폴더를 위에서부터 만든다(부모는 만들지 않는 호출이다).
        await deps.ops.makeDirectory(
          copy.parent.slice(0, copy.parent.lastIndexOf("/")),
        );
        await deps.ops.makeDirectory(copy.parent);
        await deps.ops.makeDirectory(copy.root);
        return ok(undefined);
      } catch {
        return err({
          code: "unavailable",
          message: "working copy unavailable",
        });
      }
    },
  };
}
