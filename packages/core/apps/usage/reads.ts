import { err, ok } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { type AppToolUse, appUsage } from "../../../protocol/apps/usage.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { archivedToAgent, loadApp, loadApps } from "../registration/mod.ts";
import { usagePorts } from "./ports.ts";
import { appToolUsers, order, workspaceKey } from "./users.ts";

export function createUsageReads(): ReadDefinition<typeof appUsage> {
  return {
    route: appUsage,
    handle(snapshot, ctx, input) {
      const ports = snapshot.port(usagePorts);
      const actor = parseActor(ctx.actor);
      // 다른 앱·project의 사용 관계는 경계를 넘어 보는 home의 lophn만 읽는다.
      if (
        actor?.kind === "agent" &&
        ports.sessionWorkspace(actor.id)?.workspace !== null
      ) {
        return err({
          code: "forbidden",
          message: "only a home session reads app usage",
        });
      }
      let apps;
      if (input.app === undefined) {
        const listed = loadApps(snapshot.sql, "active");
        if (!listed.ok) return listed;
        apps = listed.value.map((app) => app.id);
      } else {
        const one = loadApp(snapshot.sql, input.app);
        if (!one.ok) return one;
        if (
          one.value === null ||
          archivedToAgent(snapshot.sql, ctx, one.value.id)
        ) {
          return err({ code: "not_found", message: "app not found" });
        }
        apps = [one.value.id];
      }
      const uses: AppToolUse[] = [];
      for (const app of apps) {
        const users = appToolUsers(snapshot.sql, ports, app);
        if (!users.ok) return users;
        for (const user of users.value) uses.push({ app, ...user });
      }
      uses.sort(
        (a, b) =>
          order(a.app, b.app) ||
          order(a.tool, b.tool) ||
          order(workspaceKey(a.workspace), workspaceKey(b.workspace)),
      );
      return ok({
        uses,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
