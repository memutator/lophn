import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { domainsSchemaSteps } from "../../../domains/schema.ts";
import { artifactMoveStep } from "./artifact-move.ts";

const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const OTHER = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb";
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";

// 폴더 안 모든 file의 상대 경로와 내용이다. 두 번 돌려도 같은지 보는 데 쓴다.
async function snapshot(folder: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    out.push(
      ...(entry.isDirectory()
        ? await snapshot(join(folder, entry.name), `${path}/`)
        : [`${path}=${await readFile(join(folder, entry.name), "utf8")}`]),
    );
  }
  return out.sort();
}

// 사용자 data를 잃으면 안 된다: 같은 그릇 안 이름이 겹쳐도, artifact 안 하위 폴더가 있어도 file이 모두 남고, 다시 돌려도 아무것도 옮기지 않는다.
test("artifact 옮기기는 이름이 겹쳐도 file을 잃지 않고 다시 돌아도 같다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-artifact-move-"));
  try {
    const db = new DatabaseSync(join(root, "lophn.db"));
    for (const step of domainsSchemaSteps) db.exec(step.sql);
    // alpha·beta는 같은 project, gamma는 다른 project에 이미 같은 이름이 있고, delta는 보관한 앱의 것이다.
    const domain = db.prepare(
      `INSERT INTO domains (id, name, title, purpose, owner_kind, owner_id, revision, status)
       VALUES (?, ?, 't', '', ?, ?, '1', ?)`,
    );
    domain.run("dom_a", "alpha", "project", PRJ, "active");
    domain.run("dom_b", "beta", "project", PRJ, "active");
    domain.run("dom_c", "gamma", "project", OTHER, "active");
    domain.run("dom_d", "delta", "app", APP, "archived");
    db.close();
    const put = async (path: string, text: string) => {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, text);
    };
    for (const [dom, text] of [
      ["dom_a", "alpha"],
      ["dom_b", "beta"],
      ["dom_c", "gamma"],
      ["dom_d", "delta"],
    ]) {
      await put(
        join(root, "domains", dom, "artifacts/report/index.html"),
        text,
      );
      await put(
        join(root, "domains", dom, "artifacts/report/data/series.json"),
        `${text}-data`,
      );
    }
    await put(
      join(root, "domains/dom_b/artifacts/only-beta/index.html"),
      "only",
    );
    // 그릇에 다른 까닭으로 이미 있던 것은 덮이지 않는다.
    await put(
      join(root, "projects", OTHER, "artifacts/report/index.html"),
      "kept",
    );
    // 판 8 layout: 탭 key와 group이 가리키는 key가 모두 새 신원으로 바뀐다.
    await put(
      join(root, "shell/places", `${PRJ}.json`),
      JSON.stringify({
        schema_version: 8,
        active_desk: "_default",
        desks: {
          _default: {
            label: "Main",
            tabs: [
              {
                key: "artifact:dom_a:report",
                kind: "artifact",
                title: "report",
                domain: "dom_a",
                name: "report",
              },
              {
                key: "artifact:dom_b:report",
                kind: "artifact",
                title: "report",
                domain: "dom_b",
                name: "report",
              },
            ],
            selected_tab: "artifact:dom_b:report",
            groups: [
              {
                layout: {
                  dir: "row",
                  ratio: 0.5,
                  a: { tab: "artifact:dom_a:report" },
                  b: { tab: "artifact:dom_b:report" },
                },
                focus: "artifact:dom_b:report",
              },
            ],
            floats: [],
            detached: [],
          },
        },
      }),
    );

    const first = await artifactMoveStep.run(root);
    assert.ok(first.ok);

    const projectFolder = join(root, "projects", PRJ, "artifacts");
    assert.deepStrictEqual(await snapshot(projectFolder), [
      "only-beta/index.html=only",
      "report-beta/data/series.json=beta-data",
      "report-beta/index.html=beta",
      "report/data/series.json=alpha-data",
      "report/index.html=alpha",
    ]);
    assert.deepStrictEqual(
      await snapshot(join(root, "projects", OTHER, "artifacts")),
      [
        "report-gamma/data/series.json=gamma-data",
        "report-gamma/index.html=gamma",
        "report/index.html=kept",
      ],
    );
    assert.deepStrictEqual(
      await snapshot(join(root, "apps", APP, "artifacts")),
      ["report/data/series.json=delta-data", "report/index.html=delta"],
    );
    // 옛 자리에는 artifact가 남지 않는다.
    assert.deepStrictEqual(await snapshot(join(root, "domains")), []);

    const layout = JSON.parse(
      await readFile(join(root, "shell/places", `${PRJ}.json`), "utf8"),
    );
    const key = (name: string) => `artifact:project:${PRJ}:${name}`;
    const desk = layout.desks._default;
    assert.equal(layout.schema_version, 9);
    assert.deepStrictEqual(
      desk.tabs.map((tab: Record<string, unknown>) => [
        tab["key"],
        tab["project"],
        tab["name"],
        tab["domain"],
      ]),
      [
        [key("report"), PRJ, "report", undefined],
        [key("report-beta"), PRJ, "report-beta", undefined],
      ],
    );
    assert.equal(desk.selected_tab, key("report-beta"));
    assert.equal(desk.groups[0].layout.b.tab, key("report-beta"));
    assert.equal(desk.groups[0].focus, key("report-beta"));

    const before = [
      await snapshot(join(root, "projects")),
      await snapshot(join(root, "apps")),
    ];
    const again = await artifactMoveStep.run(root);
    assert.ok(again.ok);
    assert.deepStrictEqual(
      [
        await snapshot(join(root, "projects")),
        await snapshot(join(root, "apps")),
      ],
      before,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
