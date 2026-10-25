import {
  FILE_PICK_CHANNEL,
  FOLDER_PICK_CHANNEL,
  type FolderPickerApi,
  type FolderPickReply,
} from "../ipc/folder-picker.ts";

interface FolderTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

/** Electron `webUtils`. File.path가 없어져 preload에서만 경로를 얻는다. */
interface FilePaths {
  getPathForFile(file: File): string;
}

// 경로는 main이 연 OS dialog의 결과나 사람이 끌어 놓은 파일의 것만 온다. 통로 실패는 고정 오류로 바꾼다.
export function createFolderApi(
  transport: FolderTransport,
  paths: FilePaths,
): FolderPickerApi {
  async function invoke(
    channel: string,
    input: unknown,
  ): Promise<FolderPickReply> {
    try {
      return await transport.invoke(channel, input) as FolderPickReply;
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }
  return Object.freeze(
    {
      pick: (input) => invoke(FOLDER_PICK_CHANNEL, input ?? {}),
      pickFile: () => invoke(FILE_PICK_CHANNEL, {}),
      pathForFile: (file) => {
        try {
          return paths.getPathForFile(file) || null;
        } catch {
          return null;
        }
      },
    } satisfies FolderPickerApi,
  );
}
