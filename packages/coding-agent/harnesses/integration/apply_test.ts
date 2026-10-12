// 설치 engine 테스트다(coding-agent/harnesses#R6–R9, R12, T29). fixture home은
// temp dir이고 사람의 실제 home은 읽지 않는다. home root는 engine에 주입한다.
import { assert, assertEquals } from "@std/assert";
import { sha256Hex } from "../../../base/mod.ts";
import type { IntegrationTarget } from "../../../protocol/coding-agent/mod.ts";
import { catalogOf } from "../catalog/definitions.ts";
import {
  type FilePort,
  install,
  observe,
  type ObservedHashes,
  type Store,
} from "./apply.ts";
import { recover, remove } from "./remove.ts";
import { filePort, storeOf } from "./journal.ts";
import {
  type InstallPlan,
  type PlannedResource,
  planOf,
  type PlanResult,
} from "./plan.ts";
import type { Journal, Receipt } from "./receipt.ts";

const NOW = "2026-10-05T00:00:00.000Z";

function target(harness: IntegrationTarget["harness_id"]): IntegrationTarget {
  return {
    scope_kind: "user",
    environment: { kind: "host", identity: "fixture" },
    profile_id: null,
    harness_id: harness,
    app: null,
    app_realpath: null,
  };
}

function resource(partial: Partial<PlannedResource>): PlannedResource {
  return {
    identity: "mcp",
    path: ".claude.json",
    kind: "config",
    owned_key: "mcpServers.lophn",
    format: "json",
    content: JSON.stringify({
      command: "lophn",
      args: ["--connection", "cac_x"],
    }),
    ...partial,
  };
}

function assertPlan(value: PlanResult): InstallPlan {
  assert(value.ok);
  if (!value.ok) throw new Error("unreachable");
  return value.value;
}

function assertSeen(value: ObservedHashes | "blocked"): ObservedHashes {
  if (typeof value === "string") throw new Error("unreachable");
  return value;
}

// 메모리 파일 눈이다. symlink는 따라가지 않고 표시만 한다(R7). 디렉터리는
// `dir/` 접두 파일로 본다.
function memoryPort(
  files: Record<string, string>,
  symlinks: string[] = [],
): FilePort {
  const tree = { ...files };
  const prefixOf = (dir: string) => (dir.endsWith("/") ? dir : `${dir}/`);
  return {
    read(path) {
      if (symlinks.includes(path)) return Promise.resolve({ kind: "symlink" });
      const text = tree[path];
      if (text !== undefined) return Promise.resolve({ kind: "file", text });
      const prefix = prefixOf(path);
      const hasChild = Object.keys(tree).some((key) => key.startsWith(prefix));
      return Promise.resolve(
        hasChild ? { kind: "directory" } : { kind: "absent" },
      );
    },
    listFiles(dir) {
      const hit = symlinks.find((link) =>
        link === dir || link.startsWith(prefixOf(dir))
      );
      if (hit !== undefined) {
        return Promise.resolve({
          kind: "symlink",
          path: hit.slice(dir.length + 1),
        });
      }
      const prefix = prefixOf(dir);
      const listed = Object.entries(tree)
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, text]) => ({ path: key.slice(prefix.length), text }));
      return Promise.resolve({ kind: "files", files: listed });
    },
    escapes(root, path) {
      const prefix = prefixOf(root);
      if (!path.startsWith(prefix)) return Promise.resolve(true);
      const relative = path.slice(prefix.length);
      if (relative.split("/").includes("..")) return Promise.resolve(true);
      // 부모 컴포넌트가 symlink면 root 밖으로 빠져나간다(R7).
      const parts = relative.split("/");
      let cursor = root;
      for (let index = 0; index < parts.length - 1; index++) {
        cursor = `${cursor}/${parts[index]}`;
        if (symlinks.includes(cursor)) return Promise.resolve(true);
      }
      return Promise.resolve(false);
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

function memoryStore(): Store & {
  receipts: Receipt[];
  journalEntries: Journal;
} {
  const receipts: Receipt[] = [];
  const journalEntries: Journal = { entries: [] };
  return {
    receipts,
    journalEntries,
    receipt() {
      return Promise.resolve(receipts.at(-1) ?? null);
    },
    saveReceipt(receipt) {
      receipts.push(receipt);
      return Promise.resolve(true);
    },
    journal() {
      return Promise.resolve(journalEntries);
    },
    saveJournal(journal) {
      journalEntries.entries = journal.entries;
      return Promise.resolve(true);
    },
  };
}

function claudePlan(resources: PlannedResource[]) {
  const claude = catalogOf("claude");
  assert(claude !== undefined);
  if (claude === undefined) throw new Error("unreachable");
  return planOf({
    definition: claude,
    target: target("claude"),
    connection: null,
    resources,
  });
}

Deno.test("coding-agent/harnesses#R6: plan은 고른 harness의 native target만 받는다", () => {
  const accepted = assertPlan(claudePlan([resource({})]));
  assertEquals(accepted.target.harness_id, "claude");
  // 감지된 다른 제품은 plan에 들어오지 않는다(R6 확인).
  const claude = catalogOf("claude");
  assert(claude !== undefined);
  if (claude === undefined) return;
  const other = planOf({
    definition: claude,
    target: target("codex"),
    connection: null,
    resources: [resource({})],
  });
  assert(!other.ok);
  if (other.ok) return;
  assertEquals(other.error.code, "invalid_target");
  // WSL·remote는 미지원이다(R4, R6).
  const remote = planOf({
    definition: claude,
    target: {
      ...target("claude"),
      environment: { kind: "remote", identity: "fixture" },
    },
    connection: null,
    resources: [resource({})],
  });
  assert(!remote.ok);
  if (remote.ok) return;
  assertEquals(remote.error.code, "unsupported");
});

Deno.test("coding-agent/harnesses#R6: root 밖 경로는 plan이 거절한다", () => {
  const claude = catalogOf("claude");
  assert(claude !== undefined);
  if (claude === undefined) return;
  for (const path of ["/etc/passwd", "../outside", "a/../../b"]) {
    const planned = planOf({
      definition: claude,
      target: target("claude"),
      connection: null,
      resources: [resource({ path })],
    });
    assert(!planned.ok, path);
  }
});

Deno.test("coding-agent/harnesses#R8: JSON merge는 lophn key만 바꾸고 나머지를 보존한다", async () => {
  const existing = JSON.stringify({
    mcpServers: { other: { command: "keep" } },
    permissions: { allow: ["Bash"] },
  });
  const port = memoryPort({ "/home/.claude.json": existing });
  const store = memoryStore();
  const planned = assertPlan(claudePlan([resource({})]));
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
  assertEquals(applied.resources[0].outcome, "changed");
  const written = await port.read("/home/.claude.json");
  assert(written.kind === "file");
  if (written.kind !== "file") return;
  const parsed = JSON.parse(written.text);
  // 기존 server·permission은 남는다(R8 확인).
  assertEquals(parsed.mcpServers.other.command, "keep");
  assertEquals(parsed.permissions.allow, ["Bash"]);
  assertEquals(parsed.mcpServers.lophn.command, "lophn");
});

Deno.test("coding-agent/harnesses#R8: 깨진 설정은 고치지 않는다", async () => {
  const port = memoryPort({ "/home/.claude.json": "{ broken" });
  const store = memoryStore();
  const planned = assertPlan(claudePlan([resource({})]));
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
  const after = await port.read("/home/.claude.json");
  assert(after.kind === "file");
  if (after.kind !== "file") return;
  assertEquals(after.text, "{ broken");
});

Deno.test("coding-agent/harnesses#R7: receipt 없는 동명 파일은 덮지 않는다", async () => {
  // lophn key가 이미 있는데 receipt가 없다. 사람이 만든 항목이다.
  const existing = JSON.stringify({
    mcpServers: { lophn: { command: "mine" } },
  });
  const port = memoryPort({ "/home/.claude.json": existing });
  const store = memoryStore();
  const planned = assertPlan(claudePlan([resource({})]));
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
});

Deno.test("coding-agent/harnesses#R7: 사람이 고친 소유 조각은 갱신·제거하지 않는다", async () => {
  const port = memoryPort({});
  const store = memoryStore();
  const planned = assertPlan(claudePlan([resource({})]));
  const seen = assertSeen(await observe(port, "/home", planned));
  await install(port, store, "/home", planned, seen, "op-1", NOW);
  // 사람이 lophn 조각을 고친다.
  const current = await port.read("/home/.claude.json");
  assert(current.kind === "file");
  if (current.kind !== "file") return;
  const edited = current.text.replace('"lophn"', '"lophn-edited"');
  await port.writeAtomic("/home/.claude.json", edited);
  const again = assertSeen(await observe(port, "/home", planned));
  const updated = await install(
    port,
    store,
    "/home",
    planned,
    again,
    "op-2",
    NOW,
  );
  assertEquals(updated.resources[0].outcome, "conflict");
  const after = await port.read("/home/.claude.json");
  assert(after.kind === "file");
  if (after.kind !== "file") return;
  assertEquals(after.text, edited);
});

Deno.test("coding-agent/harnesses#R7: 파일의 다른 부분이 바뀌어도 소유 조각이 같으면 갱신한다", async () => {
  const port = memoryPort({});
  const store = memoryStore();
  const planned = assertPlan(claudePlan([resource({})]));
  const seen = assertSeen(await observe(port, "/home", planned));
  await install(port, store, "/home", planned, seen, "op-1", NOW);
  // harness가 다른 key를 다시 쓴다(조사 9.7). lophn 조각은 그대로다.
  const current = await port.read("/home/.claude.json");
  assert(current.kind === "file");
  if (current.kind !== "file") return;
  const parsed = JSON.parse(current.text);
  parsed.theme = "moved";
  await port.writeAtomic("/home/.claude.json", JSON.stringify(parsed));
  const next = assertPlan(claudePlan([resource({
    content: JSON.stringify({
      command: "lophn",
      args: ["--connection", "cac_y"],
    }),
  })]));
  const again = assertSeen(await observe(port, "/home", next));
  const updated = await install(port, store, "/home", next, again, "op-2", NOW);
  assertEquals(updated.resources[0].outcome, "changed");
  const after = await port.read("/home/.claude.json");
  assert(after.kind === "file");
  if (after.kind !== "file") return;
  assertEquals(JSON.parse(after.text).theme, "moved");
});

Deno.test("coding-agent/harnesses#R7: symlink는 따라 쓰지 않고 conflict다", async () => {
  const port = memoryPort({}, ["/home/.claude.json"]);
  const planned = assertPlan(claudePlan([resource({})]));
  const seen = await observe(port, "/home", planned);
  assertEquals(seen, "blocked");
});

Deno.test("coding-agent/harnesses#R7: 제거는 receipt의 resource만 지운다", async () => {
  const port = memoryPort({});
  const store = memoryStore();
  const planned = assertPlan(claudePlan([resource({})]));
  const seen = assertSeen(await observe(port, "/home", planned));
  await install(port, store, "/home", planned, seen, "op-1", NOW);
  const removed = await remove(port, store, "/home", planned, "op-2", NOW);
  assertEquals(removed.resources[0].outcome, "changed");
  const after = await port.read("/home/.claude.json");
  assert(after.kind === "file");
  if (after.kind !== "file") return;
  // 소유 조각만 빠지고 파일은 남는다(R8 제거).
  assertEquals(JSON.parse(after.text).mcpServers.lophn, undefined);
});

Deno.test("coding-agent/harnesses#R9: receipt 저장 실패는 partial과 journal로 남고 다음 갱신을 거절한다", async () => {
  const port = memoryPort({});
  const store = memoryStore();
  store.saveReceipt = () => Promise.resolve(false);
  const planned = assertPlan(claudePlan([resource({})]));
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
  assertEquals(applied.receipt_stored, false);
  assertEquals(applied.recovery_pending, true);
  assertEquals(applied.resources[0].outcome, "changed");
  // 복구 전에는 다시 쓰지 않는다(R9).
  const again = assertSeen(await observe(port, "/home", planned));
  const blocked = await install(
    port,
    store,
    "/home",
    planned,
    again,
    "op-2",
    NOW,
  );
  assertEquals(blocked.resources[0].outcome, "skipped");
  assertEquals(blocked.recovery_pending, true);
});

Deno.test("coding-agent/harnesses#R9: 복구는 hash를 다시 확인하고 무조건 재설치하지 않는다", async () => {
  const port = memoryPort({});
  const failing = memoryStore();
  failing.saveReceipt = () => Promise.resolve(false);
  const planned = assertPlan(claudePlan([resource({})]));
  const seen = assertSeen(await observe(port, "/home", planned));
  await install(port, failing, "/home", planned, seen, "op-1", NOW);
  // journal의 hash와 receipt가 다르면 보존만 하고 재설치하지 않는다.
  const preserved = await recover(failing, null);
  assertEquals(preserved.recovered, false);
  assertEquals(preserved.preserved, true);
  assertEquals((await failing.journal()).entries.length, 1);
});

Deno.test("coding-agent/harnesses#R12: 설정에는 connection 참조만 있고 token 원문이 없다", async () => {
  const claude = catalogOf("claude");
  assert(claude !== undefined);
  if (claude === undefined) return;
  const port = memoryPort({});
  const store = memoryStore();
  const planned = assertPlan(planOf({
    definition: claude,
    target: target("claude"),
    connection: "cac_01arz3ndektsv4rrffq69g5fav",
    resources: [resource({
      content: JSON.stringify({
        command: "lophn",
        args: ["--connection", "cac_01arz3ndektsv4rrffq69g5fav"],
      }),
    })],
  }));
  const seen = assertSeen(await observe(port, "/home", planned));
  await install(port, store, "/home", planned, seen, "op-1", NOW);
  const written = await port.read("/home/.claude.json");
  assert(written.kind === "file");
  if (written.kind !== "file") return;
  // token처럼 보이는 긴 비밀 문자열이 없다. connection 참조만 있다.
  assert(!written.text.includes("sk-"));
  assert(written.text.includes("--connection"));
  const receipt = store.receipts[0];
  assertEquals(receipt.connection, "cac_01arz3ndektsv4rrffq69g5fav");
  assert(!JSON.stringify(receipt).includes("sk-"));
});

Deno.test("coding-agent/guides#R4: skill은 root 바로 아래 디렉터리에 본문과 보조 자료를 함께 쓴다", async () => {
  const planned = assertPlan(claudePlan([resource({
    identity: "skill",
    path: ".claude/skills/lophn",
    kind: "skill",
    owned_key: null,
    format: "directory",
    content: [
      { path: "SKILL.md", content: "# lophn\n" },
      { path: "notes.md", content: "helper\n" },
    ],
  })]));
  const port = memoryPort({});
  const store = memoryStore();
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
  assertEquals(applied.resources[0].outcome, "changed");
  const body = await port.read("/home/.claude/skills/lophn/SKILL.md");
  const notes = await port.read("/home/.claude/skills/lophn/notes.md");
  assert(body.kind === "file" && body.text.startsWith("# lophn"));
  assert(notes.kind === "file" && notes.text === "helper\n");
});

Deno.test("coding-agent/harnesses#R9: 실제 파일 눈은 temp·fsync·rename으로 쓰고 symlink를 conflict로 본다", async () => {
  const home = await Deno.makeTempDir({ prefix: "harness-install-" });
  try {
    const port = filePort();
    const store = storeOf(home);
    const planned = assertPlan(claudePlan([resource({ path: "config.json" })]));
    const seen = assertSeen(await observe(port, home, planned));
    const applied = await install(
      port,
      store,
      home,
      planned,
      seen,
      "op-1",
      NOW,
    );
    assertEquals(applied.receipt_stored, true);
    const text = await Deno.readTextFile(`${home}/config.json`);
    assert(text.includes("mcpServers"));
    // receipt가 home 안 integrations에 남는다.
    const saved = await store.receipt(target("claude"));
    assert(saved !== null);
    if (saved === null) return;
    assertEquals(saved.resources.length, 1);
    // 쓴 파일의 hash가 receipt와 같다(R7).
    assertEquals(saved.resources[0].last_written_hash, await sha256Hex(text));
    // symlink는 따라 쓰지 않는다.
    const link = `${home}/linked.json`;
    await Deno.symlink(`${home}/config.json`, link);
    const linked = await port.read(link);
    assertEquals(linked.kind, "symlink");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

function skillPlan() {
  return claudePlan([resource({
    identity: "skill",
    path: ".claude/skills/lophn",
    kind: "skill",
    owned_key: null,
    format: "directory",
    content: [
      { path: "SKILL.md", content: "# lophn\n" },
      { path: "notes.md", content: "helper\n" },
    ],
  })]);
}

Deno.test("coding-agent/guides#R4: 실제 파일 눈으로 skill 디렉터리를 재설치·갱신·제거한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "harness-skill-" });
  try {
    const port = filePort();
    const store = storeOf(home);
    const planned = assertPlan(skillPlan());
    const seen = assertSeen(await observe(port, home, planned));
    const applied = await install(
      port,
      store,
      home,
      planned,
      seen,
      "op-1",
      NOW,
    );
    assertEquals(applied.resources[0].outcome, "changed");
    const body = await Deno.readTextFile(
      `${home}/.claude/skills/lophn/SKILL.md`,
    );
    assertEquals(body, "# lophn\n");
    // 같은 내용으로 다시 설치하면 무변경이다. 디렉터리를 error로 보면 막힌다.
    const again = assertSeen(await observe(port, home, planned));
    const repeat = await install(
      port,
      store,
      home,
      planned,
      again,
      "op-2",
      NOW,
    );
    assertEquals(repeat.resources[0].outcome, "unchanged");
    // 사람이 보조 자료를 고치면 제거를 거절하고 파일을 남긴다(R7).
    await Deno.writeTextFile(
      `${home}/.claude/skills/lophn/notes.md`,
      "edited\n",
    );
    const kept = await remove(port, store, home, planned, "op-3", NOW);
    assertEquals(kept.resources[0].outcome, "conflict");
    const still = await Deno.readTextFile(
      `${home}/.claude/skills/lophn/SKILL.md`,
    );
    assertEquals(still, "# lophn\n");
    // 되돌리면 receipt digest와 같아 디렉터리 전체를 지운다.
    await Deno.writeTextFile(
      `${home}/.claude/skills/lophn/notes.md`,
      "helper\n",
    );
    const gone = await remove(port, store, home, planned, "op-4", NOW);
    assertEquals(gone.resources[0].outcome, "changed");
    const after = await port.read(`${home}/.claude/skills/lophn`);
    assertEquals(after.kind, "absent");
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("coding-agent/harnesses#R7: 부모 symlink로 root 밖을 가리키면 실제 파일 눈이 conflict로 거절한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "harness-escape-" });
  const outside = await Deno.makeTempDir({ prefix: "harness-outside-" });
  try {
    const port = filePort();
    const store = storeOf(home);
    // `root/.claude`가 root 밖을 가리킨다. 마지막 컴포넌트만 보면 놓친다.
    await Deno.symlink(outside, `${home}/.claude`);
    const planned = assertPlan(
      claudePlan([resource({ path: ".claude/config.json" })]),
    );
    const seen = await observe(port, home, planned);
    assertEquals(seen, "blocked");
    // 관찰을 건너뛴 채 바로 써도 교체 직전 검사에서 거절한다.
    const applied = await install(
      port,
      store,
      home,
      planned,
      new Map(),
      "op-1",
      NOW,
    );
    assertEquals(applied.resources[0].outcome, "conflict");
    // 밖에는 아무것도 쓰지 않았다.
    const leaked: string[] = [];
    for await (const entry of Deno.readDir(outside)) leaked.push(entry.name);
    assertEquals(leaked, []);
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("coding-agent/harnesses#R9: 쓰기는 기존 파일의 mode를 보존한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "harness-mode-" });
  try {
    const port = filePort();
    const store = storeOf(home);
    const path = `${home}/config.json`;
    await Deno.writeTextFile(path, "{}\n");
    await Deno.chmod(path, 0o644);
    const planned = assertPlan(claudePlan([resource({ path: "config.json" })]));
    const seen = assertSeen(await observe(port, home, planned));
    const applied = await install(
      port,
      store,
      home,
      planned,
      seen,
      "op-1",
      NOW,
    );
    assertEquals(applied.resources[0].outcome, "changed");
    const mode = (await Deno.lstat(path)).mode;
    assert(mode !== null);
    if (mode === null) return;
    assertEquals(mode & 0o777, 0o644);
    // 실행 권한도 남는다. temp 파일 기본 0600으로 덮으면 사라진다.
    await Deno.chmod(path, 0o755);
    const again = assertSeen(await observe(port, home, planned));
    const planned2 = assertPlan(claudePlan([resource({
      path: "config.json",
      content: JSON.stringify({
        command: "lophn",
        args: ["--connection", "cac_y"],
      }),
    })]));
    const updated = await install(
      port,
      store,
      home,
      planned2,
      again,
      "op-2",
      NOW,
    );
    assertEquals(updated.resources[0].outcome, "changed");
    const kept = (await Deno.lstat(path)).mode;
    assert(kept !== null);
    if (kept === null) return;
    assertEquals(kept & 0o777, 0o755);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
