// artifact의 신원이 `{domain, name}`에서 그릇(project나 앱)과 이름으로 바뀐 것을 옛 data root에 옮기는 wiring이다.
// data step 하나가 한다(옮길 곳의 계획을 아는 곳이 여기라서다):
// - `domains/<dom>/artifacts/*`를 그 그릇의 `artifacts/`로 옮긴다.
// - rewind 기록 가운데 그 artifact의 것을 새 모양(root = 그릇의 `artifacts/`, path = `<최종 이름>/…`)으로 다시 쓴다.
//   옛 checkpoint를 되돌릴 때 옛 자리에 쓰거나 이름이 바뀐 artifact 대신 이긴 쪽에 쓰는 틀린 복원을 막고,
//   `lastArtifactWriter`가 옛 기록도 찾게 한다.
// - `shell/places/*.json`의 판 8 artifact 탭을 새 신원으로 다시 써서 판 9로 적는다.
// ledger 파일을 여는 data step이라 schema step이 다 돈 뒤에 돈다(core.ts: migration → dataSteps).
// domains 표가 필요해서 표를 거두는 data step(`domains.retire`)보다 앞에 등록한다(assembly.ts의 WIRINGS 순서).
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { normalize } from "node:path";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type ArtifactWorkspace,
  artifactsFolder,
} from "../../../../protocol/projects/mod.ts";
import { REWIND_FILES_IMMUTABLE } from "../../../lophn-agent/session/rewind/mod.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

type DomainRow = { id: string; name: string; workspace: ArtifactWorkspace };

type Move = {
  domain: string;
  name: string;
  workspace: ArtifactWorkspace;
  newName: string;
  from: string;
  to: string;
};

// artifact 이름은 slug(63자까지)라 길어진 이름은 잘라 slug 규칙을 지킨다.
const NAME_MAX = 63;

async function namesIn(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

// 옮길 곳을 정한다. 그릇마다 domain 이름 순으로 보고, 이미 그 이름이 있으면(앞선 domain이 가졌거나 다른 까닭으로
// 있던 것) `<name>-<domain 이름>`으로 옮긴다. 있는 것은 덮지 않는다. 둘 다 있으면 옮기지 않고 제자리에 둔다.
// 다시 돌아도 같은 곳이 나온다: 앞서 옮겨진 것은 옛 자리에 없고, 그 이름은 대상 폴더에 이미 있다.
async function planMoves(
  root: string,
  domains: readonly DomainRow[],
): Promise<Move[]> {
  const used = new Map<string, Set<string>>();
  const moves: Move[] = [];
  const ordered = [...domains].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const d of ordered) {
    const folder = artifactsFolder(root, d.workspace);
    let taken = used.get(folder);
    if (taken === undefined) {
      taken = new Set(await namesIn(folder));
      used.set(folder, taken);
    }
    const source = `${root}/domains/${d.id}/artifacts`;
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
        workspace: d.workspace,
        newName,
        from: `${source}/${name}`,
        to: `${folder}/${newName}`,
      });
    }
  }
  return moves;
}

type Layout = {
  schema_version?: unknown;
  desks?: Record<string, Desk>;
};
type Tab = { key: string; kind?: unknown; [field: string]: unknown };
type LayoutNode = {
  tab?: string;
  stack?: string[];
  a?: LayoutNode;
  b?: LayoutNode;
};
type Desk = {
  tabs: Tab[];
  selected_tab: string | null;
  groups: { layout: LayoutNode; focus: string }[];
  floats: { tab: Tab }[];
  detached: { tab: Tab }[];
};

// 판 8 layout의 artifact 탭을 새 신원으로 고친다. domain을 모르는 탭은 그 탭만 걷어낸다(그 탭이 든 group은 풀린다).
function rewriteLayout(
  layout: Layout,
  where: (
    domain: string,
    name: string,
  ) => { workspace: ArtifactWorkspace; name: string } | null,
): void {
  const keys = new Map<string, string>();
  const dropped = new Set<string>();
  const desks = Object.values(layout.desks ?? {});
  const tabs = desks.flatMap((desk) => [
    ...desk.tabs,
    ...desk.floats.map((item) => item.tab),
    ...desk.detached.map((item) => item.tab),
  ]);
  const fixes: (() => void)[] = [];
  for (const tab of tabs) {
    if (tab.kind !== "artifact" || typeof tab["domain"] !== "string") continue;
    const found = where(tab["domain"], String(tab["name"]));
    if (found === null) {
      dropped.add(tab.key);
      continue;
    }
    const key = `artifact:${found.workspace.kind}:${found.workspace.id}:${found.name}`;
    keys.set(tab.key, key);
    fixes.push(() => {
      delete tab["domain"];
      tab[found.workspace.kind] = found.workspace.id;
      tab["name"] = found.name;
      tab.key = key;
    });
  }
  for (const fix of fixes) fix();
  const rekey = (key: string) => keys.get(key) ?? key;
  const rekeyNode = (node: LayoutNode): void => {
    if (node.tab !== undefined) node.tab = rekey(node.tab);
    if (node.stack !== undefined) node.stack = node.stack.map(rekey);
    if (node.a !== undefined) rekeyNode(node.a);
    if (node.b !== undefined) rekeyNode(node.b);
  };
  const keysOf = (node: LayoutNode): string[] => [
    ...(node.tab === undefined ? [] : [node.tab]),
    ...(node.stack ?? []),
    ...(node.a === undefined ? [] : keysOf(node.a)),
    ...(node.b === undefined ? [] : keysOf(node.b)),
  ];
  // 칸에 가려진 탭은 고른 탭이 될 수 없다.
  const hiddenOf = (node: LayoutNode): string[] =>
    node.tab !== undefined
      ? (node.stack ?? []).filter((key) => key !== node.tab)
      : [
          ...(node.a === undefined ? [] : hiddenOf(node.a)),
          ...(node.b === undefined ? [] : hiddenOf(node.b)),
        ];
  for (const desk of desks) {
    const left = (tab: { key: string }) => !dropped.has(tab.key);
    desk.tabs = desk.tabs.filter(left);
    desk.floats = desk.floats.filter((item) => left(item.tab));
    desk.detached = desk.detached.filter((item) => left(item.tab));
    desk.groups = (desk.groups ?? []).filter(
      (group) => !keysOf(group.layout).some((key) => dropped.has(key)),
    );
    for (const group of desk.groups) {
      rekeyNode(group.layout);
      group.focus = rekey(group.focus);
    }
    if (desk.selected_tab !== null) {
      const selected = rekey(desk.selected_tab);
      const hidden = desk.groups.flatMap((group) => hiddenOf(group.layout));
      desk.selected_tab = dropped.has(desk.selected_tab)
        ? (desk.tabs.find((tab) => !hidden.includes(tab.key))?.key ?? null)
        : selected;
    }
  }
  layout.schema_version = 9;
}

// 옛 root는 realpath라 Windows에서는 `\`로 나뉜다. 새 root도 normalize해 realpath와 같은 꼴로 쓴다.
const DOMAIN_ROOT = /^(.*)[\\/]domains[\\/](dom_[0-9a-z]+)([\\/]artifacts)?$/;

// 옛 rewind 기록의 root는 realpath로 두 모양이 있었다. PM·App Engineer는 domain 폴더를 열어 root가
// `<data>/domains/<dom>`, path가 `artifacts/<name>/…`였고, Operator는 domain의 `artifacts/`만 열어 root가
// `<data>/domains/<dom>/artifacts`, path가 `<name>/…`였다. 둘 다 root를 그 그릇의 `artifacts/`로, path의 첫 마디를 최종 이름으로
// 바꾼다. 앞 모양에서 `artifacts/` 아래가 아닌 기록(skills/, DOMAIN.md, kinds.yaml)은 건드리지 않는다.
// 옮기지 못하고 제자리에 남는 artifact의 기록도 그대로 둔다. 다시 돌면 이미 바뀐 기록은 root가 맞지 않아 아무것도 바뀌지 않는다.
async function rewriteRewindRows(
  connection: LedgerConnection,
  root: string,
  domains: ReadonlyMap<string, DomainRow>,
  moves: readonly Move[],
): Promise<void> {
  const planned = new Map(
    moves.map((move) => [`${move.domain}\n${move.name}`, move.newName]),
  );
  // 계획에 없는 이름은 이미 없는 artifact(같은 이름)이거나 제자리에 남는 것이다. 폴더가 아직 있으면 남는 것이다.
  const finalName = async (domain: string, name: string) => {
    const known = planned.get(`${domain}\n${name}`);
    if (known !== undefined) return known;
    const stays = await lstat(`${root}/domains/${domain}/artifacts/${name}`)
      .then(() => true)
      .catch(() => false);
    return stays ? null : name;
  };
  // path를 artifacts 폴더 기준으로 바꾼다. 안쪽 root(`…/artifacts`)는 그대로고, domain 폴더 root는 `artifacts/` 아래만 센다.
  const relative = (path: string, nested: boolean) =>
    nested
      ? path
      : path.startsWith("artifacts/")
        ? path.slice("artifacts/".length)
        : null;
  const updates: {
    tool_call: string;
    path: string;
    root: string;
    newPath: string;
    movedFrom: string | null;
  }[] = [];
  for (const row of connection.sql.all(
    "select tool_call, root, path, moved_from from rewind_files where root like '%/domains/%' or root like '%\\domains\\%'",
    [],
  )) {
    const match = DOMAIN_ROOT.exec(String(row["root"]));
    const domain = match === null ? undefined : domains.get(match[2]!);
    if (match === null || domain === undefined) continue;
    const nested = match[3] !== undefined;
    const path = relative(String(row["path"]), nested);
    const moved = row["moved_from"] === null ? null : String(row["moved_from"]);
    const from = moved === null ? null : relative(moved, nested);
    if (path === null || (moved !== null && from === null)) continue;
    const rename = async (rel: string) => {
      const old = rel.split("/")[0]!;
      const name = await finalName(domain.id, old);
      return name === null ? null : `${name}${rel.slice(old.length)}`;
    };
    const newPath = await rename(path);
    const movedFrom = from === null ? null : await rename(from);
    if (newPath === null || (from !== null && movedFrom === null)) continue;
    updates.push({
      tool_call: String(row["tool_call"]),
      path: String(row["path"]),
      root: normalize(artifactsFolder(match[1]!, domain.workspace)),
      newPath,
      movedFrom,
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

async function rewriteLayoutFiles(
  root: string,
  domains: ReadonlyMap<string, DomainRow>,
  moves: readonly Move[],
): Promise<void> {
  const planned = new Map(
    moves.map((move) => [`${move.domain}\n${move.name}`, move]),
  );
  const where = (domain: string, name: string) => {
    const row = domains.get(domain);
    if (row === undefined) return null;
    // 계획에 없는 것은 앞서 옮겨졌거나 제자리에 둔 것이다. 이름은 그대로 본다.
    return {
      workspace: row.workspace,
      name: planned.get(`${domain}\n${name}`)?.newName ?? name,
    };
  };
  const folder = `${root}/shell/places`;
  for (const file of await namesIn(folder)) {
    if (!file.endsWith(".json")) continue;
    const path = `${folder}/${file}`;
    let layout: Layout;
    try {
      layout = JSON.parse(await readFile(path, "utf8")) as Layout;
    } catch {
      continue; // 깨진 파일은 shell이 손상으로 다룬다.
    }
    if (layout?.schema_version !== 8) continue;
    rewriteLayout(layout, where);
    const mode = (await stat(path)).mode & 0o777;
    await writeFile(`${path}.tmp`, JSON.stringify(layout), { mode });
    await rename(`${path}.tmp`, path);
  }
}

export const artifactMoveStep: DataStep = {
  id: "artifacts.container",
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
          workspace: {
            kind: row["owner_kind"] === "app" ? "app" : "project",
            id: String(row["owner_id"]),
          },
        }));
      const byId = new Map(rows.map((row) => [row.id, row]));
      const moves = await planMoves(root, rows);
      // 기록과 탭을 먼저 쓴다. 옮기다 끊겨 다시 돌아도 같은 계획이 나오고, 이미 쓴 기록과 판 9 파일은 건너뛴다.
      await rewriteRewindRows(connection, root, byId, moves);
      await rewriteLayoutFiles(root, byId, moves);
      for (const move of moves) {
        await mkdir(artifactsFolder(root, move.workspace), { recursive: true });
        await rename(move.from, move.to);
      }
      for (const row of rows) {
        // 비게 된 옛 폴더만 치운다. 제자리에 둔 것이 있으면 남는다.
        await rmdir(`${root}/domains/${row.id}/artifacts`).catch(() => {});
      }
      return ok(undefined);
    } catch {
      return err({
        code: "unavailable",
        message: "artifacts could not be moved to their project or app folder",
      });
    } finally {
      connection.close();
    }
  },
};

export const artifactMoveWiring: WiringFactory = () => ({
  name: "artifact-move",
  dataSteps: [artifactMoveStep],
});
