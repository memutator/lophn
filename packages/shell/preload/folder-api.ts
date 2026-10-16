import {
  FILE_PICK_CHANNEL,
  FOLDER_PICK_CHANNEL,
  type FolderPickerApi,
  type FolderPickReply,
} from "../ipc/folder-picker.ts";

interface FolderTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

// 경로는 main이 연 OS dialog의 결과만 온다. 통로 실패는 고정 오류로 바꾼다.
export function createFolderApi(transport: FolderTransport): FolderPickerApi {
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
    } satisfies FolderPickerApi,
  );
}
