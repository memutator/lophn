import { useEffect, useState } from "react";

// 앱 view preload bridge `lophnApp.files`의 SDK 쪽 사본(protocol/shell/app-bridge-types.ts).
export interface FilesBridge {
  locate(file: string): Promise<{ uri: string }>;
}

export type AppFileState =
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "failed"; code: string };

const LOADING: AppFileState = { status: "loading" };

function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^([a-z_]+):/.exec(message)?.[1] ?? "unavailable";
}

/**
 * 앱 file의 손잡이(`{ file, ... }`)를 화면이 그릴 주소로 바꾼다. 손잡이가 없는 동안(null·undefined)과 받아 오는 동안은 `loading`이고,
 * 되면 `ready`의 `uri`를 `<img src>`나 React Native `<Image source={{ uri }}>`에 그대로 쓴다. `failed`의 `code`는 오류 code다.
 * 손잡이의 `file`이 바뀌면 다시 푼다. 앱 view 밖이면 `failed`(`unavailable`)다.
 */
export function useAppFile(
  handle: { file: string } | null | undefined,
  bridge: FilesBridge | undefined = (
    globalThis as { lophnApp?: { files?: FilesBridge } }
  ).lophnApp?.files,
): AppFileState {
  const file = handle?.file;
  const [settled, setSettled] = useState<{
    file: string;
    state: AppFileState;
  } | null>(null);
  useEffect(() => {
    if (file === undefined) return;
    let current = true;
    const settle = (state: AppFileState) => {
      if (current) setSettled({ file, state });
    };
    if (bridge === undefined) {
      settle({ status: "failed", code: "unavailable" });
      return;
    }
    bridge.locate(file).then(
      ({ uri }) => settle({ status: "ready", uri }),
      (error) => settle({ status: "failed", code: codeOf(error) }),
    );
    return () => {
      current = false;
    };
  }, [file, bridge]);
  return file !== undefined && settled?.file === file ? settled.state : LOADING;
}
