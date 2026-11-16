// 옛 판의 "Start at login"(tray)이 남긴 OS 등록을 "Keep lophn running" 표시로 옮긴다. 옛 등록은 Linux XDG autostart의
// `lophn.desktop`(`--core`나 더 옛 `--tray` entry)과 macOS·Windows의 Electron login item이다. 이 file만 그 모양을 안다.
// 표시를 켜는 일이 성공한 뒤에만 옛 등록을 지운다: 실패하면 남겨 로그인 시작을 잃지 않고, 다음 실행이 다시 한다.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  type ExecutableProbe,
  verifiedExecPath,
} from "./os-entry/exec-path.ts";

const LEGACY_INTENTS = ["--core", "--tray"] as const;

export interface LegacyAutostartOs {
  platform: NodeJS.Platform;
  packaged: boolean;
  execPath: string;
  appImage?: string;
  /** `$XDG_CONFIG_HOME` 또는 `~/.config`. */
  configHome: string;
  probe: ExecutableProbe;
  files: {
    /** 없으면 undefined. */
    read(path: string): string | undefined;
    /** 없어도 오류가 아니다. */
    remove(path: string): void;
  };
  loginItems: {
    get(query: { path: string; args: string[] }): { openAtLogin: boolean };
    set(settings: { openAtLogin: boolean; path: string; args: string[] }): void;
  };
  log: (message: string) => void;
}

export interface KeepRunningMigration {
  os: LegacyAutostartOs;
  /** 표시를 켠다. 등록까지 이 기계 OS가 답했을 때만 true다. */
  turnOn(): Promise<boolean>;
  /** 옮기기가 끝났다. 사람에게 한 번 알릴 표지를 남긴다. */
  migrated(): void;
}

/** 옛 등록이 있으면 표시로 옮기고 옛 등록을 지운다. 개발 실행은 옛 등록을 만든 적이 없어 아무것도 하지 않는다. */
export async function migrateLegacyLogin(
  input: KeepRunningMigration,
): Promise<void> {
  const { os } = input;
  const verified = verifiedExecPath(os);
  if (!verified.ok) return;
  try {
    const legacy = findLegacy(os, verified.path);
    if (legacy === undefined) return;
    if (!(await input.turnOn())) {
      os.log(
        "옛 로그인 시작 등록을 Keep running으로 옮기지 못했다. 옛 등록을 남긴다",
      );
      return;
    }
    legacy.remove();
    input.migrated();
  } catch (error) {
    os.log(`옛 로그인 시작 등록을 옮기지 못했다: ${(error as Error).message}`);
  }
}

function findLegacy(
  os: LegacyAutostartOs,
  execPath: string,
): { remove(): void } | undefined {
  if (os.platform === "linux") {
    const file = join(os.configHome, "autostart", "lophn.desktop");
    const text = os.files.read(file);
    if (text === undefined || !/^Exec=.*\s--(?:core|tray)$/m.test(text)) {
      return undefined;
    }
    return { remove: () => os.files.remove(file) };
  }
  const enabled = LEGACY_INTENTS.filter(
    (intent) =>
      os.loginItems.get({ path: execPath, args: [intent] }).openAtLogin,
  );
  if (enabled.length === 0) return undefined;
  return {
    remove: () => {
      for (const intent of enabled) {
        os.loginItems.set({
          openAtLogin: false,
          path: execPath,
          args: [intent],
        });
      }
    },
  };
}

/** 실제 XDG autostart 파일 읽기·지우기. */
export const nodeLegacyFiles: LegacyAutostartOs["files"] = {
  read(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  remove(path) {
    rmSync(path, { force: true });
  },
};

// 옮겼다는 표지. 그 뒤 desktop 창이 처음 열릴 때 한 번 알리고 지운다.
const NOTICE_FILE = ["shell", "keep-running-notice.json"] as const;

export const keepRunningNotice = {
  mark(dataRoot: string): void {
    const file = join(dataRoot, ...NOTICE_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{}\n");
  },
  pending(dataRoot: string): boolean {
    return nodeLegacyFiles.read(join(dataRoot, ...NOTICE_FILE)) !== undefined;
  },
  clear(dataRoot: string): void {
    rmSync(join(dataRoot, ...NOTICE_FILE), { force: true });
  },
};
