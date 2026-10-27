import type { ProtectedRoots } from "./model.ts";

// home 전체는 보호 대상이 아니다. credential 폴더와 플랫폼 자료만 보호한다.
// 경로는 호출자가 푼 실제 절대 경로다.

const CREDENTIAL_DIRS = [".ssh", ".aws", ".gnupg"] as const;

export function credentialRoots(home: string): string[] {
  return CREDENTIAL_DIRS.map((name) => `${home}/${name}`);
}

// macOS 로그인 keychain과 사용자 keychain 폴더. 다른 OS에는 없다.
export function keychainRoots(home: string): string[] {
  return [`${home}/Library/Keychains`, "/Library/Keychains"];
}

export function protectedRoots(
  home: string,
  dataRoot: string,
  appRoots: readonly string[],
  sourceRoots: readonly string[],
): ProtectedRoots {
  return {
    credentialRoots: [...credentialRoots(home), ...keychainRoots(home)],
    dataRoot,
    appRoots,
    sourceRoots,
  };
}
