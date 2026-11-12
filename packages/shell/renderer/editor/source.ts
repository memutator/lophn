// 편집기가 쓰는 파일 통로. shell main이 디스크를 직접 읽고 쓰는 `FilesApi`(preload의
// `lophnFiles`)에서 이 화면이 부르는 것만 담는다. 테스트와 gallery는 fake-source.ts로 바꿔 낀다.
import type { FileFailure, FilesApi } from "../../ipc/files.ts";

export type EditorFiles = Pick<
  FilesApi,
  | "read"
  | "readBytes"
  | "write"
  | "writeBytes"
  | "delete"
  | "watch"
  | "onChanged"
  | "counts"
  | "onCloseRequest"
  | "answerClose"
>;

export type OpenFailure = FileFailure;

/** preload가 없으면 모든 호출이 unavailable로 답한다. */
export function windowEditorFiles(): EditorFiles {
  const bridge = (globalThis as { lophnFiles?: FilesApi }).lophnFiles;
  if (bridge && typeof bridge.read === "function") return bridge;
  const unavailable = () =>
    Promise.resolve({ ok: false, code: "unavailable" } as const);
  return {
    read: unavailable,
    readBytes: unavailable,
    write: unavailable,
    writeBytes: unavailable,
    delete: unavailable,
    watch: unavailable,
    onChanged: () => () => {},
    counts: () => {},
    onCloseRequest: () => () => {},
    answerClose: () => {},
  };
}
