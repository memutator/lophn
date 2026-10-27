// 로그인 자동 시작. 검증된 실행 경로와 창 없는 시작 intent `--tray`만
// OS에 등록한다. Linux는 XDG autostart entry, 그 외는 Electron login item이다. OS 쪽은
// 주입한 adapter로만 만진다. 상태의 정본은 OS 등록 자체이고 따로 설정 값을 두지 않는다.
import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { TRAY_INTENT } from "./launch-mode.ts";

/** XDG autostart 파일 이름. 같은 이름이 있으면 lophn의 것으로 본다. */
const AUTOSTART_FILE = "lophn.desktop";

type AutostartUnavailable =
  /** 개발 실행. 실행 파일이 Electron 자체라 앱으로 돌아오지 않는다. */
  | "not_packaged"
  /** 실행 경로가 절대 경로·실행 가능한 파일이 아니거나 등록에 쓸 수 없는 글자를 담는다. */
  | "unverified_path"
  /** OS가 등록을 거절했다. */
  | "os_failed";

export type AutostartState =
  | { available: true; enabled: boolean }
  | { available: false; enabled: false; reason: AutostartUnavailable };

/** 실행 경로 검증에 쓰는 파일 검사. */
export interface ExecutableProbe {
  /** 일반 파일이고 실행 권한이 있는지. 없거나 읽지 못하면 false. */
  isExecutableFile(path: string): boolean;
}

/** Linux XDG autostart 파일 다루기. */
interface AutostartFiles {
  /** 없으면 undefined. */
  read(path: string): string | undefined;
  /** 디렉터리를 만들고 원자적으로 쓴다. */
  write(path: string, data: string): void;
  /** 없어도 오류가 아니다. */
  remove(path: string): void;
}

/** macOS·Windows의 Electron login item. */
interface LoginItems {
  get(query: { path: string; args: string[] }): { openAtLogin: boolean };
  set(settings: { openAtLogin: boolean; path: string; args: string[] }): void;
}

export interface AutostartOs {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** 실행 중인 앱의 실행 파일(Electron `process.execPath`). */
  execPath: string;
  /** Linux AppImage로 실행했을 때 그 파일. execPath는 임시 mount 안이라 쓰지 않는다. */
  appImage?: string;
  /** `$XDG_CONFIG_HOME` 또는 `~/.config`. */
  configHome: string;
  probe: ExecutableProbe;
  files: AutostartFiles;
  loginItems: LoginItems;
  log?: (message: string) => void;
}

// 제어 문자와 따옴표는 어디서나 받지 않는다. Linux는 Exec quoting·field code에 걸리는
// 글자도 받지 않는다. escape 규칙에 기대지 않고 등록 자체를 거절한다(fail closed).
// deno-lint-ignore no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f"]/;
const UNSAFE_EXEC = /[`$\\%]/;

type VerifiedPath =
  | { ok: true; path: string }
  | { ok: false; reason: "not_packaged" | "unverified_path" };

/** 등록할 실행 경로. packaged 실행 파일만, 절대 경로·실행 가능·안전한 글자일 때만. */
export function verifiedExecPath(
  os: Pick<AutostartOs, "platform" | "packaged" | "execPath" | "appImage"> & {
    probe: ExecutableProbe;
  },
): VerifiedPath {
  if (!os.packaged) return { ok: false, reason: "not_packaged" };
  const candidate =
    os.platform === "linux" && os.appImage ? os.appImage : os.execPath;
  if (!isAbsolute(candidate, os.platform)) {
    return { ok: false, reason: "unverified_path" };
  }
  if (UNSAFE.test(candidate)) return { ok: false, reason: "unverified_path" };
  if (os.platform === "linux" && UNSAFE_EXEC.test(candidate)) {
    return { ok: false, reason: "unverified_path" };
  }
  if (!os.probe.isExecutableFile(candidate)) {
    return { ok: false, reason: "unverified_path" };
  }
  return { ok: true, path: candidate };
}

function isAbsolute(path: string, platform: NodeJS.Platform): boolean {
  if (platform === "win32") return /^[A-Za-z]:\\/.test(path);
  return path.startsWith("/");
}

/** XDG autostart entry. Exec는 따옴표로 묶은 실행 경로와 `--tray`뿐이다. */
function desktopEntry(execPath: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=lophn",
    `Exec="${execPath}" ${TRAY_INTENT}`,
    "X-GNOME-Autostart-enabled=true",
    "NoDisplay=false",
    "",
  ].join("\n");
}

function autostartPath(configHome: string): string {
  return join(configHome, "autostart", AUTOSTART_FILE);
}

/** 지금 OS 등록 상태. 등록이 지금 검증된 경로·intent와 다르면 켜지지 않은 것으로 본다. */
export function readAutostart(os: AutostartOs): AutostartState {
  const verified = verifiedExecPath(os);
  if (!verified.ok) {
    return { available: false, enabled: false, reason: verified.reason };
  }
  try {
    if (os.platform === "linux") {
      const current = os.files.read(autostartPath(os.configHome));
      return {
        available: true,
        enabled: current === desktopEntry(verified.path),
      };
    }
    const item = os.loginItems.get({
      path: verified.path,
      args: [TRAY_INTENT],
    });
    return { available: true, enabled: item.openAtLogin };
  } catch (error) {
    os.log?.(`자동 시작 상태를 읽지 못했다: ${(error as Error).message}`);
    return { available: false, enabled: false, reason: "os_failed" };
  }
}

/** 켜기·끄기. 끝나면 OS에서 다시 읽은 상태를 돌려준다. */
export function writeAutostart(
  os: AutostartOs,
  enabled: boolean,
): AutostartState {
  const verified = verifiedExecPath(os);
  if (!verified.ok) {
    return { available: false, enabled: false, reason: verified.reason };
  }
  try {
    if (os.platform === "linux") {
      const file = autostartPath(os.configHome);
      if (enabled) os.files.write(file, desktopEntry(verified.path));
      else os.files.remove(file);
    } else {
      os.loginItems.set({
        openAtLogin: enabled,
        path: verified.path,
        // macOS는 args를 넘기지 못한다. 시작할 때 wasOpenedAtLogin으로 창 없는
        // 시작을 안다(launch-mode).
        args: [TRAY_INTENT],
      });
    }
  } catch (error) {
    os.log?.(`자동 시작을 바꾸지 못했다: ${(error as Error).message}`);
    return { available: false, enabled: false, reason: "os_failed" };
  }
  return readAutostart(os);
}

/** 실제 파일 검사. 테스트는 가짜 probe를 준다. */
export const nodeExecutableProbe: ExecutableProbe = {
  isExecutableFile(path) {
    try {
      if (!statSync(path).isFile()) return false;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
};

/** 실제 XDG autostart 파일 다루기. 같은 디렉터리의 임시 파일을 rename해 원자적으로 쓴다. */
export const nodeAutostartFiles: AutostartFiles = {
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  write(path, data) {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, data, { mode: 0o644 });
    renameSync(temp, path);
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};
