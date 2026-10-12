// context worker 일의 시험이 함께 쓰는 fake. 제품 코드는 import하지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import type { ProjectFiles } from "./extract/types.ts";
import { inlineFiles } from "./extract/testing.ts";
import type { WatchFolder } from "./watch/mod.ts";
import type {
  FinishCheckInput,
  RecordViolationsInput,
  Snapshot,
  SnapshotPort,
  SubmitPort,
} from "./work-types.ts";

export const CHECK = "chk_00000000000000000000000001";

export type FakeSubmit = SubmitPort & {
  // 순서대로 낸 command와 입력
  readonly calls: (
    | { command: "bundle.finish_check"; input: FinishCheckInput }
    | { command: "context.record_violations"; input: RecordViolationsInput }
  )[];
};

export function fakeSubmit(
  options: {
    log?: string[];
    // 기본은 ok. 오류나 보류하는 promise를 돌려줄 수 있다.
    recordViolations?: (
      input: RecordViolationsInput,
    ) => Promise<Result<unknown>>;
    finishCheck?: (input: FinishCheckInput) => Promise<Result<unknown>>;
  } = {},
): FakeSubmit {
  const calls: FakeSubmit["calls"] = [];
  return {
    calls,
    async finishCheck(input) {
      calls.push({ command: "bundle.finish_check", input });
      options.log?.push("submit:finish_check");
      return options.finishCheck ? await options.finishCheck(input) : ok({});
    },
    async recordViolations(input) {
      calls.push({ command: "context.record_violations", input });
      options.log?.push(`submit:record_violations:${input.context}`);
      return options.recordViolations
        ? await options.recordViolations(input)
        : ok({});
    },
  };
}

export const failure = (
  code: LophnError["code"],
): Promise<Result<never>> =>
  Promise.resolve(err({ code, message: `fake ${code}` }));

// 독립된 폴더 덮음 판정(제품의 folderCovers와 따로 쓴다).
function covered(folders: readonly WatchFolder[], path: string): boolean {
  const slash = path.lastIndexOf("/");
  const parent = slash < 0 ? "" : path.slice(0, slash);
  return folders.some((folder) =>
    folder.recursive
      ? folder.path === "" || parent === folder.path ||
        parent.startsWith(`${folder.path}/`)
      : parent === folder.path
  );
}

export type FakeSnapshots = SnapshotPort & {
  readonly created: {
    check: string;
    folders: WatchFolder[];
    paths: string[];
  }[];
  readonly removed: string[];
};

// project의 파일 중 folders가 덮는 것만 복사한 snapshot을 낸다. failWith가 있으면 만들지 못한다.
export function fakeSnapshots(
  project: ProjectFiles,
  options: { log?: string[]; failWith?: LophnError } = {},
): FakeSnapshots {
  const created: FakeSnapshots["created"] = [];
  const removed: string[] = [];
  return {
    created,
    removed,
    create(check, folders): Result<Snapshot> {
      if (options.failWith) return err(options.failWith);
      const copy: Record<string, string> = {};
      for (const path of project.paths()) {
        if (covered(folders, path)) copy[path] = project.read(path) ?? "";
      }
      created.push({
        check,
        folders: [...folders],
        paths: Object.keys(copy).sort(),
      });
      options.log?.push("snapshot:create");
      return ok({
        files: inlineFiles(copy),
        remove() {
          if (!removed.includes(check)) {
            removed.push(check);
            options.log?.push("snapshot:remove");
          }
        },
      });
    },
  };
}
