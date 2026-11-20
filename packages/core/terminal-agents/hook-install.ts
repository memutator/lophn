// harness의 전역 hook을 놓는 흐름. 터미널에서 harness를 처음 알아보거나 coding session을 열 때 `dry_run`으로
// 없는지만 보고, 없으면 묻지 않고 자동으로 놓는다(Settings에서 사람이 [Uninstall hooks]로 지운 harness는 opt-out으로
// 기억해 다시 놓지 않는다). Settings의 상태 보기(`harness status` 한 번으로 모든 harness), [Install hooks], [Uninstall hooks]도
// 같은 CLI 호출이다. 놓기가 실패해도 호출한 쪽은 막지 않는다.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HarnessHookView } from "../../protocol/coding-agent/coding-agents.ts";
import type { CliRun } from "./coding-connection.ts";
import {
  HARNESS_IDS,
  type HarnessId,
} from "../../protocol/coding-agent/harnesses.ts";

type Outcome =
  | "installed"
  | "unchanged"
  | "missing"
  | "failed"
  | "not_supported";
type Install = { skill: string; hook: string; files: string[] };

/** 사용자가 Settings에서 명시적으로 제거해 자동 설치에서 뺀 harness 목록. */
export type HookOptOut = {
  has(harness: string): boolean;
  add(harness: string): void;
  remove(harness: string): void;
};

/** data root 아래 JSON file로 opt-out 목록을 보존한다. 읽기·쓰기가 실패해도 hook 흐름을 막지 않는다. */
export function createFileHookOptOut(filePath: string): HookOptOut {
  const disabled = new Set<string>();
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === "string" && item.length > 0) disabled.add(item);
      }
    }
  } catch {
    // file이 없거나 깨졌으면 빈 목록으로 시작한다.
  }

  function save(): void {
    try {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, `${JSON.stringify([...disabled].sort())}\n`, {
        mode: 0o600,
      });
      renameSync(tmp, filePath);
    } catch {
      // 디스크 오류로 설치·제거 응답을 실패시키지 않는다.
    }
  }

  return {
    has: (harness) => disabled.has(harness),
    add(harness) {
      if (disabled.has(harness)) return;
      disabled.add(harness);
      save();
    },
    remove(harness) {
      if (!disabled.delete(harness)) return;
      save();
    },
  };
}

export type HookInstallResultNotice = {
  harness: string;
  ok: boolean;
  files: string[];
  message?: string;
  running: boolean;
  terminal?: string;
};

export type HookInstallerDeps = {
  /** `lophn` CLI. 설치 경로를 모르면 null이고 아무것도 놓지 않는다. */
  runCli: CliRun | null;
  /** 개발 실행의 hook command(절대 경로). packaged는 없고 PATH의 `lophn`이다. */
  hookCommand?: string;
  /** 그 harness에 전역 hook 자리가 있는지. */
  hasHook(harness: string): boolean;
  /** 사람이 Settings에서 지운 harness opt-out 저장소. */
  optOut?: HookOptOut;
  /** 자동 설치 결과를 알린다(선택). */
  onResult?(result: HookInstallResultNotice): void;
  /** hook을 놓거나 지웠다. 공유 skill 사본이 hook이 놓인 harness를 따르므로 다시 맞춘다. */
  changed?(): void;
};

export type HookInstaller = {
  /** 없으면 묻지 않고 자동으로 놓는다. 같은 harness가 동시에 와도 실행은 하나다. */
  ensureRegistered(harness: string, terminalRef?: string): Promise<void>;
  /** 이 core 실행에서 harness마다 한 번만 `ensureRegistered`를 부른다(opt-out이면 건너뛴다). */
  ensureOnce(harness: string, terminalRef?: string): void;
  status(): Promise<HarnessHookView[]>;
  /** 사람이 [Install hooks]를 눌렀다. opt-out을 풀고 놓는다. */
  install(harness: HarnessId): Promise<HarnessHookView>;
  /** 사람이 [Uninstall hooks]를 눌렀다. opt-out으로 기록해 다시 자동으로 놓지 않는다. */
  uninstall(harness: HarnessId): Promise<HarnessHookView>;
};

function installResult(data: unknown): Install | null {
  const value = data as Partial<Install> | null;
  if (
    typeof value?.skill !== "string" ||
    typeof value.hook !== "string" ||
    !Array.isArray(value.files) ||
    !value.files.every((file) => typeof file === "string")
  )
    return null;
  return { skill: value.skill, hook: value.hook, files: value.files };
}

export function createHookInstaller(deps: HookInstallerDeps): HookInstaller {
  const registering = new Map<string, Promise<void>>();
  const attempted = new Set<string>();

  function runInstall(harness: string, dryRun: boolean) {
    const input = {
      harness,
      ...(dryRun ? { dry_run: true } : {}),
      ...(deps.hookCommand === undefined ? {} : { command: deps.hookCommand }),
    };
    return deps.runCli!([
      "harness",
      "install",
      "--input",
      JSON.stringify(input),
    ]);
  }

  async function registerOnce(
    harness: string,
    terminalRef: string | undefined,
  ): Promise<void> {
    if (deps.runCli === null || deps.optOut?.has(harness)) return;
    let files: string[];
    try {
      const seen = await runInstall(harness, true);
      const found = seen.ok ? installResult(seen.data) : null;
      if (found === null) return;
      if (found.skill !== "missing" && found.hook !== "missing") return;
      files = found.files;
    } catch {
      return;
    }
    let shown: HookInstallResultNotice;
    try {
      const done = await runInstall(harness, false);
      const wrote = done.ok ? installResult(done.data) : null;
      if (!done.ok) {
        shown = {
          harness,
          ok: false,
          files,
          message: done.message,
          running: terminalRef !== undefined,
          ...(terminalRef === undefined ? {} : { terminal: terminalRef }),
        };
      } else if (wrote === null) {
        shown = {
          harness,
          ok: false,
          files,
          message: "unexpected result",
          running: terminalRef !== undefined,
          ...(terminalRef === undefined ? {} : { terminal: terminalRef }),
        };
      } else {
        // skill 단계는 옛 skill 사본 지우기라 지울 위치가 없는 harness는 not_supported다. 그것은 실패가 아니다.
        const ok =
          (wrote.hook === "installed" || wrote.hook === "unchanged") &&
          wrote.skill !== "failed";
        shown = {
          harness,
          ok,
          files: wrote.files,
          running: terminalRef !== undefined,
          ...(terminalRef === undefined ? {} : { terminal: terminalRef }),
          ...(ok
            ? {}
            : {
                message: `skill ${wrote.skill}, hook ${wrote.hook}`,
              }),
        };
      }
    } catch (error) {
      shown = {
        harness,
        ok: false,
        files,
        message: error instanceof Error ? error.message : "failed",
        running: terminalRef !== undefined,
        ...(terminalRef === undefined ? {} : { terminal: terminalRef }),
      };
    }
    deps.onResult?.(shown);
    deps.changed?.();
  }

  function ensureRegistered(
    harness: string,
    terminalRef?: string,
  ): Promise<void> {
    const running = registering.get(harness);
    if (running !== undefined) return running;
    const started = registerOnce(harness, terminalRef).finally(() =>
      registering.delete(harness),
    );
    registering.set(harness, started);
    return started;
  }

  const viewOf = (
    harness: HarnessId,
    outcome: Outcome | string,
    files: string[],
  ): HarnessHookView => ({
    harness_id: harness,
    status:
      outcome === "missing"
        ? "missing"
        : outcome === "unchanged" || outcome === "installed"
          ? "installed"
          : outcome === "failed"
            ? "failed"
            : "unsupported",
    files,
  });

  async function run(harness: HarnessId, dryRun: boolean) {
    const unsupported = viewOf(harness, "not_supported", []);
    if (deps.runCli === null || !deps.hasHook(harness)) return unsupported;
    if (!dryRun) deps.optOut?.remove(harness);
    try {
      const ran = await runInstall(harness, dryRun);
      const found = ran.ok ? installResult(ran.data) : null;
      if (!dryRun) deps.changed?.();
      return found === null
        ? viewOf(harness, "failed", [])
        : viewOf(harness, found.hook, found.files);
    } catch {
      return viewOf(harness, "failed", []);
    }
  }

  // 모든 harness를 CLI 한 번(`harness status`)으로 본다. harness마다 process를 띄우면 화면이 열릴 때마다 수십 개가 뜬다.
  async function status(): Promise<HarnessHookView[]> {
    const rows = new Map<string, Install>();
    let failed = false;
    if (deps.runCli !== null) {
      try {
        const ran = await deps.runCli([
          "harness",
          "status",
          "--input",
          JSON.stringify(
            deps.hookCommand === undefined ? {} : { command: deps.hookCommand },
          ),
        ]);
        if (ran.ok && Array.isArray(ran.data)) {
          for (const item of ran.data) {
            const found = installResult(item);
            const harness = (item as { harness?: unknown } | null)?.harness;
            if (found !== null && typeof harness === "string") {
              rows.set(harness, found);
            }
          }
        } else failed = true;
      } catch {
        failed = true;
      }
    }
    return HARNESS_IDS.map((id) => {
      if (deps.runCli === null || !deps.hasHook(id)) {
        return viewOf(id, "not_supported", []);
      }
      const found = rows.get(id);
      return failed || found === undefined
        ? viewOf(id, "failed", [])
        : viewOf(id, found.hook, found.files);
    });
  }

  async function uninstall(harness: HarnessId): Promise<HarnessHookView> {
    if (deps.runCli === null || !deps.hasHook(harness)) {
      return viewOf(harness, "not_supported", []);
    }
    // 사람이 지웠으니 영구 opt-out으로 기록해 다음 실행에서도 자동으로 다시 놓지 않는다.
    attempted.add(harness);
    deps.optOut?.add(harness);
    try {
      const ran = await deps.runCli([
        "harness",
        "uninstall",
        "--input",
        JSON.stringify({ harness }),
      ]);
      const done = ran.ok
        ? (ran.data as { hook?: unknown; files?: unknown } | null)
        : null;
      deps.changed?.();
      const files = Array.isArray(done?.files)
        ? done.files.filter((file): file is string => typeof file === "string")
        : [];
      // 지웠거나 지울 것이 없으면 이제 놓이지 않은 상태다.
      return done?.hook === "removed" || done?.hook === "unchanged"
        ? viewOf(harness, "missing", files)
        : viewOf(
            harness,
            done?.hook === "not_supported" ? "not_supported" : "failed",
            files,
          );
    } catch {
      return viewOf(harness, "failed", []);
    }
  }

  return {
    ensureRegistered,
    ensureOnce(harness, terminalRef) {
      if (
        !deps.hasHook(harness) ||
        attempted.has(harness) ||
        deps.optOut?.has(harness)
      )
        return;
      attempted.add(harness);
      void ensureRegistered(harness, terminalRef);
    },
    status,
    install: (harness) => run(harness, false),
    uninstall,
  };
}
