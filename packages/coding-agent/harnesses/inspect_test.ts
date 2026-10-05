// 설치 관측 테스트다(coding-agent/harnesses#R3, R10, T32). component 상태와
// loading 단계가 따로 나오고 current가 loading 성공을 뜻하지 않는지 본다.
// 모든 root는 temp fixture이고 MCP server는 대역이다.
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { harnessIntegrationObservationSchema } from "../../contracts/coding-agent/mod.ts";
import { inspectIntegration } from "./inspect.ts";
import { filePort, storeOf } from "./integration/journal.ts";
import { stdioMcpProbe } from "./mcp-probe.ts";
import {
  type Fixture,
  fixture,
  fixtureLaunch,
  inputOf,
  installWithReceipt,
  NOW,
  rootFor,
  write,
} from "./testing/mod.ts";

function ports(fx: Fixture) {
  return {
    files: filePort(),
    mcp: stdioMcpProbe({
      timeout_ms: 8_000,
      ambient: (name) =>
        ({
          PATH: "/usr/bin:/bin",
          HOME: fx.home,
          DENO_DIR: `${fx.base}/deno`,
        })[name],
    }),
    store: storeOf(fx.lophn),
  };
}

Deno.test("coding-agent/harnesses#R3: component가 current여도 server가 못 뜨면 loading은 failure로 따로 나온다", async () => {
  const fx = await fixture();
  try {
    await installWithReceipt(
      fx,
      "claude",
      "app",
      fixtureLaunch("crash"),
      "lophn-save",
    );
    const { observation, loading } = await inspectIntegration(
      { ...inputOf(fx, "claude", "app", { trust: "trusted" }), now: NOW },
      ports(fx),
    );
    const kinds = observation.components.map((item) =>
      `${item.kind}:${item.state}`
    );
    assertEquals(kinds.sort(), ["mcp:current", "skill:current"]);
    for (const component of observation.components) {
      assertEquals(component.ownership, "owned");
      assert(component.receipt_ref !== null);
    }
    const init = observation.loading_checks.find((check) =>
      check.stage === "mcp_initialize"
    );
    assertEquals(init?.result, "failure");
    // skill 하나만 설치했으므로 skill_discovery도 success가 아니다.
    assertEquals(
      observation.loading_checks.find((check) =>
        check.stage === "skill_discovery"
      )?.result,
      "failure",
    );
    // loading 결과는 observation과 같고 다음 확인을 더 가진다.
    assertEquals(loading.length, 4);
    assertEquals(
      loading.map((item) => item.result),
      observation.loading_checks.map((item) => item.result),
    );
    // contract schema를 통과한다.
    harnessIntegrationObservationSchema.parse(observation);
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R3: 사람이 고친 항목은 modified, 사라진 resource는 missing, 깨진 설정은 error다", async () => {
  const fx = await fixture();
  try {
    await installWithReceipt(
      fx,
      "claude",
      "app",
      fixtureLaunch("ok"),
      "lophn-save",
    );
    const input = { ...inputOf(fx, "claude", "app"), now: NOW };

    // 사람이 MCP 항목을 고쳤다.
    const mcp = `${fx.project}/.mcp.json`;
    const text = await Deno.readTextFile(mcp);
    await write(mcp, text.replace('"core"', '"core,app"'));
    const edited = await inspectIntegration(input, ports(fx));
    assertEquals(
      edited.observation.components.find((item) => item.kind === "mcp")?.state,
      "modified",
    );

    // skill 디렉터리가 사라졌다.
    await Deno.remove(`${fx.project}/.claude/skills`, { recursive: true });
    const gone = await inspectIntegration(input, ports(fx));
    assertEquals(
      gone.observation.components.find((item) => item.kind === "skill")?.state,
      "missing",
    );

    // 설정이 깨졌다. error이고 파일은 그대로다.
    await write(mcp, '{"mcpServers": {');
    const broken = await inspectIntegration(input, ports(fx));
    const component = broken.observation.components.find((item) =>
      item.kind === "mcp"
    );
    assertEquals(component?.state, "error");
    assertStringIncludes(component?.reason ?? "", "깨져");
    assertEquals(await Deno.readTextFile(mcp), '{"mcpServers": {');
  } finally {
    await fx.dispose();
  }
});

Deno.test("coding-agent/harnesses#R3: receipt가 없으면 component는 비고 loading 네 단계는 그대로 관측한다", async () => {
  const fx = await fixture();
  try {
    const { observation } = await inspectIntegration(
      { ...inputOf(fx, "codex", "user"), now: NOW },
      ports(fx),
    );
    assertEquals(observation.components, []);
    assertEquals(observation.loading_checks.length, 4);
    assertEquals(observation.target.harness_id, "codex");
    assertEquals(observation.connection, "cac_01h455vb4pex5v6nkc6gd5fdw1");
    assertEquals(rootFor(fx, "codex_home").startsWith(fx.home), true);
  } finally {
    await fx.dispose();
  }
});
