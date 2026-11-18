// harness의 전역 hook을 놓는 흐름. 열 때 `dry_run`으로 있는지만 보고, 없으면 사람에게 한 번 물은 뒤 놓는다
// (사람 터미널이 harness를 처음 알아봤을 때 쓴다). 묻기는 `HookInstallAsked`를 받은 lophn 창의 dialog다. Settings의 상태 보기
// (`harness status` 한 번으로 모든 harness), [Install hooks], [Uninstall hooks]도 같은 CLI 호출이다. 묻거나 놓기가 실패해도
// 호출한 쪽은 막지 않는다.
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

/** terminalRef는 사람 터미널이 harness를 알아본 길에서만 있다. 묻는 창을 고르는 데 쓴다. */
export type HookRegister = {
  ask(input: {
    harness: string;
    files: string[];
    terminalRef?: string;
  }): Promise<boolean>;
  show(input: {
    harness: string;
    ok: boolean;
    files: string[];
    message?: string;
    terminalRef?: string;
  }): void;
};

export type HookInstallerDeps = {
  /** `lophn` CLI. 설치 경로를 모르면 null이고 아무것도 놓지 않는다. */
  runCli: CliRun | null;
  /** 개발 실행의 hook command(절대 경로). packaged는 없고 PATH의 `lophn`이다. */
  hookCommand?: string;
  /** 그 harness에 전역 hook 자리가 있는지. */
  hasHook(harness: string): boolean;
  /** 사람에게 묻고 결과를 보인다. 없으면 묻지 않고 놓지 않는다. */
  register?: HookRegister;
  /** hook을 놓거나 지웠다. 공유 skill 사본이 hook이 놓인 harness를 따르므로 다시 맞춘다. */
  changed?(): void;
};

export type HookInstaller = {
  /** 없으면 사람에게 묻고 놓는다. 같은 harness가 동시에 와도 묻는 창은 하나다. */
  ensureRegistered(harness: string, terminalRef?: string): Promise<void>;
  /** 이 core 실행에서 harness마다 한 번만 `ensureRegistered`를 부른다. */
  ensureOnce(harness: string, terminalRef?: string): void;
  status(): Promise<HarnessHookView[]>;
  /** 사람이 [Install hooks]를 눌렀다. 누른 것이 허락이라 묻지 않는다. */
  install(harness: HarnessId): Promise<HarnessHookView>;
  /** 사람이 [Uninstall hooks]를 눌렀다. 이 실행에서는 그 harness를 다시 묻지 않는다. */
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
  const asked = new Set<string>();

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
    const register = deps.register;
    if (deps.runCli === null || register === undefined) return;
    let files: string[];
    try {
      const seen = await runInstall(harness, true);
      const found = seen.ok ? installResult(seen.data) : null;
      if (found === null) return;
      if (found.skill !== "missing" && found.hook !== "missing") return;
      files = found.files;
      if (!(await register.ask({ harness, files, terminalRef }))) return;
    } catch {
      return;
    }
    // 허락한 뒤의 실패는 사람에게 보인다. 실패에도 놓으려던 file을 같이 보인다.
    let shown: Parameters<typeof register.show>[0];
    try {
      const done = await runInstall(harness, false);
      const wrote = done.ok ? installResult(done.data) : null;
      if (!done.ok) {
        shown = { harness, ok: false, files, message: done.message };
      } else if (wrote === null) {
        shown = { harness, ok: false, files, message: "unexpected result" };
      } else {
        // skill 단계는 옛 skill 사본 지우기라 지울 위치가 없는 harness는 not_supported다. 그것은 실패가 아니다.
        const ok =
          (wrote.hook === "installed" || wrote.hook === "unchanged") &&
          wrote.skill !== "failed";
        shown = {
          harness,
          ok,
          files: wrote.files,
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
      };
    }
    register.show({ ...shown, terminalRef });
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
    // 사람이 지웠으니 이 실행에서 터미널이 그 harness를 알아봐도 다시 묻지 않는다.
    asked.add(harness);
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
      if (!deps.hasHook(harness) || asked.has(harness)) return;
      asked.add(harness);
      void ensureRegistered(harness, terminalRef);
    },
    status,
    install: (harness) => run(harness, false),
    uninstall,
  };
}
