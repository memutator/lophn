// 창 preload가 연 파일 통로. 끌어 놓거나 붙여 넣거나 고른 OS 파일의 절대 경로와, Explorer에서 끌어 온
// 이미지 파일의 바이트를 얻는다.
import type { FilesApi } from "../../ipc/files.ts";
import type { FolderPickerApi } from "../../ipc/folder-picker.ts";

/** 통로가 없는 창(gallery, 테스트)은 undefined라 composer에 이미지만 붙는다. */
export function windowPathOf(): ((file: File) => string | null) | undefined {
  const bridge = (globalThis as { lophnFolders?: FolderPickerApi })
    .lophnFolders;
  return bridge === undefined ? undefined : (file) => bridge.pathForFile(file);
}

/** Explorer에서 끌어 온 이미지 파일의 바이트. 통로가 없거나 읽지 못하면 null이라 경로 chip으로 붙는다. */
export function windowReadImage():
  | ((path: string) => Promise<File | null>)
  | undefined {
  const bridge = (globalThis as { lophnFiles?: FilesApi }).lophnFiles;
  if (bridge === undefined) return undefined;
  return async (path) => {
    const read = await bridge.readBytes({ path });
    if (!read.ok) return null;
    return new File(
      [new Uint8Array(read.value.bytes)],
      path.slice(path.lastIndexOf("/") + 1),
      {
        type: read.value.content_type,
      },
    );
  };
}
