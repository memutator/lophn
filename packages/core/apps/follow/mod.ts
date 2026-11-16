// 다른 기계의 새 release 따라가기(follow.ts)를 이 기계의 ledger와 앱 source 저장소에 잇는다.
// 언제 도는지(계기)와 폴더 쪽(앱 기록 사본, take-in)은 조립이 넘긴다.
import { ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { git } from "../../folder/apps/git.ts";
import {
  allowedConsents,
  waitingConsents,
} from "../releases/activation/consents.ts";
import { loadReleases } from "../releases/store.ts";
import {
  createFollow as createFollowLoop,
  type Follow,
  type FollowDeps,
} from "./follow.ts";

export type { Follow, FollowApp, FollowState } from "./follow.ts";
export type { OfferedRelease } from "./order.ts";

/** `ancestor`가 `descendant`의 조상(같은 commit 포함)인가. `"missing"`: `descendant`가 이 저장소에 아직 없다. */
export async function isAncestor(
  source: string,
  ancestor: string,
  descendant: string,
): Promise<Result<boolean | "missing">> {
  const found = await git(source, "cat-file", "-e", `${descendant}^{commit}`);
  if (!found.ok) return ok("missing");
  // ancestor에서 닿고 descendant에서 닿지 않는 commit이 없으면 조상이다.
  const outside = await git(
    source,
    "rev-list",
    "--max-count=1",
    ancestor,
    `^${descendant}`,
  );
  if (!outside.ok) return outside;
  return ok(outside.value === "");
}

export function createFollow(
  deps: Pick<FollowDeps, "apps" | "offered" | "takeIn" | "activate"> & {
    sql: Pick<Sql, "get" | "all">;
  },
): Follow {
  const { sql } = deps;
  return createFollowLoop({
    apps: deps.apps,
    offered: deps.offered,
    takeIn: deps.takeIn,
    activate: deps.activate,
    releases: (app: Id<"app">) => loadReleases(sql, { app }),
    consent(release) {
      if (allowedConsents(sql).some((row) => row.release === release)) {
        return "allowed";
      }
      return waitingConsents(sql).some((row) => row.release === release)
        ? "waiting"
        : null;
    },
    isAncestor,
  });
}
