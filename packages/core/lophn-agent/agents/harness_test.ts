import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import type { Result } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";

// agents ledger 시험이 함께 쓰는 자격과 도움. 제품 코드와 mod.ts는 import하지 않는다.
// 파일은 harness의 임시 폴더(ledger 파일이 있는 폴더 = data root)에 둔다.

const OPERATIONS = [
  "SaveAgent",
  "DeleteAgent",
  "ChangePlaceAgentSettings",
  "ListAgents",
  "ReadAgent",
  "ReadPlaceAgentSettings",
  "CommandResult",
];

export const userCred: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

export const machineCred: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

export type AgentHarness = {
  h: LedgerHarness;
  root: string;
};

export async function openAgents(): Promise<AgentHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [
      new URL("./registration_test.ts", import.meta.url),
    ],
    credentials: [userCred, machineCred],
    nowMs: Date.UTC(2026, 0, 1),
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  const h = opened.value;
  const rows = value(
    await h.inspect(
      "select file from pragma_database_list where name = 'main'",
      [],
    ),
  );
  const file = String(rows[0]!["file"]);
  return { h, root: file.slice(0, file.lastIndexOf("/")) };
}

export function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

export function failure(result: Result<unknown>, code: string) {
  assert(
    !result.ok,
    result.ok ? "expected failure, got " + JSON.stringify(result.value) : "",
  );
  assertEquals(result.error.code, code);
  return result.error;
}

// invalid_input의 details.issues를 `field:code` 목록으로 줄여 비교하기 쉽게 한다.
export function issuesOf(result: Result<unknown>): string[] {
  const error = failure(result, "invalid_input");
  const issues = (error.details as {
    issues: { field: string; code: string }[];
  }).issues;
  return issues.map((issue) => `${issue.field}:${issue.code}`).sort();
}

let keys = 0;

export function envelope(command: string, input: unknown, compare: unknown) {
  keys++;
  return {
    command,
    input,
    compare,
    idempotency_key: `agents-${keys}`,
    prepared: [] as string[],
  };
}

export function placeDir(
  root: string,
  place: { kind: string; id: string },
): string {
  return `${root}/${
    place.kind === "project" ? "projects" : "apps"
  }/${place.id}/agents`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function writeAgentFile(
  root: string,
  place: { kind: string; id: string },
  file: string,
  text: string,
) {
  const dir = placeDir(root, place);
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(`${dir}/${file}`, text);
}

export function readAgentFile(
  root: string,
  place: { kind: string; id: string },
  file: string,
): string | null {
  try {
    return Deno.readTextFileSync(`${placeDir(root, place)}/${file}`);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

// 고정 fixture(`testdata/`)의 파일을 그대로 data root에 옮긴다.
export function seedFixtureFiles(root: string) {
  const data = new URL("./testdata/", import.meta.url);
  const copy = (
    place: { kind: string; id: string },
    from: string,
    file: string,
  ) =>
    writeAgentFile(
      root,
      place,
      file,
      Deno.readTextFileSync(new URL(from, data)),
    );
  const project = {
    kind: "project",
    id: "prj_01arz3ndektsv4rrffq69g5fa1",
  };
  const app = { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fa2" };
  const projectDir = "projects/prj_01arz3ndektsv4rrffq69g5fa1/agents/";
  const appDir = "apps/app_01arz3ndektsv4rrffq69g5fa2/agents/";
  for (
    const file of [
      "lophn.md",
      "context-engineer.md",
      "settings.md",
      "asg_01arz3ndektsv4rrffq69g5fa6.md",
      "asg_01arz3ndektsv4rrffq69g5fa7.md",
    ]
  ) {
    copy(project, `${projectDir}${file}`, file);
  }
  for (
    const file of [
      "app-engineer.md",
      "settings.md",
      "asg_01arz3ndektsv4rrffq69g5fa8.md",
    ]
  ) {
    copy(app, `${appDir}${file}`, file);
  }
}

export async function eventsOf(h: LedgerHarness, type: string) {
  const rows = value(
    await h.inspect(
      "select subject, actor, payload from events where type = ? order by seq",
      [type],
    ),
  );
  return rows.map((row) => ({
    subject: row["subject"] as string | null,
    actor: String(row["actor"]),
    payload: JSON.parse(String(row["payload"])) as Record<string, unknown>,
  }));
}

export async function assignmentRows(h: LedgerHarness) {
  return value(
    await h.inspect(
      "select id, role, scope_kind, scope_id, state, revision from assignments order by id",
      [],
    ),
  );
}
