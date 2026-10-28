// Settings › Coding agents의 main 쪽. `lophn harness detect|refresh`를 exec로 불러 제품마다 감지 결과를 읽고
// `HarnessSettingsView`로 바꿔 renderer에 준다. 감지 결과는 CLI도 저장하지 않아서 이 module이 마지막 결과만
// 메모리에 쥔다.
//
// 처음 읽기는 `detect`(실행 파일 찾기만), 사람이 누른 [Detect again]만 `refresh`(version probe)다.
// 화면이 열릴 때 자동 재감지는 없다. 연결을 만들거나 설치하는 길은 없다.
import { execFile } from "node:child_process";

import {
  type CodingReply,
  HARNESS_IDS,
  type HarnessDiscovery,
  type HarnessName,
  type HarnessSettingsView,
} from "../../ipc/coding.ts";

// shell tsc는 protocol의 base를 따라가지 못한다. 감지 값 검사와 제품 표(label)는 wiring이
// protocol의 `harnessDetectionSchema`·`HARNESS_ADAPTERS`·`canDeliverMessages`로 만들어 넣는다.
// 이 module이 읽는 감지 칸만 여기 둔다.
type Detection = {
  harness_id: HarnessName;
  discovery: HarnessDiscovery;
  observed_at: string;
  selected_executable: string | null;
  version: {
    result: HarnessSettingsView["version_result"];
    value: string | null;
  };
};

export type HarnessCatalog = {
  /** `harnessDetectionSchema` 검사. 맞지 않으면 null. */
  parse(item: unknown): Detection | null;
  facts(id: HarnessName): {
    label: string;
    can_deliver_messages: boolean;
  };
};

type ExecFile = (
  file: string,
  args: string[],
  options: { env: Record<string, string>; timeout: number; maxBuffer: number },
) => Promise<{ code: number | null; stdout: string }>;

const defaultExec: ExecFile = (file, args, options) =>
  new Promise((resolve) => {
    execFile(file, args, options, (error, stdout) => {
      const code =
        error === null
          ? 0
          : typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : null;
      resolve({ code, stdout: String(stdout) });
    });
  });

/** `lophn <args> --json`이 찍은 값 그대로(성공은 감싸지 않는다). 실패하면 `{error}`의 이유 한 줄. */
type CliRun = (
  args: string[],
) => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>;

/**
 * `lophn` 실행 파일 child다. 상속 환경에서 credential 이름을 빼고 부른다. 종료 code와 상관없이
 * stdout의 JSON 하나를 읽는다(실패도 `{error}`로 나온다).
 */
export function childCliRunner(options: {
  /** `lophn` 실행 파일 절대 경로. */
  command: string;
  env: Readonly<Record<string, string | undefined>>;
  exec?: ExecFile;
  timeout_ms?: number;
}): CliRun {
  const exec = options.exec ?? defaultExec;
  return async (args) => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.env)) {
      if (value === undefined) continue;
      if (/(TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) continue;
      env[name] = value;
    }
    const ran = await exec(options.command, [...args, "--json"], {
      env,
      timeout: options.timeout_ms ?? 30_000,
      maxBuffer: 1 << 20,
    });
    let body: unknown;
    try {
      body = JSON.parse(ran.stdout);
    } catch {
      return { ok: false, message: "lophn gave no result" };
    }
    const error = (body as { error?: { code?: unknown; message?: unknown } })
      ?.error;
    if (typeof error?.code === "string" && typeof error.message === "string") {
      return { ok: false, message: error.message };
    }
    return { ok: true, data: body };
  };
}

type HarnessSettingsDeps = {
  catalog: HarnessCatalog;
  /** `lophn` child. 설치 경로를 모르면 null이다. */
  cli: CliRun | null;
};

export type HarnessSettings = {
  /** 마지막 감지 결과. 아직 없으면 `detect`를 한 번 돌린다. */
  read(): Promise<CodingReply<readonly HarnessSettingsView[]>>;
  /** 사람이 누른 [Detect again]. `refresh`를 돌려 마지막 결과를 바꾼다. */
  refresh(): Promise<CodingReply<readonly HarnessSettingsView[]>>;
};

export function createHarnessSettings(
  deps: HarnessSettingsDeps,
): HarnessSettings {
  function viewOf(detection: Detection): HarnessSettingsView {
    const facts = deps.catalog.facts(detection.harness_id);
    return {
      harness_id: detection.harness_id,
      label: facts.label,
      discovery: detection.discovery,
      version: detection.version.value,
      version_result: detection.version.result,
      can_deliver_messages: facts.can_deliver_messages,
      observed_at: detection.observed_at,
      executable: detection.selected_executable,
    };
  }

  // CLI가 실패했거나 이 제품 항목이 없을 때.
  function unknownView(id: HarnessName): HarnessSettingsView {
    const facts = deps.catalog.facts(id);
    return {
      harness_id: id,
      label: facts.label,
      discovery: "unknown",
      version: null,
      version_result: "unknown",
      can_deliver_messages: facts.can_deliver_messages,
    };
  }

  // 감지가 성공한 마지막 결과. 실패 결과는 쥐지 않아서 다음 읽기가 다시 감지한다.
  let last: readonly HarnessSettingsView[] | null = null;

  async function run(mode: "detect" | "refresh") {
    const fail = () => ({
      views: HARNESS_IDS.map((id) => unknownView(id)),
      detections: null,
    });
    if (deps.cli === null) return fail();
    const ran = await deps.cli(["harness", mode]);
    if (!ran.ok) return fail();
    if (!Array.isArray(ran.data)) {
      return fail();
    }
    const detections: Detection[] = [];
    for (const item of ran.data) {
      const parsed = deps.catalog.parse(item);
      if (parsed !== null) detections.push(parsed);
    }
    const views = HARNESS_IDS.map((id) => {
      const found = detections.find((item) => item.harness_id === id);
      return found === undefined ? unknownView(id) : viewOf(found);
    });
    return { views, detections };
  }

  async function take(mode: "detect" | "refresh") {
    const done = await run(mode);
    if (done.detections === null) return done.views;
    last = done.views;
    return done.views;
  }

  return {
    async read() {
      if (last === null) return { ok: true, value: await take("detect") };
      return { ok: true, value: last };
    },
    async refresh() {
      return { ok: true, value: await take("refresh") };
    },
  };
}
