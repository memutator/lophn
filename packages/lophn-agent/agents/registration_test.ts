import { ok } from "../../base/mod.ts";
import type { LedgerTestRegistration } from "../../../apps/core/testing/ledger.ts";
import type {
  AgentRole,
  AgentSettings,
  McpTool,
} from "../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../protocol/platform/mod.ts";
import { createNodeAgentFiles } from "./adapters/node-fs.ts";
import {
  type AgentFileSystem,
  type AgentLookups,
  type AssignmentRef,
  createAgentCommands,
  createAgentReads,
} from "./mod.ts";

// agents ledger 시험 등록. 파일은 실제 임시 폴더(ledger 파일이 있는 폴더가 data root다)에 쓰고,
// 다른 concern(assignment 표, context, skill·MCP 등록, Workspace 층)은 고정한 값으로 갈음한다.
// writer와 reader는 이 module을 따로 올리므로 상태를 module에 두지 않고 assignment 표만 ledger에 둔다.

const DATA = new URL("./testdata/", import.meta.url);

function json<T>(path: string): T {
  return JSON.parse(Deno.readTextFileSync(new URL(path, DATA))) as T;
}

type Environment = {
  role_caps: Record<AgentRole, string[]>;
  mcp: McpTool[];
  skills: string[];
};

const ENV = json<Environment>("environment.json");
const WORKSPACE = json<AgentSettings>("workspace.json");

export const PRJ = "prj_01arz3ndektsv4rrffq69g5fa1";
export const OTHER_PRJ = "prj_01arz3ndektsv4rrffq69g5fa9";
export const APP = "app_01arz3ndektsv4rrffq69g5fa2";
export const ASG = {
  lophn: "asg_01arz3ndektsv4rrffq69g5fa3",
  context_engineer: "asg_01arz3ndektsv4rrffq69g5fa4",
  app_engineer: "asg_01arz3ndektsv4rrffq69g5fa5",
  reviewer: "asg_01arz3ndektsv4rrffq69g5fa6",
  scribe: "asg_01arz3ndektsv4rrffq69g5fa7",
  watcher: "asg_01arz3ndektsv4rrffq69g5fa8",
  other_project: "asg_01arz3ndektsv4rrffq69g5fb5",
  withdrawn: "asg_01arz3ndektsv4rrffq69g5fb6",
};
export const CTX = {
  one: "ctx_01arz3ndektsv4rrffq69g5fb1",
  two: "ctx_01arz3ndektsv4rrffq69g5fb2",
  archived: "ctx_01arz3ndektsv4rrffq69g5fb3",
  drafting: "ctx_01arz3ndektsv4rrffq69g5fb4",
  // 다른 project의 active context.
  foreign: "ctx_01arz3ndektsv4rrffq69g5fb7",
};

// 본문에 이 글이 있으면 쓰기와 지우기가 실패한다. 임시 파일이나 rename이 실패한 디스크를 갈음한다.
export const FAIL_MARKER = "[[fail the disk]]";

function failingFiles(): AgentFileSystem {
  const real = createNodeAgentFiles();
  return {
    read: (path) => real.read(path),
    writeAtomic(path, text) {
      if (text.includes(FAIL_MARKER)) throw new Error("disk failure");
      real.writeAtomic(path, text);
    },
    remove(path) {
      if (real.read(path)?.includes(FAIL_MARKER)) {
        throw new Error("disk failure");
      }
      real.remove(path);
    },
  };
}

const STEP = `
create table assignments (
  id text primary key,
  role text not null,
  scope_kind text not null,
  scope_id text,
  state text not null,
  revision integer not null
) strict;
insert into assignments values
  ('${ASG.lophn}', 'lophn', 'all', null, 'enabled', 1),
  ('${ASG.context_engineer}', 'context_engineer', 'all', null, 'enabled', 1),
  ('${ASG.app_engineer}', 'app_engineer', 'app', '${APP}', 'enabled', 1),
  ('${ASG.reviewer}', 'operator', 'project', '${PRJ}', 'enabled', 1),
  ('${ASG.scribe}', 'operator', 'project', '${PRJ}', 'enabled', 1),
  ('${ASG.watcher}', 'operator', 'app', '${APP}', 'enabled', 1),
  ('${ASG.other_project}', 'operator', 'project', '${OTHER_PRJ}', 'enabled', 1),
  ('${ASG.withdrawn}', 'operator', 'project', '${PRJ}', 'withdrawn', 2);`;

type Sql = Pick<Tx["sql"], "get" | "all">;

function refOf(row: Record<string, unknown>): AssignmentRef {
  return {
    id: String(row["id"]),
    role: String(row["role"]) as AgentRole,
    scope: row["scope_kind"] === "all" ? { kind: "all" } : {
      kind: String(row["scope_kind"]) as "project" | "app",
      id: String(row["scope_id"]),
    },
    state: String(row["state"]) as AssignmentRef["state"],
    revision: Number(row["revision"]),
  };
}

function lookups(sql: Sql): AgentLookups {
  return {
    placeExists: (place) =>
      place.id === PRJ || place.id === OTHER_PRJ || place.id === APP,
    assignments: (place) =>
      sql.all(
        `select * from assignments where state != 'withdrawn'
           and (scope_kind = 'all' or (scope_kind = ? and scope_id = ?))
         order by id`,
        [place.kind, place.id],
      ).map(refOf),
    assignment: (id) => {
      const row = sql.get("select * from assignments where id = ?", [id]);
      return row === undefined ? null : refOf(row);
    },
    contextStatus: (id) =>
      id === CTX.one || id === CTX.two || id === CTX.foreign
        ? "active"
        : id === CTX.archived
        ? "archived"
        : id === CTX.drafting
        ? "drafting"
        : null,
    contextProject: (id) =>
      id === CTX.foreign
        ? OTHER_PRJ
        : id === CTX.one || id === CTX.two || id === CTX.archived ||
            id === CTX.drafting
        ? PRJ
        : null,
    activeContexts: (place) =>
      place.kind === "project" ? [CTX.one, CTX.two] : [],
    skills: () => ENV.skills,
    mcp: () => ENV.mcp,
    workspace: () => WORKSPACE,
  };
}

export function createLedgerTestRegistration(): LedgerTestRegistration {
  const deps = {
    files: failingFiles(),
    lookups,
    assignmentWriter: (tx: Tx) => ({
      createOperator(place: { kind: string; id: string }) {
        const id = tx.newId("asg");
        tx.sql.run(
          "insert into assignments values (?, 'operator', ?, ?, 'enabled', 1)",
          [id, place.kind, place.id],
        );
        return ok(id);
      },
      withdraw(id: string) {
        tx.sql.run(
          "update assignments set state = 'withdrawn', revision = revision + 1 where id = ?",
          [id],
        );
        return ok(undefined);
      },
    }),
    roleCaps: (role: AgentRole) => ENV.role_caps[role],
  };
  const commands = createAgentCommands(deps);
  const reads = createAgentReads(deps);
  return {
    schemaSteps: [{ id: "agents.test.assignments", sql: STEP }],
    commands: [commands.save, commands.delete, commands.changeSettings],
    reads: [reads.list, reads.read, reads.settings],
  };
}
