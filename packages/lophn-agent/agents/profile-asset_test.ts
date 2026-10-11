import { assert, assertEquals } from "@std/assert";
import type {
  AgentPlace,
  AgentRole,
  Profile,
} from "../../contracts/lophn-agent/mod.ts";
import { createNodeProfileImageFiles } from "./adapters/node-fs.ts";
import {
  type AgentFileSystem,
  type AgentLookups,
  type AgentStore,
  type AssignmentRef,
  createAgentStore,
  parseAgentFile,
  serializeAgentFile,
} from "./mod.ts";
import {
  type ProfileAssetDeps,
  type ProfileImageFiles,
  readProfileImage,
  sniffProfileImage,
  uploadProfileImage,
} from "./profile-asset.ts";

// 이미지 바이트를 메모리 disk에 쓰고 읽는다. 글 파일(정의)은 같은 disk를 store로 읽는다.
// 쓰기 실패를 켜면 쓰기가 던지고 disk는 그대로다.

const ROOT = "/data";
const PRJ: AgentPlace = {
  kind: "project",
  id: "prj_01arz3ndektsv4rrffq69g5fa1",
};
const APP: AgentPlace = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fa2" };
const LOPHN = "asg_01arz3ndektsv4rrffq69g5fa3";
const OP = "asg_01arz3ndektsv4rrffq69g5fa6";
const OTHER_OP = "asg_01arz3ndektsv4rrffq69g5fb5";
const WITHDRAWN = "asg_01arz3ndektsv4rrffq69g5fb6";
const UNKNOWN = "asg_01arz3ndektsv4rrffq69g5fz9";

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_MAGIC = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const FIXTURE = new URL(
  "./testdata/projects/prj_01arz3ndektsv4rrffq69g5fa1/agents/asg_01arz3ndektsv4rrffq69g5fa6.md",
  import.meta.url,
);
const OPERATOR = { role: "operator", place: "project" } as const;

// magic으로 시작하고 나머지는 0으로 채운 바이트. 크기를 정해 1 MiB 경계를 시험한다.
function imageOf(magic: number[], size = magic.length): Uint8Array {
  const out = new Uint8Array(size);
  out.set(magic);
  return out;
}

function memoryFiles(): {
  disk: Map<string, Uint8Array>;
  failing: { writes: boolean };
  files: ProfileImageFiles;
  store: AgentStore;
} {
  const disk = new Map<string, Uint8Array>();
  const failing = { writes: false };
  const files: ProfileImageFiles = {
    read: (path) => disk.get(path) ?? null,
    writeAtomic(path, bytes) {
      if (failing.writes) throw new Error("write failure");
      disk.set(path, bytes);
    },
  };
  const text: AgentFileSystem = {
    read(path) {
      const bytes = disk.get(path);
      return bytes === undefined ? null : new TextDecoder().decode(bytes);
    },
    writeAtomic(path, value) {
      if (failing.writes) throw new Error("write failure");
      disk.set(path, new TextEncoder().encode(value));
    },
    remove(path) {
      disk.delete(path);
    },
  };
  return { disk, failing, files, store: createAgentStore(text, ROOT) };
}

function assignment(
  id: string,
  role: AgentRole,
  scope: AssignmentRef["scope"],
  state: AssignmentRef["state"] = "enabled",
): AssignmentRef {
  return { id, role, scope, state, revision: 1 };
}

const REFS: AssignmentRef[] = [
  assignment(LOPHN, "lophn", { kind: "all" }),
  assignment(OP, "operator", { kind: "project", id: PRJ.id }),
  assignment(OTHER_OP, "operator", {
    kind: "project",
    id: "prj_01arz3ndektsv4rrffq69g5fa9",
  }),
  assignment(
    WITHDRAWN,
    "operator",
    { kind: "project", id: PRJ.id },
    "withdrawn",
  ),
];

// 시험에 필요한 자리·assignment 표만 가진 lookups다. 나머지 값은 비어 있다.
function lookups(): AgentLookups {
  return {
    placeExists: (place) => place.id === PRJ.id,
    assignments: (place) =>
      REFS.filter((ref) =>
        ref.state !== "withdrawn" &&
        (ref.scope.kind === "all" ||
          (ref.scope.kind === place.kind && ref.scope.id === place.id))
      ),
    assignment: (id) => REFS.find((ref) => ref.id === id) ?? null,
    contextStatus: () => null,
    activeContexts: () => [],
    skills: () => [],
    mcp: () => [],
    workspace: () => ({}),
  };
}

// 시험 정의 글에 profile만 바꿔 넣은 글이다. profile이 undefined면 칸을 뺀다.
function definitionWith(profile: Profile | undefined): string {
  const parsed = parseAgentFile(Deno.readTextFileSync(FIXTURE), OPERATOR);
  assert(parsed.ok, "fixture should parse");
  const written = serializeAgentFile(
    { ...parsed.value, profile },
    OPERATOR,
  );
  assert(written.ok, "definition should serialize");
  return written.value;
}

const OP_FOLDER = `${ROOT}/projects/${PRJ.id}/agents/${OP}`;

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

Deno.test("lophn-agent/agents#R13 [agent-I17]: a png, jpg or webp upload is stored as avatar.<ext> in the Operator's folder and the profile names that file", () => {
  const { disk, files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  const cases = [
    { type: "image/png", magic: PNG_MAGIC, ext: "png" },
    { type: "image/jpeg", magic: JPEG_MAGIC, ext: "jpg" },
    { type: "image/webp", magic: WEBP_MAGIC, ext: "webp" },
  ];
  for (const { type, magic, ext } of cases) {
    const body = imageOf(magic, 64);
    const result = uploadProfileImage(deps, lookups(), {
      place: PRJ,
      assignment: OP,
      content_type: type,
      declared_bytes: body.length,
      body,
    });
    assert(result.ok, `${type} should be accepted`);
    assertEquals(result.value, {
      profile: { kind: "image", image: `avatar.${ext}` },
    });
    assertEquals(disk.get(`${OP_FOLDER}/avatar.${ext}`), body);
  }
  assertEquals(disk.size, 3);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: an svg is refused whatever the declared type, and a refused upload writes nothing", () => {
  const { disk, files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  );
  const byType = uploadProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: OP,
    content_type: "image/svg+xml",
    declared_bytes: svg.length,
    body: svg,
  });
  assertEquals(byType.ok, false);
  if (!byType.ok) assertEquals(byType.error.code, "invalid_input");
  const byBody = uploadProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: OP,
    content_type: "image/png",
    declared_bytes: svg.length,
    body: svg,
  });
  assertEquals(byBody.ok, false);
  if (!byBody.ok) assertEquals(byBody.error.code, "invalid_input");
  assertEquals(disk.size, 0);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: 1048576 bytes is the largest image, and an empty or larger body is invalid_input", () => {
  const { disk, files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  const largest = imageOf(PNG_MAGIC, 1_048_576);
  const accepted = uploadProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: OP,
    content_type: "image/png",
    declared_bytes: largest.length,
    body: largest,
  });
  assert(accepted.ok, "1048576 bytes should be accepted");
  for (const size of [0, 1_048_577]) {
    const body = size === 0 ? new Uint8Array() : imageOf(PNG_MAGIC, size);
    const refused = uploadProfileImage(deps, lookups(), {
      place: PRJ,
      assignment: OP,
      content_type: "image/png",
      declared_bytes: body.length,
      body,
    });
    assertEquals(refused.ok, false);
    if (!refused.ok) assertEquals(refused.error.code, "invalid_input");
  }
  assertEquals(disk.get(`${OP_FOLDER}/avatar.png`), largest);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: the bytes must start with the magic of the declared type and match the declared size", () => {
  const { disk, files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
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
    const refused = uploadProfileImage(deps, lookups(), {
      place: PRJ,
      assignment: OP,
      content_type: type,
      declared_bytes: body.length,
      body,
    });
    assertEquals(refused.ok, false);
    if (!refused.ok) assertEquals(refused.error.code, "invalid_input");
  }
  const sized = imageOf(PNG_MAGIC, 32);
  const wrongDeclared = uploadProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: OP,
    content_type: "image/png",
    declared_bytes: 33,
    body: sized,
  });
  assertEquals(wrongDeclared.ok, false);
  if (!wrongDeclared.ok) {
    assertEquals(wrongDeclared.error.code, "invalid_input");
  }
  assertEquals(disk.size, 0);
});

Deno.test("lophn-agent/agents#R7 [agent-I17]: an Operator that is not an agent of the place, is withdrawn or does not exist is not_found and writes nothing", () => {
  const { disk, files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  const body = imageOf(PNG_MAGIC, 32);
  const cases: { place: AgentPlace; assignment: string }[] = [
    { place: PRJ, assignment: UNKNOWN },
    { place: PRJ, assignment: OTHER_OP },
    { place: PRJ, assignment: WITHDRAWN },
    { place: APP, assignment: OP },
  ];
  for (const { place, assignment } of cases) {
    const refused = uploadProfileImage(deps, lookups(), {
      place,
      assignment,
      content_type: "image/png",
      declared_bytes: body.length,
      body,
    });
    assertEquals(refused.ok, false);
    if (!refused.ok) assertEquals(refused.error.code, "not_found");
  }
  assertEquals(disk.size, 0);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a built-in agent's image goes in the folder named after its file, such as lophn", () => {
  const { disk, files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  const body = imageOf(WEBP_MAGIC, 32);
  const result = uploadProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: LOPHN,
    content_type: "image/webp",
    declared_bytes: body.length,
    body,
  });
  assert(result.ok, "a built-in agent may take an image");
  assertEquals(result.value.profile.image, "avatar.webp");
  assertEquals(
    disk.get(`${ROOT}/projects/${PRJ.id}/agents/lophn/avatar.webp`),
    body,
  );
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a failed image write is unavailable and leaves the previous image whole", () => {
  const { disk, failing, files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  const first = imageOf(PNG_MAGIC, 32);
  assert(
    uploadProfileImage(deps, lookups(), {
      place: PRJ,
      assignment: OP,
      content_type: "image/png",
      declared_bytes: first.length,
      body: first,
    }).ok,
  );
  failing.writes = true;
  const second = imageOf(PNG_MAGIC, 48);
  const refused = uploadProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: OP,
    content_type: "image/png",
    declared_bytes: second.length,
    body: second,
  });
  assertEquals(refused.ok, false);
  if (!refused.ok) assertEquals(refused.error.code, "unavailable");
  assertEquals(disk.get(`${OP_FOLDER}/avatar.png`), first);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: reading returns the stored image with the Content-Type of its real format, not the declared one", () => {
  const { files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  const body = imageOf(WEBP_MAGIC, 40);
  assert(
    uploadProfileImage(deps, lookups(), {
      place: PRJ,
      assignment: OP,
      content_type: "image/webp",
      declared_bytes: body.length,
      body,
    }).ok,
  );
  const written = store.write(
    PRJ,
    `${OP}.md`,
    definitionWith({ kind: "image", image: "avatar.webp" }),
  );
  assert(written.ok, "the definition should be written");
  const read = readProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: OP,
  });
  assert(read.ok, "the image should be read");
  assertEquals(read.value.content_type, "image/webp");
  assertEquals(read.value.bytes, body);
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: reading is not_found when the profile is an icon, the definition or the file is missing, or the assignment is outside the place", () => {
  const { files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  const body = imageOf(PNG_MAGIC, 32);
  const input = { place: PRJ, assignment: OP };
  // 정의가 없다.
  const noDefinition = readProfileImage(deps, lookups(), input);
  assertEquals(noDefinition.ok, false);
  if (!noDefinition.ok) assertEquals(noDefinition.error.code, "not_found");
  // profile이 icon이다.
  assert(
    store.write(
      PRJ,
      `${OP}.md`,
      definitionWith({ kind: "icon", icon: "roles" }),
    ).ok,
  );
  const iconOnly = readProfileImage(deps, lookups(), input);
  assertEquals(iconOnly.ok, false);
  if (!iconOnly.ok) assertEquals(iconOnly.error.code, "not_found");
  // profile은 image인데 파일이 없다.
  assert(
    store.write(
      PRJ,
      `${OP}.md`,
      definitionWith({ kind: "image", image: "avatar.png" }),
    ).ok,
  );
  const fileMissing = readProfileImage(deps, lookups(), input);
  assertEquals(fileMissing.ok, false);
  if (!fileMissing.ok) assertEquals(fileMissing.error.code, "not_found");
  // 자리 밖의 assignment는 파일이 있어도 보이지 않는다.
  assert(
    uploadProfileImage(deps, lookups(), {
      place: PRJ,
      assignment: OP,
      content_type: "image/png",
      declared_bytes: body.length,
      body,
    }).ok,
  );
  const outside = readProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: OTHER_OP,
  });
  assertEquals(outside.ok, false);
  if (!outside.ok) assertEquals(outside.error.code, "not_found");
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: a stored file that is not a supported image is unavailable and is never sent as another type", () => {
  const { disk, files, store } = memoryFiles();
  const deps: ProfileAssetDeps = { root: ROOT, files, store };
  assert(
    store.write(
      PRJ,
      `${OP}.md`,
      definitionWith({ kind: "image", image: "avatar.png" }),
    ).ok,
  );
  disk.set(`${OP_FOLDER}/avatar.png`, new TextEncoder().encode("<svg></svg>"));
  const read = readProfileImage(deps, lookups(), {
    place: PRJ,
    assignment: OP,
  });
  assertEquals(read.ok, false);
  if (!read.ok) assertEquals(read.error.code, "unavailable");
});

Deno.test("lophn-agent/agents#R13 [agent-I17]: the node adapter writes image bytes through a temp file, reads them back whole, and a missing image is null", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const files = createNodeProfileImageFiles();
    const path = `${dir}/projects/${PRJ.id}/agents/${OP}/avatar.png`;
    assertEquals(files.read(path), null);
    const first = imageOf(PNG_MAGIC, 64);
    files.writeAtomic(path, first);
    assertEquals(files.read(path), first);
    const second = imageOf(PNG_MAGIC, 128);
    files.writeAtomic(path, second);
    assertEquals(files.read(path), second);
    const leftovers = [
      ...Deno.readDirSync(`${dir}/projects/${PRJ.id}/agents/${OP}`),
    ]
      .filter((entry) => entry.name !== "avatar.png");
    assertEquals(leftovers, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
