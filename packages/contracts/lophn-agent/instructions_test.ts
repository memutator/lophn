import { assert, assertEquals } from "@std/assert";
import { routePath } from "../platform/mod.ts";
import {
  INSTRUCTION_READ_LAYERS,
  INSTRUCTION_READ_MAX_BASE64,
  instructionRead,
  instructionReadFileSchema,
} from "./instructions.ts";

const run = "run_01arz3ndektsv4rrffq69g5fav";

Deno.test("lophn-agent/instructions#R4 [agent-I19]: ReadInstructionFile은 machine만 읽고 입력은 run과 층 이름뿐이다", () => {
  assertEquals(routePath(instructionRead), "/v1/instructions/read");
  assertEquals(instructionRead.actors, ["machine"]);
  assertEquals([...INSTRUCTION_READ_LAYERS], [
    "global",
    "project",
    "app",
    "agent",
  ]);
  for (const layer of INSTRUCTION_READ_LAYERS) {
    assert(instructionRead.input.safeParse({ run, layer }).success);
  }
  // 어느 자리인지는 core가 run으로 정한다. 자리 id·문서 id·경로는 입력에 없다.
  for (
    const extra of [
      { place: "prj_01arz3ndektsv4rrffq69g5fav" },
      { document: "doc_01arz3ndektsv4rrffq69g5fav" },
      { path: "/etc/passwd" },
    ]
  ) {
    assert(
      !instructionRead.input.safeParse({ run, layer: "project", ...extra })
        .success,
    );
  }
  assert(!instructionRead.input.safeParse({ run }).success);
  assert(!instructionRead.input.safeParse({ run, layer: "preset" }).success);
});

Deno.test("lophn-agent/instructions#R7 [agent-I19]: 읽기 응답은 파일이 없으면 null이고 있으면 실제 크기와 본문뿐이다", () => {
  const common = { as_of_seq: "3", next_cursor: null };
  assert(instructionRead.output.safeParse({ ...common, file: null }).success);
  const file = { size_bytes: 5, content_base64: "aGVsbG8=" };
  assert(instructionReadFileSchema.safeParse(file).success);
  assert(instructionRead.output.safeParse({ ...common, file }).success);
  assertEquals(Object.keys(instructionReadFileSchema.shape).sort(), [
    "content_base64",
    "size_bytes",
  ]);
  // 파일 상한 32 KiB의 base64가 들어가고 그 이상은 들어가지 않는다.
  assertEquals(INSTRUCTION_READ_MAX_BASE64, 43_700);
  assert(
    instructionReadFileSchema.safeParse({
      size_bytes: 40_000,
      content_base64: "A".repeat(INSTRUCTION_READ_MAX_BASE64),
    }).success,
  );
  assert(
    !instructionReadFileSchema.safeParse({
      size_bytes: 40_000,
      content_base64: "A".repeat(INSTRUCTION_READ_MAX_BASE64 + 1),
    }).success,
  );
});
