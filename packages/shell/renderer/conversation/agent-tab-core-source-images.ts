// 메시지에 붙이는 이미지. 올려서 blob hash를 받아 image block에 싣고, 화면에 그릴 때는 file route로 읽어 blob URL로
// 기억한다. 올림은 session을 모른다: 올린 blob은 그것을 실은 메시지가 그 session에서 참조하면서 읽힌다.
// 그래서 보내는 중인 줄은 core에서 읽으면 아직 참조가 없어 not_found다. 이 화면이 올린 이미지는 올린 바이트로 그린다.
import type { CoreSource } from "../desktop/connection/connection.ts";
import type { ContentBlock } from "../../../protocol/lophn-agent/content-block.ts";
import type { SourceResult } from "./agent-tab-source.ts";

export interface ImageSource {
  uploadImage(image: Blob): Promise<SourceResult<{ block: ContentBlock }>>;
  imageUrl(session: string, id: string): Promise<string | null>;
}

export function createImageSource(core: CoreSource): ImageSource {
  // 키는 `<session>/<id>`. 같은 이미지를 여러 번 그려도 한 번만 읽는다.
  const urls = new Map<string, Promise<string | null>>();
  // 이 화면이 올린 이미지. 키는 blob hash. 바이트가 같으면 hash도 같아 session을 가리지 않아도 된다.
  const uploaded = new Map<string, string>();

  return {
    async uploadImage(image) {
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
          body: { content_type: image.type, bytes: bytes.byteLength },
          bytes,
        });
        if (!reply.ok) {
          return { ok: false, code: reply.error?.code ?? "internal" };
        }
        const { blob } = reply.value as { blob: string };
        if (!uploaded.has(blob)) uploaded.set(blob, URL.createObjectURL(image));
        return {
          ok: true,
          value: {
            block: {
              type: "image",
              // 붙이기가 받은 형식만 올린다.
              mimeType: image.type as Extract<
                ContentBlock,
                { type: "image" }
              >["mimeType"],
              blob,
            },
          },
        };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },

    imageUrl(session, id) {
      // core의 그림은 blob hash로만 읽는다. file 링크는 chip으로 둔다.
      if (id.startsWith("file://")) return Promise.resolve(null);
      const local = uploaded.get(id);
      if (local !== undefined) return Promise.resolve(local);
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
