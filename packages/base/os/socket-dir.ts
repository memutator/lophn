import { err, ok, type Result } from "../result.ts";
import type { OsPlatform } from "./home.ts";

type SocketDirectoryError = { code: "invalid_input"; message: string };

type SocketDirectoryDeps = {
  // data root마다 폴더를 나눈다. 같은 계정에서 lophn이 여럿 떠도 서로의 socket을 지우지 않는다.
  dataRoot: string;
  xdgRuntimeDir: string | undefined;
  // 사용자별 임시 디렉터리의 부모(보통 OS tmp).
  tempParent: string;
  uid: number;
  platform: OsPlatform;
  // 동기 SHA-256 hex. base는 node를 import하지 않아 호출하는 곳이 넘긴다.
  hash(text: string): string;
};

// POSIX는 XDG runtime이 있으면 거기를, 없으면 사용자별 임시 디렉터리를 쓴다. 두 경우 모두 data root의
// hash 앞 12자로 폴더를 나눈다. Windows는 폴더가 아니라 pipe 이름 공간이라 data root를 그대로 쓴다.
export function socketDirectoryPath(
  deps: SocketDirectoryDeps,
): Result<string, SocketDirectoryError> {
  // 이 값은 pipe 이름 hash에만 쓰인다. 같은 폴더를 core는 `C:\a\b`로, dev 도구는 `C:\a/b`로 받아 서로 다른 pipe를
  // 찾았다. Windows path는 구분자와 대소문자를 가리지 않으므로 그 차이를 지운다.
  if (deps.platform === "win32") {
    return ok(
      deps.dataRoot.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase(),
    );
  }
  if (!Number.isSafeInteger(deps.uid) || deps.uid < 0) {
    return err({ code: "invalid_input", message: "uid is not valid" });
  }
  const base =
    deps.xdgRuntimeDir && deps.xdgRuntimeDir.length > 0
      ? `${deps.xdgRuntimeDir}/lophn`
      : `${deps.tempParent}/lophn-${deps.uid}`;
  return ok(`${base}/${deps.hash(deps.dataRoot).slice(0, 12)}`);
}
