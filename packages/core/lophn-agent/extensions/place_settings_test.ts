import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import type { Result } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import {
  APP,
  GLOBAL_SERVER_NAME,
  MISSING_PRJ,
  OTHER_PRJ,
  PRJ,
} from "./place_registration_test.ts";

// ChangePlaceExtensionSettings·ReadPlaceExtensionSettings. 실제 writer·reader(harness)와 실제 임시 폴더를 쓴다.

const OPERATIONS = [
  "ChangePlaceExtensionSettings",
  "ReadPlaceExtensionSettings",
  "CommandResult",
];

const userCred: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const machineCred: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

type Place = { kind: "project" | "app"; id: string };
const PROJECT: Place = { kind: "project", id: PRJ };
const OTHER: Place = { kind: "project", id: OTHER_PRJ };
const APP_PLACE: Place = { kind: "app", id: APP };

type Harness = { h: LedgerHarness; root: string };

async function withExtensions(run: (ctx: Harness) => Promise<void>) {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("./place_registration_test.ts", import.meta.url),
    ],
    credentials: [userCred, machineCred],
    nowMs: Date.UTC(2026, 0, 1),
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  const h = opened.value;
  try {
    const rows = value(
      await h.inspect(
        "select file from pragma_database_list where name = 'main'",
        [],
      ),
    );
    const file = String(rows[0]!["file"]);
    await run({ h, root: file.slice(0, file.lastIndexOf("/")) });
  } finally {
    await h.close();
  }
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function failure(result: Result<unknown>, code: string) {
  assert(
    !result.ok,
    result.ok ? "expected failure, got " + JSON.stringify(result.value) : "",
  );
  assertEquals(result.error.code, code);
  return result.error;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

let keys = 0;

function change(
  ctx: Harness,
  place: Place,
  mcp_servers: unknown[],
  hash: string | null,
  as = userCred,
) {
  keys++;
  return ctx.h.command(as, {
    command: "ChangePlaceExtensionSettings",
    input: { place, mcp_servers },
    compare: { hash },
    idempotency_key: `place-extension-${keys}`,
    prepared: [] as string[],
  });
}

function read(ctx: Harness, place: Place, as = userCred) {
  return ctx.h.read(
    { resource: "place-extension-settings", method: "read" },
    as,
    { place },
  );
}

type Server = {
  name: string;
  revision: number;
  enabled: boolean;
  call_timeout_ms: number;
  [key: string]: unknown;
};

function stdioServer(name: string, over: Record<string, unknown> = {}) {
  return {
    name,
    revision: 1,
    enabled: true,
    transport: "stdio",
    call_timeout_ms: 60_000,
    classifications: {},
    stdio: { executable: `/usr/bin/${name}`, args: [], cwd: null, env: {} },
    ...over,
  };
}

type Read = {
  place: Place;
  settings: { revision: number; mcp_servers: Server[] };
  hash: string | null;
  skills: { name: string; description: string; source_kind: string }[];
  shadowed: { name: string; kept: string; hidden: string }[];
  skipped: { path: string; reason: string }[];
};

async function readValue(ctx: Harness, place: Place): Promise<Read> {
  return value(await read(ctx, place)) as unknown as Read;
}

function placeFolder(ctx: Harness, place: Place): string {
  return `${ctx.root}/${
    place.kind === "project" ? "projects" : "apps"
  }/${place.id}`;
}

function writeSkill(
  folder: string,
  name: string,
  description: string,
  bundle = name,
) {
  Deno.mkdirSync(`${folder}/${bundle}`, { recursive: true });
  Deno.writeTextFileSync(
    `${folder}/${bundle}/SKILL.md`,
    `---\nname: ${name}\ndescription: ${description}\n---\n본문\n`,
  );
}

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (path: string) => {
    let entries: Deno.DirEntry[];
    try {
      entries = [...Deno.readDirSync(path)];
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = `${path}/${entry.name}`;
      if (entry.isDirectory) walk(full);
      else found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

async function eventsOf(h: LedgerHarness) {
  const rows = value(
    await h.inspect(
      "select subject, actor, payload from events where type = 'PlaceExtensionSettingsChanged' order by seq",
      [],
    ),
  );
  return rows.map((row) => ({
    subject: row["subject"] as string | null,
    actor: String(row["actor"]),
    payload: JSON.parse(String(row["payload"])) as Record<string, unknown>,
  }));
}

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: a place without a file has no servers and a null hash", async () => {
  await withExtensions(async (ctx) => {
    const empty = await readValue(ctx, PROJECT);
    assertEquals(empty.place, PROJECT);
    assertEquals(empty.settings, { revision: 1, mcp_servers: [] });
    assertEquals(empty.hash, null);
    assertEquals(empty.skills, []);
  });
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: the servers of a place live in a file of that place's folder, apart from the agents folder", async () => {
  await withExtensions(async (ctx) => {
    const saved = value(
      await change(ctx, PROJECT, [stdioServer("notes")], null),
    );
    const files = filesUnder(placeFolder(ctx, PROJECT));
    assertEquals(files.length, 1);
    assert(!files[0].includes("/agents/"));
    assert(!files[0].endsWith("settings.md"));
    const text = Deno.readTextFileSync(files[0]);
    assertEquals(
      (saved.result as { hash: string }).hash,
      sha256(text),
    );

    const after = await readValue(ctx, PROJECT);
    assertEquals(after.hash, sha256(text));
    assertEquals(after.settings.mcp_servers.map((server) => server.name), [
      "notes",
    ]);
    assertEquals(after.settings.revision, 1);

    // 두 번째 변경은 revision을 올린다.
    const second = value(
      await change(
        ctx,
        PROJECT,
        [stdioServer("notes"), stdioServer("calendar")],
        sha256(text),
      ),
    );
    assert((second.result as { hash: string }).hash !== sha256(text));
    assertEquals((await readValue(ctx, PROJECT)).settings.revision, 2);
  });
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: a server of one place is not seen by another project, and an app has its own folder", async () => {
  await withExtensions(async (ctx) => {
    value(await change(ctx, PROJECT, [stdioServer("notes")], null));
    value(await change(ctx, APP_PLACE, [stdioServer("viewer")], null));
    assertEquals(
      (await readValue(ctx, OTHER)).settings.mcp_servers,
      [],
    );
    assertEquals(
      (await readValue(ctx, APP_PLACE)).settings.mcp_servers.map((s) => s.name),
      ["viewer"],
    );
    assertEquals(
      (await readValue(ctx, PROJECT)).settings.mcp_servers.map((s) => s.name),
      ["notes"],
    );
    assertEquals(filesUnder(placeFolder(ctx, OTHER)), []);
    assertEquals(filesUnder(placeFolder(ctx, APP_PLACE)).length, 1);
  });
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: adding a server whose name a global server has is refused and nothing is written", async () => {
  await withExtensions(async (ctx) => {
    const refused = await change(
      ctx,
      PROJECT,
      [stdioServer("notes"), stdioServer(GLOBAL_SERVER_NAME)],
      null,
    );
    const error = failure(refused, "invalid_input");
    assert(error.message.includes(GLOBAL_SERVER_NAME));
    assertEquals(filesUnder(placeFolder(ctx, PROJECT)), []);
    assertEquals((await readValue(ctx, PROJECT)).settings.mcp_servers, []);
    assertEquals(await eventsOf(ctx.h), []);
  });
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: the same server name twice in one place is refused", async () => {
  await withExtensions(async (ctx) => {
    failure(
      await change(
        ctx,
        PROJECT,
        [stdioServer("notes"), stdioServer("notes", { revision: 2 })],
        null,
      ),
      "invalid_input",
    );
    assertEquals(filesUnder(placeFolder(ctx, PROJECT)), []);
  });
});

Deno.test("lophn-agent/extensions#R12 [agent-I19b]: a server with conflicting settings is refused, and the others are not saved either", async () => {
  await withExtensions(async (ctx) => {
    const conflicting = {
      name: "remote",
      revision: 1,
      enabled: true,
      transport: "http",
      call_timeout_ms: 60_000,
      classifications: {},
      http: {
        url: "https://mcp.example.test/rpc",
        headers: { "x-api-key": { kind: "value", value: "raw" } },
        auth: {
          kind: "api_key",
          secret_ref: "sec:remote.key",
          header_name: "X-Api-Key",
        },
      },
    };
    const error = failure(
      await change(ctx, PROJECT, [stdioServer("notes"), conflicting], null),
      "invalid_input",
    );
    assert(error.message.includes("remote"));
    assertEquals(filesUnder(placeFolder(ctx, PROJECT)), []);
  });
});

Deno.test("lophn-agent/extensions#R11 [agent-I19b]: a server's revision rises only when its settings change", async () => {
  await withExtensions(async (ctx) => {
    const first = value(
      await change(
        ctx,
        PROJECT,
        [stdioServer("notes"), stdioServer("calendar")],
        null,
      ),
    );
    const second = value(
      await change(
        ctx,
        PROJECT,
        [
          stdioServer("notes"),
          stdioServer("calendar", { enabled: false }),
          stdioServer("mail"),
        ],
        (first.result as { hash: string }).hash,
      ),
    );
    const servers = (await readValue(ctx, PROJECT)).settings.mcp_servers;
    assertEquals(
      servers.map((server) => [server.name, server.revision, server.enabled]),
      [["notes", 1, true], ["calendar", 2, false], ["mail", 1, true]],
    );
    assertEquals(
      (second.result as { hash: string }).hash,
      (await readValue(ctx, PROJECT)).hash,
    );
  });
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: a stale or wrong file hash is a conflict and nothing changes", async () => {
  await withExtensions(async (ctx) => {
    const first = value(
      await change(ctx, PROJECT, [stdioServer("notes")], null),
    ) as { result: { hash: string } };
    const before = await readValue(ctx, PROJECT);
    // 파일이 있는데 없다고 보낸 저장과 옛 hash의 저장은 같은 conflict다.
    failure(
      await change(ctx, PROJECT, [stdioServer("mail")], null),
      "conflict",
    );
    failure(
      await change(ctx, PROJECT, [stdioServer("mail")], "0".repeat(64)),
      "conflict",
    );
    assertEquals(await readValue(ctx, PROJECT), before);
    assertEquals(before.hash, first.result.hash);
    assertEquals((await eventsOf(ctx.h)).length, 1);
    // 없는 파일에 hash를 보내도 conflict다.
    failure(
      await change(ctx, OTHER, [stdioServer("mail")], "0".repeat(64)),
      "conflict",
    );
  });
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: an unknown place is not found, for a read and for a change", async () => {
  await withExtensions(async (ctx) => {
    const missing: Place = { kind: "project", id: MISSING_PRJ };
    failure(await change(ctx, missing, [], null), "not_found");
    failure(await read(ctx, missing), "not_found");
    // 같은 id를 앱으로 읽어도 그 앱은 없다.
    failure(
      await read(ctx, { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fzz" }),
      "not_found",
    );
  });
});

Deno.test("lophn-agent/extensions#R11 [agent-I19b]: only a person changes the servers and a run preparation reads them", async () => {
  await withExtensions(async (ctx) => {
    failure(
      await change(ctx, PROJECT, [stdioServer("notes")], null, machineCred),
      "forbidden",
    );
    assertEquals(filesUnder(placeFolder(ctx, PROJECT)), []);
    value(await change(ctx, PROJECT, [stdioServer("notes")], null));
    const seen = value(
      await read(ctx, PROJECT, machineCred),
    ) as unknown as Read;
    assertEquals(seen.settings.mcp_servers.map((server) => server.name), [
      "notes",
    ]);
  });
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: a change records the place, the actor and the file hashes before and after, never the servers", async () => {
  await withExtensions(async (ctx) => {
    const first = value(
      await change(ctx, PROJECT, [stdioServer("notes")], null),
    ) as { result: { hash: string } };
    const second = value(
      await change(
        ctx,
        PROJECT,
        [stdioServer("notes"), stdioServer("calendar")],
        first.result.hash,
      ),
    ) as { result: { hash: string } };
    const events = await eventsOf(ctx.h);
    assertEquals(events.length, 2);
    assertEquals(events[0].subject, PRJ);
    assert(events[0].actor.startsWith("user"));
    assertEquals(events[0].payload, {
      place: PROJECT,
      before_hash: null,
      after_hash: first.result.hash,
    });
    assertEquals(events[1].payload, {
      place: PROJECT,
      before_hash: first.result.hash,
      after_hash: second.result.hash,
    });
    assert(!JSON.stringify(events).includes("/usr/bin"));
  });
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: a place sees its own skills and the global ones, and the other project sees only the global ones", async () => {
  await withExtensions(async (ctx) => {
    writeSkill(
      `${placeFolder(ctx, PROJECT)}/skills`,
      "phroner-style",
      "Only for this project",
    );
    writeSkill(`${ctx.root}/registered`, "audit", "Registered audit");
    writeSkill(`${ctx.root}/skills`, "notes", "Personal notes");
    writeSkill(`${ctx.root}/bundled`, "basics", "Bundled basics");

    const mine = await readValue(ctx, PROJECT);
    assertEquals(
      mine.skills.map((skill) => [skill.name, skill.source_kind]),
      [
        ["phroner-style", "place"],
        ["audit", "registered"],
        ["notes", "personal"],
        ["basics", "bundled"],
      ],
    );
    const other = await readValue(ctx, OTHER);
    assertEquals(
      other.skills.map((skill) => skill.name),
      ["audit", "notes", "basics"],
    );
    // 앱 자리도 project의 skill 폴더를 보지 않는다.
    assertEquals(
      (await readValue(ctx, APP_PLACE)).skills.map((skill) => skill.name),
      ["audit", "notes", "basics"],
    );
  });
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: a place skill hides the global one of the same name and the read says so", async () => {
  await withExtensions(async (ctx) => {
    writeSkill(
      `${placeFolder(ctx, PROJECT)}/skills`,
      "review",
      "Project review",
    );
    writeSkill(`${ctx.root}/registered`, "review", "Registered review");
    writeSkill(`${ctx.root}/bundled`, "review", "Bundled review");

    const mine = await readValue(ctx, PROJECT);
    assertEquals(mine.skills, [
      {
        name: "review",
        description: "Project review",
        source_kind: "place",
      },
    ]);
    assertEquals(mine.shadowed, [
      { name: "review", kept: "place", hidden: "registered" },
      { name: "review", kept: "place", hidden: "bundled" },
    ]);
    // 다른 project에서는 가려진 것이 없다.
    const other = await readValue(ctx, OTHER);
    assertEquals(other.skills[0].description, "Registered review");
    assertEquals(other.shadowed, [
      { name: "review", kept: "registered", hidden: "bundled" },
    ]);
  });
});

Deno.test("lophn-agent/extensions#R2 [agent-I19b]: a place skill with a wrong name is left out and reported with the reason, never renamed", async () => {
  await withExtensions(async (ctx) => {
    const folder = `${placeFolder(ctx, PROJECT)}/skills`;
    // 사람이 등록한 폴더가 없으면 그것도 알리므로, 이 시험은 등록 폴더를 만들어 둔다.
    Deno.mkdirSync(`${ctx.root}/registered`, { recursive: true });
    writeSkill(folder, "good-one", "Fine");
    writeSkill(folder, "Bad_Name", "Wrong name", "bad-folder");
    Deno.mkdirSync(`${folder}/good-one/nested`, { recursive: true });
    Deno.writeTextFileSync(
      `${folder}/good-one/nested/SKILL.md`,
      "---\nname: nested-one\ndescription: Nested\n---\n본문\n",
    );
    const seen = await readValue(ctx, PROJECT);
    assertEquals(seen.skills.map((skill) => skill.name), ["good-one"]);
    assertEquals(seen.skipped.length, 1);
    assert(seen.skipped[0].path.endsWith("/skills/bad-folder/SKILL.md"));
    assert(seen.skipped[0].reason.length > 0);
  });
});
