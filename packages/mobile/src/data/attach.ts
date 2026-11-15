// Pictures a person adds to a message from the phone. They go the way the desktop composer's pasted images go: uploaded
// with `message-images/upload` (the source's `uploadImage`), and the message carries the returned blob in an image block.
// The desktop also attaches any file by its path on the computer; a phone's files have no path there, so only pictures go.
import type { ContentBlock } from "../../../protocol/lophn-agent/content-block.ts";
import {
  MESSAGE_IMAGE_MAX_BYTES,
  MESSAGE_IMAGE_TYPES,
} from "../../../protocol/lophn-agent/message-images.ts";
import type { AgentTabSource, SourceResult } from "../../../shell/renderer/conversation/agent-tab-source.ts";

type ImageType = keyof typeof MESSAGE_IMAGE_TYPES;

/** The upload's size limit in megabytes, for the words that tell it. */
export const ATTACH_MAX_MB = MESSAGE_IMAGE_MAX_BYTES / (1024 * 1024);

/** A picture chosen for the message, read and ready to upload. `uri` is also what keeps one picture from being added twice. */
export interface Attached {
  readonly uri: string;
  readonly name: string;
  readonly type: ImageType;
  readonly bytes: Uint8Array;
}

/** What a picker hands over. `size` and `mimeType` are only there when the picker knows them. */
export interface Candidate {
  readonly uri: string;
  readonly name: string;
  readonly size?: number | undefined;
  readonly mimeType?: string | null | undefined;
}

/** `kind`: not a PNG, JPEG, GIF or WebP. `big`: over the upload limit. `unreadable`: the file could not be read. */
export type Refusal = { readonly name: string; readonly why: "kind" | "big" | "unreadable" };

const BY_EXTENSION: Record<string, ImageType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function typeOf(candidate: Candidate): ImageType | null {
  const mime = candidate.mimeType?.toLowerCase();
  if (mime !== undefined && mime in MESSAGE_IMAGE_TYPES) return mime as ImageType;
  // A picker may not know the type (a recent photo has only a file name).
  if (mime !== undefined && mime !== "" && mime !== "application/octet-stream") return null;
  return BY_EXTENSION[candidate.name.slice(candidate.name.lastIndexOf(".") + 1).toLowerCase()] ?? null;
}

/** Reads what the pickers returned. The ones that cannot be sent come back as refusals so the screen can say why. */
export async function readCandidates(
  candidates: readonly Candidate[],
): Promise<{ added: Attached[]; refused: Refusal[] }> {
  const added: Attached[] = [];
  const refused: Refusal[] = [];
  for (const candidate of candidates) {
    const type = typeOf(candidate);
    if (type === null) {
      refused.push({ name: candidate.name, why: "kind" });
    } else if ((candidate.size ?? 0) > MESSAGE_IMAGE_MAX_BYTES) {
      refused.push({ name: candidate.name, why: "big" });
    } else {
      try {
        const bytes = new Uint8Array(await (await fetch(candidate.uri)).arrayBuffer());
        if (bytes.byteLength > MESSAGE_IMAGE_MAX_BYTES) refused.push({ name: candidate.name, why: "big" });
        else added.push({ uri: candidate.uri, name: candidate.name, type, bytes });
      } catch {
        refused.push({ name: candidate.name, why: "unreadable" });
      }
    }
  }
  return { added, refused };
}

/** The pictures not yet on the list, so a second pick of the same one does nothing. */
export function withAttached(current: readonly Attached[], added: readonly Attached[]): Attached[] {
  return [...current, ...added.filter((one) => !current.some((other) => other.uri === one.uri))];
}

/** Uploads the pictures one after another and gives their image blocks. The first failure stops it, as on the desktop. */
export async function uploadAttached(
  source: AgentTabSource,
  items: readonly Attached[],
): Promise<SourceResult<ContentBlock[]>> {
  const blocks: ContentBlock[] = [];
  for (const item of items) {
    // React Native's Blob cannot be built from bytes; the source reads only `type` and `arrayBuffer()` of what it uploads.
    const blob = {
      type: item.type,
      size: item.bytes.byteLength,
      arrayBuffer: async () => item.bytes.buffer.slice(item.bytes.byteOffset, item.bytes.byteOffset + item.bytes.byteLength),
    } as unknown as Blob;
    const uploaded = await source.uploadImage(blob);
    if (!uploaded.ok) return uploaded;
    blocks.push(uploaded.value.block);
  }
  return { ok: true, value: blocks };
}
