// Message images over the phone's connection. The desktop image source keeps bytes as Blob URLs, which React Native does not
// have; over the remote channel the core also carries file and upload bytes as base64 (core/remote/call.ts), so the phone
// keeps them as data URLs.
import type { ImageSource } from "../../../packages/shell/renderer/conversation/agent-tab-core-source-images.ts";
import type { CoreSource } from "../../../packages/shell/renderer/desktop/connection/connection.ts";
import type { ContentBlock } from "../../../packages/protocol/lophn-agent/content-block.ts";

function base64Of(bytes: Uint8Array): string {
  let text = "";
  // fromCharCode takes its bytes as arguments; a big image would overflow the call stack in one go.
  for (let at = 0; at < bytes.length; at += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(text);
}

export function remoteImages(core: CoreSource): ImageSource {
  // Key `<session>/<id>`: one read per picture however often it is drawn.
  const urls = new Map<string, Promise<string | null>>();
  // Images this screen uploaded, by blob hash: a message still being sent has no reference the core can read it through.
  const uploaded = new Map<string, string>();

  return {
    async uploadImage(image) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await image.arrayBuffer());
      } catch {
        return { ok: false, code: "unavailable" };
      }
      const base64 = base64Of(bytes);
      const reply = await core
        .call({
          kind: "upload",
          resource: "message-images",
          method: "upload",
          body: {
            input: { content_type: image.type, bytes: bytes.byteLength },
            base64,
          },
        })
        .catch(() => null);
      if (!reply) return { ok: false, code: "unavailable" };
      if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
      const { blob } = reply.value as { blob: string };
      uploaded.set(blob, `data:${image.type};base64,${base64}`);
      return {
        ok: true,
        value: {
          block: {
            type: "image",
            mimeType: image.type as Extract<
              ContentBlock,
              { type: "image" }
            >["mimeType"],
            blob,
          },
        },
      };
    },

    imageUrl(session, id) {
      if (id.startsWith("file://")) return Promise.resolve(null);
      const local = uploaded.get(id);
      if (local !== undefined) return Promise.resolve(local);
      const key = `${session}/${id}`;
      let url = urls.get(key);
      if (url === undefined) {
        url = core
          .call({
            kind: "file",
            resource: "message-images",
            method: "read",
            body: { session, image: id },
          })
          .then((reply) => {
            if (!reply.ok) return null;
            const file = reply.value as { content_type: string; base64: string };
            return `data:${file.content_type};base64,${file.base64}`;
          })
          .catch(() => null);
        urls.set(key, url);
        // A picture that could not be read is read again next time.
        void url.then((value) => {
          if (value === null) urls.delete(key);
        });
      }
      return url;
    },
  };
}
