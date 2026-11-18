// Settings › Coding agents의 core 쪽(`coding_agents/list|refresh`). `lophn harness detect|refresh`를 exec로 불러 제품마다 감지
// 결과를 읽고 `HarnessSettingsView`로 바꾼다. 감지 결과는 CLI도 저장하지 않아서 이 module이 마지막 결과만 메모리에 쥔다.
//
// 처음 읽기는 `detect`(실행 파일 찾기만), 사람이 누른 [Detect again]만 `refresh`(version probe)다.
// 화면이 열릴 때 자동 재감지는 없다. 연결을 만들거나 설치하는 길은 없다.
import { execFile } from "node:child_process";

import { cmdShimCommand } from "../../base/os/mod.ts";
import {
  canDeliverMessages,
  HARNESS_ADAPTERS,
} from "../../protocol/coding-agent/harness-adapter.ts";
import {
  HARNESS_IDS,
  type HarnessDetection,
  type HarnessId,
  harnessDetectionSchema,
} from "../../protocol/coding-agent/harnesses.ts";
import type { HarnessSettingsView } from "../../protocol/coding-agent/coding-agents.ts";

type ExecFile = (
  file: string,
  args: string[],
  options: { env: Record<string, string>; timeout: number; maxBuffer: number },
) => Promise<{ code: number | null; stdout: string }>;

// Node는 shell 없이 .cmd·.bat를 실행하지 못한다(win32, 설치본의 `bin\lophn.cmd`와 개발 실행의 `lophn.cmd`).
// hook 설치는 JSON 인자를 넘기므로 cmd.exe용으로 escape해서 띄운다.
const defaultExec: ExecFile = (file, args, options) =>
  new Promise((resolve) => {
    const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
    const run = shim
      ? cmdShimCommand(process.env.ComSpec ?? "cmd.exe", file, args)
      : { command: file, args };
    execFile(
      run.command,
      run.args,
      { ...options, windowsVerbatimArguments: shim },
      (error, stdout) => {
        const code =
          error === null
            ? 0
            : typeof (error as { code?: unknown }).code === "number"
              ? (error as { code: number }).code
              : null;
        resolve({ code, stdout: String(stdout) });
      },
    );
  });

/** `lophn <args> --json`이 찍은 값 그대로(성공은 감싸지 않는다). 실패하면 `{error}`의 이유 한 줄. */
export type CliRun = (
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

export type HarnessSettings = {
  /** 마지막 감지 결과. 아직 없으면 `detect`를 한 번 돌린다. */
  read(): Promise<HarnessSettingsView[]>;
  /** 사람이 누른 [Detect again]. `refresh`를 돌려 마지막 결과를 바꾼다. */
  refresh(): Promise<HarnessSettingsView[]>;
};

const factsOf = (id: HarnessId) => ({
  label: HARNESS_ADAPTERS[id].label,
  can_deliver_messages: canDeliverMessages(id),
});

function viewOf(detection: HarnessDetection): HarnessSettingsView {
  return {
    harness_id: detection.harness_id,
    ...factsOf(detection.harness_id),
    discovery: detection.discovery,
    version: detection.version.value,
    version_result: detection.version.result,
    observed_at: detection.observed_at,
    executable: detection.selected_executable,
  };
}

// CLI가 실패했거나 이 제품 항목이 없을 때.
function unknownView(id: HarnessId): HarnessSettingsView {
  return {
    harness_id: id,
    ...factsOf(id),
    discovery: "unknown",
    version: null,
    version_result: "unknown",
  };
}

/** `cli`는 `lophn` child다. 설치 경로를 모르면 null이다. */
export function createHarnessSettings(cli: CliRun | null): HarnessSettings {
  // 감지가 성공한 마지막 결과. 실패 결과는 쥐지 않아서 다음 읽기가 다시 감지한다.
  let last: HarnessSettingsView[] | null = null;

  async function take(mode: "detect" | "refresh") {
    const ran = cli === null ? null : await cli(["harness", mode]);
    if (ran === null || !ran.ok || !Array.isArray(ran.data)) {
      return HARNESS_IDS.map(unknownView);
    }
    const detections = ran.data.flatMap((item) => {
      const parsed = harnessDetectionSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    last = HARNESS_IDS.map((id) => {
      const found = detections.find((item) => item.harness_id === id);
      return found === undefined ? unknownView(id) : viewOf(found);
    });
    return last;
  }

  return {
    read: async () => last ?? (await take("detect")),
    refresh: () => take("refresh"),
  };
}
