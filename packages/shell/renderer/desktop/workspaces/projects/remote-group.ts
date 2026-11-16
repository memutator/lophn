// A window of another machine (M) groups M's projects with this computer's by the cross-machine id. Both lists are whole
// `project.list` replies; the caller keeps the last good one of each, so a failed read never drops a group.
import { matchProjects } from "../../../../../protocol/projects/identity.ts";

/** The fields of a `project.list` record this needs. An older M has no `identity` or `remote`: both read as null. */
export interface ProjectRow {
  readonly id: string;
  readonly title: string;
  readonly identity?: string | null;
  readonly remote?: { readonly key: string; readonly url: string } | null;
}

export type RemoteGroup =
  /** The same project is here too (same id file). */
  | {
      readonly kind: "same";
      readonly here: { readonly id: string; readonly title: string };
    }
  /** Only on M, with an id: it can be cloned here. `url` is null when M's repository has no remote to clone from. */
  | {
      readonly kind: "remoteOnly";
      readonly identity: string;
      readonly url: string | null;
    }
  /** Not linked by an id, but the git remote is the same as a project here. Only a suggestion. */
  | {
      readonly kind: "suggested";
      readonly here: { readonly id: string; readonly title: string };
    };

/** M's project id → its group. Projects of M without an id and without a match have none. */
export function groupProjects(
  here: readonly ProjectRow[],
  there: readonly ProjectRow[],
  machine: string,
): ReadonlyMap<string, RemoteGroup> {
  const keys = (rows: readonly ProjectRow[], prefix: string) =>
    rows.map((row) => ({
      id: `${prefix}:${row.id}`,
      identity: row.identity ?? null,
      remote_key: row.remote?.key ?? null,
    }));
  const { same, suggested } = matchProjects(
    keys(here, "this"),
    keys(there, machine),
  );
  const strip = (id: string) => id.slice(id.indexOf(":") + 1);
  const hereOf = (id: string) => {
    const row = here.find((one) => one.id === strip(id))!;
    return { id: row.id, title: row.title };
  };
  const groups = new Map<string, RemoteGroup>();
  for (const [left, right] of same) {
    groups.set(strip(right.id), { kind: "same", here: hereOf(left.id) });
  }
  for (const [left, right] of suggested) {
    groups.set(strip(right.id), { kind: "suggested", here: hereOf(left.id) });
  }
  for (const row of there) {
    const identity = row.identity ?? null;
    if (identity === null || groups.has(row.id)) continue;
    groups.set(row.id, {
      kind: "remoteOnly",
      identity,
      url: row.remote?.url ?? null,
    });
  }
  return groups;
}
