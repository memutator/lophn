// Hermes·pi·OpenClaw adapter 테스트다(coding-agent/harnesses#R8, R11,
// guides#R5, R13, cli#R9, connection#R1, R14, mcp-server#R1, T31). fixture
// home은 temp dir이고 사람의 실제 home은 읽지 않는다. 실제 설정 위치는 조사
// 문서의 검증 근거를 따른다.
import { assert, assertEquals } from "@std/assert";
import type {
  HarnessId,
  IntegrationTarget,
} from "../../../contracts/coding-agent/mod.ts";
import { cliMcpConfigSchema } from "../../../contracts/coding-agent/mod.ts";
import {
  type FilePort,
  install,
  observe,
  type ObservedHashes,
  type Store,
} from "../integration/apply.ts";
import {
  type InstallPlan,
  type PlannedResource,
  planOf,
} from "../integration/plan.ts";
import type { Receipt } from "../integration/receipt.ts";
import { ownedFragment, parseYaml } from "../adapters/yaml.ts";
import { catalogOf, HARNESS_CATALOG } from "./definitions.ts";
import type { HarnessDefinition } from "../model.ts";

const NOW = "2026-10-05T00:00:00.000Z";

function target(
  harness: IntegrationTarget["harness_id"],
  scope: IntegrationTarget["scope_kind"] = "user",
): IntegrationTarget {
  return scope === "app"
    ? {
      scope_kind: "app",
      environment: { kind: "host", identity: "fixture" },
      profile_id: null,
      harness_id: harness,
      app: "app_01h455vb4pex5v6nkc6gd5fdw1",
      app_realpath: "/fixture/app",
    }
    : {
      scope_kind: "user",
      environment: { kind: "host", identity: "fixture" },
      profile_id: null,
      harness_id: harness,
      app: null,
      app_realpath: null,
    };
}

// 메모리 파일 눈이다. symlink는 따라가지 않는다(R7). 디렉터리는 `dir/` 접두
// 파일로 본다.
function memoryPort(files: Record<string, string>): FilePort {
  const tree = { ...files };
  const prefixOf = (dir: string) => (dir.endsWith("/") ? dir : `${dir}/`);
  return {
    read(path) {
      const text = tree[path];
      if (text !== undefined) return Promise.resolve({ kind: "file", text });
      const prefix = prefixOf(path);
      const hasChild = Object.keys(tree).some((key) => key.startsWith(prefix));
      return Promise.resolve(
        hasChild ? { kind: "directory" } : { kind: "absent" },
      );
    },
    listFiles(dir) {
      const prefix = prefixOf(dir);
      const listed = Object.entries(tree)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, text]) => ({ path: key.slice(prefix.length), text }));
      return Promise.resolve({ kind: "files", files: listed });
    },
    escapes(root, path) {
      const prefix = prefixOf(root);
      return Promise.resolve(
        !path.startsWith(prefix) ||
          path.slice(prefix.length).split("/").includes(".."),
      );
    },
    writeAtomic(path, text) {
      tree[path] = text;
      return Promise.resolve(true);
    },
    writeTree(dir, entries) {
      for (const entry of entries) tree[`${dir}/${entry.path}`] = entry.content;
      return Promise.resolve(true);
    },
    remove(path) {
      delete tree[path];
      const prefix = prefixOf(path);
      for (const key of Object.keys(tree)) {
        if (key.startsWith(prefix)) delete tree[key];
      }
      return Promise.resolve(true);
    },
  };
}

function memoryStore(): Store & { receipts: Receipt[] } {
  const receipts: Receipt[] = [];
  return {
    receipts,
    receipt() {
      return Promise.resolve(receipts.at(-1) ?? null);
    },
    saveReceipt(receipt) {
      receipts.push(receipt);
      return Promise.resolve(true);
    },
    journal() {
      return Promise.resolve({ entries: [] });
    },
    saveJournal() {
      return Promise.resolve(true);
    },
  };
}

function definitionOf(id: HarnessId): HarnessDefinition {
  const found = catalogOf(id);
  assert(found !== undefined, id);
  if (found === undefined) throw new Error("unreachable");
  return found;
}

function assertPlan(value: ReturnType<typeof planOf>): InstallPlan {
  assert(value.ok);
  if (!value.ok) throw new Error("unreachable");
  return value.value;
}

function assertSeen(value: ObservedHashes | "blocked"): ObservedHashes {
  assert(typeof value !== "string");
  if (typeof value === "string") throw new Error("unreachable");
  return value;
}

Deno.test("coding-agent/harnesses#R8: Hermes config target은 HERMES_HOME의 config.yaml이다", () => {
  const hermes = definitionOf("hermes");
  // `$HERMES_HOME/config.yaml`(기본 `~/.hermes`)이다(조사 9.1 get_config_path).
  assertEquals(hermes.config_targets.length, 1);
  const seat = hermes.config_targets[0];
  assertEquals(seat.root_resolver, "hermes_home");
  assertEquals(seat.path, "config.yaml");
  assertEquals(seat.format, "yaml");
  // lophn 항목은 `mcp_servers.lophn` stdio command·args·env·cwd다(R8).
  assertEquals(seat.owned_key, "mcp_servers.lophn");
  assertEquals(seat.scope_kind, "user");
});

Deno.test("coding-agent/harnesses#R8: pi config target은 native mcp.json이고 adapter 파일이 아니다", () => {
  const pi = definitionOf("pi");
  // 조사 revision(8369268)의 `~/.pi/agent/mcp.json`이다(질문 Q19, 조사 9.1).
  assertEquals(pi.config_targets[0].root_resolver, "home");
  assertEquals(pi.config_targets[0].path, ".pi/agent/mcp.json");
  assertEquals(pi.config_targets[0].format, "json");
  assertEquals(pi.config_targets[0].owned_key, "mcpServers.lophn");
  // trusted `<cwd>/.pi/mcp.json`(app)이다. 사람 trust 결정 뒤에만 읽힌다.
  assertEquals(pi.config_targets[1].scope_kind, "app");
  assertEquals(pi.config_targets[1].path, ".pi/mcp.json");
  // 옛 `mcp-adapter.json`은 target이 아니다(Q19).
  assert(
    !pi.config_targets.some((entry) => entry.path.includes("mcp-adapter")),
  );
});

Deno.test("coding-agent/harnesses#R8: OpenClaw는 자동 merge target이 없고 조각 안내만 둔다", () => {
  const openclaw = definitionOf("openclaw");
  // `mcp.servers`는 strict schema라 invalid면 harness가 throw하므로(조사 9.1)
  // 자동 merge하지 않는다(R8).
  assertEquals(openclaw.config_targets.length, 0);
  // managed skill root만 둔다(조사 skills-and-guides OpenClaw 절).
  assertEquals(openclaw.skill_targets[0].path, ".openclaw/skills");
});

Deno.test("coding-agent/harnesses#R11: 세 제품의 상태 hook은 검증 version이 없어 두지 않는다", () => {
  // 미검증 hook·plugin·extension은 자동 설치하지 않는다(R11).
  for (const id of ["hermes", "pi", "openclaw"] as const) {
    assertEquals(definitionOf(id).hooks.length, 0, id);
  }
});

Deno.test("coding-agent/harnesses#R11: 미확인 session 소유 stdio는 unverified로 남는다", () => {
  const openclaw = definitionOf("openclaw");
  // unknown을 supported·unsupported로 바꾸지 않는다(조사 3.1, mcp-server#R1).
  assertEquals(openclaw.execution.capability, "unverified");
  assertEquals(openclaw.execution.prompt_delivery, "stdin_after_ready");
});

Deno.test("coding-agent/harnesses#R8: 세 제품의 version·auth 미확인 probe는 unverified다", () => {
  for (const id of ["hermes", "pi", "openclaw"] as const) {
    const entry = definitionOf(id);
    // probe 자리가 없다(present: false). capability는 unverified다(조사 9.4).
    assertEquals(entry.version_probe.present, false, id);
    assert(entry.version_probe.present === false);
    assertEquals(entry.version_probe.capability, "unverified", id);
    assertEquals(entry.auth_probe.present, false, id);
    assert(entry.auth_probe.present === false);
    assertEquals(entry.auth_probe.capability, "unverified", id);
    assertEquals(entry.version_policy.unverifiable, "unverified", id);
  }
});

Deno.test("coding-agent/guides#R5: 세 제품의 skill root는 실제 발견 위치를 둔다", () => {
  // Hermes: `$HERMES_HOME/skills`와 프로젝트 `.hermes/skills`(조사 9.5,
  // skills-and-guides Hermes 절).
  const hermes = definitionOf("hermes");
  assertEquals(hermes.skill_targets[0].root_resolver, "hermes_home");
  assertEquals(hermes.skill_targets[0].path, "skills");
  assertEquals(hermes.skill_targets[1].path, ".hermes/skills");
  // pi: `~/.pi/agent/skills`와 `<cwd>/.pi/skills`(skills-and-guides pi 절).
  const pi = definitionOf("pi");
  assertEquals(pi.skill_targets[0].path, ".pi/agent/skills");
  assertEquals(pi.skill_targets[1].path, ".pi/skills");
  // OpenClaw: managed `~/.openclaw/skills`(skills-and-guides OpenClaw 절).
  const openclaw = definitionOf("openclaw");
  assertEquals(openclaw.skill_targets[0].root_resolver, "home");
});

Deno.test("coding-agent/guides#R13: 세 제품의 지침 정본은 AGENTS.md 하나다", () => {
  // Codex·pi는 더 가까운 `AGENTS.override.md`가 이기고(skills-and-guides
  // R13 diff) Hermes는 `.hermes.md`/`HERMES.md`가 이기지만 lophn이 쓰는
  // 관리 구간은 정본 `AGENTS.md` 하나다.
  for (const id of ["hermes", "pi", "openclaw"] as const) {
    const entry = definitionOf(id);
    assertEquals(entry.instructions.length, 1, id);
    assertEquals(entry.instructions[0].file, "AGENTS.md", id);
    assertEquals(entry.instructions[0].marker, "lophn-managed-instruction", id);
  }
});

Deno.test("coding-agent/cli#R9: mcp config는 세 제품의 target·scope·connection을 받는다", () => {
  // 조각은 executable·분리 argv·안전 env만이다. 설정 파일은 고치지 않는다.
  for (const id of ["hermes", "pi", "openclaw"] as const) {
    cliMcpConfigSchema.parse({
      command: "mcp config",
      target: id,
      scope: "user",
      connection: "cac_01h455vb4pex5v6nkc6gd5fdw1",
    });
    // scope는 user|app 둘이다.
    assertEquals(
      cliMcpConfigSchema.safeParse({
        command: "mcp config",
        target: id,
        scope: "all",
        connection: "cac_01h455vb4pex5v6nkc6gd5fdw1",
      }).success,
      false,
      id,
    );
    // connection 없는 요청은 거절이다.
    assertEquals(
      cliMcpConfigSchema.safeParse({
        command: "mcp config",
        target: id,
        scope: "user",
      }).success,
      false,
      id,
    );
  }
});

Deno.test("coding-agent/connection#R1: 세 제품의 실행 계약은 catalog에 둔다", () => {
  // 연결은 자기 터미널 세션과 사람 [Start] TUI를 같은 계약으로 연다(R1).
  const hermes = definitionOf("hermes");
  assertEquals(hermes.execution.transport, "pty");
  assertEquals(hermes.execution.launch_argv, ["hermes", "--tui"]);
  // Hermes resume은 [미확인]이라 null이다(조사 9.4).
  assertEquals(hermes.execution.resume_argv, null);
  const pi = definitionOf("pi");
  assertEquals(pi.execution.transport, "pty");
  assertEquals(pi.execution.launch_argv, ["pi"]);
  assertEquals(pi.execution.resume_argv, ["pi", "--session"]);
  const openclaw = definitionOf("openclaw");
  assertEquals(openclaw.execution.transport, "pty");
});

Deno.test("coding-agent/connection#R14: 연결 안내는 사용자 설정·workspace 권한을 얻지 않는다", () => {
  // OpenClaw workspace는 agent마다 다르고 lophn이 바꾸지 않는다(domain-model
  // 표). config_target이 없어 credential·scope로 설정을 고칠 통로도 없다.
  const openclaw = definitionOf("openclaw");
  assertEquals(openclaw.config_targets.length, 0);
  // pi app target은 사람 trust 결정 뒤에만 읽힌다(guides#R5).
  const pi = definitionOf("pi");
  assertEquals(pi.config_targets[1].scope_kind, "app");
});

Deno.test("coding-agent/mcp-server#R1: OpenClaw의 session 소유 stdio 미확인은 unverified·CLI fallback이다", () => {
  const openclaw = definitionOf("openclaw");
  // 세션별 stdio를 보장하지 못하면 CLI fallback으로 구별한다(R1 확인).
  assertEquals(openclaw.execution.capability, "unverified");
  assertEquals(openclaw.execution.session_evidence, "listing");
});

Deno.test("coding-agent/harnesses#R1: 세 제품의 정의는 모음 catalog에 있다", () => {
  for (const id of ["hermes", "pi", "openclaw"] as const) {
    assert(HARNESS_CATALOG.some((entry) => entry.harness_id === id), id);
  }
  assertEquals(HARNESS_CATALOG.length, 7);
});

Deno.test("coding-agent/harnesses#R6: 세 제품의 target plan은 같은 제품만 받는다", () => {
  const hermes = definitionOf("hermes");
  const accepted = assertPlan(planOf({
    definition: hermes,
    target: target("hermes"),
    connection: null,
    resources: [],
  }));
  assertEquals(accepted.target.harness_id, "hermes");
  // 다른 제품 target은 거절이다(R6).
  const other = planOf({
    definition: hermes,
    target: target("pi"),
    connection: null,
    resources: [],
  });
  assert(!other.ok);
  if (other.ok) return;
  assertEquals(other.error.code, "invalid_target");
});

Deno.test("coding-agent/harnesses#R8: Hermes YAML merge는 lophn 항목만 넣고 기존 server·env를 보존한다", async () => {
  const hermes = definitionOf("hermes");
  // 기존 server·env를 둔 fixture config.yaml이다(connection#R1 보존 모양).
  const existing =
    'mcp_servers:\n  other:\n    command: keep\nenv:\n  A: "1"\n';
  const port = memoryPort({ "/hermes-home/config.yaml": existing });
  const store = memoryStore();
  const planned = assertPlan(planOf({
    definition: hermes,
    target: target("hermes"),
    connection: null,
    resources: [
      {
        identity: "mcp",
        path: "config.yaml",
        kind: "config",
        owned_key: "mcp_servers.lophn",
        format: "yaml",
        content: JSON.stringify({
          command: "lophn",
          args: ["--connection", "cac_x"],
        }),
      } satisfies PlannedResource,
    ],
  }));
  const seen = assertSeen(await observe(port, "/hermes-home", planned));
  const applied = await install(
    port,
    store,
    "/hermes-home",
    planned,
    seen,
    "op-hermes-1",
    NOW,
  );
  assertEquals(applied.resources[0].outcome, "changed");
  const written = await port.read("/hermes-home/config.yaml");
  assert(written.kind === "file");
  if (written.kind !== "file") return;
  // 기존 server·env는 보존된다(R8, connection#R1).
  assertEquals(parseYaml(written.text).ok, true);
  const fragment = ownedFragment(written.text, "mcp_servers.other");
  assert(fragment.ok);
  if (!fragment.ok) return;
  assertEquals(fragment.value, { command: "keep" });
  const lophn = ownedFragment(written.text, "mcp_servers.lophn");
  assert(lophn.ok);
  if (!lophn.ok) return;
  assertEquals(lophn.value, {
    command: "lophn",
    args: ["--connection", "cac_x"],
  });
  const envValue = ownedFragment(written.text, "env.A");
  assert(envValue.ok);
  if (!envValue.ok) return;
  assertEquals(envValue.value, "1");
});

Deno.test("coding-agent/harnesses#R8: 깨진 Hermes YAML은 고치지 않고 무변경 이유로 남는다", async () => {
  const hermes = definitionOf("hermes");
  // Hermes는 깨진 YAML을 메모리에서 기본값으로 대체하므로(조사 R8) doctor가
  // 파싱 실패를 loading 실패 이유로 낸다. lophn은 broken을 고치지 않는다.
  const port = memoryPort({
    "/hermes-home/config.yaml": "mcp_servers:\n  lophn: {\n",
  });
  const store = memoryStore();
  const planned = assertPlan(planOf({
    definition: hermes,
    target: target("hermes"),
    connection: null,
    resources: [{
      identity: "mcp",
      path: "config.yaml",
      kind: "config",
      owned_key: "mcp_servers.lophn",
      format: "yaml",
      content: JSON.stringify({ command: "lophn" }),
    } as PlannedResource],
  }));
  const seen = assertSeen(await observe(port, "/hermes-home", planned));
  const applied = await install(
    port,
    store,
    "/hermes-home",
    planned,
    seen,
    "op-hermes-2",
    NOW,
  );
  assertEquals(applied.resources[0].outcome, "conflict");
  const after = await port.read("/hermes-home/config.yaml");
  assert(after.kind === "file");
  if (after.kind !== "file") return;
  assertEquals(after.text, "mcp_servers:\n  lophn: {\n");
});

Deno.test("coding-agent/guides#R5: OpenClaw managed root의 동명 skill은 receipt 없으면 덮지 않는다", async () => {
  const openclaw = definitionOf("openclaw");
  // `.openclaw/skills/lophn`에 사람이 만든 동명 resource가 있다(조사 tier
  // 순서에서 managed보다 personal이 이긴다).
  const port = memoryPort({
    "/home/.openclaw/skills/lophn/SKILL.md": "# mine\n",
  });
  const store = memoryStore();
  const planned = assertPlan(planOf({
    definition: openclaw,
    target: target("openclaw"),
    connection: null,
    resources: [{
      identity: "skill",
      path: ".openclaw/skills/lophn",
      kind: "skill",
      owned_key: null,
      format: "directory",
      content: [{ path: "SKILL.md", content: "# lophn\n" }],
    } as PlannedResource],
  }));
  const seen = assertSeen(await observe(port, "/home", planned));
  const applied = await install(
    port,
    store,
    "/home",
    planned,
    seen,
    "op-1",
    NOW,
  );
  assertEquals(applied.resources[0].outcome, "conflict");
  assertEquals(store.receipts.length, 0);
  const kept = await port.read("/home/.openclaw/skills/lophn/SKILL.md");
  assert(kept.kind === "file");
  assertEquals(kept.text, "# mine\n");
});

Deno.test("coding-agent/guides#R5: Hermes home root의 skill은 본문과 보조 자료를 함께 쓴다", async () => {
  const hermes = definitionOf("hermes");
  const port = memoryPort({});
  const store = memoryStore();
  const planned = assertPlan(planOf({
    definition: hermes,
    target: target("hermes"),
    connection: null,
    resources: [{
      identity: "skill",
      path: "skills/lophn",
      kind: "skill",
      owned_key: null,
      format: "directory",
      content: [
        { path: "SKILL.md", content: "# lophn\n" },
        { path: "notes.md", content: "helper\n" },
      ],
    } as PlannedResource],
  }));
  const seen = assertSeen(await observe(port, "/hermes-home", planned));
  const applied = await install(
    port,
    store,
    "/hermes-home",
    planned,
    seen,
    "op-1",
    NOW,
  );
  assertEquals(applied.resources[0].outcome, "changed");
  const body = await port.read("/hermes-home/skills/lophn/SKILL.md");
  const notes = await port.read("/hermes-home/skills/lophn/notes.md");
  assert(body.kind === "file" && body.text.startsWith("# lophn"));
  assert(notes.kind === "file" && notes.text === "helper\n");
});
