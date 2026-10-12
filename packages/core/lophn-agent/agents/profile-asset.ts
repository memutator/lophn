import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  AGENT_PROFILE_IMAGE_MAX_BYTES,
  AGENT_PROFILE_IMAGE_TYPES,
  type AgentPlace,
  type AgentRole,
  agentRoleSchema,
  agentsRead,
  type Profile,
  profileOutputSchema,
  readAgentProfileInputSchema,
  uploadAgentProfileInputSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  ReadRoute,
} from "../../../protocol/platform/mod.ts";
import { agentFileName, agentsDirectory } from "./store.ts";

// 사람이 올린 profile 이미지(R13)다. 받는 형식은 png·jpg·webp뿐이고 형식은 내용의 첫 byte로 확인한다.
// Content-Type 선언과 맞지 않으면 거절한다. 바이트는 글과 달리 UTF-8로 바꾸지 않는다.
// 자리와 assignment의 판정(있는지, 어느 역할인지, 정의의 profile)은 읽기 concern이 맡고 여기서는 파일만 다룬다.
// 정의의 profile에 이미지 이름을 잇는 것은 SaveAgent가 한다.

export type ProfileImageType = keyof typeof AGENT_PROFILE_IMAGE_TYPES;

const IMAGE_EXTENSIONS = Object.values(AGENT_PROFILE_IMAGE_TYPES);

// 한 파일의 바이트 읽기·원자 쓰기. 없는 파일 읽기는 null이고 그 밖의 IO 실패는 던진다.
export interface ProfileImageFiles {
  read(path: string): Promise<Uint8Array | null>;
  writeAtomic(path: string, bytes: Uint8Array): Promise<void>;
}

// 읽기 concern의 값을 읽는 길이다. 자리 밖이거나 없는 assignment는 not_found로 온다.
export type ProfileReaders = {
  read(
    route: Pick<ReadRoute, "resource" | "method">,
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
};

export type ProfileAssetDeps = {
  root: string;
  files: ProfileImageFiles;
  readers: ProfileReaders;
};

export type UploadedProfile = { profile: { kind: "image"; image: string } };

export type ProfileImageBody = {
  bytes: ReadableStream<Uint8Array>;
  length: number | undefined;
};

export type ProfileUploadHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
  body: ProfileImageBody,
) => Promise<Result<UploadedProfile>>;

export type ProfileFileHandler = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Promise<
  Result<
    {
      contentType: ProfileImageType;
      length: number;
      body: ReadableStream<Uint8Array>;
    }
  >
>;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function matchesAt(
  bytes: Uint8Array,
  at: number,
  magic: readonly number[],
): boolean {
  return bytes.length >= at + magic.length &&
    magic.every((value, index) => bytes[at + index] === value);
}

// 내용의 첫 byte로 형식을 정한다. png·jpg·webp가 아니면 null이다(svg도 여기서 빠진다).
export function sniffProfileImage(bytes: Uint8Array): ProfileImageType | null {
  if (matchesAt(bytes, 0, PNG)) return "image/png";
  if (matchesAt(bytes, 0, JPEG)) return "image/jpeg";
  if (matchesAt(bytes, 0, RIFF) && matchesAt(bytes, 8, WEBP)) {
    return "image/webp";
  }
  return null;
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function notFound(message: string): Result<never> {
  return err({ code: "not_found", message });
}

function unavailable(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

// 선언한 형식·크기·길이와 첫 byte가 모두 맞아야 받는다.
export function checkProfileImage(
  content_type: string,
  declared: number,
  body: Uint8Array,
): Result<{ type: ProfileImageType; ext: string }> {
  if (!Object.hasOwn(AGENT_PROFILE_IMAGE_TYPES, content_type)) {
    return invalid("profile image must be png, jpg or webp");
  }
  const type = content_type as ProfileImageType;
  const size = body.length;
  if (size === 0 || size > AGENT_PROFILE_IMAGE_MAX_BYTES) {
    return invalid(
      `profile image must be 1 to ${AGENT_PROFILE_IMAGE_MAX_BYTES} bytes`,
    );
  }
  if (declared !== size) {
    return invalid("profile image length differs from the declared bytes");
  }
  if (sniffProfileImage(body) !== type) {
    return invalid("profile image bytes do not match the content type");
  }
  return ok({ type, ext: AGENT_PROFILE_IMAGE_TYPES[type] });
}

// `<자리>/agents/<정의 파일 이름에서 .md를 뺀 것>/`. 이름이 assignment ID라 정의와 같은 폴더를 쓴다.
function imageFolder(
  root: string,
  place: AgentPlace,
  role: AgentRole,
  assignment: string,
): string {
  const stem = agentFileName(role, assignment).replace(/\.md$/, "");
  return `${agentsDirectory(root, place)}/${stem}`;
}

// 저장한 정의가 가리키지 않는 `avatar.*` 경로다. 정의가 이미지를 가리키면 그 파일만 남기고, icon이거나
// profile이 없으면 이미지 파일을 모두 지운다(R13). SaveAgent가 저장 뒤에 지운다.
export function staleImagePaths(
  root: string,
  place: AgentPlace,
  role: AgentRole,
  assignment: string,
  profile: Profile | undefined,
): string[] {
  const keep = profile?.kind === "image" ? profile.image : null;
  const folder = imageFolder(root, place, role, assignment);
  return IMAGE_EXTENSIONS.map((ext) => `avatar.${ext}`)
    .filter((name) => name !== keep)
    .map((name) => `${folder}/${name}`);
}

// 새 파일을 원자적으로 쓴다. 다른 확장자의 옛 avatar는 남긴다. 정의가 가리키는 이미지를 사람이 저장하기 전에
// 잃지 않게 하려고 지우는 일은 SaveAgent(staleImagePaths)가 맡는다.
async function storeImage(
  deps: ProfileAssetDeps,
  target: { place: AgentPlace; role: AgentRole; assignment: string },
  image: { ext: string; body: Uint8Array },
): Promise<Result<UploadedProfile>> {
  const folder = imageFolder(
    deps.root,
    target.place,
    target.role,
    target.assignment,
  );
  const name = `avatar.${image.ext}`;
  try {
    await deps.files.writeAtomic(`${folder}/${name}`, image.body);
  } catch {
    return unavailable("profile image could not be written");
  }
  return ok({ profile: { kind: "image", image: name } });
}

const judgedSchema = z.object({
  role: agentRoleSchema,
  definition: z.object({ profile: profileOutputSchema.optional() }).nullable(),
});

// 읽기 concern이 자리와 assignment를 보고 역할과 정의의 profile을 준다. 모양이 틀리면 우리 코드의 결함이다.
async function judge(
  deps: ProfileAssetDeps,
  ctx: AuthenticatedContext,
  place: AgentPlace,
  assignment: string,
): Promise<Result<z.infer<typeof judgedSchema>>> {
  const read = await deps.readers.read(agentsRead, ctx, { place, assignment });
  if (!read.ok) return read;
  const parsed = judgedSchema.safeParse(read.value);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "agent read has an unexpected shape" });
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
): Promise<Result<Uint8Array>> {
  try {
    return ok(new Uint8Array(await new Response(stream).arrayBuffer()));
  } catch {
    return invalid("upload body could not be read");
  }
}

// upload route의 처리기다. 입력의 형식·크기·선언 길이를 먼저 보고, 통과한 바이트만 읽어 쓴다.
export function profileImageUploadHandler(
  deps: ProfileAssetDeps,
): ProfileUploadHandler {
  return async (ctx, rawInput, body) => {
    const input = uploadAgentProfileInputSchema.safeParse(rawInput);
    if (
      !input.success ||
      (body.length !== undefined && input.data.bytes !== body.length)
    ) {
      body.bytes.cancel().catch(() => {});
      return invalid("upload input does not match the body");
    }
    const read = await readAll(body.bytes);
    if (!read.ok) return read;
    const checked = checkProfileImage(
      input.data.content_type,
      input.data.bytes,
      read.value,
    );
    if (!checked.ok) return checked;
    const judged = await judge(
      deps,
      ctx,
      input.data.place,
      input.data.assignment,
    );
    if (!judged.ok) return judged;
    return storeImage(
      deps,
      {
        place: input.data.place,
        role: judged.value.role,
        assignment: input.data.assignment,
      },
      { ext: checked.value.ext, body: read.value },
    );
  };
}

// file route의 처리기다. 정의의 profile이 가리키는 이미지를 읽고 Content-Type은 파일의 실제 형식이다.
export function profileImageFileHandler(
  deps: ProfileAssetDeps,
): ProfileFileHandler {
  return async (ctx, rawInput) => {
    const input = readAgentProfileInputSchema.safeParse(rawInput);
    if (!input.success) return invalid("read input is not valid");
    const judged = await judge(
      deps,
      ctx,
      input.data.place,
      input.data.assignment,
    );
    if (!judged.ok) return judged;
    const profile = judged.value.definition?.profile;
    if (profile?.kind !== "image") return notFound("profile image not found");
    const path = `${
      imageFolder(
        deps.root,
        input.data.place,
        judged.value.role,
        input.data.assignment,
      )
    }/${profile.image}`;
    let bytes: Uint8Array | null;
    try {
      bytes = await deps.files.read(path);
    } catch {
      return unavailable("profile image could not be read");
    }
    if (bytes === null) return notFound("profile image not found");
    const contentType = sniffProfileImage(bytes);
    if (contentType === null) {
      return unavailable("stored profile image is not a supported image");
    }
    return ok({
      contentType,
      length: bytes.length,
      body: streamOf(bytes),
    });
  };
}
