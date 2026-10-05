// save command 테스트다(cli#R15, R16, R20; connection#R10). 실제 temp 파일로 첫 파일
// primary·제출 검사·MCP와 같은 결과를 보고, 표에 자리 놓기·원본 제거·series 생성
// command가 없는지 본다. core 대신 route별 답을 정한 흐름 client를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { SubmittedFile } from "../../connection/mod.ts";
import {
  preparedFor,
  PROJECT_PLACE,
  savedResult,
  scriptedFlow,
  SERIES_ID,
} from "../../connection/testing/mod.ts";
import { COMMANDS, findCommand } from "../registry.ts";
import { runSave, SAVE_COMMANDS } from "./save.ts";
import { SERIES_COMMANDS } from "./series.ts";
import { FORMAT_COMMANDS } from "./format.ts";

const empty = { documents: [], next_cursor: null };

async function workspace() {
  const base = await Deno.makeTempDir({ prefix: "lophn-cli-save-" });
  const root = await Deno.realPath(base);
  await Deno.mkdir(`${root}/notes`);
  await Deno.mkdir(`${root}-data`);
  await Deno.writeTextFile(`${root}/notes/plan.md`, "# plan\n");
  await Deno.writeTextFile(`${root}/notes/extra.txt`, "extra");
  await Deno.writeTextFile(`${root}-data/ledger.sqlite`, "secret");
  return { root, data: `${root}-data` };
}

function blobFor(file: SubmittedFile) {
  return ok({
    preparation: `prep-${file.path}`,
    principal: "cac",
    purpose: "document_file",
    hash: file.blob_hash,
    size_bytes: file.bytes,
  });
}

Deno.test("coding-agent/cli#R15: save는 위치 인자 경로를 받고 series만 있고 key가 없으면 거절한다", () => {
  const entry = findCommand("save");
  assert(entry);
  const paths = ["/work/notes/plan.md", "/work/notes/extra.txt"];
  assert(entry.input.safeParse({ command: "save", paths }).success);
  assert(
    entry.input.safeParse({
      command: "save",
      paths,
      series: { series: SERIES_ID },
      key: "2",
    }).success,
  );
  assert(
    !entry.input.safeParse({
      command: "save",
      paths,
      series: { series: SERIES_ID },
    }).success,
  );
  // 빈 목록·상대 경로·모르는 필드는 거절한다.
  assert(!entry.input.safeParse({ command: "save", paths: [] }).success);
  assert(
    !entry.input.safeParse({ command: "save", paths: ["notes/plan.md"] })
      .success,
  );
  assert(
    !entry.input.safeParse({ command: "save", paths, move_original: true })
      .success,
  );
});

Deno.test("coding-agent/cli#R16: CLI에 자리 놓기·원본 제거·보관 복귀 command가 없다", () => {
  const names = COMMANDS.map((entry) => entry.name);
  for (
    const name of [
      "document move",
      "document rename",
      "document place",
      "document archive",
      "document unarchive",
      "document restore",
      "document delete",
      "document remove",
    ]
  ) {
    assertEquals(names.includes(name), false, name);
  }
  // save의 소유 route는 준비·저장·읽기·가입뿐이고 파일을 쓰는 route가 없다.
  const routes = Object.values(SAVE_COMMANDS[0].opRoutes ?? {}).map((route) =>
    route.name
  );
  assertEquals(routes, [
    "document.list",
    "series.get",
    "document.prepare",
    "document.save",
    "series.add_instance",
  ]);
});

Deno.test("coding-agent/cli#R20: series는 읽기 command 셋뿐이고 생성 command가 없다", () => {
  assertEquals(SERIES_COMMANDS.map((entry) => entry.name), [
    "series list",
    "series show",
    "series next",
  ]);
  for (const entry of SERIES_COMMANDS) {
    assertEquals((entry.monoRoute as { kind: string }).kind, "read");
  }
  const names = COMMANDS.map((entry) => entry.name);
  for (const name of ["series create", "series add", "series update"]) {
    assertEquals(names.includes(name), false, name);
  }
});

Deno.test("coding-agent/cli#R15: format은 list·show·validate가 소유 route로 연결된다", () => {
  assertEquals(
    FORMAT_COMMANDS.map((entry) => [entry.name, entry.monoRoute?.name]),
    [
      ["format list", "format.list"],
      ["format show", "format.get"],
      ["format validate", "format.validate"],
    ],
  );
});

Deno.test("coding-agent/cli#R15: save는 첫 파일을 primary로 제출 검사를 거쳐 저장하고 MCP와 같은 결과를 낸다", async () => {
  const where = await workspace();
  try {
    const flow = scriptedFlow({
      "document.list": empty,
      "document.prepare": preparedFor,
      "document.save": (input) =>
        savedResult("saved", (input as { document: string }).document),
    });
    const prepared: string[] = [];
    const saved = await runSave(
      {
        command: "save",
        paths: [`${where.root}/notes/plan.md`, `${where.root}/notes/extra.txt`],
        place: PROJECT_PLACE,
        slug: "plan",
        title: "계획",
      },
      {
        client: flow.client,
        scope: { root: where.root, forbidden: [where.data] },
        prepareBytes: (file) => {
          prepared.push(file.path);
          return Promise.resolve(blobFor(file));
        },
      },
    );
    assert(saved.ok, saved.ok ? "" : saved.error.message);
    assertEquals(prepared, ["plan.md", "extra.txt"]);
    const sent = flow.calls("document.prepare")[0].input as {
      files: { path: string; primary: boolean; media_type: string }[];
    };
    assertEquals(
      sent.files.map((file) => [file.path, file.primary, file.media_type]),
      [["plan.md", true, "text/markdown"], ["extra.txt", false, "text/plain"]],
    );
    // 같은 흐름이 같은 결과를 만든다: CLI 결과가 MCP 결과 모양(summary·data·next)이다.
    assertEquals(saved.value.summary, "새 문서로 저장했다: notes/plan@1");
    assertEquals(
      (saved.value.data as { address: string }).address,
      "notes/plan@1",
    );
    assertEquals(saved.value.next.length > 0, true);
  } finally {
    await Deno.remove(where.root, { recursive: true });
    await Deno.remove(where.data, { recursive: true });
  }
});

Deno.test("coding-agent/connection#R10: 금지 영역으로 이어진 파일은 어떤 bytes도 넘기기 전에 거절한다", async () => {
  const where = await workspace();
  try {
    await Deno.symlink(
      `${where.data}/ledger.sqlite`,
      `${where.root}/notes/looks-like-source.md`,
    );
    const flow = scriptedFlow({});
    let prepared = 0;
    const saved = await runSave(
      {
        command: "save",
        paths: [
          `${where.root}/notes/plan.md`,
          `${where.root}/notes/looks-like-source.md`,
        ],
      },
      {
        client: flow.client,
        scope: { root: where.root, forbidden: [where.data] },
        prepareBytes: (file) => {
          prepared += 1;
          return Promise.resolve(blobFor(file));
        },
      },
    );
    assert(!saved.ok);
    assertEquals(saved.error.code, "invalid_input");
    assertEquals(saved.error.message, "제출할 수 없는 파일이다");
    // 허용 파일의 bytes도 넘기지 않았고 core 호출도 없다.
    assertEquals(prepared, 0);
    assertEquals(flow.sent.length, 0);
  } finally {
    await Deno.remove(where.root, { recursive: true });
    await Deno.remove(where.data, { recursive: true });
  }
});
