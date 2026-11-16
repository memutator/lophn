// 앱을 OS 앱 바로가기로 등록하고 지운다. 각 OS 등록은 고정 앱 ID를
// `--open-app` intent로 lophn 실행 파일에 넘길 뿐이고 앱 코드·source path·token·port를
// 담지 않는다. packaged 실행 파일만 등록하고, OS 쪽은 주입한 adapter로만 만진다.
import { join } from "node:path";

import { type ExecutableProbe, verifiedExecPath } from "./exec-path.ts";
import { linuxEntry, linuxEntryPath } from "./linux.ts";
import { macBundleFiles, macBundlePath } from "./macos.ts";
import {
  type ShortcutOptions,
  windowsShortcut,
  windowsShortcutPath,
} from "./windows.ts";

export interface OsEntryApp {
  id: string;
  /** 사람에게 보이는 앱 이름. */
  name: string;
}

export interface EntryFiles {
  /** 디렉터리를 만들고 원자적으로 쓴다. */
  write(path: string, data: string, mode: number): void;
  /** 파일이나 폴더를 지운다. 없어도 오류가 아니다. */
  remove(path: string): void;
}

interface ShortcutLinks {
  /** Electron `shell.writeShortcutLink(path, "create", options)`. */
  write(path: string, options: ShortcutOptions): boolean;
}

export interface OsEntryEnv {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** headless 확인은 사람 장치의 OS에 아무것도 등록하지 않는다. */
  headless: boolean;
  execPath: string;
  appImage?: string;
  /** 사람 home. macOS `~/Applications`의 기준이다. */
  home: string;
  /** Linux `$XDG_DATA_HOME` 또는 `~/.local/share`. */
  dataHome: string;
  /** Windows `%APPDATA%`. */
  appData: string;
  probe: ExecutableProbe;
  files: EntryFiles;
  shortcuts: ShortcutLinks;
  log?: (message: string) => void;
}

export type OsEntryResult =
  | { ok: true; path: string }
  | {
      ok: false;
      reason:
        | "not_packaged"
        | "unverified_path"
        | "invalid_app"
        | "unsupported"
        | "os_failed";
    };

const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
// script·Exec 안에서 뜻을 갖는 글자. escape에 기대지 않고 등록을 거절한다.
const SHELL_UNSAFE = /[`$\\%]/;

function entryPath(env: OsEntryEnv, app: string): string | undefined {
  switch (env.platform) {
    case "linux":
      return linuxEntryPath(env.dataHome, app);
    case "darwin":
      return macBundlePath(env.home, app);
    case "win32":
      return windowsShortcutPath(env.appData, app);
    default:
      return undefined;
  }
}

function verified(env: OsEntryEnv): OsEntryResult {
  if (env.headless) return { ok: false, reason: "not_packaged" };
  const exec = verifiedExecPath(env);
  if (!exec.ok) return exec;
  if (env.platform !== "win32" && SHELL_UNSAFE.test(exec.path)) {
    return { ok: false, reason: "unverified_path" };
  }
  return { ok: true, path: exec.path };
}

/** 앱 바로가기를 쓴다. 같은 앱의 이전 등록은 덮어쓴다. */
export function installOsEntry(
  env: OsEntryEnv,
  app: OsEntryApp,
): OsEntryResult {
  if (!APP_ID.test(app.id)) return { ok: false, reason: "invalid_app" };
  const path = entryPath(env, app.id);
  if (path === undefined) return { ok: false, reason: "unsupported" };
  const exec = verified(env);
  if (!exec.ok) return exec;
  const named = { id: app.id, name: app.name.trim() || "lophn app" };
  try {
    if (env.platform === "linux") {
      env.files.write(path, linuxEntry(exec.path, named), 0o644);
    } else if (env.platform === "darwin") {
      for (const file of macBundleFiles(exec.path, named)) {
        env.files.write(join(path, file.path), file.data, file.mode);
      }
    } else if (!env.shortcuts.write(path, windowsShortcut(exec.path, named))) {
      return { ok: false, reason: "os_failed" };
    }
  } catch (error) {
    env.log?.(`앱 바로가기를 쓰지 못했다: ${(error as Error).message}`);
    return { ok: false, reason: "os_failed" };
  }
  return { ok: true, path };
}

/** 앱 바로가기를 지운다. 없어도 성공이다. */
export function removeOsEntry(env: OsEntryEnv, app: string): OsEntryResult {
  if (!APP_ID.test(app)) return { ok: false, reason: "invalid_app" };
  const path = entryPath(env, app);
  if (path === undefined) return { ok: false, reason: "unsupported" };
  if (env.headless) return { ok: false, reason: "not_packaged" };
  try {
    env.files.remove(path);
  } catch (error) {
    env.log?.(`앱 바로가기를 지우지 못했다: ${(error as Error).message}`);
    return { ok: false, reason: "os_failed" };
  }
  return { ok: true, path };
}
