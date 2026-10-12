import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  INSTRUCTION_READ_MAX_BASE64,
  instructionRead,
} from "../../protocol/lophn-agent/mod.ts";
import {
  decodeInstructionFile,
  encodeInstructionFile,
  INSTRUCTION_FILE_MAX_BYTES,
  type InstructionFile,
  instructionFilesOverCore,
  type InstructionLayerKind,
  resolveInstructions,
} from "./mod.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const encoder = new TextEncoder();

function fileOf(text: string): InstructionFile {
  const bytes = encoder.encode(text);
  return {
    size_bytes: bytes.length,
    bytes: bytes.slice(0, INSTRUCTION_FILE_MAX_BYTES),
  };
}

// core 쪽을 흉내 내는 가짜: route의 input·output schema를 거쳐 층별 파일을 돌려준다.
function viaRoute(seed: {
  files: Partial<Record<InstructionLayerKind, string>>;
  failing?: InstructionLayerKind[];
}) {
  const asked: unknown[] = [];
  const files = instructionFilesOverCore(RUN, (input) => {
    const parsed = instructionRead.input.parse(input);
    asked.push(parsed);
    if (seed.failing?.includes(parsed.layer)) {
      return Promise.resolve(
        err({ code: "unavailable", message: "/private/path/LOPHN.md" }),
      );
    }
    const text = seed.files[parsed.layer];
    return Promise.resolve(ok(instructionRead.output.parse({
      file: text === undefined ? null : encodeInstructionFile(fileOf(text)),
      as_of_seq: "7",
      next_cursor: null,
    })));
  });
  return { files, asked, stored: seed.files };
}

function resolve(files: ReturnType<typeof viaRoute>["files"]) {
  return resolveInstructions(
    { files, redact: (text) => text },
    { place: { kind: "project", id: PROJECT } },
  );
}

Deno.test("lophn-agent/instructions#R4 R5 [agent-I19]: ReadInstructionFile은 machine만 읽는 route이고 입력은 run과 층 하나이며 runtime은 이 route로 전역 → project → agent 본문을 UTF-8 그대로 받는다", async () => {
  assertEquals(instructionRead.actors, ["machine"]);
  const global = "전역 지침 — prefer short answers\n";
  const { files, asked } = viaRoute({
    files: { global, project: "project rules\n", agent: "agent rules\n" },
  });
  const resolved = await resolve(files);
  assert(resolved.ok);
  assertEquals(resolved.value.status, "ready");
  assertEquals(resolved.value.layers.map((layer) => layer.kind), [
    "global",
    "project",
    "agent",
  ]);
  assertEquals(resolved.value.layers.map((layer) => layer.text), [
    global,
    "project rules\n",
    "agent rules\n",
  ]);
  // 읽기 입력에는 자리 id가 없다. 어느 자리인지는 core가 run으로 정한다.
  assertEquals(asked, [
    { run: RUN, layer: "global" },
    { run: RUN, layer: "project" },
    { run: RUN, layer: "agent" },
  ]);
  // 로컬 경로는 어느 칸에도 없다.
  assert(!JSON.stringify(resolved.value).includes("/private"));
});

Deno.test("lophn-agent/instructions#R8 [agent-I19]: 읽을 때마다 파일을 다시 읽어 저장한 지침은 다음 call부터 새 hash로 보인다", async () => {
  const source = viaRoute({ files: { global: "first\n" } });
  const first = await resolve(source.files);
  assert(first.ok);
  source.stored.global = "edited\n";
  const second = await resolve(source.files);
  assert(second.ok);
  assertEquals(first.value.layers[0].text, "first\n");
  assertEquals(second.value.layers[0].text, "edited\n");
  assert(
    second.value.layers[0].source_hash !== first.value.layers[0].source_hash,
  );
});

Deno.test("lophn-agent/instructions#R2 R7 [agent-I19]: 파일이 없는 층은 부재, 읽지 못함·상한 초과는 본문을 보내지 않고 call을 멈춘다", async () => {
  const none = await resolve(viaRoute({ files: {} }).files);
  assert(none.ok);
  assertEquals(none.value.status, "ready");
  assertEquals(none.value.layers.map((layer) => layer.status), [
    "absent",
    "absent",
    "absent",
  ]);

  const failing = viaRoute({
    files: { global: "x\n" },
    failing: ["project"],
  });
  const failed = await resolve(failing.files);
  assert(failed.ok);
  assertEquals(failed.value.status, "blocked");
  assert(failed.value.layers.every((layer) => layer.text === null));
  assert(!JSON.stringify(failed.value).includes("/private"));

  // core는 처음 32 KiB만 보내고 size_bytes로 실제 크기를 알린다. 읽는 쪽이 상한 초과로 멈춘다.
  const large = viaRoute({ files: { global: "a".repeat(40_000) } });
  const grown = await resolve(large.files);
  assert(grown.ok);
  assertEquals(grown.value.status, "blocked");
  assertEquals(grown.value.layers[0].status, "too_large");
  assertEquals(grown.value.layers[0].bytes, 40_000);
});

Deno.test("lophn-agent/instructions#R2 [agent-I19]: 읽는 입력은 run과 층 하나뿐이고 자리 id·문서 id·경로를 주면 거절된다", () => {
  for (const layer of ["global", "project", "app", "agent"]) {
    assert(instructionRead.input.safeParse({ run: RUN, layer }).success);
  }
  assert(
    !instructionRead.input.safeParse({ run: RUN, layer: "preset" }).success,
  );
  assert(!instructionRead.input.safeParse({ run: RUN }).success);
  assert(
    !instructionRead.input.safeParse({
      run: RUN,
      layer: "project",
      place: PROJECT,
    }).success,
  );
  assert(
    !instructionRead.input.safeParse({
      run: RUN,
      layer: "global",
      document: "doc_01arz3ndektsv4rrffq69g5faz",
    }).success,
  );
  assert(
    !instructionRead.input.safeParse({ run: RUN, layer: "global", path: "/x" })
      .success,
  );
});

Deno.test("lophn-agent/instructions#R7 [agent-I19]: 읽기 응답은 문서·판 칸 없이 크기와 본문뿐이고 32 KiB 본문이 한 응답에 들어간다", () => {
  const bytes = new Uint8Array(INSTRUCTION_FILE_MAX_BYTES).fill(0x61);
  const encoded = encodeInstructionFile({ size_bytes: bytes.length, bytes });
  assertEquals(Object.keys(encoded).sort(), ["content_base64", "size_bytes"]);
  assert(encoded.content_base64.length <= INSTRUCTION_READ_MAX_BASE64);
  const reply = instructionRead.output.safeParse({
    file: encoded,
    as_of_seq: "1",
    next_cursor: null,
  });
  assert(reply.success);
  // 문서·판 칸이 있는 옛 응답은 걸러지거나 거절되어 어느 쪽이든 결과에 남지 않는다.
  const old = instructionRead.output.safeParse({
    file: { ...encoded, document: "doc_01arz3ndektsv4rrffq69g5faz" },
    as_of_seq: "1",
    next_cursor: null,
  });
  assert(
    !old.success ||
      !("document" in (old.data.file as unknown as Record<string, unknown>)),
  );
  const decoded = decodeInstructionFile(encoded);
  assert(decoded.ok);
  assertEquals(decoded.value.bytes, bytes);
  assertEquals(decoded.value.size_bytes, bytes.length);
});

// 읽기 통로가 err를 그대로 올리는지(오류를 부재로 바꾸지 않는다).
Deno.test("lophn-agent/instructions#R7 [agent-I19]: 읽기 오류는 부재로 바뀌지 않고 err로 전해지며 깨진 본문도 err다", async () => {
  const failing = instructionFilesOverCore(
    RUN,
    (): Promise<Result<never>> =>
      Promise.resolve(err({ code: "unavailable", message: "x" })),
  );
  const read = await failing.read("global");
  assertEquals(read.ok, false);

  const broken = instructionFilesOverCore(RUN, () =>
    Promise.resolve(ok({
      file: { size_bytes: 3, content_base64: "***not base64***" },
    })));
  const decoded = await broken.read("global");
  assertEquals(decoded.ok, false);
});
