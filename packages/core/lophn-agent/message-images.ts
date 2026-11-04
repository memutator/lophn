import { err, ok, type Result } from "../../base/mod.ts";
import {
  MESSAGE_IMAGE_CALL_MAX_BYTES,
  MESSAGE_IMAGE_PURPOSE,
  MESSAGE_IMAGE_TYPES,
  messageImagePath,
  messageImagePrepare,
  messageImageRead,
  messageImageUpload,
} from "../../protocol/lophn-agent/mod.ts";
import { sha256Schema } from "../../protocol/base/values.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { objectPathFor } from "../storage/blobs/mod.ts";
import { type BodyPrepare, prepareBytes } from "./session/message-body.ts";

// 메시지에 싣는 이미지다. 올린 바이트는 blob store의 blob이고(사람은 `UploadMessageImage`, agent는
// `PrepareMessageImage`), 읽는 길은 둘이다. image block의 hash는 그 session의 메시지가 참조할 때만 열린다(`referenced`):
// 다른 session은 hash를 알아도 읽지 못한다. 옛 첨부(`attachment:<id>`)는 core data root 아래
// `message-images/<session>/<id>.<ext>` 파일이고 session 폴더가 경계다. session과 id는 protocol schema의 id 모양
// (소문자·숫자·밑줄)만 통과해 경로에 ".."나 "/"가 들어올 수 없다.

type ImageType = keyof typeof MESSAGE_IMAGE_TYPES;

export interface MessageImageFiles {
  read(path: string): Promise<Uint8Array | null>;
  exists(path: string): Promise<boolean>;
}

export type MessageImageDeps = {
  root: string;
  files: MessageImageFiles;
  // 준비 통로. I/O worker가 뜨기 전에는 없다(unavailable).
  relay(): BodyPrepare | undefined;
  // 이 session의 메시지가 그 blob을 참조하는지.
  referenced(session: string, blob: string): Result<boolean>;
};

type Body = { bytes: ReadableStream<Uint8Array>; length: number | undefined };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function matchesAt(bytes: Uint8Array, at: number, magic: number[]): boolean {
  return (
    bytes.length >= at + magic.length &&
    magic.every((value, index) => bytes[at + index] === value)
  );
}

// 내용의 첫 byte로 형식을 정한다. svg 같은 그 밖의 형식은 null이다.
function sniff(bytes: Uint8Array): ImageType | null {
  if (matchesAt(bytes, 0, PNG)) return "image/png";
  if (matchesAt(bytes, 0, JPEG)) return "image/jpeg";
  if (matchesAt(bytes, 0, GIF87) || matchesAt(bytes, 0, GIF89)) {
    return "image/gif";
  }
  if (matchesAt(bytes, 0, RIFF) && matchesAt(bytes, 8, WEBP)) {
    return "image/webp";
  }
  return null;
}

const invalid = (message: string): Result<never> =>
  err({ code: "invalid_input", message });
const notFound = (): Result<never> =>
  err({ code: "not_found", message: "message image not found" });

const folderOf = (root: string, session: string) =>
  `${root}/message-images/${session}`;

// 확장자를 모르는 옛 첨부 id를 파일로 찾는다.
async function locate(
  deps: MessageImageDeps,
  session: string,
  image: string,
): Promise<{ path: string; type: ImageType } | null> {
  for (const [type, ext] of Object.entries(MESSAGE_IMAGE_TYPES)) {
    const path = `${folderOf(deps.root, session)}/${image}.${ext}`;
    if (await deps.files.exists(path)) return { path, type: type as ImageType };
  }
  return null;
}

// image block의 blob. 그 session의 메시지가 참조하는 hash만 파일로 풀린다.
async function locateBlob(
  deps: MessageImageDeps,
  session: string,
  blob: string,
): Promise<Result<{ path: string; type: ImageType }>> {
  const referenced = deps.referenced(session, blob);
  if (!referenced.ok) return referenced;
  if (!referenced.value) return notFound();
  const path = objectPathFor(deps.root, blob);
  let bytes: Uint8Array | null;
  try {
    bytes = await deps.files.read(path);
  } catch {
    return err({
      code: "unavailable",
      message: "message image could not be read",
    });
  }
  if (bytes === null) return notFound();
  const type = sniff(bytes);
  return type === null
    ? invalid("the blob is not an image")
    : ok({ path, type });
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// 이미지 바이트를 보낸 자격의 이름으로 blob에 준비한다. 이어지는 메시지 command가 같은 자격으로 참조를 건다.
async function prepareImage(
  deps: MessageImageDeps,
  ctx: AuthenticatedContext,
  bytes: Uint8Array,
): Promise<Result<string>> {
  const relay = deps.relay();
  if (relay === undefined) {
    return err({
      code: "unavailable",
      message: "blob preparation is not available",
    });
  }
  return await prepareBytes(
    relay,
    ctx,
    MESSAGE_IMAGE_PURPOSE,
    bytes,
    "message image",
  );
}

export function messageImageUploadHandler(deps: MessageImageDeps) {
  return async (
    ctx: AuthenticatedContext,
    rawInput: unknown,
    body: Body,
  ): Promise<Result<{ blob: string }>> => {
    const input = messageImageUpload.input.safeParse(rawInput);
    if (
      !input.success ||
      (body.length !== undefined && input.data.bytes !== body.length)
    ) {
      body.bytes.cancel().catch(() => {});
      return invalid("upload input does not match the body");
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await new Response(body.bytes).arrayBuffer());
    } catch {
      return invalid("upload body could not be read");
    }
    if (
      bytes.length !== input.data.bytes ||
      sniff(bytes) !== input.data.content_type
    ) {
      return invalid("image bytes do not match the declared type and length");
    }
    const blob = await prepareImage(deps, ctx, bytes);
    return blob.ok ? ok({ blob: blob.value }) : blob;
  };
}

// agent의 `lophn call send --image`가 쓴다. runtime loopback이 JSON뿐이라 바이트가 base64로 온다.
export function messageImagePrepareHandler(deps: MessageImageDeps) {
  return async (
    ctx: AuthenticatedContext,
    rawInput: unknown,
  ): Promise<Result<{ blob: string; mimeType: ImageType }>> => {
    const input = messageImagePrepare.input.safeParse(rawInput);
    if (!input.success) return invalid("image input is not valid");
    const bytes = new Uint8Array(Buffer.from(input.data.data_base64, "base64"));
    const mimeType = sniff(bytes);
    if (mimeType === null || bytes.length > MESSAGE_IMAGE_CALL_MAX_BYTES) {
      return invalid("image must be png, jpeg, gif or webp within the limit");
    }
    const blob = await prepareImage(deps, ctx, bytes);
    return blob.ok ? ok({ blob: blob.value, mimeType }) : blob;
  };
}

export function messageImageFileHandler(deps: MessageImageDeps) {
  return async (
    _ctx: AuthenticatedContext,
    rawInput: unknown,
  ): Promise<
    Result<{
      contentType: ImageType;
      length: number;
      body: ReadableStream<Uint8Array>;
    }>
  > => {
    const input = messageImageRead.input.safeParse(rawInput);
    if (!input.success) return invalid("read input is not valid");
    const found = sha256Schema.safeParse(input.data.image).success
      ? await locateBlob(deps, input.data.session, input.data.image)
      : await locate(deps, input.data.session, input.data.image).then((at) =>
          at === null ? notFound() : ok(at),
        );
    if (!found.ok) return found;
    let bytes: Uint8Array | null;
    try {
      bytes = await deps.files.read(found.value.path);
    } catch {
      return err({
        code: "unavailable",
        message: "message image could not be read",
      });
    }
    if (bytes === null) return notFound();
    return ok({
      contentType: sniff(bytes) ?? found.value.type,
      length: bytes.length,
      body: streamOf(bytes),
    });
  };
}

// agent가 자기 session의 이미지만 풀 수 있다: 입력의 session이 credential의 session과 같아야 한다.
export function messageImagePathHandler(deps: MessageImageDeps) {
  return async (
    who: AuthenticatedContext,
    rawInput: unknown,
  ): Promise<Result<{ path: string; media_type: ImageType }>> => {
    const input = messageImagePath.input.safeParse(rawInput);
    if (!input.success) return invalid("image reference is not valid");
    if (
      who.actor !== `agent:${input.data.session}` ||
      who.conditions.session !== input.data.session
    ) {
      return err({
        code: "forbidden",
        message: "the credential belongs to another session",
      });
    }
    const found = sha256Schema.safeParse(input.data.image).success
      ? await locateBlob(deps, input.data.session, input.data.image)
      : await locate(deps, input.data.session, input.data.image).then((at) =>
          at === null ? notFound() : ok(at),
        );
    return found.ok
      ? ok({ path: found.value.path, media_type: found.value.type })
      : found;
  };
}
