// harness 감지다. 실행 파일(PATH와 home 기준 bin 폴더 몇 곳), version, 로그인을 확인한다. 확인하지 못하면
// 확인 못함(unknown)이고 부재나 성공으로 바꾸지 않는다. 결과는 저장하지 않는다. 사람 요청이 올 때마다 다시 한다.
import { err, formatAt, ok, type Result } from "../../base/mod.ts";
import {
  HARNESS_ADAPTERS,
  type HarnessAdapter,
  type HarnessAuth,
  type HarnessCandidate,
  type HarnessDetection,
  type HarnessId,
  type HarnessProbeResult,
  type HarnessVersion,
} from "../../protocol/coding-agent/mod.ts";

export const ADAPTER_REVISION = "harness-adapters-1";

// PATH 뒤에 읽는 home 기준 bin 폴더다. shell RC는 평가하지 않는다.
export const FALLBACK_DIRS = [
  ".local/bin",
  ".bun/bin",
  ".npm-global/bin",
  ".pnpm-global/bin",
  ".yarn/bin",
  ".volta/bin",
  ".asdf/shims",
  ".fnm/aliases/default/bin",
  ".local/share/mise/shims",
] as const;

// probe가 끝난 모양이다. exit가 null이면 시간 안에 끝나지 않았다.
export type ProbeOutput = { exit: number | null; text: string };

export type DetectPorts = {
  // 파일이 없으면 null, 있으면 실행 권한 여부다. 읽지 못하면 오류다.
  executable(path: string): Result<boolean | null>;
  // argv만 쓰고 shell을 열지 않는다.
  run(argv: readonly string[]): Promise<Result<ProbeOutput>>;
  path: string | undefined;
  home: string;
};

export type DetectInput = {
  // version·login probe를 돌릴지다. `harness refresh`만 돈다.
  probe: boolean;
  now: string;
};

type Found = {
  discovery: HarnessDetection["discovery"];
  candidates: HarnessCandidate[];
  selected: string | null;
};

export function discover(
  adapter: HarnessAdapter,
  ports: Pick<DetectPorts, "executable" | "path" | "home">,
): Found {
  const home = ports.home.replace(/\/$/, "");
  const dirs = [
    ...(ports.path ?? "").split(":").filter((dir) => dir !== "").map((
      dir,
    ) => ({ dir, source: "PATH" })),
    ...FALLBACK_DIRS.map((dir) => ({
      dir: `${home}/${dir}`,
      source: `fallback:${dir}`,
    })),
  ];
  const candidates: HarnessCandidate[] = [];
  for (const { dir, source } of dirs) {
    for (const name of adapter.commands) {
      const path = `${dir}/${name}`;
      const found = ports.executable(path);
      if (!found.ok) {
        return { discovery: "unknown", candidates, selected: null };
      }
      if (found.value === null) continue;
      candidates.push({
        path,
        source,
        executable_result: found.value ? "ok" : "not_executable",
      });
    }
  }
  const selected = candidates.find((one) => one.executable_result === "ok")
    ?.path ?? null;
  if (selected !== null) return { discovery: "detected", candidates, selected };
  return {
    discovery: candidates.length === 0 ? "absent" : "unknown",
    candidates,
    selected: null,
  };
}

const SEMVER = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/;

function unknownVersion(reason: string): HarnessVersion {
  return { result: "unknown", value: null, reason };
}

function unknownAuth(reason: string): HarnessAuth {
  return { result: "unknown", evidence: null, reason };
}

async function probeOne(
  adapter: HarnessAdapter,
  executable: string,
  ports: DetectPorts,
): Promise<
  { version: HarnessVersion; auth: HarnessAuth; results: HarnessProbeResult[] }
> {
  const results: HarnessProbeResult[] = [];
  let version = unknownVersion("이 제품은 version 확인 방법이 없다");
  let auth = unknownAuth("이 제품은 로그인 확인 방법이 없다");
  const run = async (probe: "version" | "login", argv: readonly string[]) => {
    const ran = await ports.run([executable, ...argv.slice(1)]);
    if (!ran.ok) {
      results.push({
        probe,
        outcome: "unavailable",
        detail: ran.error.message,
      });
      return null;
    }
    if (ran.value.exit === null) {
      results.push({
        probe,
        outcome: "timeout",
        detail: "시간 안에 끝나지 않았다",
      });
      return null;
    }
    results.push({
      probe,
      outcome: ran.value.exit === 0 ? "ok" : "failed",
      detail: `종료 ${ran.value.exit}`,
    });
    return ran.value;
  };
  if (adapter.version_probe !== null) {
    const done = await run("version", adapter.version_probe.argv);
    if (done === null) {
      version = unknownVersion("version 확인이 끝나지 않았다");
    } else {
      const first = done.text.split("\n").find((line) => line.trim() !== "") ??
        "";
      const found = SEMVER.exec(first);
      version = done.exit === 0 && found !== null
        ? { result: "verified", value: found[1], reason: null }
        : {
          result: "error",
          value: null,
          reason: `version 확인이 종료 ${done.exit}로 끝났다`,
        };
    }
  }
  if (adapter.login_probe !== null) {
    const done = await run("login", adapter.login_probe.argv);
    if (done === null) {
      auth = unknownAuth("로그인 확인이 끝나지 않았다");
    } else if (done.exit === 0) {
      auth = {
        result: "verified",
        evidence: "login status를 확인했다",
        reason: null,
      };
    } else if (/not logged in|no credentials|logged out/i.test(done.text)) {
      auth = {
        result: "not_verified",
        evidence: "login status가 로그인하지 않았다고 했다",
        reason: null,
      };
    } else {
      auth = unknownAuth(`로그인 확인이 종료 ${done.exit}로 끝났다`);
    }
  }
  return { version, auth, results };
}

async function detectOne(
  adapter: HarnessAdapter,
  ports: DetectPorts,
  input: DetectInput,
): Promise<HarnessDetection> {
  const found = discover(adapter, ports);
  let version = unknownVersion(
    input.probe
      ? "version 확인 방법이 없다"
      : "version probe를 실행하지 않았다",
  );
  let auth = unknownAuth(
    input.probe ? "로그인 확인 방법이 없다" : "login probe를 실행하지 않았다",
  );
  let results: HarnessProbeResult[] = [];
  if (input.probe && found.selected !== null) {
    ({ version, auth, results } = await probeOne(
      adapter,
      found.selected,
      ports,
    ));
  }
  return {
    harness_id: adapter.id,
    catalog_revision: ADAPTER_REVISION,
    environment: { kind: "host", identity: "native" },
    profile_id: null,
    observed_at: formatAt(new Date(input.now).getTime()),
    discovery: found.discovery,
    candidates: found.candidates,
    selected_executable: found.selected,
    version,
    auth,
    probe_results: results,
    freshness: "fresh",
  };
}

export async function detectHarnesses(
  ports: DetectPorts,
  input: DetectInput,
): Promise<Result<HarnessDetection[]>> {
  if (Number.isNaN(new Date(input.now).getTime())) {
    return err({ code: "invalid_input", message: "시각이 맞지 않다" });
  }
  const list: HarnessDetection[] = [];
  for (const id of Object.keys(HARNESS_ADAPTERS) as HarnessId[]) {
    list.push(await detectOne(HARNESS_ADAPTERS[id], ports, input));
  }
  return ok(list);
}
