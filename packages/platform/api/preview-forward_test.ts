// documents#T10: /v1/projects/preview_tracking route 연결 테스트. 감독 pipe 통로 뒤
// documents worker(T2)의 실행(acceptPreparation, 실제 폴더 scan)을 위임한 worker로
// 띄운다. 권한·한도·schema 뒤 worker로 넘기고 page를 그대로 돌려준다.
// 데이터는 fixtures 사본(temp)이고 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, ok, seededRandom } from "../../base/mod.ts";
import { ERROR_HTTP_STATUS } from "../../contracts/platform/mod.ts";
import {
  ROUTES as DOCUMENT_ROUTES,
  type TrackingPreview,
} from "../../contracts/documents/mod.ts";
import {
  type CredentialIssue,
  CredentialRegistry,
  type OperationPolicy,
} from "../identity/mod.ts";
import {
  type WorkerRouteHandle,
  type WorkerRouteLimits,
  type WorkerRouteTarget as ResponsivenessTarget,
} from "../responsiveness/mod.ts";
import { acceptPreparation } from "../../../apps/worker/documents/preparation.ts";
import {
  addGitDir,
  addLophnDataDir,
  copyFixture,
  removeFixtureCopy,
} from "../../../fixtures/projects/scenarios.ts";
import { startApiServer } from "./mod.ts";
import { RouteRegistry } from "./routes.ts";
import { call, value } from "./harness_test.ts";

const AT = "2026-10-04T00:00:00.000Z";

const POLICIES: OperationPolicy[] = [
  { name: "project.preview_tracking", actors: ["user"], kind: "read" },
  { name: "identity/current", actors: ["user"], kind: "read" },
];

// preview_tracking의 scope가 있는 credential이다. forward_test.ts와 같은 모양이다.
const USER: CredentialIssue = {
  actor: "user",
  principal: "user",
  scope: {
    operations: ["project.preview_tracking", "identity/current"],
    targets: {},
  },
  conditions: { process: "main-generation" },
};

function target(
  handle: WorkerRouteHandle,
  limits?: WorkerRouteLimits,
): ResponsivenessTarget {
  return { handle, ...(limits === undefined ? {} : { limits }) };
}

// worker target은 documents worker(T2)의 실제 실행(acceptPreparation)을 위임한다.
// observation은 documents/worker의 준비 여부고, forward는 acceptPreparation의
// 결과를 worker_response envelope로 답한다.
function previewWorker(): ResponsivenessTarget {
  return target({
    observation: () => ({
      component: "documents/worker",
      available: true,
      observed_at: AT,
    }),
    forward: async (request) =>
      ok({
        type: "worker_response" as const,
        request_id: request.request_id,
        ok: true as const,
        payload: await acceptPreparation(request),
      }),
  });
}

async function openPreviewServer(
  workers?: ReadonlyMap<string, ResponsivenessTarget>,
) {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const credentials = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random: seededRandom(5),
    operations: POLICIES,
  });
  const issued = value(await credentials.issue(USER));
  const server = await startApiServer({
    port: 0,
    clock,
    credentials,
    workers: workers ??
      new Map([["projects/preview_tracking", previewWorker()]]),
    registry: new RouteRegistry([...DOCUMENT_ROUTES]),
  });
  return {
    server,
    base: `http://127.0.0.1:${server.port}`,
    token: issued.token,
  };
}

function trackBody(
  root: string,
  patterns: readonly { effect: "include" | "exclude"; glob: string }[],
  useGitignore: boolean,
  enabled: boolean,
) {
  return JSON.stringify({
    project: "prj_01arz3ndektsv4rrffq69g5fav",
    base_revision: "1",
    folders: [{ path: root, description: "" }],
    tracking: { enabled, patterns, use_gitignore: useGitignore },
  });
}

async function postPreview(
  opened: { base: string; token: string },
  body: string,
): Promise<Response> {
  return await call(opened.base, "/v1/projects/preview_tracking", {
    method: "POST",
    token: opened.token,
    headers: { "content-type": "application/json" },
    body,
  });
}

Deno.test("documents/projects#R6: preview_tracking route는 실제 폴더 scan을 page로 돌려준다", async () => {
  const root = await copyFixture("notes-basic");
  const opened = await openPreviewServer();
  try {
    const response = await postPreview(
      opened,
      trackBody(root, [{ effect: "include", glob: "**/*.md" }], true, true),
    );
    assertEquals(response.status, 200);
    const body = await response.json() as TrackingPreview;
    // 응답은 요청과 같은 project·base_revision·folders·tracking이다(R6).
    assertEquals(body.project, "prj_01arz3ndektsv4rrffq69g5fav");
    assertEquals(body.base_revision, "1");
    assertEquals(body.folders, [{ path: root, description: "" }]);
    assertEquals(body.tracking, {
      enabled: true,
      patterns: [{ effect: "include", glob: "**/*.md" }],
      use_gitignore: true,
    });
    assertEquals(body.complete, true);
    assertEquals(body.next_cursor, null);
    assert(body.observed_at.length > 0);
    const included = body.entries.filter((entry) => entry.included);
    // 감독 pipe 통로 뒤 실제 폴더 scan이 page로 나온다(R6).
    assert(
      included.some((entry) => entry.path === "index.md"),
      "index.md를 포함한다",
    );
    assert(
      included.some((entry) => entry.path === "deep/sub/inner.md"),
      "하위 폴더를 포함한다",
    );
    assert(
      included.every((entry) => entry.reason === "include **/*.md"),
      "이유는 include <glob>이다",
    );
    // .gitignore가 걸리는 파일은 제외 이유가 있다(R5).
    const excluded = body.entries.filter((entry) => !entry.included);
    const hidden = excluded.find((entry) => entry.path === "ignored/hidden.md");
    assertEquals(hidden?.reason, "gitignore");
    const secret = excluded.find((entry) => entry.path === "private.secret.md");
    assertEquals(secret?.reason, "gitignore");
    const notes = excluded.find((entry) => entry.path === "notes.txt");
    assertEquals(notes?.reason, "unmatched");
    // 모든 entry의 folder_path는 등록 root다(R6).
    for (const entry of body.entries) {
      assertEquals(entry.folder_path, root);
    }
  } finally {
    await opened.server.stop();
    await removeFixtureCopy(root);
  }
});

Deno.test("documents/projects#R5: preview_tracking route도 .git 내부와 lophn data 폴더를 추적 불가로 돌려준다", async () => {
  const root = await copyFixture("notes-basic");
  await addGitDir(root);
  await addLophnDataDir(root);
  const opened = await openPreviewServer();
  try {
    const response = await postPreview(
      opened,
      trackBody(
        root,
        [{ effect: "include", glob: "**/*" }],
        // .gitignore 없이 include-all을 건다. .git·.lophn 내부는 이 밖으로도 추적 불가다.
        false,
        true,
      ),
    );
    assertEquals(response.status, 200);
    const body = await response.json() as TrackingPreview;
    const inGit = body.entries.filter((entry) =>
      entry.path.startsWith(".git/")
    );
    const inLophn = body.entries.filter((entry) =>
      entry.path.startsWith(".lophn/")
    );
    assert(inGit.length > 0, ".git 내부 파일을 결과에 남긴다");
    assert(inLophn.length > 0, ".lophn 내부 파일을 결과에 남긴다");
    // .git·.lophn 내부는 include로도 추적 불가이고 전부 제외다(R5).
    for (const entry of [...inGit, ...inLophn]) {
      assertEquals(entry.included, false);
      assertEquals(
        ["inside .git", "inside lophn data"].includes(entry.reason),
        true,
        `제외 이유는 .git·lophn data다: ${entry.reason}`,
      );
    }
  } finally {
    await opened.server.stop();
    await removeFixtureCopy(root);
  }
});

Deno.test("documents/projects#R3: 꺼진 tracking의 preview는 파일을 모두 제외로 돌려준다", async () => {
  const root = await copyFixture("notes-basic");
  const opened = await openPreviewServer();
  try {
    const response = await postPreview(
      opened,
      trackBody(root, [{ effect: "include", glob: "**/*.md" }], true, false),
    );
    assertEquals(response.status, 200);
    const body = await response.json() as TrackingPreview;
    assertEquals(body.complete, true);
    assertEquals(body.next_cursor, null);
    // 켜기 전에는 추적하지 않는다(R3).
    assertEquals(body.entries.some((entry) => entry.included), false);
    const off = body.entries.find((entry) => entry.path === "index.md");
    assertEquals(off?.reason, "tracking disabled");
  } finally {
    await opened.server.stop();
    await removeFixtureCopy(root);
  }
});

Deno.test("documents/projects#R6: 권한 밖 scope는 worker에 닿지 않고 forbidden이다", async () => {
  const clock = manualClock(Date.parse("2026-10-04T00:00:00.000Z"));
  const credentials = new CredentialRegistry({
    epoch: "core-one",
    clock,
    random: seededRandom(5),
    operations: POLICIES,
  });
  const issued = value(
    await credentials.issue({
      actor: "user",
      principal: "user",
      scope: { operations: ["identity/current"], targets: {} },
      conditions: { process: "main-generation" },
    }),
  );
  let forwarded = 0;
  const server = await startApiServer({
    port: 0,
    clock,
    credentials,
    workers: new Map([
      [
        "projects/preview_tracking",
        target({
          observation: () => ({
            component: "documents/worker",
            available: true,
            observed_at: AT,
          }),
          forward: () => {
            forwarded += 1;
            throw new Error("must not forward");
          },
        }),
      ],
    ]),
    registry: new RouteRegistry([...DOCUMENT_ROUTES]),
  });
  const opened = {
    server,
    base: `http://127.0.0.1:${server.port}`,
    token: issued.token,
  };
  try {
    const response = await postPreview(
      opened,
      trackBody("/tmp/lophn-preview-test", [], false, false),
    );
    assertEquals(response.status, ERROR_HTTP_STATUS.forbidden);
    assertEquals((await response.json()).error.code, "forbidden");
    assertEquals(forwarded, 0);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("documents/projects#R6: worker가 없으면 unavailable이다", async () => {
  const opened = await openPreviewServer(new Map());
  try {
    const response = await postPreview(
      opened,
      trackBody("/tmp/lophn-preview-test", [], false, false),
    );
    assertEquals(response.status, ERROR_HTTP_STATUS.unavailable);
    assertEquals((await response.json()).error.code, "unavailable");
  } finally {
    await opened.server.stop();
  }
});
