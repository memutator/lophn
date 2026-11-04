// domain 폴더에 있던 agent용 file을 그 그릇(project나 앱)의 자리로 옮기는 wiring이다. data step 하나가 한다
// (옮길 곳의 계획을 아는 곳이 여기라서다):
// - `domains/<dom>/skills/*`를 그 그릇 자리의 `skills/`로 옮긴다. 이름이 겹치면 `artifact-move.ts`와 같은 규칙이다.
// - `DOMAIN.md`와 `kinds.yaml`은 그릇 자리의 `old-domains/<domain 이름>/`로 옮긴다. 읽는 쪽이 없는 보관본이다.
// - rewind 기록 가운데 그 file의 것을 새 자리(root = 그릇의 `skills/` 또는 `old-domains/<이름>`)로 다시 쓴다.
//   옛 checkpoint를 되돌릴 때 `domains/<dom>`이나 그릇 root에 쓰거나 이름이 바뀐 skill 대신 이긴 쪽에 쓰는 틀린 복원을 막는다.
// 옮기는 쪽은 rename뿐이라 file을 복사하거나 지우지 않고, 있는 대상은 덮지 않는다.
// domains 표가 필요해서 표를 거두는 data step(`domains.retire`)보다 앞에 등록한다(assembly.ts의 WIRINGS 순서).
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  placeDataFolder,
  placeDataSkillsFolder,
} from "../../../agent-places/place/data-folder.ts";
import { dropDomainsFieldStep } from "../../../lophn-agent/agents/domains-field-step.ts";
import { REWIND_FILES_IMMUTABLE } from "../../../lophn-agent/session/rewind/mod.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

type Place = { kind: "project" | "app"; id: string };
type DomainRow = { id: string; name: string; place: Place };

// 옮길 곳의 data 폴더는 root에서 정하고, 기록의 root는 기록된 접두(realpath)에서 정한다.
const skillsOf = (root: string, place: Place) =>
  placeDataSkillsFolder(root, place as never);
const oldDomainsOf = (root: string, place: Place, domain: string) =>
  `${placeDataFolder(root, place as never)}/old-domains/${domain}`;

const DOCS = ["DOMAIN.md", "kinds.yaml"] as const;

type Move = {
  domain: string;
  name: string;
  newName: string;
  from: string;
  to: string;
  // skill 폴더가 이름을 바꿔 옮겨질 때만 있다. SKILL.md의 `name:`을 같이 바꾼다.
  rename: boolean;
};

// skill 이름은 slug(63자까지)라 길어진 이름은 잘라 slug 규칙을 지킨다.
const NAME_MAX = 63;

async function namesIn(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

const exists = (path: string) =>
  lstat(path)
    .then(() => true)
    .catch(() => false);

// skill을 옮길 곳을 정한다. 그릇마다 domain 이름 순으로 보고, 이미 그 이름이 있으면(앞선 domain이 가졌거나 다른 까닭으로
// 있던 것) `<name>-<domain 이름>`으로 옮긴다. 있는 것은 덮지 않는다. 둘 다 있으면 옮기지 않고 제자리에 둔다.
// 다시 돌아도 같은 곳이 나온다: 앞서 옮겨진 것은 옛 자리에 없고, 그 이름은 대상 폴더에 이미 있다.
async function planSkillMoves(
  root: string,
  domains: readonly DomainRow[],
): Promise<Move[]> {
  const used = new Map<string, Set<string>>();
  const moves: Move[] = [];
  const ordered = [...domains].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const d of ordered) {
    const folder = skillsOf(root, d.place);
    let taken = used.get(folder);
    if (taken === undefined) {
      taken = new Set(await namesIn(folder));
      used.set(folder, taken);
    }
    const source = `${root}/domains/${d.id}/skills`;
    for (const name of (await namesIn(source)).sort()) {
      const newName = [
        name,
        `${name}-${d.name}`.slice(0, NAME_MAX).replace(/-+$/, ""),
      ].find((candidate) => !taken.has(candidate));
      if (newName === undefined) continue;
      taken.add(newName);
      moves.push({
        domain: d.id,
        name,
        newName,
        from: `${source}/${name}`,
        to: `${folder}/${newName}`,
        rename: newName !== name,
      });
    }
  }
  return moves;
}

// 이름이 바뀌어 옮겨지는 skill은 SKILL.md의 `name:`도 새 이름으로 고친다. 그대로 두면 같은 skill 이름이 둘이 되어 한쪽이 가려진다.
// 폴더 이름과 다른 `name:`을 가진 skill은 사람이 일부러 그렇게 둔 것이라 건드리지 않는다.
async function renameInManifest(
  folder: string,
  name: string,
  newName: string,
): Promise<void> {
  const path = `${folder}/SKILL.md`;
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return;
  const lines = text.split("\n");
  const close = lines.findIndex(
    (line, i) => i > 0 && line.replace(/\r$/, "") === "---",
  );
  if (lines[0]?.replace(/\r$/, "") !== "---" || close === -1) return;
  const at = lines.findIndex((line, i) => {
    if (i === 0 || i >= close) return false;
    const match = /^name:\s*(.*?)\s*$/.exec(line.replace(/\r$/, ""));
    return match?.[1]?.replace(/^(["'])(.*)\1$/, "$2") === name;
  });
  if (at === -1) return;
  lines[at] = `name: ${newName}`;
  await writeFile(`${path}.tmp`, lines.join("\n"), "utf8");
  await rename(`${path}.tmp`, path);
}

type DocMove = { domain: DomainRow; name: string; from: string; to: string };

// 옮길 곳에 이미 있으면 옮기지 않고 제자리에 둔다.
async function planDocMoves(
  root: string,
  domains: readonly DomainRow[],
): Promise<DocMove[]> {
  const moves: DocMove[] = [];
  for (const domain of domains) {
    for (const name of DOCS) {
      const from = `${root}/domains/${domain.id}/${name}`;
      const to = `${oldDomainsOf(root, domain.place, domain.name)}/${name}`;
      if ((await exists(from)) && !(await exists(to))) {
        moves.push({ domain, name, from, to });
      }
    }
  }
  return moves;
}

const DOMAIN_ROOT = /^(.*)\/domains\/(dom_[0-9a-z]+)$/;

// 옛 rewind 기록의 root는 realpath로 `<data>/domains/<dom>`였고 path가 `skills/<name>/…`, `DOMAIN.md`, `kinds.yaml`이었다.
// skill은 root를 그 그릇의 `skills/`로 path의 첫 마디를 최종 이름으로, 문서는 root를 `old-domains/<domain 이름>`으로 바꾼다.
// `artifacts/` 아래 기록은 artifact 옮기기가 먼저 바꿨거나(root가 이미 맞지 않는다) 제자리에 남은 것이라 건드리지 않는다.
// 옮기지 못하고 제자리에 남는 file의 기록도 그대로 둔다. 다시 돌면 이미 바뀐 기록은 root가 맞지 않아 아무것도 바뀌지 않는다.
async function rewriteRewindRows(
  connection: LedgerConnection,
  root: string,
  domains: ReadonlyMap<string, DomainRow>,
  skillMoves: readonly Move[],
  docMoves: readonly DocMove[],
): Promise<void> {
  const planned = new Map(
    skillMoves.map((move) => [`${move.domain}\n${move.name}`, move.newName]),
  );
  const docsPlanned = new Set(
    docMoves.map((move) => `${move.domain.id}\n${move.name}`),
  );
  // 계획에 없는 이름은 이미 없는 file(같은 이름)이거나 제자리에 남는 것이다. 아직 있으면 남는 것이다.
  const finalName = async (domain: string, name: string) => {
    const known = planned.get(`${domain}\n${name}`);
    if (known !== undefined) return known;
    return (await exists(`${root}/domains/${domain}/skills/${name}`))
      ? null
      : name;
  };
  const target = async (
    data: string,
    domain: DomainRow,
    rel: string,
  ): Promise<{ root: string; path: string } | null> => {
    if ((DOCS as readonly string[]).includes(rel)) {
      const stays =
        !docsPlanned.has(`${domain.id}\n${rel}`) &&
        (await exists(`${root}/domains/${domain.id}/${rel}`));
      return stays
        ? null
        : { root: oldDomainsOf(data, domain.place, domain.name), path: rel };
    }
    if (!rel.startsWith("skills/")) return null;
    const inner = rel.slice("skills/".length);
    const old = inner.split("/")[0]!;
    const name = await finalName(domain.id, old);
    return name === null
      ? null
      : {
          root: skillsOf(data, domain.place),
          path: `${name}${inner.slice(old.length)}`,
        };
  };
  const updates: {
    tool_call: string;
    path: string;
    root: string;
    newPath: string;
    movedFrom: string | null;
  }[] = [];
  for (const row of connection.sql.all(
    "select tool_call, root, path, moved_from from rewind_files where root like '%/domains/%'",
    [],
  )) {
    const match = DOMAIN_ROOT.exec(String(row["root"]));
    const domain = match === null ? undefined : domains.get(match[2]!);
    if (match === null || domain === undefined) continue;
    const moved = row["moved_from"] === null ? null : String(row["moved_from"]);
    const now = await target(match[1]!, domain, String(row["path"]));
    const from = moved === null ? null : await target(match[1]!, domain, moved);
    if (now === null || (moved !== null && from?.root !== now.root)) continue;
    updates.push({
      tool_call: String(row["tool_call"]),
      path: String(row["path"]),
      root: now.root,
      newPath: now.path,
      movedFrom: from?.path ?? null,
    });
  }
  if (updates.length === 0) return;
  // 기록의 root·path는 바뀌지 않는 칸이라 trigger를 내렸다 다시 만든다.
  connection.exec("begin immediate");
  try {
    connection.exec("drop trigger rewind_files_immutable");
    for (const update of updates) {
      connection.sql.run(
        "update rewind_files set root = ?, path = ?, moved_from = ? where tool_call = ? and path = ?",
        [
          update.root,
          update.newPath,
          update.movedFrom,
          update.tool_call,
          update.path,
        ],
      );
    }
    connection.exec(REWIND_FILES_IMMUTABLE);
    connection.exec("commit");
  } catch (thrown) {
    if (connection.inTransaction()) connection.exec("rollback");
    throw thrown;
  }
}

export const placeDataMoveStep: DataStep = {
  id: "domains.place-data",
  async run(root): Promise<Result<void>> {
    const opened = openConnection(`${root}/lophn.db`);
    if (!opened.ok) return opened;
    const connection = opened.value;
    try {
      const rows: DomainRow[] = connection.sql
        .all("select id, name, owner_kind, owner_id from domains", [])
        .map((row) => ({
          id: String(row["id"]),
          name: String(row["name"]),
          place: {
            kind: row["owner_kind"] === "app" ? "app" : "project",
            id: String(row["owner_id"]),
          },
        }));
      const byId = new Map(rows.map((row) => [row.id, row]));
      const skillMoves = await planSkillMoves(root, rows);
      const docMoves = await planDocMoves(root, rows);
      // 기록을 먼저 쓴다. 옮기다 끊겨 다시 돌아도 같은 계획이 나오고, 이미 쓴 기록은 건너뛴다.
      await rewriteRewindRows(connection, root, byId, skillMoves, docMoves);
      for (const move of skillMoves) {
        const owner = byId.get(move.domain)!;
        await mkdir(skillsOf(root, owner.place), { recursive: true });
        if (move.rename) {
          await renameInManifest(move.from, move.name, move.newName);
        }
        await rename(move.from, move.to);
      }
      for (const move of docMoves) {
        await mkdir(oldDomainsOf(root, move.domain.place, move.domain.name), {
          recursive: true,
        });
        await rename(move.from, move.to);
      }
      for (const row of rows) {
        // 비게 된 옛 폴더만 치운다. 제자리에 둔 것이 있으면 남는다.
        await rmdir(`${root}/domains/${row.id}/skills`).catch(() => {});
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message:
          "domain skills and documents could not be moved to their project or app folder",
      });
    } finally {
      connection.close();
    }
  },
};

export const placeDataMoveWiring: WiringFactory = () => ({
  name: "place-data-move",
  dataSteps: [dropDomainsFieldStep, placeDataMoveStep],
});
