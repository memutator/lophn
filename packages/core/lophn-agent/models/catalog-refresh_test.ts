import { assertEquals } from "@std/assert";
import { startCatalogRefresher } from "./catalog-refresh.ts";

// 자동 갱신을 끈 사람의 새 data root에서 models.dev 요청이 나가지 않는다(network 경계).
for (const autoUpdate of [false, true]) {
  Deno.test(`새 data root에서 autoUpdate=${autoUpdate}이면 catalog 요청이 ${autoUpdate ? "나간다" : "안 나간다"}`, async () => {
    const dataRoot = await Deno.makeTempDir();
    try {
      const refresher = startCatalogRefresher({
        dataRoot,
        autoUpdate,
        clock: { nowMs: () => Date.parse("2026-01-01T00:00:00Z") },
        fetch: () => Promise.resolve(new Response("down", { status: 500 })),
      });
      await refresher.kickAutoUpdate();
      const state = JSON.parse(
        await Deno.readTextFile(
          `${dataRoot}/derived/lophn-agent/catalog-state.json`,
        ),
      );
      assertEquals(state.auto_update, autoUpdate);
      assertEquals(state.last_failure, autoUpdate ? "unavailable" : null);
    } finally {
      await Deno.remove(dataRoot, { recursive: true });
    }
  });
}
