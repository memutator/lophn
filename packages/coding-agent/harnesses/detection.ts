// harness 감지다(coding-agent/harnesses#R2–R4, T28). PATH와 제품 catalog에
// 정한 유한한 fallback 위치만 읽는다. home 전체 순회·설치 트리 순회·shell RC
// 평가가 없다(R2). 발견·version·auth는 별도 값이고 timeout·실패·미지원 probe를
// absent나 성공으로 바꾸지 않는다(R3). 지금 native host만 수집이고 WSL·remote
// 요청은 미지원 안내로 끝난다(R4). probe는 argv만 쓰고 timeout이 있다
// (파일·외부 command는 인자로 끼운다, architecture).
import { err, formatAt, ok, type Result } from "../../base/mod.ts";
import {
  authResultSchema,
  discoveryResultSchema,
  type HarnessAuth,
  type HarnessCandidate,
  type HarnessDetection,
  type HarnessEnvironment,
  type HarnessId,
  type HarnessVersion,
} from "../../protocol/coding-agent/mod.ts";
import {
  type HarnessDefinition,
  PROBE_OUTCOMES,
  type ProbeOutcome,
  type ProbeSeat,
} from "./model.ts";

// alias가 가리키는 bin 재검사 hop guard다(R2, domain-model). 8회면 cycle로
// 보고 그 alias 위치를 따라가지 않는다.
export const ALIAS_HOP_LIMIT = 8;

// probe의 고정 상한이다(R1, domain-model target·probe 계약).
export const PROBE_TIMEOUT_MS = 5_000;
export const PROBE_OUTPUT_LIMIT_BYTES = 65_536;

// PATH와 fallback 디렉터리의 파일을 보는 눈이다. 테스트에서 fixture home으로
// 끼운다. 사람의 실제 home은 읽지 않는다.
export type FilesPort = {
  // 디렉터리가 있으면 하위 이름을 준다. 없으면 null이다.
  list(dir: string): Result<readonly string[] | null>;
  // 파일의 POSIX 실행 권한이다. 없으면 null이다.
  executable(path: string): Result<boolean | null>;
};

// probe의 외부 command 눈이다. argv만 쓰고 shell을 열지 않는다. 테스트에서
// fake로 끼운다.
export type ExecPort = {
  run(
    argv: readonly string[],
    limit: { timeout_ms: number; output_limit_bytes: number },
  ): Promise<Result<ProbeRun>>;
};

export type ProbeRun = {
  outcome: ProbeOutcome;
  // raw stdout는 아니다. classifier가 다듬은 안전 detail만 있다(R12).
  detail: string | null;
};

// 감지 결과 key다(R4). environment·profile별로 나눈다.
export type DetectionKey = {
  environment: HarnessEnvironment;
  profile_id: string | null;
};

// catalog fallback이 가리키는 home 기준 bin다(R2). shell RC 평가가 없다.
export const FALLBACK_DIRS = [
  ".local/bin",
  ".bun/bin",
  // npm·pnpm·Yarn의 정한 bin이다(domain-model DetectionSpec).
  ".npm-global/bin",
  ".pnpm-global/bin",
  ".yarn/bin",
  // Volta·asdf·fnm·mise shim/bin이다(domain-model DetectionSpec).
  ".volta/bin",
  ".asdf/shims",
  ".fnm/aliases/default/bin",
  ".local/share/mise/shims",
] as const;

export function environmentSupported(
  definition: HarnessDefinition,
  environment: HarnessEnvironment,
): Result<void> {
  const support = definition.environments.find(
    (entry) => entry.kind === environment.kind,
  );
  if (support === undefined) {
    return err({
      code: "invalid_input",
      message: "지원하지 않는 환경이다",
      details: { kind: environment.kind },
    });
  }
  if (!support.supported) {
    // WSL·remote 요청은 미지원 안내로 끝난다(R4). invalid_input에 안내 이유를
    // 남긴다(존재 누설이 아니다, 요청이 먼저 온다).
    return err({
      code: "invalid_input",
      message: support.reason ?? "지원하지 않는 환경이다",
      details: { kind: environment.kind },
    });
  }
  return ok(undefined);
}

type CandidateSeed =
  | { kind: "path"; dir: string; source: string }
  | { kind: "fallback"; dir: string; source: string }
  | { kind: "alias"; dir: string; source: string; hops: number };

export type Candidate = {
  path: string;
  source: string;
  executable_result: string;
};

// PATH에서 찾은 디렉터리다. shell RC 평가 없이 process env의 PATH만 본다(R2).
export function pathDirs(
  path: string | undefined,
): readonly string[] {
  if (path === undefined || path === "") return [];
  return path.split(":").filter((dir) => dir !== "");
}

// 첫 후보 경로의 절대 여부다(domain-model). PATH·fallback 모두 절대 경로다.
function absoluteJoin(home: string, dir: string, name: string): string {
  if (dir.startsWith("/")) return `${dir}/${name}`;
  return `${home}/${dir}/${name}`;
}

// 실행 결과 라벨이다(R3). 발견과 실행 가능함은 별도 값이다. POSIX 실행 권한을
// 파일 lookup으로 본다(조사 1.2).
function executableLabel(executable: boolean | null, exists: boolean): string {
  if (!exists) return "absent";
  return executable ? "ok" : "not_executable";
}

// fallback 후보의 상대 dir이다. hop guard 안에서 alias再来을 막는다.
function fallbackSeeds(
  home: string,
): readonly CandidateSeed[] {
  return FALLBACK_DIRS.map((dir) => ({
    kind: "fallback" as const,
    dir: `${home}/${dir}`,
    source: `fallback:${dir}`,
  }));
}

// PATH seeds다. process PATH의 순서대로 본다.
function pathSeeds(dirs: readonly string[]): readonly CandidateSeed[] {
  return dirs.map((dir) => ({
    kind: "path" as const,
    dir,
    source: "PATH",
  }));
}

// 실행 파일을 찾는다(R2). 위치 목록: PATH + 정한 fallback만이다. 다른 위치는
// 순회하지 않는다. absent는 모든 정한 lookup이 끝나고 후보가 없을 때뿐이다.
export function discover(
  definition: HarnessDefinition,
  key: DetectionKey,
  ports: {
    files: FilesPort;
    path: string | undefined;
    home: string;
  },
): Result<
  {
    discovery: string;
    candidates: readonly HarnessCandidate[];
    selected: string | null;
  }
> {
  const supported = environmentSupported(definition, key.environment);
  if (!supported.ok) return err(supported.error);

  const names = definition.detection.commands.flatMap((command) => [
    command.name,
    ...command.aliases,
  ]);
  const candidates: Candidate[] = [];
  for (
    const seed of [
      ...pathSeeds(pathDirs(ports.path)),
      ...fallbackSeeds(ports.home),
    ]
  ) {
    const listed = ports.files.list(seed.dir);
    if (!listed.ok) {
      // lookup 실패도 absent로 바꾸지 않는다(R3). 하나의 실패가 전체를
      // unknown으로 만든다.
      return ok({
        discovery: "unknown",
        candidates: [...candidates],
        selected: null,
      });
    }
    const names_in_dir = listed.value;
    if (names_in_dir === null) continue;
    for (const name of names) {
      if (!names_in_dir.includes(name)) continue;
      const full = absoluteJoin(ports.home, seed.dir, name);
      const executable = ports.files.executable(full);
      if (!executable.ok) {
        return ok({
          discovery: "unknown",
          candidates: [...candidates],
          selected: null,
        });
      }
      // PATH 뒤 정한 fallback이다. source는 seed provenance다(R2).
      candidates.push({
        path: full,
        source: seed.source,
        executable_result: executableLabel(executable.value, true),
      });
    }
  }
  // absent는 모든 정한 lookup이 끝나고 후보가 없을 때뿐이다(R3).
  const first = candidates.find(
    (candidate) => candidate.executable_result === "ok",
  );
  return ok({
    discovery: candidates.length === 0 ? "absent" : "detected",
    candidates: [...candidates],
    selected: first?.path ?? null,
    ...(first === undefined && candidates.length > 0 ? { selected: null } : {}),
  });
}

// probe를 실행한다(R1). 사람이 고른 별도 검사 level에서 부른다. filesystem
// 감지에서 자동 실행하지 않는다. timeout·실패는 absent나 성공으로 바꾸지
// 않는다(R3).
export async function runProbe(
  seat: ProbeSeat,
  exec: ExecPort,
): Promise<Result<HarnessProbeResult_shape>> {
  if (!seat.present) {
    // 없는 probe는 unverified_capability로 남는다(R3). 성공이 아니다.
    return ok({
      probe: "capability",
      outcome: "unverified_capability",
      detail: seat.reason,
    });
  }
  const spec = seat.spec;
  const run = await exec.run(spec.argv, {
    timeout_ms: spec.timeout_ms,
    output_limit_bytes: spec.output_limit_bytes,
  });
  if (!run.ok) {
    return ok({
      probe: spec.adapter_method,
      outcome: "unavailable",
      detail: run.error.message,
    });
  }
  return ok({
    probe: spec.adapter_method,
    outcome: run.value.outcome,
    detail: run.value.detail,
  });
}

type HarnessProbeResult_shape = {
  probe: string;
  outcome: string;
  detail: string | null;
};

// version을 판정한다(R3). classifier 성공만 verified고 나머지는
// unknown·error다. timeout을 성공으로 바꾸지 않는다.
export function versionJudgment(
  run: ProbeRun | null,
): HarnessVersion {
  if (run === null) {
    return {
      result: "unknown",
      value: null,
      reason: "version probe를 실행하지 않았다",
    };
  }
  if (run.outcome === "ok" && run.detail !== null) {
    return { result: "verified", value: run.detail, reason: null };
  }
  // timeout·실패는 각각 구별한다(R3).
  return {
    result: run.outcome === PROBE_OUTCOMES[1] ? "error" : "unknown",
    value: null,
    reason: run.detail ?? `probe outcome은 ${run.outcome}이다`,
  };
}

// auth를 판정한다(R3). probe 상태 문구 확인만 verified고 파일 존재·미지원
// probe를 verified나 성공으로 바꾸지 않는다.
export function authJudgment(
  run: ProbeRun | null,
  seat: ProbeSeat,
): HarnessAuth {
  if (!seat.present) {
    // 미지원·미검증 probe는 unverified_capability다(R1 확인). 성공이 아니다.
    return {
      result: seat.capability === "unsupported"
        ? "unverified_capability"
        : "unverified_capability",
      evidence: null,
      reason: seat.reason,
    };
  }
  if (run === null) {
    return {
      result: "unknown",
      evidence: null,
      reason: "auth probe를 실행하지 않았다",
    };
  }
  if (seat.spec.classifier === "login_status") {
    const parsed = authResultSchema.safeParse(run.detail);
    if (run.outcome === "ok" && parsed.success) {
      return {
        result: parsed.data as HarnessAuth["result"],
        evidence: "login_status를 확인했다",
        reason: null,
      };
    }
  }
  return {
    result: "unknown",
    evidence: null,
    reason: run.detail ?? `probe outcome은 ${run.outcome}이다`,
  };
}

// obs의 freshness를 판정한다. env·profile·catalog 변경이 stale이다(R4).
export function freshnessOf(
  previous: {
    environment: HarnessEnvironment;
    profile_id: string | null;
    catalog_revision: string;
  } | null,
  current: DetectionKey & { catalog_revision: string },
): "fresh" | "stale" {
  if (previous === null) return "stale";
  const sameEnv = previous.environment.kind === current.environment.kind &&
    previous.environment.identity === current.environment.identity;
  const sameProfile = previous.profile_id === current.profile_id;
  const sameCatalog = previous.catalog_revision === current.catalog_revision;
  return sameEnv && sameProfile && sameCatalog ? "fresh" : "stale";
}

// 감지 결과값이다(R2–R4). obs key·candidates·selected·version·auth·probe·
// freshness를 별도 값으로 둔다. refresh는 사람 요청만 먹는다(호출 경로가
// 그렇게 묶는다). freshness는 이전 결과가 같은 key이면 fresh다.
export function detectionOf(
  definition: HarnessDefinition,
  input: {
    key: DetectionKey;
    catalog_revision: string;
    observed_at: string;
    discovery: string;
    candidates: readonly HarnessCandidate[];
    selected: string | null;
    version: HarnessVersion;
    auth: HarnessAuth;
    probe_results: readonly {
      probe: string;
      outcome: string;
      detail: string | null;
    }[];
    previous: {
      environment: HarnessEnvironment;
      profile_id: string | null;
      catalog_revision: string;
    } | null;
  },
): Result<HarnessDetection> {
  const discovery = discoveryResultSchema.safeParse(input.discovery);
  if (!discovery.success) {
    return err({ code: "internal", message: "discovery 결과가 맞지 않다" });
  }
  return ok({
    harness_id: definition.harness_id,
    catalog_revision: input.catalog_revision,
    environment: input.key.environment,
    profile_id: input.key.profile_id,
    observed_at: formatAt(new Date(input.observed_at).getTime()),
    discovery: discovery.data,
    candidates: [...input.candidates],
    selected_executable: input.selected,
    version: input.version,
    auth: input.auth,
    probe_results: [...input.probe_results],
    freshness: freshnessOf(input.previous, {
      ...input.key,
      catalog_revision: input.catalog_revision,
    }),
  });
}

export type { HarnessId };
