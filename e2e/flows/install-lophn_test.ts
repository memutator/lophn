// flow install-lophn의 Linux 단계(platform#T48): 설치된 .deb 묶음을 임시 HOME·LOPHN_HOME으로
// 시작해 본다. 설치 묶음은 `/opt/lophn`(또는 LOPHN_INSTALL_ROOT)에 실제로 설치돼 있어야 하고
// chrome-sandbox가 root 소유 4755여야 한다. 설치 전이면 이 시험은 통과가 아니라 건너뛴다:
// 풀어 놓은 묶음이나 sandbox를 끈 실행은 배포 시험 통과로 세지 않는다(install-and-update#R1).
//   1. sudo dpkg -i build/linux/lophn_<version>_amd64.deb (사람 또는 CI가 한다)
//   2. deno task e2e install-lophn
import { assertEquals } from "@std/assert";

import { checkSandboxFile } from "../../packages/platform/install-and-update/mod.ts";
import { displayAvailable } from "../harness.ts";

const repoRoot = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const root = Deno.env.get("LOPHN_INSTALL_ROOT") ?? "/opt/lophn";

function installed(): boolean {
  if (Deno.env.get("LOPHN_E2E") !== "1" || !displayAvailable()) return false;
  try {
    const stat = Deno.statSync(`${root}/chrome-sandbox`);
    return checkSandboxFile({
      uid: stat.uid ?? -1,
      gid: stat.gid ?? -1,
      mode: stat.mode ?? 0,
    }).ok;
  } catch {
    return false;
  }
}

Deno.test({
  name:
    "platform/install-and-update#R1: 설치된 Linux 묶음이 배치·Deno·cached-only 시작·cache 삭제·실제 sandbox 확인을 모두 통과한다",
  ignore: !installed(),
  async fn() {
    const verified = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        `${repoRoot}/tools/verify-linux-install.ts`,
        "--root",
        root,
      ],
      stdout: "inherit",
      stderr: "inherit",
    }).output();
    // 0은 모든 항목 통과, 1은 실패, 2는 미확인이 남음이다.
    assertEquals(verified.code, 0);
  },
});
