// `lophn harness detect|refresh|install`의 실행이다. 이미 있는 감지·설치 engine을 부르는 일만 하고 새 규칙은
// 없다. engine 호출이 이 file 하나에 모여 있어 engine이 바뀌면 이 file만 맞춘다.
// 감지는 `detect`가 저장 결과를, `refresh`만 다시 감지하고 version·login probe를 돈다.
import { err, type LophnError, ok, type Result } from "../../../base/mod.ts";
import type { HarnessDetection } from "../../../protocol/coding-agent/mod.ts";
import {
  detectHarnesses,
  DETECTION_FALLBACK_DIRS,
  detectionCacheOf,
  discover,
  filePort,
  HARNESS_CATALOG,
  NATIVE_ENVIRONMENT,
} from "../../harnesses/mod.ts";
import {
  systemExecPort,
  systemFilesPort,
} from "../../harnesses/system-ports.ts";
import type { LocalEnv } from "./types.ts";

export async function runHarnessDetect(
  mode: "detect" | "refresh",
  local: LocalEnv,
): Promise<Result<readonly HarnessDetection[], LophnError>> {
  const root = local.dataRoot ?? `${local.home}/.lophn`;
  const probeEnv: Record<string, string> = {};
  for (const name of ["PATH", "HOME"]) {
    const value = local.env.get(name);
    if (value !== undefined) probeEnv[name] = value;
  }
  const detected = await detectHarnesses(
    mode,
    {
      files: systemFilesPort(),
      execFor: (classifier) => systemExecPort(classifier, probeEnv),
      path: local.env.get("PATH"),
      home: local.home,
    },
    detectionCacheOf(
      local.home,
      filePort(),
      `${root.replace(/\/$/, "")}/integrations`,
    ),
    local.now(),
  );
  return detected.ok ? ok(detected.value.detections) : detected;
}

// 앱 source 폴더에 skill 둘과 hook 설정을 놓는다. 폴더 안만 쓴다(권한도 그 폴더 하나만 연다).
// 새 설치 engine(`installIntoFolder`)이 들어오기 전에는 쓰지 않고 unavailable로 낸다.
export function runHarnessInstall(
  _input: { harness: string; folder: string },
): Promise<Result<{ skill: string; hook: string }, LophnError>> {
  return Promise.resolve(err({
    code: "unavailable",
    message: "harness install은 아직 새 설치 engine에 이어지지 않았다",
  }));
}

// `harness refresh`가 probe를 돌릴 제품 실행 파일의 절대 경로들이다(probe는 돌리지 않는다). launcher가
// 이 파일에만 실행 권한을 연다.
export function detectedExecutables(
  env: { get(name: string): string | undefined },
  home: string,
): string[] {
  const found: string[] = [];
  for (const definition of HARNESS_CATALOG) {
    const result = discover(
      definition,
      { environment: NATIVE_ENVIRONMENT, profile_id: null },
      { files: systemFilesPort(), path: env.get("PATH"), home },
    );
    if (result.ok && result.value.selected !== null) {
      found.push(result.value.selected);
    }
  }
  return [...new Set(found)];
}

// 감지가 PATH 말고 읽는 home 기준 폴더들이다(읽기 권한 계산에 쓴다).
export function detectionReadDirs(home: string): string[] {
  return DETECTION_FALLBACK_DIRS.map((dir) =>
    `${home.replace(/\/$/, "")}/${dir}`
  );
}
