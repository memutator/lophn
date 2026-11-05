import { err, ok } from "../../base/mod.ts";
import { runList, runRead } from "../../protocol/runs/mod.ts";
import type { ReadDefinition } from "../../protocol/server/mod.ts";
import { listRuns, loadRun } from "./store.ts";

const PAGE = 50;

export function createRunReads(): {
  read: ReadDefinition<typeof runRead>;
  list: ReadDefinition<typeof runList>;
} {
  return {
    read: {
      route: runRead,
      handle(snapshot, _ctx, input) {
        const found = loadRun(snapshot.sql, input.run);
        if (!found.ok) return found;
        if (found.value === null) {
          return err({ code: "not_found", message: "run not found" });
        }
        return ok({
          run: found.value,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: runList,
      handle(snapshot, _ctx, input) {
        const loaded = listRuns(snapshot.sql, {
          ...(input.session === undefined ? {} : { session: input.session }),
          ...(input.agent === undefined ? {} : { agent: input.agent }),
          ...(input.workspace === undefined
            ? {}
            : { workspace: input.workspace }),
          ...(input.state === undefined ? {} : { state: input.state }),
          ...(input.cursor === undefined ? {} : { after: input.cursor }),
          limit: PAGE + 1,
        });
        if (!loaded.ok) return loaded;
        const page = loaded.value.slice(0, PAGE);
        return ok({
          runs: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            loaded.value.length > PAGE ? page[page.length - 1]!.id : null,
        });
      },
    },
  };
}
