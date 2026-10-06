// test 공통 도구. 앱 DB와 파일 폴더는 test 전용 임시 폴더에 만든다. 운영 DB와 다른 앱의 DB, 사람의 실제 폴더는 열지
// 않는다.
import { openStore } from "@lophn/cap-store";
import { defaults, type Deps } from "../src/deps.ts";

export const NOW = "2026-02-01T00:00:00.000Z";

export type Place = {
  data: string;
  exports: string;
  imports: string;
};

export async function withPlace<T>(
  work: (place: Place) => Promise<T>,
): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "app-todo-" });
  try {
    const place = {
      data: `${root}/data`,
      exports: `${root}/export`,
      imports: `${root}/import`,
    };
    for (const dir of Object.values(place)) await Deno.mkdir(dir);
    return await work(place);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

export function depsAt(place: Place, over: Partial<Deps> = {}): Deps {
  return {
    ...defaults,
    openStore: () =>
      openStore({ host: { mode: "test", dataPath: place.data } }),
    now: () => NOW,
    dirs: { export: place.exports, import: place.imports },
    views: new Map(),
    ...over,
  };
}
