import { err, ok, type Result } from "../../base/mod.ts";
import {
  AGENT_PROFILE_IMAGE_MAX_BYTES,
  AGENT_PROFILE_IMAGE_TYPES,
  type AgentPlace,
  type AgentRole,
} from "../../contracts/lophn-agent/mod.ts";
import { parseAgentFile } from "./definition-file.ts";
import type { AgentLookups, AssignmentRef } from "./ports.ts";
import { agentFileName, agentsDirectory, type AgentStore } from "./store.ts";

// 사람이 올린 profile 이미지(R13)다. 받는 형식은 png·jpg·webp뿐이고 형식은 내용의 첫 byte로 확인한다.
// Content-Type 선언과 맞지 않으면 거절한다. 파일 IO는 port로 받고 바이트는 글과 달리 UTF-8로 바꾸지 않는다.
// 정의의 profile에 이미지 이름을 잇는 것은 SaveAgent가 한다. 이 길은 파일만 다룬다.

export type ProfileImageType = keyof typeof AGENT_PROFILE_IMAGE_TYPES;

// 한 파일의 바이트 읽기·원자 쓰기. 없는 파일 읽기는 null이고 그 밖의 IO 실패는 던진다.
export interface ProfileImageFiles {
  read(path: string): Uint8Array | null;
  writeAtomic(path: string, bytes: Uint8Array): void;
}

export type ProfileAssetDeps = {
  root: string;
  files: ProfileImageFiles;
  // 이미지를 읽을 때 정의 글에서 profile 칸을 찾는다.
  store: AgentStore;
};

export type ProfileImageUpload = {
  place: AgentPlace;
  assignment: string;
  content_type: string;
  // upload header의 bytes(보내겠다고 한 크기)다. 실제 body 길이와 같아야 한다.
  declared_bytes: number;
  body: Uint8Array;
};

export type ProfileImageRead = { place: AgentPlace; assignment: string };

export type UploadedProfile = { profile: { kind: "image"; image: string } };

export type ReadProfileImage = {
  bytes: Uint8Array;
  content_type: ProfileImageType;
};

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

function checkUpload(
  input: ProfileImageUpload,
): Result<{ type: ProfileImageType; ext: string }> {
  if (!Object.hasOwn(AGENT_PROFILE_IMAGE_TYPES, input.content_type)) {
    return invalid("profile image must be png, jpg or webp");
  }
  const type = input.content_type as ProfileImageType;
  const size = input.body.length;
  if (size === 0 || size > AGENT_PROFILE_IMAGE_MAX_BYTES) {
    return invalid(
      `profile image must be 1 to ${AGENT_PROFILE_IMAGE_MAX_BYTES} bytes`,
    );
  }
  if (input.declared_bytes !== size) {
    return invalid("profile image length differs from the declared bytes");
  }
  if (sniffProfileImage(input.body) !== type) {
    return invalid("profile image bytes do not match the content type");
  }
  return ok({ type, ext: AGENT_PROFILE_IMAGE_TYPES[type] });
}

// 자리 안의 assignment만 본다. 거둔 것과 다른 자리의 것은 없는 것과 같다.
function visibleAssignment(
  lookups: AgentLookups,
  place: AgentPlace,
  id: string,
): Result<AssignmentRef> {
  if (!lookups.placeExists(place)) return notFound("place not found");
  const found = lookups.assignments(place).find((ref) => ref.id === id);
  return found === undefined ? notFound("agent not found") : ok(found);
}

// `<자리>/agents/<정의 파일 이름에서 .md를 뺀 것>/<이미지 이름>`. 이름이 assignment ID라 정의와 같은 폴더를 쓴다.
function imagePath(
  root: string,
  place: AgentPlace,
  role: AgentRole,
  assignment: string,
  image: string,
): string {
  const stem = agentFileName(role, assignment).replace(/\.md$/, "");
  return `${agentsDirectory(root, place)}/${stem}/${image}`;
}

export function uploadProfileImage(
  deps: ProfileAssetDeps,
  lookups: AgentLookups,
  input: ProfileImageUpload,
): Result<UploadedProfile> {
  const checked = checkUpload(input);
  if (!checked.ok) return checked;
  const found = visibleAssignment(lookups, input.place, input.assignment);
  if (!found.ok) return found;
  const image = `avatar.${checked.value.ext}`;
  const path = imagePath(
    deps.root,
    input.place,
    found.value.role,
    input.assignment,
    image,
  );
  try {
    deps.files.writeAtomic(path, input.body);
  } catch {
    return unavailable("profile image could not be written");
  }
  return ok({ profile: { kind: "image", image } });
}

// 정의의 profile이 가리키는 이미지를 읽는다. Content-Type은 파일 바이트의 실제 형식이다.
export function readProfileImage(
  deps: ProfileAssetDeps,
  lookups: AgentLookups,
  input: ProfileImageRead,
): Result<ReadProfileImage> {
  const found = visibleAssignment(lookups, input.place, input.assignment);
  if (!found.ok) return found;
  const { role } = found.value;
  const file = deps.store.read(
    input.place,
    agentFileName(role, input.assignment),
  );
  if (!file.ok) return file;
  if (file.value === null) return notFound("agent definition not found");
  const parsed = parseAgentFile(file.value.text, {
    role,
    place: input.place.kind,
  });
  if (!parsed.ok) return notFound("agent definition is not readable");
  const profile = parsed.value.profile;
  if (profile?.kind !== "image") return notFound("profile image not found");
  const path = imagePath(
    deps.root,
    input.place,
    role,
    input.assignment,
    profile.image,
  );
  let bytes: Uint8Array | null;
  try {
    bytes = deps.files.read(path);
  } catch {
    return unavailable("profile image could not be read");
  }
  if (bytes === null) return notFound("profile image not found");
  const type = sniffProfileImage(bytes);
  if (type === null) {
    return unavailable("stored profile image is not a supported image");
  }
  return ok({ bytes, content_type: type });
}
