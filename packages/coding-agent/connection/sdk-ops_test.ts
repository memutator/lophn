// SDK 공통 흐름 테스트다(T22, mcp#R22·R23, cli#R30). core 대신 route별 답을 정한 흐름
// client와 메모리 source port를 쓴다. MCP와 CLI가 같은 흐름이므로 두 surface의 data가 같은지도 본다.
import { assert, assertEquals } from "@std/assert";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import type { Package } from "../../protocol/apps/mod.ts";
import { fail, scriptedFlow } from "./testing/mod.ts";
import {
  compareSemver,
  isRangeVersion,
  planImportMap,
  runSdkOp,
  type SdkOpOutput,
  type SdkSourcePort,
} from "./sdk-ops.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const SOURCE = "/work/notes";
const CONFIG = `${SOURCE}/deno.json`;

const PACKAGES: Package[] = [
  {
    id: "pkg_01arz3ndektsv4rrffq69g5fav",
    name: "@lophn/ui-table",
    description: "정렬과 선택이 되는 표 component",
    kind: "component",
    versions: [
      {
        version: "1.2.0",
        bundle_hash: "a".repeat(64),
        guide_hash: "b".repeat(64),
      },
      {
        version: "1.10.0",
        bundle_hash: "c".repeat(64),
        guide_hash: "d".repeat(64),
      },
      {
        version: "1.10.0-rc.1",
        bundle_hash: "e".repeat(64),
        guide_hash: "f".repeat(64),
      },
    ],
  },
  {
    id: "pkg_01arz3ndektsv4rrffq69g5faw",
    name: "@lophn/cap-schedule",
    description: "정해진 시각에 command를 부르는 capability",
    kind: "capability",
    versions: [
      {
        version: "2.0.0",
        bundle_hash: "1".repeat(64),
        guide_hash: "2".repeat(64),
      },
    ],
  },
  {
    id: "pkg_01arz3ndektsv4rrffq69g5fax",
    name: "@me/ledger-view",
    description: "개인 장부 화면",
    kind: "component",
    versions: [
      {
        version: "0.1.0",
        bundle_hash: "3".repeat(64),
        guide_hash: "4".repeat(64),
      },
    ],
  },
];

function find(name: unknown) {
  return PACKAGES.find((pkg) => pkg.name === name);
}

function flow(sourcePath: string | null = SOURCE) {
  return scriptedFlow({
    "packages.list": (input) => {
      const name = (input as { name?: string }).name;
      return {
        packages: name === undefined
          ? PACKAGES
          : PACKAGES.filter((p) => p.name === name),
        as_of_seq: 1,
        next_cursor: null,
      };
    },
    "packages.versions": (input) => {
      const pkg = find((input as { name: string }).name);
      return pkg === undefined ? fail("not_found", "없는 package다") : {
        name: pkg.name,
        versions: pkg.versions,
        as_of_seq: 1,
        next_cursor: null,
      };
    },
    "packages.guide": (input) => {
      const { name, version } = input as { name: string; version: string };
      const found = find(name)?.versions.find((v) => v.version === version);
      return found === undefined ? fail("not_found", "없는 version이다") : {
        name,
        version,
        guide_hash: found.guide_hash,
        as_of_seq: 1,
        next_cursor: null,
      };
    },
    "packages.guide_body": (input) => {
      const { name, version } = input as { name: string; version: string };
      const text = GUIDES[`${name}@${version}`];
      if (text === undefined) return fail("not_found", "blob 참조가 없다");
      const bytes = new TextEncoder().encode(text);
      return {
        status: "available",
        hash: "b".repeat(64),
        size_bytes: bytes.length,
        offset_bytes: 0,
        length_bytes: bytes.length,
        truncated: false,
        bytes: btoa(String.fromCharCode(...bytes)),
      };
    },
    "app.get": {
      app: { id: APP, slug: "notes", source_path: sourcePath, revision: "1" },
    },
  });
}

// 안내 원문(owner key는 `<name>@<version>`)이다. 1.10.0 안내만 일부러 없다.
const GUIDES: Record<string, string> = {
  "@lophn/ui-table@1.2.0":
    "# @lophn/ui-table 1.2.0\n\n## API\n표 component의 공개 API다.\n",
};

function memorySource(files: Record<string, string>) {
  const writes: string[] = [];
  const locks: string[] = [];
  const port: SdkSourcePort = {
    readText: (path) => Promise.resolve(ok(files[path])),
    writeText: (path, text) => {
      files[path] = text;
      writes.push(path);
      return Promise.resolve(ok(undefined));
    },
    refreshLock: (dir): Promise<Result<void, LophnError>> => {
      locks.push(dir);
      return Promise.resolve(ok(undefined));
    },
  };
  return { port, files, writes, locks };
}

function data(result: SdkOpOutput) {
  return result.data as Record<string, unknown>;
}

function config(imports: Record<string, string>) {
  return `${
    JSON.stringify({ tasks: { dev: "deno run main.ts" }, imports }, null, 2)
  }\n`;
}

Deno.test("coding-agent/mcp-server#R22: catalog는 이름·최신 version·종류·한 줄 설명을 내고 개인 SDK를 지원 범위 밖으로 표시한다", async () => {
  const result = await runSdkOp({ op: "catalog" }, { client: flow().client });
  assertEquals(result.isError, undefined);
  const packages = data(result).packages as Record<string, unknown>[];
  assertEquals(packages[0], {
    name: "@lophn/ui-table",
    // 문자열 순서가 아니라 SemVer 순서의 최신이고 prerelease보다 정식이 앞이다.
    latest_version: "1.10.0",
    kind: "component",
    description: "정렬과 선택이 되는 표 component",
    support: "supported",
  });
  assertEquals(packages[2].support, "personal_unsupported");
});

Deno.test("coding-agent/mcp-server#R22: catalog는 설명과 API 이름으로 검색하고 검색어는 소유 route로 보내지 않는다", async () => {
  const scripted = flow();
  const byDescription = await runSdkOp(
    { op: "catalog", query: "시각에 COMMAND" },
    { client: scripted.client },
  );
  assertEquals(
    (data(byDescription).packages as { name: string }[]).map((p) => p.name),
    ["@lophn/cap-schedule"],
  );
  const byName = await runSdkOp(
    { op: "catalog", query: "ui-table" },
    { client: scripted.client },
  );
  assertEquals(
    (data(byName).packages as { name: string }[]).map((p) => p.name),
    ["@lophn/ui-table"],
  );
  for (const call of scripted.calls("packages.list")) {
    assertEquals("query" in (call.input as object), false);
  }
});

Deno.test("coding-agent/mcp-server#R22: 이름으로 찾지 못하면 비설치와 개인 SDK를 구별한다", async () => {
  const missing = await runSdkOp(
    { op: "catalog", name: "@lophn/cap-notify" },
    { client: flow().client },
  );
  assertEquals(
    (data(missing).lookup as { status: string }).status,
    "not_installed",
  );
  const personal = await runSdkOp(
    { op: "catalog", name: "@me/other" },
    { client: flow().client },
  );
  assertEquals(
    (data(personal).lookup as { status: string }).status,
    "personal_unsupported",
  );
  const show = await runSdkOp(
    { op: "show", name: "@lophn/cap-notify" },
    { client: flow().client },
  );
  assertEquals(show.isError, true);
  assertEquals(
    (data(show).details as { status: string }).status,
    "not_installed",
  );
});

Deno.test("coding-agent/mcp-server#R22 coding-agent/cli#R30: show는 등록한 안내 blob의 원문을 body로 내고 읽지 못하면 body는 null이고 이유를 낸다", async () => {
  const picked = await runSdkOp(
    { op: "show", name: "@lophn/ui-table", version: "1.2.0" },
    { client: flow().client },
  );
  const guide = data(picked).guide as Record<string, unknown>;
  assertEquals(guide.body, GUIDES["@lophn/ui-table@1.2.0"]);
  assertEquals(guide.body_truncated, false);
  assertEquals(guide.body_unavailable, undefined);
  // 안내 blob이 없는 version은 원문을 만들어 내지 않는다.
  const missing = await runSdkOp(
    { op: "show", name: "@lophn/ui-table" },
    { client: flow().client },
  );
  const bare = data(missing).guide as Record<string, unknown>;
  assertEquals(bare.body, null);
  assert(typeof bare.body_unavailable === "string");
  assertEquals(bare.guide_hash, "d".repeat(64));
});

Deno.test("coding-agent/mcp-server#R22: show는 version 목록과 고른 version의 안내 hash를 낸다", async () => {
  const latest = await runSdkOp(
    { op: "show", name: "@lophn/ui-table" },
    { client: flow().client },
  );
  assertEquals(latest.isError, undefined);
  assertEquals(data(latest).versions, ["1.10.0", "1.10.0-rc.1", "1.2.0"]);
  assertEquals(data(latest).version, "1.10.0");
  assertEquals(
    (data(latest).guide as { guide_hash: string }).guide_hash,
    "d".repeat(64),
  );
  const picked = await runSdkOp(
    { op: "show", name: "@lophn/ui-table", version: "1.2.0" },
    { client: flow().client },
  );
  assertEquals(
    (data(picked).guide as { guide_hash: string }).guide_hash,
    "b".repeat(64),
  );
  const absent = await runSdkOp(
    { op: "show", name: "@lophn/ui-table", version: "9.9.9" },
    { client: flow().client },
  );
  assertEquals(
    (data(absent).details as { status: string }).status,
    "version_not_installed",
  );
});

Deno.test("coding-agent/mcp-server#R23: add는 범위·별칭 version을 core 호출 전에 거절한다", async () => {
  for (
    const version of [
      "^1.2.0",
      "~1.2.0",
      "latest",
      "next",
      "1.x",
      "*",
      ">=1.0.0",
      "1.2.0 || 1.3.0",
    ]
  ) {
    const scripted = flow();
    const result = await runSdkOp(
      { op: "add", name: "@lophn/ui-table", version },
      { client: scripted.client },
    );
    assertEquals(result.isError, true, version);
    assertEquals(data(result).code, "invalid_input", version);
    assertEquals(scripted.sent.length, 0, version);
  }
  assertEquals(isRangeVersion("1.0.0-rc.x.1"), false);
});

Deno.test("coding-agent/mcp-server#R23: add는 미설치 version·비설치 package·개인 SDK를 거절한다", async () => {
  const version = await runSdkOp(
    { op: "add", name: "@lophn/ui-table", version: "1.3.0" },
    { client: flow().client },
  );
  assertEquals(
    (data(version).details as { status: string }).status,
    "version_not_installed",
  );
  assertEquals(
    (data(version).details as { installed: string[] }).installed,
    ["1.10.0", "1.10.0-rc.1", "1.2.0"],
  );
  const pkg = await runSdkOp(
    { op: "add", name: "@lophn/cap-notify", version: "1.0.0" },
    { client: flow().client },
  );
  assertEquals(
    (data(pkg).details as { status: string }).status,
    "not_installed",
  );
  const personal = await runSdkOp(
    { op: "add", name: "@me/ledger-view", version: "0.1.0" },
    { client: flow().client },
  );
  assertEquals(
    (data(personal).details as { status: string }).status,
    "personal_unsupported",
  );
});

Deno.test("coding-agent/mcp-server#R23: apply 없는 add는 고정 import 안내만 내고 source를 읽지도 쓰지도 않는다", async () => {
  const scripted = flow();
  const source = memorySource({ [CONFIG]: config({}) });
  const result = await runSdkOp(
    { op: "add", name: "@lophn/ui-table", version: "1.2.0", app: APP },
    { client: scripted.client, source: source.port },
  );
  assertEquals(result.isError, undefined);
  assertEquals(data(result).import_key, "lophn-sdk:@lophn/ui-table@1.2.0");
  assertEquals(data(result).import_value, "./sdk/@lophn/ui-table/1.2.0/");
  assertEquals(data(result).apply, null);
  assertEquals(scripted.calls("app.get").length, 0);
  assertEquals(source.writes, []);
});

Deno.test("coding-agent/mcp-server#R23: apply는 changed 뒤 같은 add가 unchanged이고 항목이 하나다", async () => {
  const source = memorySource({
    [CONFIG]: config({ "@std/assert": "jsr:@std/assert@1" }),
  });
  const deps = { client: flow().client, source: source.port };
  const input = {
    op: "add",
    name: "@lophn/ui-table",
    version: "1.2.0",
    apply: true,
    app: APP,
  };
  const first = await runSdkOp(input, deps);
  assertEquals((data(first).apply as { outcome: string }).outcome, "changed");
  assertEquals((data(first).apply as { lock: string }).lock, "refreshed");
  assertEquals(source.locks, [SOURCE]);
  const second = await runSdkOp(input, deps);
  assertEquals(
    (data(second).apply as { outcome: string }).outcome,
    "unchanged",
  );
  assertEquals(source.writes.length, 1);
  assertEquals(source.locks.length, 1);
  const written = JSON.parse(source.files[CONFIG]);
  assertEquals(written.imports, {
    "@std/assert": "jsr:@std/assert@1",
    "lophn-sdk:@lophn/ui-table@1.2.0": "./sdk/@lophn/ui-table/1.2.0/",
  });
  // 사람이 둔 다른 설정은 보존한다.
  assertEquals(written.tasks, { dev: "deno run main.ts" });
});

Deno.test("coding-agent/mcp-server#R23: 다른 version이 있으면 conflict로 멈추고 조용히 upgrade하지 않는다", async () => {
  const before = config({
    "lophn-sdk:@lophn/ui-table@1.2.0": "./sdk/@lophn/ui-table/1.2.0/",
  });
  const source = memorySource({ [CONFIG]: before });
  const result = await runSdkOp(
    {
      op: "add",
      name: "@lophn/ui-table",
      version: "1.10.0",
      apply: true,
      app: APP,
    },
    { client: flow().client, source: source.port },
  );
  assertEquals(result.isError, undefined);
  const apply = data(result).apply as Record<string, unknown>;
  assertEquals(apply.outcome, "conflict");
  assertEquals(apply.reason, "other_version");
  assertEquals(apply.existing, {
    "lophn-sdk:@lophn/ui-table@1.2.0": "./sdk/@lophn/ui-table/1.2.0/",
  });
  assertEquals(source.files[CONFIG], before);
  assertEquals(source.writes, []);
  assertEquals(source.locks, []);
});

Deno.test("coding-agent/mcp-server#R23: 같은 이름의 다른 대상·깨진 deno.json·없는 deno.json도 conflict다", () => {
  assertEquals(
    planImportMap(
      config({ "@lophn/ui-table": "npm:ui-table@1" }),
      "@lophn/ui-table",
      "1.2.0",
    )
      .outcome,
    "conflict",
  );
  const broken = planImportMap("{ imports: ", "@lophn/ui-table", "1.2.0");
  assertEquals(
    broken.outcome === "conflict" && broken.reason,
    "invalid_config",
  );
  const missing = planImportMap(undefined, "@lophn/ui-table", "1.2.0");
  assertEquals(
    missing.outcome === "conflict" && missing.reason,
    "missing_config",
  );
  // 다른 SDK 항목은 충돌이 아니다.
  assertEquals(
    planImportMap(
      config({
        "lophn-sdk:@lophn/ui-tables@1.0.0": "./sdk/@lophn/ui-tables/1.0.0/",
      }),
      "@lophn/ui-table",
      "1.2.0",
    ).outcome,
    "changed",
  );
});

Deno.test("coding-agent/mcp-server#R23: apply는 앱·source port·연결 source가 없으면 쓰지 않고 거절한다", async () => {
  const noApp = await runSdkOp(
    { op: "add", name: "@lophn/ui-table", version: "1.2.0", apply: true },
    { client: flow().client, source: memorySource({}).port },
  );
  assertEquals(data(noApp).code, "invalid_input");
  const noPort = await runSdkOp(
    {
      op: "add",
      name: "@lophn/ui-table",
      version: "1.2.0",
      apply: true,
      app: APP,
    },
    { client: flow().client },
  );
  assertEquals(data(noPort).code, "unavailable");
  const noSource = await runSdkOp(
    {
      op: "add",
      name: "@lophn/ui-table",
      version: "1.2.0",
      apply: true,
      app: APP,
    },
    { client: flow(null).client, source: memorySource({}).port },
  );
  assertEquals(data(noSource).code, "conflict");
});

Deno.test("coding-agent/cli#R30: 같은 입력의 MCP와 CLI 흐름 결과 data가 같다", async () => {
  const inputs = [
    { op: "catalog", query: "표" },
    { op: "show", name: "@lophn/ui-table" },
    { op: "add", name: "@lophn/ui-table", version: "1.2.0" },
    { op: "add", name: "@lophn/ui-table", version: "^1.2.0" },
    { op: "add", name: "@me/ledger-view", version: "0.1.0" },
  ];
  for (const input of inputs) {
    const mcp = await runSdkOp(input, {
      client: flow().client,
      surface: "mcp",
    });
    const cli = await runSdkOp(input, {
      client: flow().client,
      surface: "cli",
    });
    assertEquals(cli.data, mcp.data, JSON.stringify(input));
    assertEquals(cli.isError, mcp.isError, JSON.stringify(input));
    assert(cli.next.every((line) => !line.startsWith("lophn_sdk")));
  }
});

Deno.test("coding-agent/mcp-server#R22: SemVer 비교는 precedence를 따른다", () => {
  assert(compareSemver("1.10.0", "1.2.0") > 0);
  assert(compareSemver("1.0.0", "1.0.0-rc.1") > 0);
  assert(compareSemver("1.0.0-rc.2", "1.0.0-rc.10") < 0);
  assertEquals(compareSemver("1.0.0+a", "1.0.0+b"), 0);
});

Deno.test("coding-agent/mcp-server#R23: source 쓰기 실패는 그 오류로 끝나고 lock을 만들지 않는다", async () => {
  const locks: string[] = [];
  const port: SdkSourcePort = {
    readText: () => Promise.resolve(ok(config({}))),
    writeText: () =>
      Promise.resolve(err({ code: "forbidden", message: "쓸 수 없다" })),
    refreshLock: (dir) => {
      locks.push(dir);
      return Promise.resolve(ok(undefined));
    },
  };
  const result = await runSdkOp(
    {
      op: "add",
      name: "@lophn/ui-table",
      version: "1.2.0",
      apply: true,
      app: APP,
    },
    { client: flow().client, source: port },
  );
  assertEquals(data(result).code, "forbidden");
  assertEquals(locks, []);
});
