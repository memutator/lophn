import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGENT_CHARACTER_COLORS,
  AGENT_CHARACTER_SHAPES,
  type Profile,
} from "../../../protocol/lophn-agent/agent-values.ts";
import { parseAgentFile, serializeAgentFile } from "./definition-file.ts";

const AGENT = "agt_00000000000000000000000001";

// serializer가 profile의 새 칸을 빠뜨리면 저장한 선택이 다음 읽기에서 사라진다.
test("정의 파일을 저장하고 다시 읽어도 character의 형태·색과 이미지 선택이 보존된다", () => {
  const target = { agent: AGENT } as const;
  const profiles: Profile[] = AGENT_CHARACTER_SHAPES.flatMap((shape) =>
    AGENT_CHARACTER_COLORS.map((color) => ({
      kind: "character" as const,
      shape,
      color,
    })),
  );
  profiles.push({ kind: "image", image: "avatar.png" });
  for (const profile of profiles) {
    const definition = { name: "reviewer", profile, body: "Review changes." };
    const saved = serializeAgentFile(definition, target);
    assert.ok(saved.ok);
    const read = parseAgentFile(saved.value, target);
    assert.ok(read.ok);
    assert.deepStrictEqual(read.value, definition);
  }
});
