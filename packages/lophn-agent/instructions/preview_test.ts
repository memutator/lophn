import { assert, assertEquals } from "@std/assert";
import {
  INSTRUCTION_PREVIEW_MAX_BYTES,
  instructionPreviewSchema,
} from "../../protocol/lophn-agent/mod.ts";
import {
  INSTRUCTION_FILE_MAX_BYTES,
  type InstructionFile,
  previewInstruction,
} from "./mod.ts";

// 사람 화면의 LOPHN.md 미리보기(shell/desktop#R50, lophn-agent/instructions#R9). 파일 앞부분만 상한까지 주고
// 실제 크기와 잘림을 알린다. 읽는 쪽이 이미 INSTRUCTION_FILE_MAX_BYTES까지만 읽어 오므로 그 안에서 자른다.

function fileOf(bytes: Uint8Array, size = bytes.length): InstructionFile {
  return {
    size_bytes: size,
    bytes: bytes.subarray(0, INSTRUCTION_FILE_MAX_BYTES),
  };
}

function textFile(text: string): InstructionFile {
  return fileOf(new TextEncoder().encode(text));
}

function previewOf(file: InstructionFile) {
  const preview = previewInstruction(file);
  assert(preview.ok, preview.ok ? "" : preview.error.message);
  return preview.value;
}

Deno.test("lophn-agent/instructions#R9 [agent-I49]: 미리보기 상한 안의 파일은 본문 전체와 실제 크기를 주고 잘리지 않았다고 알린다", () => {
  const preview = previewOf(textFile("# Rules\nBe brief.\n"));
  assertEquals(preview, {
    text: "# Rules\nBe brief.\n",
    size_bytes: 18,
    truncated: false,
  });
  assert(instructionPreviewSchema.safeParse(preview).success);
  // 빈 파일은 부재와 다르다: 본문이 빈 미리보기다.
  assertEquals(previewOf(textFile("")), {
    text: "",
    size_bytes: 0,
    truncated: false,
  });
});

Deno.test("lophn-agent/instructions#R9 [agent-I49]: 정확히 상한인 파일은 잘리지 않고 한 byte 넘으면 상한까지만 주며 실제 크기를 알린다", () => {
  const exact = previewOf(textFile("a".repeat(INSTRUCTION_PREVIEW_MAX_BYTES)));
  assertEquals(exact.text.length, INSTRUCTION_PREVIEW_MAX_BYTES);
  assertEquals(exact.truncated, false);

  const over = previewOf(
    textFile("a".repeat(INSTRUCTION_PREVIEW_MAX_BYTES + 1)),
  );
  assertEquals(over.text, "a".repeat(INSTRUCTION_PREVIEW_MAX_BYTES));
  assertEquals(over.size_bytes, INSTRUCTION_PREVIEW_MAX_BYTES + 1);
  assertEquals(over.truncated, true);
  assert(instructionPreviewSchema.safeParse(over).success);
});

Deno.test("lophn-agent/instructions#R9 [agent-I49]: 상한이 글자 가운데에 걸리면 그 글자를 반쪽으로 보이지 않고 앞에서 끊으며 대체 문자가 없다", () => {
  // 한글은 3 byte라 4096 byte 상한은 글자 가운데에 걸린다.
  const text = "가".repeat(2000);
  const preview = previewOf(textFile(text));
  assertEquals(preview.truncated, true);
  assertEquals(preview.size_bytes, 6000);
  assertEquals(preview.text, "가".repeat(1365));
  assert(!preview.text.includes("�"));
  assert(
    new TextEncoder().encode(preview.text).length <=
      INSTRUCTION_PREVIEW_MAX_BYTES,
  );
});

Deno.test("lophn-agent/instructions#R9 R7 [agent-I49]: 32 KiB를 넘는 파일도 앞 상한만 미리 보이고 실제 크기를 그대로 알린다", () => {
  const big = new TextEncoder().encode("b".repeat(INSTRUCTION_FILE_MAX_BYTES));
  const preview = previewOf(fileOf(big, INSTRUCTION_FILE_MAX_BYTES + 900));
  assertEquals(preview.text.length, INSTRUCTION_PREVIEW_MAX_BYTES);
  assertEquals(preview.size_bytes, INSTRUCTION_FILE_MAX_BYTES + 900);
  assertEquals(preview.truncated, true);
});

Deno.test("lophn-agent/instructions#R7 [agent-I49]: UTF-8이 아닌 파일은 대체 문자로 고쳐 보이지 않고 invalid_input이다", () => {
  const broken = previewInstruction(
    fileOf(Uint8Array.from([0x61, 0xff, 0xfe, 0x62])),
  );
  assert(!broken.ok);
  assertEquals(broken.error.code, "invalid_input");
  // 파일이 글자 가운데에서 끝나는 것도 깨진 UTF-8이다. 상한 때문에 잘린 것과 구별한다.
  const half = previewInstruction(
    fileOf(Uint8Array.from([0x61, 0xea, 0xb0])),
  );
  assert(!half.ok);
  assertEquals(half.error.code, "invalid_input");
});
