// 일곱 제품의 감지 조립이다(coding-agent/harnesses#R2, R3, R4, T36, cli#R40). 최초 감지는
// PATH와 catalog의 fallback 위치만 읽고 version·auth probe를 돌리지 않는다. 사람이 요청한 재감지
// (`refresh`)만 별도 version·auth probe까지 돌린다. 결과는 저장해 두고 화면 재진입이나 빈 결과로
// 다시 감지하지 않는다(R2): 저장한 결과는 환경·catalog revision이 같으면 그대로 쓴다.
import { ok, type Result } from "../../base/mod.ts";
import {
  type HarnessDetection,
  harnessDetectionSchema,
  type HarnessEnvironment,
} from "../../contracts/coding-agent/mod.ts";
import { HARNESS_CATALOG } from "./catalog/definitions.ts";
import type { FilePort } from "./integration/apply.ts";
import {
  authJudgment,
  type DetectionKey,
  detectionOf,
  discover,
  type ExecPort,
  type FilesPort,
  freshnessOf,
  runProbe,
  versionJudgment,
} from "./detection.ts";
import type { HarnessDefinition, ProbeSeat } from "./model.ts";
import { CATALOG_REVISION } from "./model.ts";

// 지금은 native host만 감지한다(R4). identity는 이 컴퓨터의 native 표식이고 WSL·remote는 없다.
export const NATIVE_ENVIRONMENT: HarnessEnvironment = {
  kind: "host",
  identity: "native",
};

export type DetectPorts = {
  files: FilesPort;
  // classifier별 probe 실행 눈이다. 최초 감지에서는 부르지 않는다.
  execFor(classifier: "first_semver" | "login_status"): ExecPort;
  path: string | undefined;
  home: string;
};

// 감지 결과의 저장 자리다(local metadata). 쓰지 못해도 결과는 돌려준다.
export type DetectionCache = {
  read(): Promise<readonly HarnessDetection[] | null>;
  write(list: readonly HarnessDetection[]): Promise<boolean>;
};

const KEY: DetectionKey = { environment: NATIVE_ENVIRONMENT, profile_id: null };

function seatWithExecutable(seat: ProbeSeat, executable: string): ProbeSeat {
  if (!seat.present) return seat;
  return {
    present: true,
    spec: { ...seat.spec, argv: [executable, ...seat.spec.argv.slice(1)] },
  };
}

async function detectOne(
  definition: HarnessDefinition,
  ports: DetectPorts,
  probes: boolean,
  observedAt: string,
): Promise<Result<HarnessDetection>> {
  const found = discover(definition, KEY, ports);
  const base = {
    key: KEY,
    catalog_revision: CATALOG_REVISION,
    observed_at: observedAt,
    // 방금 한 관측이라 같은 key의 fresh다. 환경·catalog가 바뀐 저장 결과만 stale이다.
    previous: {
      environment: KEY.environment,
      profile_id: KEY.profile_id,
      catalog_revision: CATALOG_REVISION,
    },
  };
  if (!found.ok) {
    return detectionOf(definition, {
      ...base,
      discovery: "error",
      candidates: [],
      selected: null,
      version: versionJudgment(null),
      auth: authJudgment(null, definition.auth_probe),
      probe_results: [],
    });
  }
  let version = versionJudgment(null);
  let auth = authJudgment(null, definition.auth_probe);
  const results: { probe: string; outcome: string; detail: string | null }[] =
    [];
  if (probes && found.value.selected !== null) {
    const executable = found.value.selected;
    const versionSeat = seatWithExecutable(
      definition.version_probe,
      executable,
    );
    const versionRun = await runProbe(
      versionSeat,
      ports.execFor(
        versionSeat.present ? versionSeat.spec.classifier : "first_semver",
      ),
    );
    if (versionRun.ok) {
      results.push(versionRun.value);
      version = versionJudgment({
        outcome: versionRun.value.outcome as never,
        detail: versionRun.value.detail,
      });
    }
    const authSeat = seatWithExecutable(definition.auth_probe, executable);
    const authRun = await runProbe(
      authSeat,
      ports.execFor(
        authSeat.present ? authSeat.spec.classifier : "login_status",
      ),
    );
    if (authRun.ok) {
      results.push(authRun.value);
      auth = authJudgment({
        outcome: authRun.value.outcome as never,
        detail: authRun.value.detail,
      }, authSeat);
    }
  }
  return detectionOf(definition, {
    ...base,
    discovery: found.value.discovery,
    candidates: found.value.candidates,
    selected: found.value.selected,
    version,
    auth,
    probe_results: results,
  });
}

export type DetectOutcome = {
  detections: HarnessDetection[];
  // 저장해 둔 결과를 그대로 썼는지, 처음 감지했는지, 사람 요청으로 다시 감지했는지다.
  source: "cached" | "first" | "refreshed";
  cache_saved: boolean | null;
};

function cacheUsable(list: readonly HarnessDetection[] | null): boolean {
  if (list === null) return false;
  const ids = new Set(list.map((item) => item.harness_id));
  return HARNESS_CATALOG.every((definition) =>
    ids.has(definition.harness_id)
  ) &&
    list.every((item) =>
      freshnessOf(item, { ...KEY, catalog_revision: CATALOG_REVISION }) ===
        "fresh"
    );
}

// `detect`는 저장한 결과가 있으면 그대로, 없거나 환경·catalog가 바뀌었으면 처음 감지(probe 없음)다.
// `refresh`는 사람 요청이라 저장 결과와 상관없이 다시 감지하고 version·auth probe도 돈다.
export async function detectHarnesses(
  mode: "detect" | "refresh",
  ports: DetectPorts,
  cache: DetectionCache,
  now: string,
): Promise<Result<DetectOutcome>> {
  const stored = await cache.read();
  if (mode === "detect" && cacheUsable(stored)) {
    return ok({
      detections: [...(stored ?? [])],
      source: "cached",
      cache_saved: null,
    });
  }
  const detections: HarnessDetection[] = [];
  for (const definition of HARNESS_CATALOG) {
    const detected = await detectOne(
      definition,
      ports,
      mode === "refresh",
      now,
    );
    if (!detected.ok) return detected;
    detections.push(detected.value);
  }
  const saved = await cache.write(detections);
  return ok({
    detections,
    source: mode === "refresh" ? "refreshed" : "first",
    cache_saved: saved,
  });
}

// 저장 결과를 schema로 다시 걸러 읽는 helper다. 맞지 않으면 없는 것으로 본다.
export function parseDetections(
  value: unknown,
): readonly HarnessDetection[] | null {
  if (!Array.isArray(value)) return null;
  const list: HarnessDetection[] = [];
  for (const item of value) {
    const parsed = harnessDetectionSchema.safeParse(item);
    if (!parsed.success) return null;
    list.push(parsed.data);
  }
  return list;
}

// 감지 결과를 receipt·journal과 같은 `<home>/.lophn/integrations/` local metadata로 저장한다.
// 원문 출력·token은 담지 않는다(R12). 쓰기는 temp·rename이고 실패는 저장 안 됨으로 돌려준다.
export function detectionCacheOf(
  home: string,
  files: FilePort,
): DetectionCache {
  const path = `${home.replace(/\/$/, "")}/.lophn/integrations/detection.json`;
  return {
    async read() {
      const read = await files.read(path);
      if (read.kind !== "file") return null;
      try {
        return parseDetections(JSON.parse(read.text));
      } catch {
        return null;
      }
    },
    write(list) {
      return files.writeAtomic(path, `${JSON.stringify(list, null, 2)}\n`);
    },
  };
}
