// 앱과 project의 icon을 읽는 값과 hook. 표식이 그릴 때마다 읽으므로 짧게 캐시하고, 사람이 올리거나 지우면
// 캐시를 버리고 떠 있는 표식을 다시 읽게 한다.
import { useEffect, useState } from "react";

/** 화면이 보는 icon. src는 data URL이나 `lucide:<이름>`(IconImage가 그린다), uploaded는 사람이 올린 것이 보이는 중인지다. */
export interface IconView {
  readonly src: string | null;
  readonly uploaded: boolean;
}

/** 사람이 고른 이미지 파일. */
export interface IconFile {
  readonly type: string;
  readonly bytes: Uint8Array;
}

interface IconReply {
  // lucide는 앱이 선언한 lucide icon 이름이다(`app.icon`만 준다). src에는 `lucide:<이름>`으로 싣는다.
  icon: { content_type: string; data: string } | { lucide: string } | null;
  uploaded: boolean;
}

/** core `apps.icon`·`projects.icon`의 값을 화면 값으로 옮긴다. */
export function iconViewOf(reply: IconReply): IconView {
  const { icon } = reply;
  // lucide 이름이 이 shell에 있는지는 그릴 때 본다(useDrawableIcon). 없으면 기본 모양이다.
  let src: string | null = null;
  if (icon !== null) {
    src =
      "lucide" in icon
        ? `lucide:${icon.lucide}`
        : `data:${icon.content_type};base64,${icon.data}`;
  }
  return { src, uploaded: reply.uploaded };
}

/** core `set_icon`의 icon 입력. null이면 올린 것을 지운다. */
export function iconInputOf(
  file: IconFile | null,
): { content_type: string; data: string } | null {
  if (file === null) return null;
  // String.fromCharCode의 인자 수 상한을 피하려고 나눠 만든다.
  let binary = "";
  for (let at = 0; at < file.bytes.length; at += 8192) {
    binary += String.fromCharCode(...file.bytes.subarray(at, at + 8192));
  }
  return { content_type: file.type, data: btoa(binary) };
}

// 여러 자리가 한꺼번에 읽는 것만 하나로 합칠 만큼만 쥔다.
const CACHE_MS = 10_000;

/** icon 이미지의 data URL(앱이 lucide를 선언했으면 `lucide:<이름>`)을 주는 통로. 없거나 읽지 못하면 undefined다. */
export interface IconReader {
  (id: string): Promise<string | undefined>;
  /** 캐시를 버리고 그 id를 보는 표식에 다시 읽게 알린다. */
  forget?(id: string): void;
  subscribe?(listener: (id: string) => void): () => void;
}

export function cachedIconReader(
  load: (id: string) => Promise<string | undefined>,
  now: () => number = Date.now,
): IconReader {
  const cache = new Map<
    string,
    { at: number; icon: Promise<string | undefined> }
  >();
  const listeners = new Set<(id: string) => void>();
  const read = (id: string) => {
    const hit = cache.get(id);
    if (hit !== undefined && now() - hit.at < CACHE_MS) return hit.icon;
    const icon = load(id).catch(() => undefined);
    cache.set(id, { at: now(), icon });
    return icon;
  };
  return Object.assign(read, {
    forget(id: string) {
      cache.delete(id);
      for (const listener of listeners) listener(id);
    },
    subscribe(listener: (id: string) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
}

/** reader가 주는 icon의 data URL. id나 reader가 없으면 undefined다. */
export function useIconSrc(
  read: IconReader | undefined,
  id: string | undefined,
): string | undefined {
  // id나 reader(기계)가 바뀌면 이전 그림이 잠깐이라도 남지 않게 함께 쥔다.
  const [shown, setShown] = useState<{
    read: IconReader | undefined;
    id: string | undefined;
    src: string | undefined;
  }>({ read: undefined, id: undefined, src: undefined });
  const [version, setVersion] = useState(0);
  useEffect(
    () =>
      read?.subscribe?.((changed) => {
        if (changed === id) setVersion((value) => value + 1);
      }),
    [read, id],
  );
  useEffect(() => {
    if (id === undefined || read === undefined) return;
    let live = true;
    void read(id).then((src) => {
      if (live) setShown({ read, id, src });
    });
    return () => {
      live = false;
    };
  }, [id, read, version]);
  return shown.read === read && shown.id === id ? shown.src : undefined;
}
