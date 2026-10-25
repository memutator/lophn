// 메시지에 붙이는 이미지. 올려서 id를 받고, 화면에 그릴 때는 file route로 읽어 blob URL로 기억한다.
// 메시지 content는 글뿐이라 이미지는 글 끝 줄(attachments.ts)의 id로만 이어진다.
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { SourceResult } from "./agent-tab-source.ts";

export interface ImageSource {
  uploadImage(
    session: string,
    image: Blob,
  ): Promise<SourceResult<{ id: string }>>;
  imageUrl(session: string, id: string): Promise<string | null>;
}

export function createImageSource(core: CoreSource): ImageSource {
  // 키는 `<session>/<id>`. 같은 이미지를 여러 번 그려도 한 번만 읽는다.
  const urls = new Map<string, Promise<string | null>>();

  return {
    async uploadImage(session, image) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await image.arrayBuffer());
      } catch {
        return { ok: false, code: "unavailable" };
      }
      try {
        const reply = await core.call({
          kind: "upload",
          resource: "message-images",
          method: "upload",
          body: { session, content_type: image.type, bytes: bytes.byteLength },
          bytes,
        });
        if (!reply.ok) {
          return { ok: false, code: reply.error?.code ?? "internal" };
        }
        const { id } = reply.value as { id: string };
        // 올린 직후의 미리 보기는 이미 가진 blob으로 그린다.
        urls.set(
          `${session}/${id}`,
          Promise.resolve(URL.createObjectURL(image)),
        );
        return { ok: true, value: { id } };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },

    imageUrl(session, id) {
      const key = `${session}/${id}`;
      let url = urls.get(key);
      if (url === undefined) {
        url = readImage(core, session, id);
        urls.set(key, url);
        // 못 읽은 것은 기억하지 않아 다음에 다시 읽는다.
        void url.then((value) => {
          if (value === null) urls.delete(key);
        });
      }
      return url;
    },
  };
}

async function readImage(
  core: CoreSource,
  session: string,
  image: string,
): Promise<string | null> {
  try {
    const reply = await core.call({
      kind: "file",
      resource: "message-images",
      method: "read",
      body: { session, image },
    });
    if (!reply.ok) return null;
    const file = reply.value as { bytes: Uint8Array; contentType: string };
    return URL.createObjectURL(
      new Blob([file.bytes.slice()], { type: file.contentType }),
    );
  } catch {
    return null;
  }
}
