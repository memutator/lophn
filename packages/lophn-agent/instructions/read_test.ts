import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type InstructionLocation,
  instructionRead,
} from "../../contracts/lophn-agent/mod.ts";
import {
  INSTRUCTION_FILE_MAX_BYTES,
  type InstructionFile,
  type InstructionFiles,
  instructionFilesOverCore,
  instructionReadApi,
  resolveInstructions,
} from "./mod.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const GLOBAL_DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const PROJECT_DOC = "doc_01arz3ndektsv4rrffq69g5faw";
const PRESET_DOC = "doc_01arz3ndektsv4rrffq69g5faz";
const encoder = new TextEncoder();

type Stored = { document: string; version: string; text: string };

// core 쪽: 확정 판을 가진 가짜 InstructionFiles를 ReadInstructionFile route 정의로 감싼다.
// runtime 쪽: route의 input·output schema를 거쳐 InstructionFiles 어댑터로 읽는다.
function viaRoute(seed: {
  registered: Record<string, Stored>;
  attached?: Record<string, Stored>;
  failing?: string[];
}) {
  const core: InstructionFiles = {
    registered(location: InstructionLocation) {
      const key = `${location.layer}:${location.place}`;
      if (seed.failing?.includes(key)) {
        return Promise.resolve(
          err({ code: "unavailable", message: "/private/path/LOPHN.md" }),
        );
      }
      const stored = seed.registered[key];
      return Promise.resolve(ok(stored === undefined ? null : fileOf(stored)));
    },
    attached(document: string) {
      const stored = seed.attached?.[document];
      return Promise.resolve(
        stored === undefined
          ? err({ code: "not_found", message: "no document" })
          : ok(fileOf(stored)),
      );
    },
    projectOf: () => Promise.resolve(ok(null)),
  };
  const api = instructionReadApi({ files: core, asOfSeq: () => ok("7") });
  const files = instructionFilesOverCore(async (input) => {
    const parsed = instructionRead.input.parse(input);
    const reply = await api.handle(
      {} as never,
      parsed,
    );
    if (!reply.ok) return reply;
    return ok(instructionRead.output.parse(reply.value));
  });
  return { files, registered: seed.registered };
}

function fileOf(stored: Stored): InstructionFile {
  const bytes = encoder.encode(stored.text);
  return {
    document: stored.document,
    version: stored.version,
    size_bytes: bytes.length,
    bytes: bytes.slice(0, INSTRUCTION_FILE_MAX_BYTES),
  };
}

const global: Stored = {
  document: GLOBAL_DOC,
  version: "ver_01arz3ndektsv4rrffq69g5fav",
  text: "전역 지침 — prefer short answers\n",
};
const project: Stored = {
  document: PROJECT_DOC,
  version: "ver_01arz3ndektsv4rrffq69g5faw",
  text: "project rules\n",
};

function resolve(
  files: InstructionFiles,
  attachments: { document: string; order: number }[] = [],
) {
  return resolveInstructions(
    { files, redact: (text) => text },
    { place: { kind: "project", id: PROJECT }, attachments },
  );
}

Deno.test("lophn-agent/instructions#R4 R5: ReadInstructionFile은 machine만 읽는 route이고 runtime은 이 route로 전역→project→preset 순 확정 판을 UTF-8 그대로 받는다", async () => {
  assertEquals(instructionRead.actors, ["machine"]);
  const { files } = viaRoute({
    registered: { "global:global": global, [`project:${PROJECT}`]: project },
    attached: {
      [PRESET_DOC]: { ...project, document: PRESET_DOC, text: "preset\n" },
    },
  });
  const resolved = await resolve(files, [{ document: PRESET_DOC, order: 0 }]);
  assert(resolved.ok);
  assertEquals(resolved.value.status, "ready");
  assertEquals(resolved.value.layers.map((layer) => layer.kind), [
    "global",
    "project",
    "preset",
  ]);
  assertEquals(resolved.value.layers.map((layer) => layer.text), [
    global.text,
    project.text,
    "preset\n",
  ]);
  assertEquals(resolved.value.layers[0].version, global.version);
  // 로컬 경로는 어느 칸에도 없다.
  assert(!JSON.stringify(resolved.value).includes("/private"));
});

Deno.test("lophn-agent/instructions#R8: 읽을 때마다 현재 확정 판을 다시 읽어 변경한 지침은 다음 call부터 새 version으로 보인다", async () => {
  const source = viaRoute({ registered: { "global:global": global } });
  const first = await resolve(source.files);
  assert(first.ok);
  source.registered["global:global"] = {
    ...global,
    version: "ver_01arz3ndektsv4rrffq69g5fax",
    text: "edited\n",
  };
  const second = await resolve(source.files);
  assert(second.ok);
  assertEquals(first.value.layers[0].text, global.text);
  assertEquals(second.value.layers[0].text, "edited\n");
  assert(second.value.layers[0].version !== first.value.layers[0].version);
  assert(
    second.value.layers[0].source_hash !== first.value.layers[0].source_hash,
  );
});

Deno.test("lophn-agent/instructions#R2 R7: 연결된 문서가 없는 자리는 부재, 읽지 못함·상한 초과는 본문을 보내지 않고 call을 멈춘다", async () => {
  const absent = viaRoute({ registered: {} });
  const none = await resolve(absent.files);
  assert(none.ok);
  assertEquals(none.value.status, "ready");
  assertEquals(none.value.layers.map((layer) => layer.status), [
    "absent",
    "absent",
  ]);

  const failing = viaRoute({
    registered: { "global:global": global },
    failing: [`project:${PROJECT}`],
  });
  const failed = await resolve(failing.files);
  assert(failed.ok);
  assertEquals(failed.value.status, "blocked");
  assert(failed.value.layers.every((layer) => layer.text === null));
  assert(!JSON.stringify(failed.value).includes("/private"));

  const large = viaRoute({
    registered: {
      "global:global": { ...global, text: "a".repeat(40_000) },
    },
  });
  const grown = await resolve(large.files);
  assert(grown.ok);
  assertEquals(grown.value.status, "blocked");
  assertEquals(grown.value.layers[0].status, "too_large");
  assertEquals(grown.value.layers[0].bytes, 40_000);
});

Deno.test("lophn-agent/instructions#R2: 읽는 입력은 등록 자리나 붙은 문서 하나뿐이고 둘을 함께 주거나 경로를 주면 거절된다", () => {
  assert(instructionRead.input.safeParse({ document: PRESET_DOC }).success);
  assert(
    instructionRead.input.safeParse({
      location: { layer: "global", place: "global" },
    }).success,
  );
  assert(
    !instructionRead.input.safeParse({
      document: PRESET_DOC,
      location: { layer: "global", place: "global" },
    }).success,
  );
  assert(!instructionRead.input.safeParse({ path: "/etc/passwd" }).success);
});

// 읽기 통로가 err를 그대로 올리는지(오류를 부재로 바꾸지 않는다).
Deno.test("lophn-agent/instructions#R7: 읽기 오류는 부재로 바뀌지 않고 err로 전해진다", async () => {
  const files = instructionFilesOverCore((): Promise<Result<never>> =>
    Promise.resolve(err({ code: "unavailable", message: "x" }))
  );
  const read = await files.registered({ layer: "global", place: "global" });
  assertEquals(read.ok, false);
});
