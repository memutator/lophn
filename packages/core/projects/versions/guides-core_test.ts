// documents/versions#R17, R18 (documents#T29): 제품 core가 설치 사용 안내를 offline으로
// 읽게 한다. 데이터 root와 설치 root는 temp dir고, 설치 안내는 fixture manifest와 파일을
// 실제로 쓴 폴더다. 파생 store는 만들지 않는다(안내 읽기는 derived 없이 닿는다).
// 사람 데이터 root(~/.lophn)는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import {
  GUIDE_FIXTURE_GUIDES,
  type GuideFixtureGuide,
  type GuideInstallFixture,
  guideInstallFixture,
} from "./testing/mod.ts";
import { type Core, startCore } from "../../main/daemon/core.ts";
import type { TeamModule } from "../../main/daemon/registration.ts";
import { createLedgerRegistration } from "../register.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/register.ts";
import { closeUnlessKept } from "../../testing/close-on-throw.ts";

const teams: TeamModule[] = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const AT = Date.UTC(2024, 0, 1);
const HASH = "a".repeat(64);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const OPERATIONS = [
  "guide.list",
  "guide.get",
  "guide.outline",
  "guide.read",
  "document.save",
  "document.prepare",
  "document.get",
  "document.list",
  "document.archive",
  "document.move",
];

type Opened = {
  core: Core;
  home: string;
  install: string;
  guides: GuideInstallFixture;
  token: string;
  restore(): void;
};

async function open(
  texts: readonly GuideFixtureGuide[] = GUIDE_FIXTURE_GUIDES,
): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-guides-home-" });
  const install = await Deno.makeTempDir({ prefix: "lophn-guides-install-" });
  const guides = guideInstallFixture("1.4.2", texts, `${install}/guides`);
  const before = Deno.env.get("LOPHN_INSTALL_ROOT");
  Deno.env.set("LOPHN_INSTALL_ROOT", install);
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("../register.ts", import.meta.url).href,
      new URL("../../apps/register.ts", import.meta.url).href,
    ],
    clock: manualClock(AT),
    random: seededRandom(5),
    testCredentials: true,
    superviseIo: false,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  await using guard = closeUnlessKept(async () => {
    if (before === undefined) Deno.env.delete("LOPHN_INSTALL_ROOT");
    else Deno.env.set("LOPHN_INSTALL_ROOT", before);
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
    await Deno.remove(install, { recursive: true });
  });
  const core = started.value;
  const token = "g".repeat(43);
  const context: AuthenticatedContext = {
    principal: "user-1",
    actor: "user",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: "cred-guides",
  };
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok);
  const recorded = await core.record(context);
  assert(recorded.ok);
  guard.keep();
  return {
    core,
    home,
    install,
    guides,
    token,
    restore() {
      if (before === undefined) Deno.env.delete("LOPHN_INSTALL_ROOT");
      else Deno.env.set("LOPHN_INSTALL_ROOT", before);
    },
  };
}

async function close(opened: Opened) {
  opened.restore();
  await opened.core.shutdown();
  await Deno.remove(opened.home, { recursive: true });
  await Deno.remove(opened.install, { recursive: true });
}

async function post(
  core: Core,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function reference(opened: Opened, index = 0) {
  return {
    lophn_version: opened.guides.lophnVersion,
    title: opened.guides.guides[index].title,
    content_hash: opened.guides.guides[index].content_hash,
  };
}

type Section = { key: string; title: string; level: number };

Deno.test("documents/versions#R17: 설치 안내의 목록·상세·목차·절·본문을 derived 없이 offline으로 읽고 설치 판과 내용 hash를 낸다", async () => {
  const opened = await open();
  try {
    const list = await post(opened.core, "guides/list", {}, opened.token);
    assertEquals(list.status, 200, JSON.stringify(list.body));
    assertEquals(list.body["lophn_version"], "1.4.2");
    assertEquals(list.body["complete"], true);
    const guides = list.body["guides"] as {
      lophn_version: string;
      title: string;
      content_hash: string;
      files: { path: string; primary: boolean }[];
    }[];
    assertEquals(guides.map((guide) => guide.title), ["Projects", "Revert"]);
    assertEquals(
      guides.map((guide) => guide.content_hash),
      opened.guides.guides.map((guide) => guide.content_hash),
    );
    assertEquals(guides[0].files[0].path, "roles/lophn/guides/projects.md");

    const got = await post(opened.core, "guides/get", {
      reference: reference(opened),
    }, opened.token);
    assertEquals(got.status, 200, JSON.stringify(got.body));
    assertEquals(
      (got.body["guide"] as { content_hash: string }).content_hash,
      opened.guides.guides[0].content_hash,
    );

    const path = opened.guides.guides[0].path;
    const outline = await post(opened.core, "guides/outline", {
      reference: reference(opened),
      path,
    }, opened.token);
    assertEquals(outline.status, 200, JSON.stringify(outline.body));
    assertEquals(outline.body["section_status"], "whole");
    assertEquals(outline.body["complete"], true);
    const entries = outline.body["entries"] as Section[];
    assert(entries.some((entry) => entry.title === "Create a project"));
    assert(entries.some((entry) => entry.title === "Rename a project"));
    // 깊이 2 기본은 depth 3 section을 숨기고 숨은 자식 수로 알린다.
    assert(!entries.some((entry) => entry.title === "Rename limits"));
    const rename = entries.find((entry) => entry.title === "Rename a project");
    assertEquals(
      (rename as unknown as { hidden_children_count: number })
        .hidden_children_count,
      1,
    );

    const section = entries.find((entry) =>
      entry.title === "Create a project"
    )!;
    const part = await post(opened.core, "guides/read", {
      reference: reference(opened),
      path,
      section: section.key,
    }, opened.token);
    assertEquals(part.status, 200, JSON.stringify(part.body));
    assertEquals(part.body["section_status"], "found");
    assert(
      (part.body["text"] as string).includes("choose New project."),
    );
    assert(!(part.body["text"] as string).includes("Use the project menu."));

    const whole = await post(opened.core, "guides/read", {
      reference: reference(opened),
      path,
    }, opened.token);
    assertEquals(whole.status, 200, JSON.stringify(whole.body));
    assertEquals(whole.body["section_status"], "whole");
    assertEquals(whole.body["complete"], true);
    assert((whole.body["text"] as string).includes("Names must be unique."));
    const file = whole.body["file"] as {
      reference: { lophn_version: string; content_hash: string };
      path: string;
      blob_hash: string;
    };
    assertEquals(file.reference, reference(opened));
    assertEquals(file.blob_hash, opened.guides.guides[0].content_hash);
    assertEquals(file.path, path);

    const missing = await post(opened.core, "guides/read", {
      reference: reference(opened),
      path,
      section: "no-such-section",
    }, opened.token);
    assertEquals(missing.status, 200, JSON.stringify(missing.body));
    assertEquals(missing.body["section_status"], "missing");
    assertEquals(missing.body["text"], null);
    // derived store는 만들어지지 않았다: 안내 읽기가 만들지도 읽지도 않는다.
    let derived = true;
    try {
      await Deno.stat(`${opened.home}/derived/documents.sqlite`);
    } catch {
      derived = false;
    }
    assertEquals(derived, false);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R17: 안내를 읽어도 사용자 Document·ledger 변화가 생기지 않는다", async () => {
  const opened = await open();
  try {
    const before = await post(opened.core, "guides/list", {}, opened.token);
    const path = opened.guides.guides[0].path;
    for (const call of ["get", "outline", "read"]) {
      const answer = await post(opened.core, `guides/${call}`, {
        reference: reference(opened),
        ...(call === "get" ? {} : { path }),
      }, opened.token);
      assertEquals(answer.status, 200, JSON.stringify(answer.body));
    }
    const after = await post(opened.core, "guides/list", {}, opened.token);
    // 읽기 전후 ledger seq가 같다. event도 Document도 늘지 않았다.
    assertEquals(after.body["as_of_seq"], before.body["as_of_seq"]);
    const documents = await post(
      opened.core,
      "documents/list",
      {},
      opened.token,
    );
    assertEquals(documents.status, 200, JSON.stringify(documents.body));
    assertEquals(documents.body["documents"], []);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R17: 다른 설치 판·없는 제목·다른 hash·manifest 밖 경로는 모두 같은 not_found다", async () => {
  const opened = await open();
  try {
    const path = opened.guides.guides[0].path;
    const probes = [
      { reference: { ...reference(opened), lophn_version: "1.0.0" }, path },
      { reference: { ...reference(opened), title: "Other" }, path },
      {
        reference: { ...reference(opened), content_hash: "0".repeat(64) },
        path,
      },
      { reference: reference(opened), path: "roles/lophn/guides/other.md" },
      // 다른 안내의 파일은 이 안내의 manifest 밖이다
      { reference: reference(opened), path: opened.guides.guides[1].path },
    ];
    const answers = [];
    for (const probe of probes) {
      const answer = await post(
        opened.core,
        "guides/read",
        probe,
        opened.token,
      );
      assertEquals(answer.status, 404, JSON.stringify(answer.body));
      answers.push(answer.body);
    }
    for (const body of answers) assertEquals(body, answers[0]);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R17: 설치 파일이 manifest와 다르면 읽지 않고 unavailable이다", async () => {
  const opened = await open();
  try {
    const path = opened.guides.guides[0].path;
    await Deno.writeTextFile(
      `${opened.install}/guides/${path}`,
      "# Tampered\n",
    );
    for (const call of ["get", "outline", "read"]) {
      const answer = await post(opened.core, `guides/${call}`, {
        reference: reference(opened),
        ...(call === "get" ? {} : { path }),
      }, opened.token);
      assertEquals(
        answer.status,
        503,
        `${call} ${JSON.stringify(answer.body)}`,
      );
    }
    // 다른 안내는 그대로 읽힌다.
    const other = await post(opened.core, "guides/read", {
      reference: reference(opened, 1),
      path: opened.guides.guides[1].path,
    }, opened.token);
    assertEquals(other.status, 200, JSON.stringify(other.body));
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R17: 설치 안내가 없으면 빈 목록이 아니라 unavailable이다", async () => {
  const opened = await open();
  try {
    await Deno.remove(`${opened.install}/guides/manifest.json`);
    const list = await post(opened.core, "guides/list", {}, opened.token);
    assertEquals(list.status, 503, JSON.stringify(list.body));
  } finally {
    await close(opened);
  }
});

Deno.test("documents/outline-and-search#R7 R8 R9: 긴 안내 본문은 12,000 codepoint 조각으로 cursor를 따라 겹침 없이 이어지고 목차는 예산으로 끊겨 이어진다", async () => {
  const words = "lorem ipsum dolor sit amet ".repeat(40);
  const text = [
    "# Long guide",
    "",
    ...Array.from({ length: 30 }, (_, index) => [
      `## Part ${index + 1}`,
      "",
      `${words}${index}`,
      "",
    ]).flat(),
  ].join("\n");
  const opened = await open([{
    title: "Long guide",
    path: "roles/lophn/guides/long.md",
    text,
  }]);
  try {
    const ref = reference(opened);
    const path = opened.guides.guides[0].path;
    const pieces: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const answer = await post(opened.core, "guides/read", {
        reference: ref,
        path,
        ...(cursor === undefined ? {} : { cursor }),
      }, opened.token);
      assertEquals(
        answer.status,
        200,
        JSON.stringify(answer.body).slice(0, 300),
      );
      const piece = answer.body["text"] as string;
      assert([...piece].length <= 12000);
      pieces.push(piece);
      cursor = (answer.body["next_cursor"] as string | null) ?? undefined;
      pages += 1;
    } while (cursor !== undefined && pages < 20);
    assert(pages > 1, "본문이 한 조각을 넘어야 한다");
    // 긴 한 줄은 줄 안 codepoint 위치로 끊겨 이어진다: 조각을 그대로 이으면 원문이다.
    assertEquals(pieces.join(""), text);

    // 다른 조건의 cursor는 이어 읽지 않는다.
    const first = await post(opened.core, "guides/read", {
      reference: ref,
      path,
    }, opened.token);
    const stale = await post(opened.core, "guides/read", {
      reference: ref,
      path,
      section: "part-1",
      cursor: first.body["next_cursor"],
    }, opened.token);
    assertEquals(stale.status, 400, JSON.stringify(stale.body));

    // 목차는 예산이 작으면 끊기고 cursor로 모든 section을 한 번씩 낸다.
    const keys: string[] = [];
    let outlineCursor: string | undefined;
    let outlinePages = 0;
    do {
      const answer = await post(opened.core, "guides/outline", {
        reference: ref,
        path,
        estimated_token_budget: 200,
        ...(outlineCursor === undefined ? {} : { cursor: outlineCursor }),
      }, opened.token);
      assertEquals(
        answer.status,
        200,
        JSON.stringify(answer.body).slice(0, 300),
      );
      for (const entry of answer.body["entries"] as Section[]) {
        keys.push(entry.key);
      }
      outlineCursor = (answer.body["next_cursor"] as string | null) ??
        undefined;
      outlinePages += 1;
    } while (outlineCursor !== undefined && outlinePages < 60);
    assert(outlinePages > 1, "목차가 예산으로 끊겨야 한다");
    // 서문(_preamble) 하나와 Part 30개를 한 번씩 낸다.
    assertEquals(keys.length, 31);
    assertEquals(new Set(keys).size, 31);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R18: 안내는 편집·이동·보관 route가 없고 Document 명령은 안내를 대상으로 받지 않는다", async () => {
  const opened = await open();
  try {
    const target = reference(opened);
    for (const call of ["save", "update", "move", "archive", "rename"]) {
      const answer = await post(opened.core, `guides/${call}`, {
        reference: target,
      }, opened.token);
      assertEquals(answer.status, 404, `guides/${call}`);
    }
    // Document 명령은 doc ID만 받는다. 안내 참조는 대상이 아니다.
    for (const call of ["archive", "move"]) {
      const answer = await post(opened.core, `documents/${call}`, {
        document: opened.guides.guides[0].content_hash,
        place: null,
        name: null,
      }, opened.token);
      assertEquals(answer.status, 400, `documents/${call}`);
    }
    const documents = await post(
      opened.core,
      "documents/list",
      {},
      opened.token,
    );
    assertEquals(documents.body["documents"], []);
  } finally {
    await close(opened);
  }
});

Deno.test("documents/versions#R18: 사람이 남기려는 안내는 일반 문서 복사본으로 저장되고 설치 update가 복사본을 덮지 않는다", async () => {
  const opened = await open();
  try {
    assert(opened.core.notePrepared);
    const path = opened.guides.guides[0].path;
    const read = await post(opened.core, "guides/read", {
      reference: reference(opened),
      path,
    }, opened.token);
    assertEquals(read.status, 200, JSON.stringify(read.body));
    const copiedText = read.body["text"] as string;
    const copyHash = opened.guides.guides[0].content_hash;
    const noted = await opened.core.notePrepared({
      preparation: "prep-guide-copy",
      principal: "user-1",
      purpose: "document_files",
      hash: HASH,
      size_bytes: copiedText.length,
    }, AT);
    assert(noted.ok, noted.ok ? "" : noted.error.message);
    const notedFile = await opened.core.notePrepared({
      preparation: "prep-file-guide-copy",
      principal: "user-1",
      purpose: "document_file",
      hash: HASH,
      size_bytes: copiedText.length,
    }, AT);
    assert(notedFile.ok, notedFile.ok ? "" : notedFile.error.message);
    const saved = await post(opened.core, "documents/save", {
      input: {
        document: DOC,
        base_version: null,
        files_hash: HASH,
        file_count: 1,
        primary_path: "projects.md",
        content_hash: copyHash,
        preparation_ref: "prep-guide-copy",
        files: [{
          path: "projects.md",
          blob_hash: HASH,
          bytes: copiedText.length,
          media_type: "text/markdown",
          primary: true,
          preparation_ref: "prep-file-guide-copy",
        }],
        idempotency_key: "guide-copy",
        metadata: { title: "My projects notes", place: null, name: null },
        format: { name: "document", module_hash: HASH, explicit: false },
        validation: {
          input_hash: copyHash,
          module_hash: HASH,
          status: "passed",
          error_count: 0,
          warning_count: 0,
          diagnostics: [],
        },
        source: null,
      },
      idempotency_key: "guide-copy",
      compare: { base_version: null },
      prepared: ["prep-guide-copy"],
    }, opened.token);
    assertEquals(saved.status, 200, JSON.stringify(saved.body));
    const version = saved.body["version"] as string;
    const beforeUpdate = await post(opened.core, "documents/get", {
      document: DOC,
    }, opened.token);
    assertEquals(beforeUpdate.status, 200, JSON.stringify(beforeUpdate.body));

    // 설치 update: 새 판의 안내가 설치된다.
    const installed = reference(opened);
    opened.guides.write("1.5.0", [{
      title: "Projects",
      path,
      text: "# Projects\n\nRewritten by the new release.\n",
    }]);
    const updated = await post(opened.core, "guides/list", {}, opened.token);
    assertEquals(updated.body["lophn_version"], "1.5.0");
    const old = await post(opened.core, "guides/get", {
      reference: installed,
    }, opened.token);
    assertEquals(old.status, 404);

    // 복사본은 그대로다: 같은 판, 같은 내용 hash, 한 Document다.
    const afterUpdate = await post(opened.core, "documents/get", {
      document: DOC,
    }, opened.token);
    assertEquals(afterUpdate.status, 200, JSON.stringify(afterUpdate.body));
    assertEquals(afterUpdate.body["version"], beforeUpdate.body["version"]);
    assertEquals(
      (afterUpdate.body["version"] as { id: string; content_hash: string }).id,
      version,
    );
    assertEquals(
      (afterUpdate.body["version"] as { content_hash: string }).content_hash,
      copyHash,
    );
    const documents = await post(
      opened.core,
      "documents/list",
      {},
      opened.token,
    );
    assertEquals((documents.body["documents"] as unknown[]).length, 1);
  } finally {
    await close(opened);
  }
});
