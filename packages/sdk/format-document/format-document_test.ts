// @lophn/format-document의 검사다(apps/sdk#R2, R4, apps#T29 완료 기준).
// catalog 등록은 실제 core(temp LOPHN_HOME)를 띄워 HTTP로 본다.
import { assert, assertEquals } from "@std/assert";
import { createCoreHarness } from "../../../apps/core/testing/core.ts";
import type { TeamModule } from "../../../apps/core/registration.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../../apps/core/apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../../apps/core/documents.ts";
import { installPackage } from "../../core/apps/packages/install.ts";
import {
  BUILTIN_MODULE_HASH,
} from "../../core/projects/formats/guest/module-hash.ts";
import { DOCUMENT_MODULE_HASH, documentFormat } from "./mod.ts";

// catalog command는 apps 팀이, format read는 documents 팀이 붙인다.
const teams: TeamModule[] = [
  { createLedgerRegistration: createDocumentsRegistration },
  { createLedgerRegistration: createAppsRegistration },
];

function poster(
  port: number,
  token: string,
): (
  resource: string,
  method: string,
  body: unknown,
) => Promise<{ status: number; body: unknown }> {
  return async (resource, method, body) => {
    const response = await fetch(
      `http://127.0.0.1:${port}/v1/${resource}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };
}

function guideText(sections: string): string {
  return sections;
}

// guide 원문. patch·minor·major 절이 있어야 catalog가 받는다(apps/sdk#R12).
const GUIDE = guideText(`# @lophn/format-document

## patch
API와 동작을 유지한 내부 수정이다.

## minor
기존 API를 유지한 선언 필드 추가다.

## major
선언 내용의 제거나 변경, module hash 교체다.
`);

Deno.test("apps/sdk#R4: @lophn/format-document는 정확한 1.0.0으로 낸다", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("./deno.json", import.meta.url)),
  );
  assertEquals(config.name, "@lophn/format-document");
  assertEquals(config.version, "1.0.0");
});

Deno.test("apps/sdk#R2: Package는 kind=format 하나만 담고 선언만 내놓는다", async () => {
  const text = await Deno.readTextFile(
    new URL("./mod.ts", import.meta.url),
  );
  // mod.ts는 import가 없다 — 데이터 선언뿐이고 검사 코드는 넣지 않는다.
  assertEquals(/(^|\n)import\s/.test(text), false);
  // media type·template·guide·vocabulary·FormatRef가 선언에 있다.
  assertEquals(documentFormat.name, "document");
  assertEquals(
    documentFormat.media_types,
    [
      "text/markdown",
      "text/x-markdown",
      "text/html",
      "application/xhtml+xml",
      "text/plain",
    ],
  );
  assert(documentFormat.template.length >= 1);
  assertEquals(documentFormat.template[0].path, "document.md");
  assertEquals(typeof documentFormat.guide.text, "string");
  assert(documentFormat.guide.examples.length >= 1);
  assert(documentFormat.vocabulary.length >= 1);
  assertEquals(documentFormat.extracts, true);
  assertEquals(DOCUMENT_MODULE_HASH, BUILTIN_MODULE_HASH);
});

Deno.test("apps/sdk#R2: Package는 catalog에 kind=format 1.0.0으로 등록된다", async () => {
  const opened = await createCoreHarness({
    teams,
    teamModules: [
      new URL("../../../apps/core/apps.ts", import.meta.url).href,
    ],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "machine",
      principal: "install",
      scope: {
        operations: [
          "package.register_version",
          "packages.list",
          "packages.versions",
        ],
        targets: {},
      },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const post = poster(harness.port, issued.value.token);

    const registered = await post("packages", "register_version", {
      input: {
        name: "@lophn/format-document",
        description: "내장 document format 선언 SDK",
        kind: "format",
        version: "1.0.0",
        bundle_hash: "a".repeat(64),
        guide_hash: "b".repeat(64),
      },
      idempotency_key: "r2-format-document",
      compare: {},
      prepared: [],
    });
    assertEquals(registered.status, 200, JSON.stringify(registered.body));

    // 같은 Package에 다른 kind는 conflict다(apps/sdk#R2).
    const other = await post("packages", "register_version", {
      input: {
        name: "@lophn/format-document",
        description: "내장 document format 선언 SDK",
        kind: "component",
        version: "1.1.0",
        bundle_hash: "a".repeat(64),
        guide_hash: "b".repeat(64),
      },
      idempotency_key: "r2-format-document-other",
      compare: {},
      prepared: [],
    });
    assertEquals(other.status, 409, JSON.stringify(other.body));

    const versions = await post("packages", "versions", {
      name: "@lophn/format-document",
    });
    assertEquals(versions.status, 200, JSON.stringify(versions.body));
    const listed = versions.body as { versions: { version: string }[] };
    assertEquals(listed.versions.map((entry) => entry.version), ["1.0.0"]);
  } finally {
    await harness.close();
  }
});

Deno.test("apps/sdk#R4: 설치는 packages/sdk/format-document를 1.0.0으로 묶는다", async () => {
  const dataRoot = await Deno.makeTempDir({ prefix: "lophn-fd-install-" });
  try {
    const installed = await installPackage(
      "@lophn/format-document",
      "내장 document format 선언 SDK",
      "format",
      "1.0.0",
      new TextEncoder().encode(GUIDE),
      { dataRoot },
    );
    assert(installed.ok, installed.ok ? "" : installed.error.message);
    assertEquals(installed.value.name, "@lophn/format-document");
    assertEquals(installed.value.version, "1.0.0");
    assertEquals(
      [...installed.value.files].sort(),
      ["deno.json", "format-document_test.ts", "guide.md", "mod.ts"],
    );
  } finally {
    // 사본은 0555라 그대로는 못 지운다. 권한을 복구한 뒤 지운다.
    await restorePermissions(dataRoot);
    await Deno.remove(dataRoot, { recursive: true });
  }
});

// 임시 root 아래 디렉터리를 0755로 돌려놓는다(정리용).
async function restorePermissions(root: string): Promise<void> {
  const directories: string[] = [root];
  for (let index = 0; index < directories.length; index += 1) {
    const current = directories[index];
    await Deno.chmod(current, 0o755);
    try {
      for await (const entry of Deno.readDir(current)) {
        if (entry.isDirectory) {
          directories.push(`${current}/${entry.name}`);
        }
      }
    } catch {
      // 읽을 수 없는 항목은 무시한다.
    }
  }
}

Deno.test("apps/sdk#R4: FormatRef의 module_hash가 documents#T4의 format get과 같다", async () => {
  const opened = await createCoreHarness({ teams });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  try {
    const issued = await harness.credential({
      actor: "user",
      principal: "user-1",
      scope: {
        operations: ["format.get"],
        targets: {},
      },
      conditions: {},
    });
    assert(issued.ok, issued.ok ? "" : issued.error.message);
    const response = await fetch(
      `http://127.0.0.1:${harness.port}/v1/formats/get`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${issued.value.token}`,
        },
        body: JSON.stringify({
          name: "document",
          module_hash: DOCUMENT_MODULE_HASH,
        }),
      },
    );
    const text = await response.text();
    assertEquals(response.status, 200, text);
    const body = JSON.parse(text) as Record<string, unknown>;
    assertEquals(body.module_hash, DOCUMENT_MODULE_HASH);
    assertEquals(body.name, "document");
    // 선언 내용도 같다 — SDK Package가 documents#T3·T4 선언을 그대로 담는다.
    assertEquals(
      body.media_types,
      documentFormat.media_types,
    );
    assertEquals(body.structure, documentFormat.structure);
    assertEquals(body.metadata, documentFormat.metadata);
    assertEquals(body.template, documentFormat.template);
    assertEquals(body.guide, documentFormat.guide);
    assertEquals(body.extracts, documentFormat.extracts);
  } finally {
    await harness.close();
  }
});
