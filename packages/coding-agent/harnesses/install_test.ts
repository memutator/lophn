// 선택 target 설치 흐름 시험이다(harnesses#R6, R8, R9, connection#R12, cli#R40). HOME·project·lophn
// home은 모두 temp dir fixture이고 사람의 실제 설정 root는 열지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { installSelected } from "./install.ts";
import { filePort, storeOf } from "./integration/journal.ts";
import {
  CAC,
  fixture,
  fixtureLaunch,
  NOW,
  targetOf,
  write,
} from "./testing/mod.ts";

const SKILL = {
  name: "lophn-navigate",
  files: [{ path: "SKILL.md", content: "---\nname: lophn-navigate\n---\n" }],
};

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("coding-agent/harnesses#R6 coding-agent/cli#R40: 제품 둘이 있어도 고른 하나의 target만 바뀌고 다른 제품 설정은 읽지도 만들지도 않는다", async () => {
  const fx = await fixture();
  try {
    // 다른 제품(codex)의 사람 설정이 있다. 설치는 이 파일을 건드리지 않는다.
    const codexConfig = `${fx.home}/.codex/config.toml`;
    await write(codexConfig, 'model = "mine"\n');
    const before = await Deno.readTextFile(codexConfig);
    const outcome = await installSelected({
      target: targetOf("claude", "user", fx),
      connection: CAC,
      launch: fixtureLaunch(),
      skill: SKILL,
      version: null,
      roots: { home: fx.home, env: fx.env, cwd: fx.project },
      operationId: "op-1",
      now: NOW,
    }, { files: filePort(), store: storeOf(fx.lophn) });
    assert(outcome.ok);
    assertEquals(outcome.value.status, "complete");
    assert(outcome.value.receipt_stored);
    assertEquals(
      outcome.value.resources.map((item) => item.outcome).sort(),
      ["changed", "changed"],
    );
    assertEquals(await Deno.readTextFile(codexConfig), before);
    assertFalse(await exists(`${fx.home}/.gemini`));
    // 설정에는 connection 참조만 있고 token은 없다.
    const config = await Deno.readTextFile(`${fx.home}/.claude.json`);
    assert(config.includes(CAC));
    assertFalse(/token/i.test(config));
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R8 coding-agent/connection#R12: 사람이 쓴 같은 이름의 항목은 덮지 않고 충돌로 남으며 일부 실패를 전체 성공으로 표시하지 않는다", async () => {
  const fx = await fixture();
  try {
    const path = `${fx.home}/.claude.json`;
    const mine = JSON.stringify({
      mcpServers: { lophn: { command: "mine" }, other: { command: "keep" } },
    });
    await write(path, mine);
    const outcome = await installSelected({
      target: targetOf("claude", "user", fx),
      connection: CAC,
      launch: fixtureLaunch(),
      skill: SKILL,
      version: null,
      roots: { home: fx.home, env: fx.env, cwd: fx.project },
      operationId: "op-2",
      now: NOW,
    }, { files: filePort(), store: storeOf(fx.lophn) });
    assert(outcome.ok);
    const byIdentity = new Map(
      outcome.value.resources.map((item) => [item.resource_identity, item]),
    );
    assertEquals(byIdentity.get("mcp:user")?.outcome, "conflict");
    assertEquals(await Deno.readTextFile(path), mine);
    // skill은 쓰였지만 설정 충돌이 있어 complete가 아니다.
    assertEquals(outcome.value.status, "partial");
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R9 coding-agent/connection#R12: 지원하지 않는 환경 요청은 아무것도 쓰지 않고 오류다", async () => {
  const fx = await fixture();
  try {
    const target = {
      ...targetOf("claude", "user", fx),
      environment: { kind: "wsl" as const, identity: "x" },
    };
    const outcome = await installSelected({
      target: target as never,
      connection: CAC,
      launch: fixtureLaunch(),
      version: null,
      roots: { home: fx.home, env: fx.env, cwd: fx.project },
      operationId: "op-3",
      now: NOW,
    }, { files: filePort(), store: storeOf(fx.lophn) });
    assertFalse(outcome.ok);
    assertFalse(await exists(`${fx.home}/.claude.json`));
  } finally {
    await fx.dispose();
  }
});
