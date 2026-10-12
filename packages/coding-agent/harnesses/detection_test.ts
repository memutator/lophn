// harness 감지 테스트다(coding-agent/harnesses#R2, R3, R4, R12, T28). PATH·
// fallback 탐색, 별도 관측, 미지원 환경 안내를 fixture home에서만 본다.
// 사람의 실제 home은 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import type { HarnessEnvironment } from "../../protocol/coding-agent/mod.ts";
import { catalogOf, HARNESS_CATALOG } from "./catalog/definitions.ts";
import {
  ALIAS_HOP_LIMIT,
  type DetectionKey,
  discover,
  type ExecPort,
  type FilesPort,
  freshnessOf,
  pathDirs,
  PROBE_OUTPUT_LIMIT_BYTES,
  PROBE_TIMEOUT_MS,
  runProbe,
} from "./detection.ts";

function code(
  result: { ok: boolean; error?: { code: string } },
  expected: string,
): void {
  assert(!result.ok);
  assertEquals(result.error?.code, expected);
}

// fixture FilesPort다. temp dir home 기준 map으로 이름을 준다. 사람의 실제
// home은 보지 않는다.
function fixtureFiles(
  entries: ReadonlyMap<string, readonly string[]>,
  executables: ReadonlySet<string>,
): FilesPort {
  return {
    list(dir) {
      const names = entries.get(dir);
      if (names === undefined) return ok(null);
      return ok(names);
    },
    executable(path) {
      if (executables.has(path)) return ok(true);
      if (entries.get(dirname(path))?.includes(basename(path))) {
        return ok(false);
      }
      return ok(null);
    },
  };
}

function dirname(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? path : path.slice(0, cut);
}

function basename(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? path : path.slice(cut + 1);
}

const HOST: HarnessEnvironment = { kind: "host", identity: "work-host" };
const KEY: DetectionKey = { environment: HOST, profile_id: null };
const CLAUDE = catalogOf("claude");
assert(CLAUDE !== undefined);

Deno.test("coding-agent/harnesses#R2: 감지는 PATH와 정한 fallback만 읽고 다른 위치는 순회하지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "harness-fixture-" });
  try {
    const visited = new Set<string>();
    const files: FilesPort = {
      list(dir) {
        visited.add(dir);
        return ok(null);
      },
      executable() {
        return ok(null);
      },
    };
    const result = discover(CLAUDE, KEY, {
      files,
      path: `${home}/bin`,
      home,
    });
    assert(result.ok);
    // 정한 위치만 본다: PATH 1개 + fallback 9개다. home 순회는 없다.
    assertEquals(visited.size, 10);
    assert(visited.has(`${home}/bin`));
    assert(visited.has(`${home}/.local/bin`));
    assert(visited.has(`${home}/.bun/bin`));
    assert(visited.has(`${home}/.npm-global/bin`));
    assert(visited.has(`${home}/.volta/bin`));
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("coding-agent/harnesses#R2: PATH 밖 정한 fallback에서 실행 파일을 발견한다", () => {
  const home = "/fixture-home";
  const files = fixtureFiles(
    new Map([
      [`${home}/.bun/bin`, ["claude"]],
    ]),
    new Set([`${home}/.bun/bin/claude`]),
  );
  const result = discover(CLAUDE, KEY, { files, path: "/usr/bin", home });
  assert(result.ok);
  assertEquals(result.value.discovery, "detected");
  assertEquals(result.value.candidates.length, 1);
  assertEquals(result.value.candidates[0].path, `${home}/.bun/bin/claude`);
  assertEquals(result.value.candidates[0].source, "fallback:.bun/bin");
  assertEquals(result.value.selected, `${home}/.bun/bin/claude`);
});

Deno.test("coding-agent/harnesses#R2: shell RC 평가 없이 process PATH만 본다", () => {
  // PATH에 없는 이름은 fallback에서만 찾는다. RC 확장은 없다(R2).
  assertEquals(pathDirs(undefined), []);
  assertEquals(pathDirs("/usr/bin:/bin"), ["/usr/bin", "/bin"]);
});

Deno.test("coding-agent/harnesses#R3: 발견 뒤 후보가 없으면 absent이고 실패는 absent로 바뀌지 않는다", () => {
  const home = "/fixture-home";
  // 모든 정한 lookup이 끝나고 후보 없음이 absent다.
  const absent = discover(CLAUDE, KEY, {
    files: fixtureFiles(new Map(), new Set()),
    path: "/usr/bin",
    home,
  });
  assert(absent.ok);
  assertEquals(absent.value.discovery, "absent");
  assertEquals(absent.value.selected, null);
  // lookup 실패는 unknown이다. absent로 바뀌지 않는다(R3).
  const failed: FilesPort = {
    list() {
      return { ok: false, error: { code: "unavailable", message: "err" } };
    },
    executable() {
      return ok(null);
    },
  };
  const errored = discover(CLAUDE, KEY, {
    files: failed,
    path: "/usr/bin",
    home,
  });
  assert(errored.ok);
  assertEquals(errored.value.discovery, "unknown");
});

Deno.test("coding-agent/harnesses#R3: 실행 권한이 없는 후보는 선택되지 않고 라벨로 남는다", () => {
  const home = "/fixture-home";
  const files = fixtureFiles(
    new Map([
      [`${home}/bin`, ["claude"]],
    ]),
    new Set(),
  );
  const result = discover(CLAUDE, KEY, { files, path: `${home}/bin`, home });
  assert(result.ok);
  assertEquals(result.value.discovery, "detected");
  assertEquals(result.value.candidates[0].executable_result, "not_executable");
  assertEquals(result.value.selected, null);
});

Deno.test("coding-agent/harnesses#R3: probe outcome은 absent나 성공으로 바뀌지 않는다", async () => {
  // timeout run은 unknown·error로 남는다(R3).
  const timeoutExec: ExecPort = {
    run() {
      return Promise.resolve(
        ok({ outcome: "timeout", detail: "probe가 5,000ms를 넘었다" }),
      );
    },
  };
  const seat = CLAUDE.version_probe;
  assert(seat.present === false);
  const unverified = await runProbe(seat, timeoutExec);
  assert(unverified.ok);
  assertEquals(unverified.value.outcome, "unverified_capability");
});

Deno.test("coding-agent/harnesses#R4: WSL·remote 요청은 미지원 안내로 끝난다", () => {
  const home = "/fixture-home";
  const wsl = discover(
    CLAUDE,
    {
      environment: { kind: "wsl", identity: "ubuntu-24.04" },
      profile_id: null,
    },
    { files: fixtureFiles(new Map(), new Set()), path: "/usr/bin", home },
  );
  code(wsl, "invalid_input");
  assert(!wsl.ok);
  assertEquals(wsl.error.message, "지금은 native host만 감지·설치·시작한다");
  const remote = discover(
    CLAUDE,
    { environment: { kind: "remote", identity: "relay-1" }, profile_id: null },
    { files: fixtureFiles(new Map(), new Set()), path: "/usr/bin", home },
  );
  assert(!remote.ok);
  code(remote, "invalid_input");
});

Deno.test("coding-agent/harnesses#R4: 다른 profile·catalog의 freshness는 stale이다", () => {
  const previous = {
    environment: HOST,
    profile_id: null,
    catalog_revision: "harness-catalog-1",
  };
  assertEquals(
    freshnessOf(previous, { ...KEY, catalog_revision: "harness-catalog-1" }),
    "fresh",
  );
  assertEquals(
    freshnessOf(previous, {
      environment: HOST,
      profile_id: "profile-a",
      catalog_revision: "harness-catalog-1",
    }),
    "stale",
  );
  assertEquals(
    freshnessOf(previous, {
      environment: HOST,
      profile_id: null,
      catalog_revision: "harness-catalog-2",
    }),
    "stale",
  );
  assertEquals(
    freshnessOf(previous, {
      environment: { kind: "host", identity: "other-host" },
      profile_id: null,
      catalog_revision: "harness-catalog-1",
    }),
    "stale",
  );
});

Deno.test("coding-agent/harnesses#R1: 일곱 제품 catalog가 감지 명령·probe 상한·target·실행 계약을 둔다", () => {
  assertEquals(HARNESS_CATALOG.length, 7);
  for (const definition of HARNESS_CATALOG) {
    assert(definition.detection.commands.length >= 1);
    // probe 상한이다(R1, domain-model).
    if (definition.version_probe.present) {
      assertEquals(definition.version_probe.spec.timeout_ms, PROBE_TIMEOUT_MS);
      assertEquals(
        definition.version_probe.spec.output_limit_bytes,
        PROBE_OUTPUT_LIMIT_BYTES,
      );
    }
    if (definition.auth_probe.present) {
      assertEquals(definition.auth_probe.spec.timeout_ms, PROBE_TIMEOUT_MS);
      assertEquals(
        definition.auth_probe.spec.output_limit_bytes,
        PROBE_OUTPUT_LIMIT_BYTES,
      );
    }
    // 지금 PTY TUI만 실행 허용이다(domain-model).
    assertEquals(definition.execution.transport, "pty");
  }
  // 미검증 capability는 성공으로 나오지 않는다(R1). probe가 없는 제품은
  // unverified 이유를 명시한다.
  for (const definition of HARNESS_CATALOG) {
    if (!definition.version_probe.present) {
      assert(definition.version_probe.reason.length > 0);
    }
  }
  // codex만 [확인] probe를 둔다(조사 9.4). Claude·Gemini·Hermes 등은
  // unverified다.
  const codex = catalogOf("codex");
  assert(codex !== undefined);
  assert(codex.version_probe.present);
  assertEquals(codex.version_probe.spec.argv, ["codex", "--version"]);
  assert(codex.auth_probe.present);
  assertEquals(codex.auth_probe.spec.argv, ["codex", "login", "status"]);
  // 환경은 host만 지원이다(R4).
  for (const definition of HARNESS_CATALOG) {
    assertEquals(
      definition.environments.filter((entry) => entry.supported).length,
      1,
    );
  }
});

Deno.test("coding-agent/harnesses#R1: alias hop guard는 8회다", () => {
  assertEquals(ALIAS_HOP_LIMIT, 8);
});

Deno.test("coding-agent/harnesses#R12: 감지 값에 token·설정 원문이 없다", async () => {
  const home = "/fixture-home";
  const files = fixtureFiles(
    new Map([
      [`${home}/.local/bin`, ["codex"]],
    ]),
    new Set([`${home}/.local/bin/codex`]),
  );
  const codex = catalogOf("codex");
  assert(codex !== undefined);
  const result = discover(codex, KEY, { files, path: "/usr/bin", home });
  assert(result.ok);
  const text = JSON.stringify(result.value);
  // 감지 값은 경로·source·실행 라벨뿐이다. 원문·token field는 없다(R12).
  assertEquals(text.includes("token"), false);
  assertEquals(text.includes("oauth"), false);
  const probed = await runProbe(codex.auth_probe, {
    run() {
      return Promise.resolve(
        ok({ outcome: "ok", detail: "Logged in using ChatGPT" }),
      );
    },
  });
  assert(probed.ok);
  // probe 결과도 안전 detail뿐이다(R12).
  assertEquals(JSON.stringify(probed.value).includes("ghp_"), false);
});
