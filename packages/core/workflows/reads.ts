import { err, ok, parseSeq } from "../../base/mod.ts";
import type { ReadDefinition } from "../../protocol/server/mod.ts";
import {
  workflowInstanceActivity,
  workflowInstanceList,
  workflowInstanceRead,
} from "../../protocol/workflows/mod.ts";
import {
  hasActivity,
  lastLine,
  lastReports,
  listInstances,
  loadInstance,
  loadLines,
} from "./store.ts";

const LINES = 200;
const PAGE = 50;

export function createWorkflowReads(): {
  read: ReadDefinition<typeof workflowInstanceRead>;
  list: ReadDefinition<typeof workflowInstanceList>;
  activity: ReadDefinition<typeof workflowInstanceActivity>;
} {
  return {
    read: {
      route: workflowInstanceRead,
      handle(snapshot, _ctx, input) {
        let after = 0;
        if (input.cursor !== undefined) {
          const seq = parseSeq(input.cursor);
          if (!seq.ok) {
            return err({ code: "invalid_input", message: "invalid cursor" });
          }
          after = Number(seq.value);
        }
        const found = loadInstance(snapshot.sql, input.instance);
        if (!found.ok) return found;
        if (found.value === null) {
          return err({
            code: "not_found",
            message: "workflow instance not found",
          });
        }
        const reports = lastReports(snapshot.sql, input.instance);
        if (!reports.ok) return reports;
        const loaded = loadLines(snapshot.sql, input.instance, {
          after,
          limit: LINES + 1,
        });
        if (!loaded.ok) return loaded;
        const lines = loaded.value.slice(0, LINES);
        return ok({
          instance: found.value,
          last_reports: reports.value,
          lines,
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            loaded.value.length > LINES ? lines[lines.length - 1]!.seq : null,
        });
      },
    },
    list: {
      route: workflowInstanceList,
      handle(snapshot, _ctx, input) {
        const loaded = listInstances(snapshot.sql, {
          project: input.project,
          ...(input.workflow === undefined ? {} : { workflow: input.workflow }),
          ...(input.state === undefined ? {} : { state: input.state }),
          ...(input.cursor === undefined ? {} : { after: input.cursor }),
          limit: PAGE + 1,
        });
        if (!loaded.ok) return loaded;
        const page = loaded.value.slice(0, PAGE);
        const instances = [];
        for (const instance of page) {
          const last = lastLine(snapshot.sql, instance.id);
          if (!last.ok) return last;
          instances.push({
            id: instance.id,
            project: instance.project,
            workflow: instance.workflow,
            state: instance.state,
            current: instance.current,
            input: instance.input,
            started_by: instance.started_by,
            created_at: instance.created_at,
            finished_at: instance.finished_at,
            last_line: last.value,
          });
        }
        return ok({
          instances,
          as_of_seq: snapshot.as_of_seq,
          next_cursor:
            loaded.value.length > PAGE ? page[page.length - 1]!.id : null,
        });
      },
    },
    activity: {
      route: workflowInstanceActivity,
      handle(snapshot) {
        const busy = hasActivity(snapshot.sql);
        return busy.ok
          ? ok({
              busy: busy.value,
              as_of_seq: snapshot.as_of_seq,
              next_cursor: null,
            })
          : busy;
      },
    },
  };
}
