// 실제 소유 command(documents의 `document.rename`)가 approval 요청 → 사람의 허락 → 적용으로 끝까지
// 가는지 실제 core와 임시 LOPHN_HOME의 HTTP route로 본다(platform/approvals#R5 #R7 #R11, platform Q26).
// command 이름은 소유 route 이름 그대로(`document.rename`)라 변환 없이 action이 된다.
// 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import type {
  ApprovalAction,
  ApprovalRequest,
  AuthenticatedContext,
} from "../../packages/protocol/platform/mod.ts";
import {
  actionOf,
  call,
  codeOf,
  command,
  count,
  createInput,
  decide,
  inspect,
  type Reply,
} from "./testing/approvals-fixture.ts";
import { type CoreHarness, createCoreHarness } from "./testing/core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";

const teams: TeamModule[] = [{ createLedgerRegistration }];
const HASH = "ab".repeat(32);
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const APR_ONE = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const APR_TWO = "apr_01h455vb4pex5v6nkc6gd5fdw2";

const RENAMED =
  "select count(*) as n from events where type = 'DocumentRenamed'";
const USES = "select count(*) as n from approval_uses";

type Login = { token: string; context: AuthenticatedContext };

function savedDocument(place: unknown, name: string | null) {
  return {
    document: DOC,
    base_version: null,
    files_hash: HASH,
    file_count: 1,
    primary_path: "a.md",
    content_hash: HASH,
    preparation_ref: "prep-create",
    files: [{
      path: "a.md",
      blob_hash: HASH,
      bytes: 10,
      media_type: "text/markdown",
      primary: true,
      preparation_ref: "prep-file-create",
    }],
    idempotency_key: "create",
    metadata: { title: "Notes", place, name },
    format: { name: "document", module_hash: HASH, explicit: false },
    validation: {
      input_hash: HASH,
      module_hash: HASH,
      status: "passed",
      error_count: 0,
      warning_count: 0,
      diagnostics: [],
    },
    source: null,
  };
}

async function login(
  harness: CoreHarness,
  actor: "user" | "coding_agent",
  principal: string,
  operations: string[],
): Promise<Login> {
  const issued = await harness.credential({
    actor,
    principal,
    scope: { operations, targets: {} },
    conditions: {},
  });
  assert(issued.ok, issued.ok ? "" : issued.error.message);
  return issued.value;
}

function post(
  harness: CoreHarness,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
  prepared: string[] = [],
): Promise<Reply> {
  return call(
    harness,
    path,
    token,
    {
      input,
      idempotency_key: `k-${crypto.randomUUID()}`,
      compare,
      prepared,
    },
  );
}

function revisionOf(harness: CoreHarness): string {
  const rows = inspect(harness, "select revision from documents where id = ?", [
    DOC,
  ]);
  return String(rows[0]["revision"]);
}

async function open() {
  const opened = await createCoreHarness({
    io: true,
    teams,
    teamModules: [new URL("./documents.ts", import.meta.url).href],
  });
  assert(opened.ok, opened.ok ? "" : opened.error.message);
  const harness = opened.value;
  const apply = "apply_approved_action";
  const reads = ["GetApproval", "document.resolve"];
  const user = await login(harness, "user", "user-1", [
    "project.create",
    "document.save",
    "document.rename",
    "document.move",
    "grant_approval_request",
    apply,
    ...reads,
  ]);
  const agent = await login(harness, "coding_agent", "agent-1", [
    "create_approval_request",
    ...reads,
  ]);
  for (
    const [ref, purpose, size] of [
      ["prep-create", "document_files", 0],
      ["prep-file-create", "document_file", 10],
    ] as const
  ) {
    const noted = await harness.notePrepared(
      {
        preparation: ref,
        principal: "user-1",
        purpose,
        hash: HASH,
        size_bytes: size,
      },
      Date.UTC(2024, 0, 1),
    );
    assert(noted.ok, noted.ok ? "" : noted.error.message);
  }
  const project = await post(harness, "projects/create", user.token, {
    id: PROJECT,
    name: "mahas",
    title: "Notes",
    purpose: "",
    folders: [{ path: "/tmp/lophn-test-documents", description: "" }],
    tracking: { enabled: false, patterns: [], use_gitignore: false },
  });
  assertEquals(project.status, 200, JSON.stringify(project.body));
  const saved = await post(
    harness,
    "documents/save",
    user.token,
    savedDocument({ kind: "project", id: PROJECT }, "report"),
    { base_version: null },
    ["prep-create"],
  );
  assertEquals(saved.status, 200, JSON.stringify(saved.body));
  return { harness, user, agent };
}

function renameAction(
  name: string,
  revision: string,
): Promise<ApprovalAction> {
  return actionOf({
    concern: "documents/addressing",
    command: "document.rename",
    caller: "user",
    targets: [DOC],
    value: { document: DOC, name },
    comparison: { base_revision: revision },
  });
}

Deno.test("platform/approvals#R5 #R7 #R11: documents의 document.rename이 요청 → 허락 → 적용으로 한 번만 일어나고 낡은 전제는 되돌아간다", async () => {
  const { harness, user, agent } = await open();
  try {
    const revision = revisionOf(harness);
    const action = await renameAction("weekly", revision);
    const created = await call(
      harness,
      "approvals/create",
      agent.token,
      command(
        await createInput(APR_ONE, agent.context.actor, action, {
          reason: "문서 이름을 weekly로 바꾸려 한다",
        }),
      ),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    // dot 이름 그대로 action에 고정된다.
    assertEquals(
      (created.body["request"] as ApprovalRequest).action.command,
      "document.rename",
    );
    // 사람이 허락해도 문서는 아직 그대로다(R9).
    const decided = await decide(
      harness,
      user.token,
      created.body["request"] as ApprovalRequest,
      "grant",
    );
    assertEquals(decided.status, 200, JSON.stringify(decided.body));
    assertEquals(count(harness, RENAMED), 0);
    assertEquals(
      inspect(harness, "select name from documents where id = ?", [DOC])[0][
        "name"
      ],
      "report",
    );

    // 정확한 action이 아니면 시작하지 않는다.
    const wrongName = await call(
      harness,
      "approvals/apply",
      user.token,
      command({
        approval: APR_ONE,
        action: await renameAction("daily", revision),
        idempotency_key: "wrong-name",
      }),
    );
    assertEquals(wrongName.status, 409, JSON.stringify(wrongName.body));
    assertEquals(count(harness, RENAMED), 0);

    // 고정 호출자(user)가 적용하면 소유 command가 같은 transaction에서 이름을 바꾸고 사용이 남는다.
    const applied = await call(
      harness,
      "approvals/apply",
      user.token,
      command({
        approval: APR_ONE,
        action,
        idempotency_key: "apply-1",
      }),
    );
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals(applied.body["replayed"], false);
    const use = applied.body["use"] as {
      concern: string;
      receipt: { kind: string; seq: string };
    };
    assertEquals(use.concern, "documents/addressing");
    assertEquals(
      count(
        harness,
        "select count(*) as n from events where seq = ? and type = 'DocumentRenamed'",
        [Number(use.receipt.seq)],
      ),
      1,
    );
    assertEquals(
      inspect(harness, "select name from documents where id = ?", [DOC])[0][
        "name"
      ],
      "weekly",
    );
    assertEquals(count(harness, RENAMED), 1);
    assertEquals(count(harness, USES), 1);

    // 옛 이름의 address도 현재 문서로 이어진다: 소유 command의 실제 효과다.
    const resolved = await call(harness, "documents/resolve", user.token, {
      reference: {
        place: "mahas",
        document: "report",
        section: null,
        version: null,
      },
    });
    assertEquals(resolved.status, 200, JSON.stringify(resolved.body));
    assertEquals(
      (resolved.body["resolved"] as { redirected: boolean }).redirected,
      true,
    );

    // 같은 approval의 재호출은 같은 receipt이고 두 번째 이름 변경은 없다.
    const again = await call(
      harness,
      "approvals/apply",
      user.token,
      command({
        approval: APR_ONE,
        action,
        idempotency_key: "apply-2",
      }),
    );
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(again.body["replayed"], true);
    assertEquals(again.body["use"], applied.body["use"]);
    assertEquals(count(harness, RENAMED), 1);

    // 허락 뒤 문서가 바뀌어(revision 이동) 낡은 전제가 된 허락은 소유 command의 거절로 되돌아간다.
    const stale = await renameAction("monthly", revision);
    const staleCreated = await call(
      harness,
      "approvals/create",
      agent.token,
      command(await createInput(APR_TWO, agent.context.actor, stale)),
    );
    assertEquals(staleCreated.status, 200, JSON.stringify(staleCreated.body));
    const staleGranted = await decide(
      harness,
      user.token,
      staleCreated.body["request"] as ApprovalRequest,
      "grant",
    );
    assertEquals(staleGranted.status, 200, JSON.stringify(staleGranted.body));
    const refused = await call(
      harness,
      "approvals/apply",
      user.token,
      command({
        approval: APR_TWO,
        action: stale,
        idempotency_key: "apply-stale",
      }),
    );
    assertEquals(refused.status, 409, JSON.stringify(refused.body));
    assertEquals(codeOf(refused), "conflict");
    assertEquals(count(harness, RENAMED), 1);
    assertEquals(count(harness, USES), 1);
    assertEquals(
      inspect(harness, "select name from documents where id = ?", [DOC])[0][
        "name"
      ],
      "weekly",
    );
  } finally {
    await harness.close();
  }
});
