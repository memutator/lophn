// artifact의 신원이 `{domain, name}`에서 그릇(project나 앱)과 이름으로 바뀐 것을 옛 data root에 옮기는 wiring이다.
// - schema step: rewind 기록의 root를 domain 폴더에서 그 domain의 그릇 폴더로 바꾼다(rewind/schema.ts).
// - data step: `domains/<dom>/artifacts/*`를 그 그릇의 `artifacts/`로 옮기고, `shell/places/*.json`의 판 8 artifact 탭을
//   새 신원으로 다시 써서 판 9로 적는다.
// domains 표가 필요해서 표를 거두는 data step(`domains.retire`)보다 앞에 등록한다(assembly.ts의 WIRINGS 순서).
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type ArtifactPlace,
  artifactsFolder,
} from "../../../../protocol/projects/mod.ts";
import { rewindContainerRootSteps } from "../../../lophn-agent/session/rewind/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { DataStep } from "../../../storage/migration/mod.ts";
import type { WiringFactory } from "./context.ts";

type DomainRow = { id: string; name: string; place: ArtifactPlace };

type Move = {
  domain: string;
  name: string;
  place: ArtifactPlace;
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
    const folder = artifactsFolder(root, d.place);
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
        place: d.place,
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

// 판 8 layout의 artifact 탭을 새 신원으로 고친다. domain을 모르는 탭이 있으면 false이고 layout은 건드리지 않은 것으로 본다.
function rewriteLayout(
  layout: Layout,
  where: (
    domain: string,
    name: string,
  ) => { place: ArtifactPlace; name: string } | null,
): boolean {
  const keys = new Map<string, string>();
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
    if (found === null) return false;
    const key = `artifact:${found.place.kind}:${found.place.id}:${found.name}`;
    keys.set(tab.key, key);
    fixes.push(() => {
      delete tab["domain"];
      tab[found.place.kind] = found.place.id;
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
  for (const desk of desks) {
    if (desk.selected_tab !== null) {
      desk.selected_tab = rekey(desk.selected_tab);
    }
    for (const group of desk.groups ?? []) {
      rekeyNode(group.layout);
      group.focus = rekey(group.focus);
    }
  }
  layout.schema_version = 9;
  return true;
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
      place: row.place,
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
    if (layout?.schema_version !== 8 || !rewriteLayout(layout, where)) continue;
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
    let rows: DomainRow[];
    try {
      rows = connection.sql
        .all("select id, name, owner_kind, owner_id from domains", [])
        .map((row) => ({
          id: String(row["id"]),
          name: String(row["name"]),
          place: {
            kind: row["owner_kind"] === "app" ? "app" : "project",
            id: String(row["owner_id"]),
          },
        }));
    } finally {
      connection.close();
    }
    try {
      const moves = await planMoves(root, rows);
      // 탭을 먼저 쓴다. 옮기다 끊겨 다시 돌아도 같은 계획이 나오고, 판 9가 된 파일은 건너뛴다.
      await rewriteLayoutFiles(
        root,
        new Map(rows.map((row) => [row.id, row])),
        moves,
      );
      for (const move of moves) {
        await mkdir(artifactsFolder(root, move.place), { recursive: true });
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
    }
  },
};

export const artifactMoveWiring: WiringFactory = () => ({
  name: "artifact-move",
  schemaStepsAfterTeams: rewindContainerRootSteps,
  dataSteps: [artifactMoveStep],
});
