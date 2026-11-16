// OS에 등록할 실행 경로 검증. 앱 바로가기(os-entry)와 옛 로그인 항목 옮기기(autostart-migrate)가 같이 쓴다.
import { accessSync, constants, statSync } from "node:fs";

/** 실행 경로 검증에 쓰는 파일 검사. */
export interface ExecutableProbe {
  /** 일반 파일이고 실행 권한이 있는지. 없거나 읽지 못하면 false. */
  isExecutableFile(path: string): boolean;
}

// 제어 문자와 따옴표는 어디서나 받지 않는다. Linux는 Exec quoting·field code에 걸리는
// 글자도 받지 않는다. escape 규칙에 기대지 않고 등록 자체를 거절한다(fail closed).
// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자와 따옴표를 등록 전에 거절한다.
const UNSAFE = /[\u0000-\u001f\u007f"]/;
const UNSAFE_EXEC = /[`$\\%]/;

type VerifiedPath =
  | { ok: true; path: string }
  | { ok: false; reason: "not_packaged" | "unverified_path" };

/** 등록할 실행 경로. packaged 실행 파일만, 절대 경로·실행 가능·안전한 글자일 때만. */
export function verifiedExecPath(os: {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** 실행 중인 앱의 실행 파일(Electron `process.execPath`). */
  execPath: string;
  /** Linux AppImage로 실행했을 때 그 파일. execPath는 임시 mount 안이라 쓰지 않는다. */
  appImage?: string;
  probe: ExecutableProbe;
}): VerifiedPath {
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
