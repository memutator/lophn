import { assert, assertEquals } from "@std/assert";
import {
  APP,
  ASG,
  CTX,
  FAIL_MARKER,
  OTHER_PRJ,
  PRJ,
} from "./registration_test.ts";
import {
  type AgentHarness,
  assignmentRows,
  envelope,
  eventsOf,
  failure,
  issuesOf,
  machineCred,
  openAgents,
  placeDir,
  readAgentFile,
  seedFixtureFiles,
  sha256,
  userCred,
  value,
  writeAgentFile,
} from "./testing/mod.ts";

// SaveAgent·DeleteAgent·ChangePlaceAgentSettings. 실제 writer(harness)와 실제 임시 폴더를 쓴다.

const PROJECT = { kind: "project", id: PRJ } as const;
const APP_PLACE = { kind: "app", id: APP } as const;
const OTHER = { kind: "project", id: OTHER_PRJ } as const;

const REVIEWER_FILE = `${ASG.reviewer}.md`;

async function withAgents(run: (ctx: AgentHarness) => Promise<void>) {
  const ctx = await openAgents();
  try {
    seedFixtureFiles(ctx.root);
    await run(ctx);
  } finally {
    await ctx.h.close();
  }
}

type Saved = { assignment: string; role: string; hash: string };

function save(
  ctx: AgentHarness,
  input: Record<string, unknown>,
  hash: string | null,
  as = userCred,
) {
  return ctx.h.command(
    as,
    envelope("SaveAgent", input, { hash }),
  );
}

function saved(result: Awaited<ReturnType<typeof save>>): Saved {
  return value(result).result as Saved;
}

function operators(rows: Record<string, unknown>[]) {
  return rows.filter((row) => row["role"] === "operator");
}

Deno.test("lophn-agent/agents#R3 [agent-I9]: a new Operator gets its assignment and a file named after it in the app data folder", async () => {
  await withAgents(async (ctx) => {
    const before = await assignmentRows(ctx.h).then((rows) =>
      operators(rows).length
    );
    const result = saved(
      await save(ctx, {
        place: PROJECT,
        definition: { name: "Night shift", body: "Turn notes into drafts." },
      }, null),
    );
    assertEquals(result.role, "operator");
    const rows = operators(await assignmentRows(ctx.h));
    assertEquals(rows.length, before + 1);
    const row = rows.find((r) => r["id"] === result.assignment)!;
    assertEquals(row["scope_kind"], "project");
    assertEquals(row["scope_id"], PRJ);
    assertEquals(row["state"], "enabled");

    const text = readAgentFile(ctx.root, PROJECT, `${result.assignment}.md`);
    assertEquals(
      text,
      "---\nname: Night shift\n---\n\nTurn notes into drafts.\n",
    );
    assertEquals(result.hash, sha256(text!));
  });
});

Deno.test("lophn-agent/agents#R3 [agent-I9]: two Operators of one project are two files and an app Operator lives under the app folder", async () => {
  await withAgents(async (ctx) => {
    const one = saved(
      await save(ctx, {
        place: PROJECT,
        definition: { name: "One", body: "first" },
      }, null),
    );
    const two = saved(
      await save(ctx, {
        place: PROJECT,
        definition: { name: "Two", body: "second" },
      }, null),
    );
    assert(one.assignment !== two.assignment);
    assert(readAgentFile(ctx.root, PROJECT, `${one.assignment}.md`) !== null);
    assert(readAgentFile(ctx.root, PROJECT, `${two.assignment}.md`) !== null);
    const app = saved(
      await save(ctx, {
        place: APP_PLACE,
        definition: {
          name: "Reader",
          app_reads: [{ app: APP, command: "status" }],
          body: "Read the status.",
        },
      }, null),
    );
    assert(readAgentFile(ctx.root, APP_PLACE, `${app.assignment}.md`) !== null);
    assertEquals(
      readAgentFile(ctx.root, PROJECT, `${app.assignment}.md`),
      null,
    );
  });
});

Deno.test("lophn-agent/agents#R28 [agent-I9]: saving records AgentSaved with the place, role and the file hashes before and after", async () => {
  await withAgents(async (ctx) => {
    const created = saved(
      await save(ctx, {
        place: PROJECT,
        definition: { name: "Night shift", body: "v1" },
      }, null),
    );
    const edited = saved(
      await save(ctx, {
        place: PROJECT,
        assignment: created.assignment,
        definition: { name: "Night shift", body: "v2" },
      }, created.hash),
    );
    const events = await eventsOf(ctx.h, "AgentSaved");
    assertEquals(events.length, 2);
    assertEquals(events[0], {
      subject: created.assignment,
      actor: events[0].actor,
      payload: {
        place: PROJECT,
        role: "operator",
        before_hash: null,
        after_hash: created.hash,
      },
    });
    assert(events[0].actor.startsWith("user"));
    assertEquals(events[1].payload, {
      place: PROJECT,
      role: "operator",
      before_hash: created.hash,
      after_hash: edited.hash,
    });
    // 내용의 전후는 hash뿐이고 글은 event에 없다.
    assert(!JSON.stringify(events).includes("v2"));
  });
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: editing overwrites the whole file, keeps the assignment, and clears fields left out", async () => {
  await withAgents(async (ctx) => {
    const path = readAgentFile(ctx.root, PROJECT, REVIEWER_FILE)!;
    const before = operators(await assignmentRows(ctx.h));
    const edited = saved(
      await save(ctx, {
        place: PROJECT,
        assignment: ASG.reviewer,
        definition: { name: "Reviewer", body: "Only the body now." },
      }, sha256(path)),
    );
    assertEquals(edited.assignment, ASG.reviewer);
    assertEquals(
      readAgentFile(ctx.root, PROJECT, REVIEWER_FILE),
      "---\nname: Reviewer\n---\n\nOnly the body now.\n",
    );
    assertEquals(operators(await assignmentRows(ctx.h)), before);
  });
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: a stale or wrong file hash is a conflict and nothing changes", async () => {
  await withAgents(async (ctx) => {
    const text = readAgentFile(ctx.root, PROJECT, REVIEWER_FILE)!;
    const edit = (hash: string | null) =>
      save(ctx, {
        place: PROJECT,
        assignment: ASG.reviewer,
        definition: { name: "Reviewer", body: "changed" },
      }, hash);
    failure(await edit("0".repeat(64)), "conflict");
    // 파일이 있는데 없다고 보낸 저장도 같은 conflict다.
    failure(await edit(null), "conflict");
    // 파일이 아직 없는 built-in에 hash를 보내도 conflict다.
    failure(
      await save(ctx, {
        place: OTHER,
        assignment: ASG.lophn,
        definition: { body: "x" },
      }, sha256("x")),
      "conflict",
    );
    assertEquals(readAgentFile(ctx.root, PROJECT, REVIEWER_FILE), text);
    assertEquals((await eventsOf(ctx.h, "AgentSaved")).length, 0);
  });
});

Deno.test("lophn-agent/agents#R5 [agent-I9]: blank names and bodies, built-in names and duplicate names are rejected with the field", async () => {
  await withAgents(async (ctx) => {
    const attempt = (definition: Record<string, unknown>) =>
      save(ctx, { place: PROJECT, definition }, null);
    assertEquals(
      issuesOf(await attempt({ name: "Okay", body: "  " })),
      ["body:required"],
    );
    assertEquals(issuesOf(await attempt({ body: "x" })), ["name:required"]);
    // 공백뿐인 이름은 route 입력 검사가 먼저 거절한다.
    failure(await attempt({ name: "  ", body: "x" }), "invalid_input");
    for (const name of ["lophn", "Context Engineer", " app engineer "]) {
      assertEquals(
        issuesOf(await attempt({ name, body: "x" })),
        ["name:reserved_name"],
      );
    }
    // 같은 자리 Operator와 앞뒤 공백·대소문자만 다른 이름이다.
    assertEquals(
      issuesOf(await attempt({ name: "  scribe ", body: "x" })),
      ["name:duplicate"],
    );
    // 다른 자리의 같은 이름은 된다.
    saved(
      await save(ctx, {
        place: OTHER,
        definition: { name: "Scribe", body: "x" },
      }, null),
    );
    // 자기 자신의 이름은 중복이 아니다.
    const text = readAgentFile(ctx.root, PROJECT, `${ASG.scribe}.md`)!;
    saved(
      await save(ctx, {
        place: PROJECT,
        assignment: ASG.scribe,
        definition: { name: "SCRIBE", body: "x" },
      }, sha256(text)),
    );
  });
});

Deno.test("lophn-agent/agents#R24 [agent-I9]: a valid body with a context that is not real changes nothing and names the context field", async () => {
  await withAgents(async (ctx) => {
    const before = await assignmentRows(ctx.h);
    const missing = "ctx_01arz3ndektsv4rrffq69g5fz9";
    const result = await save(ctx, {
      place: PROJECT,
      definition: {
        name: "Planner",
        contexts: [CTX.one, missing],
        body: "Plan the week.",
      },
    }, null);
    assertEquals(issuesOf(result), ["contexts.1:missing_reference"]);
    assertEquals(await assignmentRows(ctx.h), before);
    assertEquals((await eventsOf(ctx.h, "AgentSaved")).length, 0);
    assertEquals(
      [...Deno.readDirSync(placeDir(ctx.root, PROJECT))].map((e) => e.name)
        .filter((name) => name.startsWith("asg_")).sort(),
      [`${ASG.reviewer}.md`, `${ASG.scribe}.md`],
    );
    // 보관한 context도 실제 context라 고를 수 있다.
    saved(
      await save(ctx, {
        place: PROJECT,
        definition: {
          name: "Planner",
          contexts: [CTX.one, CTX.archived],
          body: "Plan the week.",
        },
      }, null),
    );
  });
});

Deno.test("lophn-agent/agents#R24 [agent-I9]: every wrong field is listed together", async () => {
  await withAgents(async (ctx) => {
    const result = await save(ctx, {
      place: PROJECT,
      definition: {
        name: "lophn",
        contexts: ["ctx_01arz3ndektsv4rrffq69g5fz9"],
        permissions: { tools: ["ticket.create"] },
        body: "",
      },
    }, null);
    assertEquals(issuesOf(result), [
      "body:required",
      "contexts.0:missing_reference",
      "name:reserved_name",
      "permissions.tools.0:over_cap",
    ]);
  });
});

Deno.test("lophn-agent/agents#R20 [agent-I9]: tools outside the role caps are over_cap", async () => {
  await withAgents(async (ctx) => {
    // ticket.create는 lophn·App Engineer 상한이고 Operator 상한이 아니다.
    const result = await save(ctx, {
      place: OTHER,
      definition: {
        name: "Ticketer",
        permissions: { tools: ["document.list", "ticket.create"] },
        body: "x",
      },
    }, null);
    assertEquals(issuesOf(result), ["permissions.tools.1:over_cap"]);
    failure(
      await save(ctx, {
        place: OTHER,
        assignment: ASG.lophn,
        definition: { permissions: { tools: ["context.draft"] }, body: "" },
      }, null),
      "invalid_input",
    );
  });
});

Deno.test("lophn-agent/agents#R21 [agent-I9]: a definition cannot grant more than its place allows", async () => {
  await withAgents(async (ctx) => {
    // 이 project의 자리 권한에는 document.save_version이 없다. Operator 상한에는 있다.
    const wider = await save(ctx, {
      place: PROJECT,
      definition: {
        name: "Writer",
        permissions: { tools: ["document.list", "document.save_version"] },
        body: "x",
      },
    }, null);
    assertEquals(issuesOf(wider), ["permissions.tools.1:over_cap"]);
    // 자리 권한 안으로 좁히는 것은 된다.
    saved(
      await save(ctx, {
        place: PROJECT,
        definition: {
          name: "Writer",
          permissions: { tools: ["document.list"] },
          body: "x",
        },
      }, null),
    );
    // 자리 설정이 없는 자리는 Workspace 기본이 상한이다.
    saved(
      await save(ctx, {
        place: OTHER,
        definition: {
          name: "Writer",
          permissions: { tools: ["document.save_version"] },
          body: "x",
        },
      }, null),
    );
  });
});

Deno.test("lophn-agent/agents#R2 [agent-I9]: a built-in saves into the place with its own assignment and only the built-in fields", async () => {
  await withAgents(async (ctx) => {
    const before = await assignmentRows(ctx.h);
    const result = saved(
      await save(ctx, {
        place: OTHER,
        assignment: ASG.lophn,
        definition: { body: "Short answers." },
      }, null),
    );
    assertEquals(result.assignment, ASG.lophn);
    assertEquals(result.role, "lophn");
    assertEquals(
      readAgentFile(ctx.root, OTHER, "lophn.md"),
      "Short answers.\n",
    );
    assertEquals(await assignmentRows(ctx.h), before);
    // 이름·context·앱 command는 built-in이 쓰지 않는다.
    assertEquals(
      issuesOf(
        await save(ctx, {
          place: OTHER,
          assignment: ASG.context_engineer,
          definition: { name: "Mine", contexts: [CTX.one], body: "" },
        }, null),
      ),
      ["contexts:not_allowed", "name:not_allowed"],
    );
    // Context Engineer는 project에서만 부른다. 전역 assignment라 앱 자리로 와도 자리가 허락하지 않는다.
    assertEquals(
      issuesOf(
        await save(ctx, {
          place: APP_PLACE,
          assignment: ASG.context_engineer,
          definition: { body: "x" },
        }, null),
      ),
      ["place:not_allowed"],
    );
    // App Engineer는 그 앱의 assignment라 project에서는 이 자리의 agent가 아니다.
    failure(
      await save(ctx, {
        place: PROJECT,
        assignment: ASG.app_engineer,
        definition: { body: "x" },
      }, null),
      "not_found",
    );
  });
});

Deno.test("lophn-agent/agents#R7 [agent-I9]: saving for an assignment that is not an agent of the place is not_found", async () => {
  await withAgents(async (ctx) => {
    const attempt = (place: unknown, assignment: string) =>
      save(
        ctx,
        { place, assignment, definition: { name: "X", body: "x" } },
        null,
      );
    failure(
      await attempt(PROJECT, "asg_01arz3ndektsv4rrffq69g5fzz"),
      "not_found",
    );
    // 다른 자리의 Operator와 거둔 Operator다.
    failure(await attempt(PROJECT, ASG.other_project), "not_found");
    failure(await attempt(PROJECT, ASG.watcher), "not_found");
    failure(await attempt(PROJECT, ASG.withdrawn), "not_found");
    // 없는 자리다.
    failure(
      await attempt(
        { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fzz" },
        ASG.lophn,
      ),
      "not_found",
    );
  });
});

Deno.test("lophn-agent/agents#R8 [agent-I9]: only a person saves, deletes or changes settings", async () => {
  await withAgents(async (ctx) => {
    failure(
      await save(
        ctx,
        {
          place: PROJECT,
          definition: { name: "Sneaky", body: "x" },
        },
        null,
        machineCred,
      ),
      "forbidden",
    );
    failure(
      await ctx.h.command(
        machineCred,
        envelope("DeleteAgent", { assignment: ASG.reviewer }, {
          hash: "0".repeat(64),
        }),
      ),
      "forbidden",
    );
    failure(
      await ctx.h.command(
        machineCred,
        envelope(
          "ChangePlaceAgentSettings",
          { place: PROJECT, settings: {} },
          { hash: null },
        ),
      ),
      "forbidden",
    );
  });
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: when the file cannot be written a new Operator leaves no assignment, file or event", async () => {
  await withAgents(async (ctx) => {
    const before = await assignmentRows(ctx.h);
    const files = [...Deno.readDirSync(placeDir(ctx.root, PROJECT))].map((e) =>
      e.name
    ).sort();
    failure(
      await save(ctx, {
        place: PROJECT,
        definition: { name: "Doomed", body: FAIL_MARKER },
      }, null),
      "unavailable",
    );
    assertEquals(await assignmentRows(ctx.h), before);
    assertEquals(
      [...Deno.readDirSync(placeDir(ctx.root, PROJECT))].map((e) => e.name)
        .sort(),
      files,
    );
    assertEquals((await eventsOf(ctx.h, "AgentSaved")).length, 0);
  });
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: when an edit cannot be written the previous file stays whole", async () => {
  await withAgents(async (ctx) => {
    const text = readAgentFile(ctx.root, PROJECT, REVIEWER_FILE)!;
    failure(
      await save(ctx, {
        place: PROJECT,
        assignment: ASG.reviewer,
        definition: { name: "Reviewer", body: FAIL_MARKER },
      }, sha256(text)),
      "unavailable",
    );
    assertEquals(readAgentFile(ctx.root, PROJECT, REVIEWER_FILE), text);
    assertEquals((await eventsOf(ctx.h, "AgentSaved")).length, 0);
  });
});

Deno.test("lophn-agent/agents#R1 [agent-I9]: deleting an Operator withdraws its assignment, removes the file and records AgentDeleted", async () => {
  await withAgents(async (ctx) => {
    const text = readAgentFile(ctx.root, PROJECT, REVIEWER_FILE)!;
    const result = value(
      await ctx.h.command(
        userCred,
        envelope("DeleteAgent", { assignment: ASG.reviewer }, {
          hash: sha256(text),
        }),
      ),
    ).result as { assignment: string; hash: string };
    assertEquals(result, { assignment: ASG.reviewer, hash: sha256(text) });
    assertEquals(readAgentFile(ctx.root, PROJECT, REVIEWER_FILE), null);
    const row = (await assignmentRows(ctx.h)).find((r) =>
      r["id"] === ASG.reviewer
    )!;
    assertEquals(row["state"], "withdrawn");
    const events = await eventsOf(ctx.h, "AgentDeleted");
    assertEquals(events.length, 1);
    assertEquals(events[0].subject, ASG.reviewer);
    assertEquals(events[0].payload, {
      place: PROJECT,
      role: "operator",
      hash: sha256(text),
    });
    // 다른 Operator의 파일은 그대로다.
    assert(readAgentFile(ctx.root, PROJECT, `${ASG.scribe}.md`) !== null);
  });
});

Deno.test("lophn-agent/agents#R2 [agent-I9]: only an Operator can be deleted and only with the current file hash", async () => {
  await withAgents(async (ctx) => {
    const remove = (assignment: string, hash: string) =>
      ctx.h.command(
        userCred,
        envelope("DeleteAgent", { assignment }, { hash }),
      );
    const lophn = readAgentFile(ctx.root, PROJECT, "lophn.md")!;
    failure(await remove(ASG.lophn, sha256(lophn)), "forbidden");
    failure(await remove(ASG.app_engineer, "0".repeat(64)), "forbidden");
    failure(await remove(ASG.reviewer, "0".repeat(64)), "conflict");
    failure(
      await remove("asg_01arz3ndektsv4rrffq69g5fzz", "0".repeat(64)),
      "not_found",
    );
    failure(await remove(ASG.withdrawn, "0".repeat(64)), "not_found");
    // 파일이 없는 Operator는 agent가 아니다.
    failure(await remove(ASG.other_project, "0".repeat(64)), "not_found");
    assert(readAgentFile(ctx.root, PROJECT, REVIEWER_FILE) !== null);
    assert(readAgentFile(ctx.root, PROJECT, "lophn.md") !== null);
    assertEquals((await eventsOf(ctx.h, "AgentDeleted")).length, 0);
    const states = (await assignmentRows(ctx.h)).filter((r) =>
      r["state"] === "withdrawn"
    );
    assertEquals(states.length, 1);
  });
});

Deno.test("lophn-agent/agents#R4 [agent-I9]: when the file cannot be removed the assignment stays enabled", async () => {
  await withAgents(async (ctx) => {
    writeAgentFile(
      ctx.root,
      PROJECT,
      REVIEWER_FILE,
      `---\nname: Reviewer\n---\n\n${FAIL_MARKER}\n`,
    );
    const text = readAgentFile(ctx.root, PROJECT, REVIEWER_FILE)!;
    failure(
      await ctx.h.command(
        userCred,
        envelope("DeleteAgent", { assignment: ASG.reviewer }, {
          hash: sha256(text),
        }),
      ),
      "unavailable",
    );
    assertEquals(readAgentFile(ctx.root, PROJECT, REVIEWER_FILE), text);
    const row = (await assignmentRows(ctx.h)).find((r) =>
      r["id"] === ASG.reviewer
    )!;
    assertEquals(row["state"], "enabled");
    assertEquals((await eventsOf(ctx.h, "AgentDeleted")).length, 0);
  });
});

function change(
  ctx: AgentHarness,
  place: unknown,
  settings: unknown,
  hash: string | null,
) {
  return ctx.h.command(
    userCred,
    envelope("ChangePlaceAgentSettings", { place, settings }, { hash }),
  );
}

const MODEL = {
  provider: "pvd_01arz3ndektsv4rrffq69g5fc1",
  model_name: "gpt-5",
  option_values: { effort: "low" },
};

Deno.test("lophn-agent/agents#R11 [agent-I9]: place settings are written as one file with a hash CAS and recorded as PlaceAgentSettingsChanged", async () => {
  await withAgents(async (ctx) => {
    const first = value(
      await change(
        ctx,
        OTHER,
        {
          models: { operator: MODEL },
          permissions: { tools: ["document.list"] },
        },
        null,
      ),
    ).result as { place: unknown; hash: string };
    const text = readAgentFile(ctx.root, OTHER, "settings.md")!;
    assertEquals(
      text,
      "---\nmodels:\n  operator:\n    provider: pvd_01arz3ndektsv4rrffq69g5fc1\n    model_name: gpt-5\n    option_values:\n      effort: low\npermissions:\n  tools:\n    - document.list\n---\n",
    );
    assertEquals(first, { place: OTHER, hash: sha256(text) });

    // 같은 hash로 다시 쓰면 통째로 바뀐다. 보내지 않은 칸은 지워진다.
    const second = value(
      await change(ctx, OTHER, { models: { lophn: MODEL } }, sha256(text)),
    ).result as { hash: string };
    assert(
      !readAgentFile(ctx.root, OTHER, "settings.md")!.includes("operator"),
    );

    // 옛 hash는 conflict이고 파일은 그대로다.
    failure(await change(ctx, OTHER, {}, sha256(text)), "conflict");
    failure(await change(ctx, OTHER, {}, null), "conflict");
    assertEquals(
      sha256(readAgentFile(ctx.root, OTHER, "settings.md")!),
      second.hash,
    );

    const events = await eventsOf(ctx.h, "PlaceAgentSettingsChanged");
    assertEquals(events.map((event) => event.subject), [OTHER_PRJ, OTHER_PRJ]);
    assertEquals(events[0].payload, {
      place: OTHER,
      before_hash: null,
      after_hash: sha256(text),
    });
    assertEquals(events[1].payload, {
      place: OTHER,
      before_hash: sha256(text),
      after_hash: second.hash,
    });
  });
});

Deno.test("lophn-agent/agents#R10 [agent-I9]: place settings reject fields a place cannot hold and wrong shapes", async () => {
  await withAgents(async (ctx) => {
    // 자리 설정에는 context·profile 같은 정의 칸이 없다. route 입력 검사가 막는다.
    const rejected = await change(
      ctx,
      OTHER,
      { contexts: [CTX.one] },
      null,
    );
    failure(rejected, "invalid_input");
    const appHash = sha256(readAgentFile(ctx.root, APP_PLACE, "settings.md")!);
    failure(
      await change(ctx, APP_PLACE, { models: { nobody: MODEL } }, appHash),
      "invalid_input",
    );
    assertEquals(readAgentFile(ctx.root, OTHER, "settings.md"), null);
  });
});

Deno.test("lophn-agent/agents#R21 [agent-I9]: place permissions must be a subset of the Workspace default", async () => {
  await withAgents(async (ctx) => {
    const result = await change(
      ctx,
      OTHER,
      {
        permissions: {
          tools: ["document.list", "not.inworkspace", "ticket.create"],
        },
      },
      null,
    );
    assertEquals(issuesOf(result), ["permissions.tools.1:over_cap"]);
    assertEquals(readAgentFile(ctx.root, OTHER, "settings.md"), null);
    assertEquals(
      (await eventsOf(ctx.h, "PlaceAgentSettingsChanged")).length,
      0,
    );
    // Workspace 기본의 부분집합은 된다.
    value(
      await change(
        ctx,
        OTHER,
        { permissions: { tools: ["document.list", "ticket.create"] } },
        null,
      ),
    );
  });
});

Deno.test("lophn-agent/agents#R7 [agent-I9]: settings of a place that does not exist are not_found", async () => {
  await withAgents(async (ctx) => {
    failure(
      await change(
        ctx,
        { kind: "app", id: "app_01arz3ndektsv4rrffq69g5fzz" },
        {},
        null,
      ),
      "not_found",
    );
  });
});
