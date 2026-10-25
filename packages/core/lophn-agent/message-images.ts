import { err, type IdSource, ok, type Result } from "../../base/mod.ts";
import {
  agentSessionRead,
  MESSAGE_IMAGE_TYPES,
  messageImagePath,
  messageImageRead,
  messageImageUpload,
} from "../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import type { ProfileReaders } from "./agents/profile-asset.ts";

// 사람이 메시지에 붙인 이미지다. 바이트는 core data root 아래 `message-images/<session>/<id>.<ext>`에 둔다
// (project 폴더 밖이라 agent의 file tool이 닿지 않고, image.read의 `attachment:<id>`만 연다).
// session과 id는 protocol schema의 id 모양(소문자·숫자·밑줄)만 통과해 경로에 ".."나 "/"가 들어올 수 없다.

type ImageType = keyof typeof MESSAGE_IMAGE_TYPES;

export interface MessageImageFiles {
  read(path: string): Promise<Uint8Array | null>;
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export type MessageImageDeps = {
  root: string;
  files: MessageImageFiles;
  readers: ProfileReaders;
  ids: IdSource;
};

type Body = { bytes: ReadableStream<Uint8Array>; length: number | undefined };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function matchesAt(bytes: Uint8Array, at: number, magic: number[]): boolean {
  return bytes.length >= at + magic.length &&
    magic.every((value, index) => bytes[at + index] === value);
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

// 확장자를 모르는 id를 파일로 찾는다.
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

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function messageImageUploadHandler(deps: MessageImageDeps) {
  return async (
    ctx: AuthenticatedContext,
    rawInput: unknown,
    body: Body,
  ): Promise<Result<{ id: string }>> => {
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
    // 없는 session 아래에 폴더를 만들지 않는다.
    const session = await deps.readers.read(agentSessionRead, ctx, {
      session: input.data.session,
    });
    if (!session.ok) return session;
    const id = deps.ids.newId("att");
    const ext = MESSAGE_IMAGE_TYPES[input.data.content_type];
    try {
      await deps.files.writeAtomic(
        `${folderOf(deps.root, input.data.session)}/${id}.${ext}`,
        bytes,
      );
    } catch {
      return err({
        code: "unavailable",
        message: "message image could not be written",
      });
    }
    return ok({ id });
  };
}

export function messageImageFileHandler(deps: MessageImageDeps) {
  return async (_ctx: AuthenticatedContext, rawInput: unknown): Promise<
    Result<{
      contentType: ImageType;
      length: number;
      body: ReadableStream<Uint8Array>;
    }>
  > => {
    const input = messageImageRead.input.safeParse(rawInput);
    if (!input.success) return invalid("read input is not valid");
    const found = await locate(deps, input.data.session, input.data.image);
    if (found === null) return notFound();
    let bytes: Uint8Array | null;
    try {
      bytes = await deps.files.read(found.path);
    } catch {
      return err({
        code: "unavailable",
        message: "message image could not be read",
      });
    }
    if (bytes === null) return notFound();
    return ok({
      contentType: sniff(bytes) ?? found.type,
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
    const found = await locate(deps, input.data.session, input.data.image);
    return found === null
      ? notFound()
      : ok({ path: found.path, media_type: found.type });
  };
}
