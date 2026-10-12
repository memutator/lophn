// 준비 worker의 launch spec. 권한은 architecture/documents 2.2를 따른다: 현재 등록 root·working
// copy·staging의 read와 파일 작업에 필요한 경로의 write뿐이고 network·env·subprocess·FFI는
// 없다. coordinator가 자기 근거(등록 root)로 만든다. core의 workerSpecs가 선언한 같은 kind의
// spec과 같은 entry·한도를 쓴다.
import { checkLaunchSpec } from "../../../packages/core/supervision/security/mod.ts";
import type { KindLaunchSpec } from "../../../packages/protocol/platform/mod.ts";
import { PREPARATION_KIND } from "./pool.ts";

const ENTRY = new URL("./preparation-entry.ts", import.meta.url).pathname;
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

// child가 코드와 deno 캐시를 올리는 읽기. 사용자 root가 아니다.
function codeReads(): string[] {
  const repo = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
  // 설치 묶음은 DENO_DIR로 ~/.cache/lophn/deno를 준다(install-and-update#R8).
  const home = Deno.env.get("HOME");
  let configured: string | undefined;
  try {
    configured = Deno.env.get("DENO_DIR");
  } catch { /* env 권한이 없는 worker는 spec을 쓰지 않는다 */ }
  const cache = configured ?? (home ? `${home}/.cache/deno` : "/tmp");
  return [repo, cache];
}

function specOf(
  reads: readonly string[],
  writes: readonly string[],
): KindLaunchSpec {
  return {
    kind: PREPARATION_KIND,
    entry: ENTRY,
    allow_read: [...new Set([...reads, ...codeReads()])],
    allow_write: [...new Set(writes)],
    allow_net: [],
    allow_run: [],
    allow_sys: [],
    allow_env: ["LOPHN_HOME", "LOPHN_WORKER_KIND"],
    policy: "on_request",
    memory_limit_bytes: MEMORY_LIMIT_BYTES,
  };
}

// 상시 slot의 spec. 현재 등록 root에서 읽고 쓰며 working copy 폴더와 staging에 쓴다.
export function preparationSpec(
  dataRoot: string,
  roots: readonly string[],
): KindLaunchSpec {
  const active = roots.filter((root) => root !== dataRoot);
  return specOf(
    [dataRoot, ...active],
    [
      `${dataRoot}/documents/staging`,
      `${dataRoot}/documents/working-copies`,
      // 전역 지침 파일 하나만 쓴다. data root 전체를 쓰지 않는다(임시 파일은 staging에 둔다).
      `${dataRoot}/LOPHN.md`,
      ...active,
    ],
  );
}

// 폴더 미리보기 한 번만 쓰는 worker의 spec. 읽기는 그 요청의 폴더뿐이고 쓰기는 없다.
// 아직 등록하지 않은 폴더라 상시 slot의 권한 밖이다. 폴더는 사람이 고른 것이라 요청마다
// 새 프로세스의 읽기 권한으로만 준다. 권한 목록에 넣을 수 없는 경로는 undefined다.
export function previewSpec(
  folders: readonly string[],
): KindLaunchSpec | undefined {
  const spec = specOf(folders, []);
  return checkLaunchSpec(spec).ok ? spec : undefined;
}
