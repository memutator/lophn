import { assert, assertEquals } from "@std/assert";
import type {
  AgentPlace,
  AgentRole,
  Profile,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/platform/mod.ts";
import { createNodeProfileImageFiles } from "./adapters/node-fs.ts";
import {
  type ProfileAssetDeps,
  profileImageFileHandler,
  type ProfileImageFiles,
  profileImageUploadHandler,
  type ProfileReaders,
  sniffProfileImage,
  staleImagePaths,
} from "./profile-asset.ts";

// 이미지 바이트는 메모리 disk에 둔다. 자리와 assignment의 판정은 읽기 concern을 흉내 낸 reader가 한다
// (있는 assignment와 그 역할, 정의의 profile). 쓰기·지우기 실패를 켜면 그 호출이 던진다.

const ROOT = "/data";
const PRJ: AgentPlace = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa1",
};
const APP: AgentPlace = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fa2" };
const LOPHN = "asg_01arz3ndektsv4rrffq69g5fa3";
const OP = "asg_01arz3ndektsv4rrffq69g5fa6";
const OTHER_OP = "asg_01arz3ndektsv4rrffq69g5fb5";
const UNKNOWN = "asg_01arz3ndektsv4rrffq69g5fz9";
const OP_FOLDER = `${ROOT}/projects/${PRJ.id}/agents/${OP}`;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

const CTX = {} as AuthenticatedContext;

// magic으로 시작하고 나머지는 0으로 채운 바이트다. 크기를 정해 1 MiB 경계를 시험한다.
function imageOf(magic: number[], size = magic.length): Uint8Array {
  const out = new Uint8Array(size);
  out.set(magic);
  return out;
}

function memoryFiles(): {
  disk: Map<string, Uint8Array>;
  failing: { write: boolean; read: boolean };
  files: ProfileImageFiles;
} {
  const disk = new Map<string, Uint8Array>();
  const failing = { write: false, read: false };
  const files: ProfileImageFiles = {
    read(path) {
      if (failing.read) return Promise.reject(new Error("read failure"));
      return Promise.resolve(disk.get(path) ?? null);
    },
    writeAtomic(path, bytes) {
      if (failing.write) return Promise.reject(new Error("write failure"));
      disk.set(path, bytes);
      return Promise.resolve();
    },
  };
  return { disk, failing, files };
}

// 자리 PRJ의 LOPHN(built-in)과 OP(Operator)만 보인다. profile이 undefined면 정의가 없다.
function readersWith(state: { profile: Profile | undefined }): ProfileReaders {
  const visible: Record<string, AgentRole> = {
    [`${PRJ.id}/${LOPHN}`]: "lophn",
    [`${PRJ.id}/${OP}`]: "operator",
  };
  return {
    read(_route, _ctx, input) {
      const { place, assignment } = input as {
        place: AgentPlace;
        assignment: string;
      };
      const role = visible[`${place.id}/${assignment}`];
      if (role === undefined) {
        return Promise.resolve({
          ok: false,
          error: { code: "not_found", message: "agent not found" },
        });
      }
      return Promise.resolve({
        ok: true,
        value: {
          role,
          definition: state.profile === undefined
            ? null
            : { profile: state.profile },
        },
      });
    },
  };
}

function deps(
  files: ProfileImageFiles,
  profile: Profile | undefined = undefined,
): ProfileAssetDeps {
  return { root: ROOT, files, readers: readersWith({ profile }) };
}

// upload 요청 하나다. input의 bytes는 선언한 크기, length는 Content-Length(없으면 chunked)다.
function upload(
  body: Uint8Array,
  options: {
    place?: AgentPlace;
    assignment?: string;
    content_type?: string;
    declared?: number;
    length?: number | undefined;
  } = {},
) {
  return {
    input: {
      place: options.place ?? PRJ,
      assignment: options.assignment ?? OP,
      content_type: options.content_type ?? "image/png",
      bytes: options.declared ?? body.length,
    },
    body: {
      bytes: streamOf(body),
      length: "length" in options ? options.length : body.length,
    },
  };
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function bytesOf(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

Deno.test("lophn-agent/agents#R13 [agent-I17]: the first bytes name the format, and only png, jpeg and webp are recognised", () => {
  assertEquals(sniffProfileImage(imageOf(PNG_MAGIC, 16)), "image/png");
  assertEquals(sniffProfileImage(imageOf(JPEG_MAGIC, 16)), "image/jpeg");
  assertEquals(sniffProfileImage(imageOf(WEBP_MAGIC, 16)), "image/webp");
  assertEquals(
    sniffProfileImage(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ),
    null,
  );
  // RIFF만 있고 WEBP가 없으면 webp가 아니다.
  assertEquals(
    sniffProfileImage(
      imageOf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], 16),
    ),
    null,
  );
  assertEquals(sniffProfileImage(new Uint8Array([0x89, 0x50])), null);
  assertEquals(sniffProfileImage(new Uint8Array()), null);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a png, jpg or webp upload is stored as avatar.<ext> in the Operator's folder and the profile names that file", async () => {
  const { disk, files } = memoryFiles();
  const handler = profileImageUploadHandler(deps(files));
  const cases = [
    { type: "image/png", magic: PNG_MAGIC, ext: "png" },
    { type: "image/jpeg", magic: JPEG_MAGIC, ext: "jpg" },
    { type: "image/webp", magic: WEBP_MAGIC, ext: "webp" },
  ];
  for (const { type, magic, ext } of cases) {
    const body = imageOf(magic, 64);
    const { input, body: stream } = upload(body, { content_type: type });
    const result = await handler(CTX, input, stream);
    assert(result.ok, `${type} should be accepted`);
    assertEquals(result.value, {
      profile: { kind: "image", image: `avatar.${ext}` },
    });
    assertEquals(disk.get(`${OP_FOLDER}/avatar.${ext}`), body);
  }
  // 올린 파일은 옛 확장자를 지우지 않는다. 지우는 일은 저장이 맡는다.
  assertEquals(
    [...disk.keys()].filter((path) => path.startsWith(OP_FOLDER)).length,
    3,
  );
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: an svg is refused whatever the declared type, and a refused upload writes nothing", async () => {
  const { disk, files } = memoryFiles();
  const handler = profileImageUploadHandler(deps(files));
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  );
  const bySvgType = upload(svg, { content_type: "image/svg+xml" });
  const byType = await handler(CTX, bySvgType.input, bySvgType.body);
  assertEquals(byType.ok, false);
  if (!byType.ok) assertEquals(byType.error.code, "invalid_input");
  const byBody = upload(svg, { content_type: "image/png" });
  const refused = await handler(CTX, byBody.input, byBody.body);
  assertEquals(refused.ok, false);
  if (!refused.ok) assertEquals(refused.error.code, "invalid_input");
  assertEquals(disk.size, 0);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: 1048576 bytes is the largest image, and an empty or larger body is invalid_input", async () => {
  const { disk, files } = memoryFiles();
  const handler = profileImageUploadHandler(deps(files));
  const largest = imageOf(PNG_MAGIC, 1_048_576);
  const accepted = upload(largest);
  assert(
    (await handler(CTX, accepted.input, accepted.body)).ok,
    "1048576 bytes should be accepted",
  );
  for (const size of [0, 1_048_577]) {
    const body = size === 0 ? new Uint8Array() : imageOf(PNG_MAGIC, size);
    const refused = upload(body, { declared: size });
    const result = await handler(CTX, refused.input, refused.body);
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.code, "invalid_input");
  }
  assertEquals(disk.get(`${OP_FOLDER}/avatar.png`), largest);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: the bytes must start with the magic of the declared type and match the declared size", async () => {
  const { disk, files } = memoryFiles();
  const handler = profileImageUploadHandler(deps(files));
  const mismatched = [
    { type: "image/jpeg", body: imageOf(PNG_MAGIC, 32) },
    {
      type: "image/webp",
      body: imageOf([
        0x52,
        0x49,
        0x46,
        0x46,
        0,
        0,
        0,
        0,
        0x41,
        0x56,
        0x49,
        0x20,
      ], 32),
    },
    { type: "image/png", body: imageOf([0x89, 0x50, 0x4e], 32) },
  ];
  for (const { type, body } of mismatched) {
    const refused = upload(body, { content_type: type });
    const result = await handler(CTX, refused.input, refused.body);
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.code, "invalid_input");
  }
  // 선언한 크기와 Content-Length가 다르면 바이트를 읽기 전에 거절한다.
  const sized = imageOf(PNG_MAGIC, 32);
  const wrongLength = upload(sized, { declared: 33 });
  const byLength = await handler(CTX, wrongLength.input, wrongLength.body);
  assertEquals(byLength.ok, false);
  if (!byLength.ok) assertEquals(byLength.error.code, "invalid_input");
  // Content-Length가 없어도 실제 크기가 선언과 다르면 거절한다.
  const chunked = upload(sized, { declared: 33, length: undefined });
  const byChunk = await handler(CTX, chunked.input, chunked.body);
  assertEquals(byChunk.ok, false);
  if (!byChunk.ok) assertEquals(byChunk.error.code, "invalid_input");
  assertEquals(disk.size, 0);
});

Deno.test("lophn-agent/agents#R7 [agent-I17]: an assignment that is not an agent of the place is not_found and writes nothing", async () => {
  const { disk, files } = memoryFiles();
  const handler = profileImageUploadHandler(deps(files));
  const cases: { place: AgentPlace; assignment: string }[] = [
    { place: PRJ, assignment: UNKNOWN },
    { place: PRJ, assignment: OTHER_OP },
    { place: APP, assignment: OP },
  ];
  for (const { place, assignment } of cases) {
    const refused = upload(imageOf(PNG_MAGIC, 32), { place, assignment });
    const result = await handler(CTX, refused.input, refused.body);
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.code, "not_found");
  }
  assertEquals(disk.size, 0);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a built-in agent's image goes in the folder named after its file, such as lophn", async () => {
  const { disk, files } = memoryFiles();
  const handler = profileImageUploadHandler(deps(files));
  const body = imageOf(WEBP_MAGIC, 32);
  const request = upload(body, {
    assignment: LOPHN,
    content_type: "image/webp",
  });
  const result = await handler(CTX, request.input, request.body);
  assert(result.ok, "a built-in agent may take an image");
  assertEquals(result.value.profile.image, "avatar.webp");
  assertEquals(
    disk.get(`${ROOT}/projects/${PRJ.id}/agents/lophn/avatar.webp`),
    body,
  );
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a failed image write is unavailable and leaves the previous image whole", async () => {
  const { disk, failing, files } = memoryFiles();
  const handler = profileImageUploadHandler(deps(files));
  const first = imageOf(PNG_MAGIC, 32);
  const ok1 = upload(first);
  assert((await handler(CTX, ok1.input, ok1.body)).ok);
  failing.write = true;
  const second = imageOf(PNG_MAGIC, 48);
  const refused = upload(second);
  const result = await handler(CTX, refused.input, refused.body);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "unavailable");
  assertEquals(disk.get(`${OP_FOLDER}/avatar.png`), first);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a new format is written beside the old avatar and the old one stays until the definition is saved", async () => {
  const { disk, files } = memoryFiles();
  const handler = profileImageUploadHandler(deps(files));
  const png = imageOf(PNG_MAGIC, 32);
  const first = upload(png);
  assert((await handler(CTX, first.input, first.body)).ok);
  const jpeg = imageOf(JPEG_MAGIC, 40);
  const next = upload(jpeg, { content_type: "image/jpeg" });
  assert((await handler(CTX, next.input, next.body)).ok);
  // 정의가 아직 png를 가리키므로 png는 지우지 않는다. 지우는 일은 SaveAgent가 맡는다.
  assertEquals(disk.get(`${OP_FOLDER}/avatar.png`), png);
  assertEquals(disk.get(`${OP_FOLDER}/avatar.jpg`), jpeg);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: reading returns the stored image with the Content-Type of its real format, not the declared one", async () => {
  const { files } = memoryFiles();
  const body = imageOf(WEBP_MAGIC, 40);
  const uploader = profileImageUploadHandler(deps(files));
  const request = upload(body, { content_type: "image/webp" });
  assert((await uploader(CTX, request.input, request.body)).ok);
  const reader = profileImageFileHandler(
    deps(files, { kind: "image", image: "avatar.webp" }),
  );
  const read = await reader(CTX, { place: PRJ, assignment: OP });
  assert(read.ok, "the image should be read");
  assertEquals(read.value.contentType, "image/webp");
  assertEquals(read.value.length, body.length);
  assertEquals(await bytesOf(read.value.body), body);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: reading is not_found when the profile is an icon, the definition or the file is missing, or the assignment is outside the place", async () => {
  const { files } = memoryFiles();
  const input = { place: PRJ, assignment: OP };
  const cases: { profile: Profile | undefined; assignment?: string }[] = [
    { profile: undefined },
    { profile: { kind: "icon", icon: "roles" } },
    { profile: { kind: "image", image: "avatar.png" } },
    { profile: { kind: "image", image: "avatar.png" }, assignment: OTHER_OP },
  ];
  for (const { profile, assignment } of cases) {
    const reader = profileImageFileHandler(deps(files, profile));
    const result = await reader(CTX, {
      ...input,
      assignment: assignment ?? OP,
    });
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.error.code, "not_found");
  }
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a stored file that is not a supported image is unavailable and is never sent as another type", async () => {
  const { disk, files } = memoryFiles();
  disk.set(`${OP_FOLDER}/avatar.png`, new TextEncoder().encode("<svg></svg>"));
  const reader = profileImageFileHandler(
    deps(files, { kind: "image", image: "avatar.png" }),
  );
  const result = await reader(CTX, { place: PRJ, assignment: OP });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "unavailable");
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a save names the avatar its profile points to and lists the other avatar paths as stale, and an icon or no profile lists all of them", () => {
  const folder = OP_FOLDER;
  const all = [
    `${folder}/avatar.png`,
    `${folder}/avatar.jpg`,
    `${folder}/avatar.webp`,
  ];
  assertEquals(
    staleImagePaths(ROOT, PRJ, "operator", OP, {
      kind: "image",
      image: "avatar.jpg",
    }),
    [`${folder}/avatar.png`, `${folder}/avatar.webp`],
  );
  assertEquals(
    staleImagePaths(ROOT, PRJ, "operator", OP, { kind: "icon", icon: "roles" }),
    all,
  );
  assertEquals(staleImagePaths(ROOT, PRJ, "operator", OP, undefined), all);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: the node adapter writes image bytes through a temp file, reads them back whole, and a missing image is null", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const files = createNodeProfileImageFiles();
    const folder = `${dir}/projects/${PRJ.id}/agents/${OP}`;
    const path = `${folder}/avatar.png`;
    assertEquals(await files.read(path), null);
    const first = imageOf(PNG_MAGIC, 64);
    await files.writeAtomic(path, first);
    assertEquals(await files.read(path), first);
    const second = imageOf(PNG_MAGIC, 128);
    await files.writeAtomic(path, second);
    assertEquals(await files.read(path), second);
    const leftovers = [...Deno.readDirSync(folder)].filter((entry) =>
      entry.name !== "avatar.png"
    );
    assertEquals(leftovers, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
