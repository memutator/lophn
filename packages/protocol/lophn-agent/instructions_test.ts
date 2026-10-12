import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../base/route.ts";
import {
  INSTRUCTION_PREVIEW_MAX_BYTES,
  INSTRUCTION_READ_LAYERS,
  INSTRUCTION_READ_MAX_BASE64,
  instructionPreview,
  instructionPreviewSchema,
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

Deno.test("lophn-agent/agents#Q1 [agent-R10]: documents가 같은 Tx에서 묻는 지침 첨부·Operator 출력 port와 그 값 schema는 contract에 없다", async () => {
  const exported = await import("./mod.ts");
  for (
    const name of [
      "InstructionAttachments",
      "OperatorOutput",
      "instructionAttachmentSchema",
      "instructionAttachmentRefSchema",
      "operatorOutputRefSchema",
      "operatorOutputRefOutputSchema",
    ]
  ) {
    assertEquals(name in exported, false, name);
  }
  // 상태 이름 목록은 assignment가 계속 쓴다.
  assertEquals(
    [...exported.ASSIGNMENT_STATES],
    ["enabled", "paused", "withdrawn"],
  );
});

Deno.test("lophn-agent/instructions#R9 shell/desktop#R50 [agent-I49]: 모든 project의 LOPHN.md 미리보기는 사람만 읽고 입력이 없으며 run·층·경로를 받지 않는다", () => {
  assertEquals(routePath(instructionPreview), "/v1/instructions/preview");
  assertEquals(instructionPreview.kind, "read");
  assertEquals(instructionPreview.name, "PreviewGlobalInstructions");
  // machine의 ReadInstructionFile과 따로다: 사람 화면이 읽고 agent·machine은 읽지 못한다.
  assertEquals([...instructionPreview.actors], ["user"]);
  assertEquals([...instructionRead.actors], ["machine"]);
  assert(instructionPreview.input.safeParse({}).success);
  for (
    const extra of [
      { run },
      { layer: "global" },
      { path: "/etc/passwd" },
      { max_bytes: 10 },
    ]
  ) {
    assert(!instructionPreview.input.safeParse(extra).success);
  }
  assert(
    instructionPreview.errors.every((code) => ERROR_CODES.includes(code)),
  );
  assert(!instructionPreview.errors.includes("internal"));
});

Deno.test("lophn-agent/instructions#R9 shell/desktop#R50 [agent-I49]: 미리보기 응답은 파일이 없으면 null이고 있으면 본문 앞부분·실제 크기·잘림 표시뿐이며 본문은 미리보기 상한을 넘지 못한다", () => {
  // 상한은 요구가 정하지 않아 추천값을 둔다: 화면 한 칸에 보이는 앞부분이라 4 KiB다.
  assertEquals(INSTRUCTION_PREVIEW_MAX_BYTES, 4096);
  const common = { as_of_seq: "3", next_cursor: null };
  assert(
    instructionPreview.output.safeParse({ ...common, preview: null }).success,
  );
  const preview = {
    text: "# Rules\nBe brief.\n",
    size_bytes: 19,
    truncated: false,
  };
  assert(instructionPreviewSchema.safeParse(preview).success);
  assert(
    instructionPreview.output.safeParse({ ...common, preview }).success,
  );
  assertEquals(Object.keys(instructionPreviewSchema.shape).sort(), [
    "size_bytes",
    "text",
    "truncated",
  ]);
  assert(
    instructionPreviewSchema.safeParse({
      text: "a".repeat(INSTRUCTION_PREVIEW_MAX_BYTES),
      size_bytes: 40_000,
      truncated: true,
    }).success,
  );
  assert(
    !instructionPreviewSchema.safeParse({
      text: "a".repeat(INSTRUCTION_PREVIEW_MAX_BYTES + 1),
      size_bytes: 40_000,
      truncated: true,
    }).success,
  );
  assert(
    !instructionPreviewSchema.safeParse({ text: "x", size_bytes: 1 }).success,
  );
  assert(!instructionPreview.output.safeParse({ ...common }).success);
});
