// OS별 로그인 시작 항목 쓰기·읽기·지우기. 도는 core는 멈추지 않는다: unit을 stop하거나 job을 bootout하지 않는다
// (그 항목이 띄운 core가 이 core일 수 있다). 지금 띄우지도 않는다(lock을 잃은 둘째 core가 뜬다).
import {
  APPROVED_KEY,
  launchdDisabled,
  launchdLabel,
  launchdPlist,
  launchdPlistPath,
  RUN_KEY,
  regValue,
  type ServicePaths,
  safePaths,
  serviceKey,
  startupApprovedOff,
  systemdEnabled,
  systemdNoBus,
  systemdUnit,
  systemdUnitName,
  systemdUnitPath,
  systemRoot,
  windowsRunName,
  windowsRunValue,
} from "./entries.ts";
import type {
  AlwaysOnOsDeps,
  Registrar,
  Registration,
  ServiceEnv,
} from "./mod.ts";

/** `started`가 false면 명령을 띄우지 못했다(없는 명령). code null은 기한을 넘겼다. */
export type OsRun = (
  file: string,
  args: readonly string[],
) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
  started: boolean;
}>;

type Log = (command: string, code: number | null) => void;

const ABSENT: Registration = { state: "absent" };
const STALE: Registration = { state: "stale" };
const REGISTERED: Registration = { state: "registered" };
const OFF: Registration = { state: "off_in_system" };
const UNVERIFIED: Registration = {
  state: "unavailable",
  reason: "unverified_path",
};
const OS_FAILED: Registration = { state: "unavailable", reason: "os_failed" };
const NO_MANAGER: Registration = {
  state: "unavailable",
  reason: "no_service_manager",
};

export function createRegistrar(
  deps: AlwaysOnOsDeps,
  run: OsRun,
  log: Log,
): Registrar {
  const paths: ServicePaths = {
    execPath: deps.execPath,
    coreEntry: deps.coreEntry,
    dataRoot: deps.dataRoot,
  };
  const key = serviceKey(deps.platform, deps.dataRoot, deps.hash);
  const failed = (command: string, code: number | null) => {
    log(command, code);
    return OS_FAILED;
  };
  // file 읽기·쓰기가 던지면(권한 등) OS가 답하지 못한 것과 같다.
  const guarded =
    <A extends unknown[]>(step: (...args: A) => Promise<Registration>) =>
    async (...args: A): Promise<Registration> => {
      try {
        return await step(...args);
      } catch {
        return failed("file", null);
      }
    };
  const os = { deps, run, paths, key, failed };
  const registrar =
    deps.platform === "darwin"
      ? launchd(os)
      : deps.platform === "win32"
        ? windowsRun(os)
        : deps.platform === "linux"
          ? systemd(os)
          : unsupported();
  return {
    mechanism: registrar.mechanism,
    read: guarded(registrar.read),
    register: guarded(registrar.register),
    unregister: guarded(registrar.unregister),
  };
}

type Os = {
  deps: AlwaysOnOsDeps;
  run: OsRun;
  paths: ServicePaths;
  key: string;
  failed: (command: string, code: number | null) => Registration;
};

function unsupported(): Registrar {
  const answer = async () => OS_FAILED;
  return {
    mechanism: "systemd",
    read: answer,
    register: answer,
    unregister: answer,
  };
}

function systemd({ deps, run, paths, key, failed }: Os): Registrar {
  const unit = systemdUnitName(key);
  const file = systemdUnitPath(deps.home, deps.env.XDG_CONFIG_HOME, key);
  const systemctl = async (
    action: string,
    ...rest: string[]
  ): Promise<Registration | undefined> => {
    const answer = await run("systemctl", ["--user", action, ...rest]);
    if (!answer.started || systemdNoBus(answer.stderr)) return NO_MANAGER;
    if (answer.code !== 0) return failed(`systemctl ${action}`, answer.code);
    return undefined;
  };
  const read = async (env: ServiceEnv): Promise<Registration> => {
    if (!safePaths("linux", paths)) return UNVERIFIED;
    const text = await deps.files.read(file);
    if (text === undefined) return ABSENT;
    if (text !== systemdUnit(paths, env)) return STALE;
    const answer = await run("systemctl", ["--user", "is-enabled", unit]);
    if (!answer.started || systemdNoBus(answer.stderr)) return NO_MANAGER;
    // disabled는 exit 1이다. 답 글로 판정한다.
    const state = answer.code === null ? null : systemdEnabled(answer.stdout);
    if (state === null) return failed("systemctl is-enabled", answer.code);
    return state === "registered" ? REGISTERED : OFF;
  };
  return {
    mechanism: "systemd",
    read,
    async register(env) {
      if (!safePaths("linux", paths)) return UNVERIFIED;
      await deps.files.write(file, systemdUnit(paths, env), 0o644);
      // --now 없이 켠다. 도는 core가 lock을 쥐고 있다.
      const problem =
        (await systemctl("daemon-reload")) ?? (await systemctl("enable", unit));
      return problem ?? read(env);
    },
    async unregister() {
      if ((await deps.files.read(file)) === undefined) return ABSENT;
      const problem = await systemctl("disable", unit);
      // bus가 없으면 켤 수도 없었다. file만 지운다.
      if (problem && problem !== NO_MANAGER) return problem;
      await deps.files.remove(file);
      await systemctl("daemon-reload");
      return (await deps.files.read(file)) === undefined
        ? ABSENT
        : failed("remove unit", null);
    },
  };
}

function launchd({ deps, run, paths, key, failed }: Os): Registrar {
  const label = launchdLabel(key);
  const file = launchdPlistPath(deps.home, label);
  const domain = `gui/${deps.uid}`;
  const launchctl = async (
    ...args: string[]
  ): Promise<Registration | undefined> => {
    const answer = await run("/bin/launchctl", args);
    return answer.code === 0
      ? undefined
      : failed(`launchctl ${args[0]}`, answer.code);
  };
  const read = async (env: ServiceEnv): Promise<Registration> => {
    if (!safePaths("darwin", paths)) return UNVERIFIED;
    const text = await deps.files.read(file);
    if (text === undefined) return ABSENT;
    if (text !== launchdPlist(label, paths, env)) return STALE;
    const answer = await run("/bin/launchctl", ["print-disabled", domain]);
    if (answer.code !== 0) {
      return failed("launchctl print-disabled", answer.code);
    }
    return launchdDisabled(answer.stdout, label) ? OFF : REGISTERED;
  };
  return {
    mechanism: "launchd",
    read,
    async register(env) {
      if (!safePaths("darwin", paths)) return UNVERIFIED;
      await deps.files.write(file, launchdPlist(label, paths, env), 0o644);
      // bootstrap하지 않는다. 다음 로그인에 launchd가 ~/Library/LaunchAgents를 읽는다.
      return (await launchctl("enable", `${domain}/${label}`)) ?? read(env);
    },
    async unregister() {
      if ((await deps.files.read(file)) === undefined) return ABSENT;
      const problem = await launchctl("disable", `${domain}/${label}`);
      if (problem) return problem;
      await deps.files.remove(file);
      return (await deps.files.read(file)) === undefined
        ? ABSENT
        : failed("remove plist", null);
    },
  };
}

function windowsRun({ deps, run, paths, key, failed }: Os): Registrar {
  const name = windowsRunName(key);
  const reg = `${systemRoot(deps.env)}\\System32\\reg.exe`;
  // reg query는 값이 없으면 exit 1이다(오류 글은 OS 언어를 따라 읽지 않는다).
  const query = (path: string) => run(reg, ["query", path, "/v", name]);
  const read = async (_env: ServiceEnv): Promise<Registration> => {
    if (!safePaths("win32", paths)) return UNVERIFIED;
    const answer = await query(RUN_KEY);
    if (answer.code === 1) return ABSENT;
    if (answer.code !== 0) return failed("reg query", answer.code);
    const value = regValue(answer.stdout, name);
    if (!value) return failed("reg query", answer.code);
    if (value.type !== "REG_SZ" || value.data !== windowsRunValue(paths)) {
      return STALE;
    }
    const approved = await query(APPROVED_KEY);
    if (approved.code === 1) return REGISTERED;
    if (approved.code !== 0) return failed("reg query", approved.code);
    const binary = regValue(approved.stdout, name);
    const off = binary ? startupApprovedOff(binary.data) : null;
    if (off === null) return failed("reg query", approved.code);
    return off ? OFF : REGISTERED;
  };
  // 사람이 lophn에서 다시 켰거나 지웠으니 Startup apps의 끔도 푼다. 값이 없으면 exit 1이고 상관없다.
  const clearApproved = () =>
    run(reg, ["delete", APPROVED_KEY, "/v", name, "/f"]);
  return {
    mechanism: "windows_run",
    read,
    async register(env) {
      if (!safePaths("win32", paths)) return UNVERIFIED;
      const value = windowsRunValue(paths);
      const answer = await run(reg, [
        "add",
        RUN_KEY,
        "/v",
        name,
        "/t",
        "REG_SZ",
        "/d",
        value,
        "/f",
      ]);
      if (answer.code !== 0) return failed("reg add", answer.code);
      await clearApproved();
      return read(env);
    },
    async unregister() {
      const answer = await run(reg, ["delete", RUN_KEY, "/v", name, "/f"]);
      if (answer.code !== 0 && answer.code !== 1) {
        return failed("reg delete", answer.code);
      }
      await clearApproved();
      const left = await query(RUN_KEY);
      if (left.code === 1) return ABSENT;
      return failed("reg delete", left.code);
    },
  };
}
