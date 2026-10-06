// handler가 쓰는 바깥 자원(저장소·시계·파일·화면 상태)과 그것을 여는 공통 틀. test는 이 값을 바꿔 쓴다.
import { CapabilityError, readTextFile, writeTextFile } from "@lophn/cap-fs";
import { CommandRejection } from "@lophn/cap-schedule";
import { reportProblem } from "@lophn/cap-problem";
import { openStore, type Store } from "@lophn/cap-store";
import { EXPORT_DIR, IMPORT_DIR } from "./places.ts";
import { ensureSchema } from "./todos.ts";

// 한 view session이 지금 고치는 할 일이다. 앱 메모리에만 있고 view가 닫히면 runtime이 그 session을 막는다.
export type View = { todo: number | null };

export type Deps = {
  openStore: () => Store;
  now: () => string;
  dirs: { export: string; import: string };
  files: {
    readText: (path: string) => Promise<string>;
    writeText: (path: string, text: string) => Promise<void>;
  };
  views: Map<string, View>;
};

export const defaults: Deps = {
  openStore: () => openStore(),
  now: () => new Date().toISOString(),
  dirs: { export: EXPORT_DIR, import: IMPORT_DIR },
  files: { readText: readTextFile, writeText: writeTextFile },
  views: new Map(),
};

// 저장소를 열고 일을 한다. 저장소가 실패하면 선언한 code로 보고하고 호출자에게는 이유 없는 거절만 돌려준다.
// 보고가 실패해도 업무 응답은 막지 않는다. 입력·DB 내용은 보고에 넣지 않는다.
export async function withStore<T>(
  deps: Deps,
  name: string,
  work: (store: Store) => T,
): Promise<T> {
  let store: Store | undefined;
  try {
    store = deps.openStore();
    await ensureSchema(store);
    return work(store);
  } catch (error) {
    if (error instanceof CommandRejection) throw error;
    reportProblem("store_unavailable", { command: name });
    throw new CommandRejection("unavailable", "the todo store is unavailable");
  } finally {
    store?.close();
  }
}

// 파일 접근 실패를 호출자에게 알린다. 허락 밖은 필요한 permission 이름과 경로(선언 값)를, 없는 파일은 입력
// 오류로, 그 밖의 실패는 선언한 code로 보고하고 원문 없는 거절을 돌려준다.
export function fileFailure(error: unknown, name: string): never {
  if (error instanceof CommandRejection) throw error;
  if (error instanceof CapabilityError && error.code === "forbidden") {
    throw new CommandRejection("forbidden", error.message);
  }
  if (error instanceof CapabilityError && error.code === "not_found") {
    throw new CommandRejection("invalid_input", "the file does not exist");
  }
  reportProblem("file_unavailable", { command: name });
  throw new CommandRejection("unavailable", "the todo file is unavailable");
}
