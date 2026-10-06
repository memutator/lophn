import { systemClock } from "../../packages/base/clock.ts";
import {
  type CatalogRefresher,
  type CatalogWorkInput,
  createCatalogRefresher,
  type FilesLike,
} from "../../packages/lophn-agent/harness/model/mod.ts";

export type CatalogRefresherHandle = CatalogRefresher;

// agent runtime 안의 catalog 갱신 연결. 갱신은 run을 막지 않는 single-flight이고
// network·시각·파일은 주입한다(architecture §5.3, R4).
export function startCatalogRefresher(
  input: {
    dataRoot: string;
    fetch?: typeof fetch;
    files?: FilesLike;
    clock?: { nowMs(): number };
  },
): CatalogRefresherHandle {
  const work: CatalogWorkInput = {
    dataRoot: input.dataRoot,
    clock: input.clock ?? systemClock,
    files: input.files ?? {
      readTextFile: (path) => Deno.readTextFile(path),
      writeTextFile: (path, text, options) =>
        Deno.writeTextFile(path, text, options),
      rename: (from, to) => Deno.rename(from, to),
      remove: (path) => Deno.remove(path),
      mkdir: (path, options) => Deno.mkdir(path, options),
    },
    loadSnapshot: () => snapshotFromBundle(),
    ...(input.fetch === undefined ? {} : { fetch: httpFetch(input.fetch) }),
  };
  return createCatalogRefresher(work);
}

// 동봉 snapshot은 모듈로 묶인 자산이다. runtime은 `--allow-read`가 data root뿐이라 소스 폴더의 파일을
// 읽지 못한다(architecture §3.2).
async function snapshotFromBundle() {
  const { parseEntries } = await import(
    "../../packages/lophn-agent/harness/model/mod.ts"
  );
  const bundled = await import(
    "../../packages/lophn-agent/harness/model/snapshot.json",
    { with: { type: "json" } }
  );
  const entries = parseEntries(JSON.stringify(bundled.default));
  if (entries === undefined) {
    throw new Error("동봉 snapshot을 해석하지 못했다");
  }
  return entries;
}

function httpFetch(
  impl: typeof fetch,
): (url: string, init: unknown) => Promise<{
  status: number;
  etag: string | null;
  bytes: Uint8Array;
}> {
  return async (url, init) => {
    // 실제 fetch는 이 프로세스의 공개 GET 경로다. credential·선택은 init에 없다(R6).
    const response = await impl(url, init as RequestInit);
    const etag = response.headers.get("etag");
    return {
      status: response.status,
      etag: etag === null ? null : etag.replace(/^"|"$/g, ""),
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  };
}
