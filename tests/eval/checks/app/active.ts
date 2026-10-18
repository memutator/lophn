import { appRuntime } from "../../../../packages/protocol/apps/mod.ts";
import {
  releasesGetRecord,
  releasesListRecords,
} from "../../../../packages/protocol/apps/activation/activation.ts";
import type { ProgramCheck } from "../../types.ts";
import { eventually, findApp, liveCheck } from "./live.ts";

// 켜진 직후일 수 있어 기다린다.
export function appActive(id: string, opts: { app: string }): ProgramCheck {
  return liveCheck(id, (core) =>
    eventually(async () => {
      const app = await findApp(core, opts.app);
      if (app.active_release === null) {
        return { pass: false, reason: "active release 없음" };
      }
      const { release } = await core.call(releasesGetRecord, {
        release: app.active_release,
      });
      if (release?.status !== "active") {
        return { pass: false, reason: `release 상태 ${release?.status}` };
      }
      const runtime = await core.call(appRuntime, { app: app.id });
      const seen = runtime.observation;
      const up = runtime.state.state === "running" && seen !== null &&
        seen.ready && seen.accepting;
      return up
        ? { pass: true, reason: `release ${release.number} 실행 중` }
        : { pass: false, reason: `runtime ${runtime.state.state}, 준비 안 됨` };
    }, 60_000));
}

// 고친 새 release가 active이고 옛 것은 superseded다.
export function releaseAdvanced(
  id: string,
  opts: { app: string; after: number },
): ProgramCheck {
  return liveCheck(id, async (core) => {
    const app = await findApp(core, opts.app);
    const { releases } = await core.call(releasesListRecords, { app: app.id });
    const active = releases.filter((r) => r.status === "active");
    const oldActive = active.filter((r) => r.number <= opts.after);
    const advanced = active.some((r) => r.number > opts.after);
    const numbers = releases.map((r) => `${r.number}:${r.status}`).join(" ");
    return {
      pass: advanced && oldActive.length === 0,
      reason: `release ${numbers} (기대: ${opts.after}보다 큰 번호가 active)`,
    };
  });
}
