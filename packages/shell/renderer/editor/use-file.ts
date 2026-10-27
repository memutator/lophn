// 파일 하나를 읽는 hook 둘. 글은 창의 편집 session으로 열고, 이미지·pdf는 바이트를 읽어 blob URL로
// 만든다. 8 MiB를 넘는 글은 편집 session을 열지 못해 읽기용으로만 보인다.
import { useEffect, useState } from "react";

import type { FileFailure } from "../../ipc/files.ts";
import { fileNameOf, isInstructionsFile } from "./model.ts";
import type { SaveSession } from "./save-state.ts";
import type { EditorSessions } from "./sessions.ts";

type TextFile =
  | { readonly kind: "loading" }
  | {
      readonly kind: "ready";
      readonly session: SaveSession;
      readonly initial: string;
    }
  | { readonly kind: "too_large"; readonly text: string | null }
  | { readonly kind: "failed"; readonly code: FileFailure };

/** 글 파일을 연다. 탭이 사라지면 session을 놓는다(저장이 남으면 창이 붙든다). */
export function useTextFile(
  sessions: EditorSessions,
  path: string,
  attempt: number,
): TextFile {
  const [file, setFile] = useState<TextFile>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    let attached = false;
    setFile({ kind: "loading" });
    void (async () => {
      const opened = await sessions.attach(
        path,
        fileNameOf(path),
        isInstructionsFile(path),
      );
      if (typeof opened !== "string") {
        attached = true;
        if (live) {
          setFile({
            kind: "ready",
            session: opened.session,
            initial: opened.text,
          });
        } else sessions.detach(path);
        return;
      }
      if (!live) return;
      if (opened !== "too_large") {
        setFile({ kind: "failed", code: opened });
        return;
      }
      const bytes = await sessions.files.readBytes({ path });
      if (live) {
        setFile({
          kind: "too_large",
          text: bytes.ok ? new TextDecoder().decode(bytes.value.bytes) : null,
        });
      }
    })();
    return () => {
      live = false;
      if (attached) sessions.detach(path);
    };
  }, [sessions, path, attempt]);
  return file;
}

type MediaFile =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string; readonly size: number }
  | { readonly kind: "failed"; readonly code: FileFailure };

/** 이미지·pdf를 읽어 blob URL로 만든다. 밖에서 바뀌면 다시 읽는다. */
export function useMediaFile(
  sessions: EditorSessions,
  path: string,
  attempt: number,
): MediaFile {
  const [file, setFile] = useState<MediaFile>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    let url: string | null = null;
    const load = async () => {
      const reply = await sessions.files.readBytes({ path });
      if (!live) return;
      if (!reply.ok) {
        setFile({ kind: "failed", code: reply.code });
        return;
      }
      const next = URL.createObjectURL(
        new Blob([reply.value.bytes as BlobPart], {
          type: reply.value.content_type,
        }),
      );
      if (url !== null) URL.revokeObjectURL(url);
      url = next;
      setFile({ kind: "ready", url: next, size: reply.value.bytes.byteLength });
    };
    setFile({ kind: "loading" });
    void load();
    const stop = sessions.watch(path, () => void load());
    return () => {
      live = false;
      stop();
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [sessions, path, attempt]);
  return file;
}
