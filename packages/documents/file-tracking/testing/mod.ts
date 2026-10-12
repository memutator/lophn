// leaf unit fixture. 실제 core·worker 증거는 아니다. 이 leaf의 mod.ts가 내놓지 않는다.
import { err, ok } from "../../../base/mod.ts";
import type { ContentFile } from "../../../protocol/projects/mod.ts";
import { resolveTarget } from "../file-ops.ts";
import {
  deleteFile,
  type FileDeps,
  type FileDone,
  writeFile,
} from "../files.ts";
import type { PlacementFiles } from "../placement.ts";

// 두기·빼기의 파일 port를 files.ts의 실제 알고리즘 위에 올린다. 바이트는 호출자가 준다.
export function localPlacementFiles(
  deps: FileDeps,
  options: {
    content(file: ContentFile): AsyncIterable<Uint8Array>;
    // 성공한 작업의 기록. 없으면 recorded로 본다.
    record?(operation: "write" | "delete", done: FileDone): void;
  },
): PlacementFiles {
  const recorded = (operation: "write" | "delete", done: FileDone) => {
    if (done.outcome === "unverified") return "unverified" as const;
    options.record?.(operation, done);
    return "recorded" as const;
  };
  return {
    async writeNew(input) {
      const written = await writeFile(deps, {
        root: input.root,
        path: input.path,
        baseHash: null,
        content: options.content(input.file),
        contentHash: input.file.blob_hash,
      });
      if (!written.ok) return written;
      return ok({
        done: written.value,
        recording: recorded("write", written.value),
      });
    },
    async exists(input) {
      const resolved = await resolveTarget(deps.ops, input.root, input.path);
      return resolved.ok ? ok(resolved.value.stat !== undefined) : resolved;
    },
    async remove(input) {
      const deleted = await deleteFile(deps, {
        root: input.root,
        path: input.path,
        baseHash: input.baseHash,
      });
      if (!deleted.ok) return err(deleted.error);
      return ok({
        done: deleted.value,
        recording: recorded("delete", deleted.value),
      });
    },
  };
}
