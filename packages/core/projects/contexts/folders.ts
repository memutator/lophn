// 초안이 lophn data 아래 어디에 놓이는지와, 그 폴더를 읽고 쓰는 얇은 port다.
// 위치만 정하고 파일 IO는 하지 않는다(IO는 writer·reader Worker 안의 ledger/deps.ts가 한다).
//   <data root>/projects/<project>/contexts/<context>/drafts/<bundle>/bundle.json
import { err, ok, type Result } from "../../../base/mod.ts";
import type { ContextFolders } from "../ports.ts";
import type { ContextDrafts } from "./api/state.ts";

export const DRAFT_FILE = "bundle.json";

// 새 context의 첫 초안, 적용된 판이 없는 context의 새 초안이 이 내용으로 시작한다. types는 Project Manager가 채운다.
export const EMPTY_DRAFT_CONTENT = { schema: 1, contract: { types: [] } };

// 모든 project의 폴더가 놓이는 상위다. 초안은 turn 중에 열려 Deno 쓰기 권한이 이 상위째 쓴다.
export function projectsRoot(dataRoot: string): string {
  return `${dataRoot}/projects`;
}

export function createContextFolders(dataRoot: string): ContextFolders {
  const contextFolder = (project: string, context: string) =>
    `${projectsRoot(dataRoot)}/${project}/contexts/${context}`;
  return {
    draftFolder: (project, context, bundle) =>
      `${contextFolder(project, context)}/drafts/${bundle}`,
  };
}

// JSON 파일 하나를 읽고 쓰는 port. 없는 파일은 읽으면 null이다.
export interface ContextFiles {
  read(path: string): Result<unknown>;
  // 폴더가 없으면 만든다.
  write(path: string, value: unknown): void;
  // 파일이나 폴더. 없으면 그대로 둔다.
  remove(path: string): void;
}

// 초안 폴더(`bundle.json` 한 파일). 폴더에 다른 파일이 있어도 무시한다.
// remove는 바로 지우지 않고 removed에 쌓는다: command의 쓰기가 성공한 뒤에 호출자가 flush한다.
export function createContextDrafts(
  folders: ContextFolders,
  files: ContextFiles,
): ContextDrafts & { flush(): void } {
  const removed: string[] = [];
  const fileOf = (project: string, context: string, bundle: string) =>
    `${folders.draftFolder(project, context, bundle)}/${DRAFT_FILE}`;
  return {
    folder: (project, context, bundle) =>
      folders.draftFolder(project, context, bundle),
    create(project, context, bundle, content) {
      const path = fileOf(project, context, bundle);
      const existing = files.read(path);
      if (existing.ok && existing.value === null) files.write(path, content);
    },
    read(project, context, bundle) {
      const read = files.read(fileOf(project, context, bundle));
      if (!read.ok) return read;
      if (read.value === null) {
        return err({
          code: "invalid_input",
          message: `the draft folder has no ${DRAFT_FILE}`,
        });
      }
      return ok(read.value);
    },
    remove(project, context, bundle) {
      removed.push(folders.draftFolder(project, context, bundle));
    },
    flush() {
      for (const folder of removed.splice(0)) files.remove(folder);
    },
  };
}
