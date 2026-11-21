import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { err, ok } from "../../base/mod.ts";
import type {
  ToolGateInput,
  ToolGateResult,
} from "../../protocol/approvals/mod.ts";
import { destinationsSetting } from "../folder/destinations.ts";
import { createSettingsRegistry } from "./registry.ts";
import {
  remoteAddressesSetting,
  shellSettingFolders,
  shellSettings,
} from "./shell-settings.ts";
import { type AskPerson, settingsUpdateHandler } from "./routes.ts";
import { createSettingsStore } from "./store.ts";

const SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzzzz";
const TURN = "trn_01hzzzzzzzzzzzzzzzzzzzzzzz";
const TOOL_CALL = "tcl_01hzzzzzzzzzzzzzzzzzzzzzzz";
const AGENT = {
  actor: `agent:${SESSION}`,
  conditions: { session: SESSION, turn: TURN },
} as never;
const PERSON = { actor: "user", conditions: {} } as never;

// data root 하나와 destination 하나("personal")가 있는 settings.json. 사람에게 묻는 길은 test가 답을 정한다.
async function withDestinations(
  run: (deps: {
    update: (
      who: never,
      input: unknown,
      answer?: (asked: ToolGateInput) => ReturnType<AskPerson>,
    ) => Promise<unknown>;
    file: string;
    original: string;
    asked: ToolGateInput[];
  }) => Promise<void>,
) {
  const base = await mkdtemp(join(tmpdir(), "lophn-settings-approval-"));
  const dataRoot = join(base, ".lophn");
  const file = join(dataRoot, "settings.json");
  const original = `${JSON.stringify({ "folder.destinations": { personal: { path: join(base, "Sync") } } }, null, 2)}\n`;
  mkdirSync(dataRoot, { recursive: true });
  writeFileSync(file, original);
  const store = createSettingsStore({
    root: dataRoot,
    registry: createSettingsRegistry([destinationsSetting(dataRoot)]),
    publish: () => {},
    log: () => {},
  });
  const asked: ToolGateInput[] = [];
  try {
    await run({
      update: async (who, input, answer) => {
        const ask: AskPerson = (_who, one) => {
          asked.push(one);
          return answer === undefined
            ? Promise.resolve(ok({ kind: "run" }))
            : answer(one);
        };
        const handled = await settingsUpdateHandler(store, ask)(who, input);
        return handled;
      },
      file,
      original,
      asked,
    });
  } finally {
    store.close();
    await rm(base, { recursive: true, force: true });
  }
}

const answered = (result: ToolGateResult) => (): ReturnType<AskPerson> =>
  Promise.resolve(ok(result));

const needsApproval = (message: string) => ({
  ok: true,
  value: {
    changed: [],
    rejected: [
      { key: "folder.destinations", reason: "needs_approval", message },
    ],
    notes: [],
  },
});

// destination을 두면 사람의 data가 data root를 떠나 바깥 도구가 올리는 폴더로 간다. 사람이 허락하지 않은 바꾸기가 쓰이면
// 사람이 모르는 곳으로 data가 나간다.
test("agent 자격은 사람의 허락 없이 destination을 두지도 바꾸지도 지우지도 못하고 설정 file이 그대로다", async () => {
  await withDestinations(async ({ update, file, original }) => {
    const changes = [
      { action: "set", value: { personal: { path: "/srv/other" } } },
      {
        action: "set",
        value: {
          personal: JSON.parse(original)["folder.destinations"].personal,
          work: { path: "/srv/work" },
        },
      },
      { action: "unset" },
    ].map((one) => ({ key: "folder.destinations", ...one }));
    const refusals: [
      string,
      Record<string, unknown>,
      ((asked: ToolGateInput) => ReturnType<AskPerson>) | undefined,
    ][] = [
      // 물을 tool call이 없다(사람의 터미널이 아닌 agent credential, 옛 명령).
      [
        "the person must allow this change; only a lophn agent turn can ask, or the person changes it in Settings",
        {},
        undefined,
      ],
      [
        "the person rejected this change: not that folder",
        { tool_call: TOOL_CALL },
        answered({ kind: "rejected", reason: "not that folder", by: "person" }),
      ],
      [
        "the person rejected this change",
        { tool_call: TOOL_CALL },
        answered({ kind: "rejected", reason: null, by: "person" }),
      ],
      // unattended turn과 팀 자식(Gate의 deny).
      [
        "the person must allow this change; ask from a session the person is in",
        { tool_call: TOOL_CALL },
        answered({ kind: "denied", reason: "no_person" }),
      ],
      [
        "the request ended before the person answered",
        { tool_call: TOOL_CALL },
        answered({ kind: "cancelled", cause: "turn_ended" }),
      ],
      [
        "the credential belongs to another session or turn",
        { tool_call: TOOL_CALL },
        () =>
          Promise.resolve(
            err({
              code: "forbidden",
              message: "the credential belongs to another session or turn",
            }),
          ),
      ],
    ];
    for (const change of changes) {
      for (const [message, extra, answer] of refusals) {
        writeFileSync(file, original);
        const before = readFileSync(file, "utf8");
        const result = await update(
          AGENT,
          { ...extra, changes: [change] },
          answer,
        );
        assert.deepStrictEqual(result, needsApproval(message), message);
        assert.equal(readFileSync(file, "utf8"), before, message);
      }
    }

    // 사람이 결정하는 사이 Settings에서 바꿔 사람이 본 줄과 지금 바뀜이 다르면 agent의 값을 쓰지 않는다.
    const moved = { personal: { path: "/srv/moved" } };
    const raced = await update(
      AGENT,
      { tool_call: TOOL_CALL, changes: [changes[1]] },
      async () => {
        await update(PERSON, {
          changes: [
            { key: "folder.destinations", action: "set", value: moved },
          ],
        });
        return ok({ kind: "run" });
      },
    );
    assert.deepStrictEqual(
      raced,
      needsApproval(
        "the setting changed while the person was deciding; ask again",
      ),
    );
    assert.deepStrictEqual(
      JSON.parse(readFileSync(file, "utf8"))["folder.destinations"],
      moved,
    );
  });
});

test("사람이 허락한 그 값만 그 한 번 쓰이고 카드는 이름과 전체 경로를 보인다", async () => {
  await withDestinations(async ({ update, file, original, asked }) => {
    const personal = JSON.parse(original)["folder.destinations"].personal
      .path as string;
    const added = await update(AGENT, {
      tool_call: TOOL_CALL,
      changes: [
        {
          key: "folder.destinations",
          action: "set",
          value: {
            personal: { path: "/srv/sync/personal" },
            work: { path: "/mnt/nas/lophn" },
          },
        },
      ],
    });
    assert.deepStrictEqual(added, {
      ok: true,
      value: { changed: ["folder.destinations"], rejected: [], notes: [] },
    });
    assert.deepStrictEqual(asked, [
      {
        session: SESSION,
        turn: TURN,
        tool_call: TOOL_CALL,
        tool: "lophn",
        call: {
          kind: "setting",
          key: "folder.destinations",
          lines: [
            `Change sync folder "personal": ${personal} → /srv/sync/personal`,
            'Add sync folder "work": /mnt/nas/lophn',
          ],
        },
      },
    ]);
    assert.deepStrictEqual(
      JSON.parse(readFileSync(file, "utf8"))["folder.destinations"],
      {
        personal: { path: "/srv/sync/personal" },
        work: { path: "/mnt/nas/lophn" },
      },
    );

    // 허락은 다음 바꾸기에 남지 않는다: 다시 묻고, 거절이면 그대로다.
    const after = readFileSync(file, "utf8");
    const removed = await update(
      AGENT,
      {
        tool_call: TOOL_CALL,
        changes: [{ key: "folder.destinations", action: "unset" }],
      },
      answered({ kind: "rejected", reason: null, by: "person" }),
    );
    assert.deepStrictEqual(
      removed,
      needsApproval("the person rejected this change"),
    );
    assert.deepStrictEqual(asked.at(-1)?.call, {
      kind: "setting",
      key: "folder.destinations",
      lines: [
        'Remove sync folder "personal" (/srv/sync/personal)',
        'Remove sync folder "work" (/mnt/nas/lophn)',
      ],
    });
    assert.equal(readFileSync(file, "utf8"), after);
  });
});

test("사람 자격은 묻지 않고 바로 쓰고 agent도 틀린 값은 묻기 전에 거절된다", async () => {
  await withDestinations(async ({ update, file, asked }) => {
    const person = await update(PERSON, {
      changes: [
        {
          key: "folder.destinations",
          action: "set",
          value: { work: { path: "/mnt/nas/lophn" } },
        },
      ],
    });
    assert.deepStrictEqual(person, {
      ok: true,
      value: { changed: ["folder.destinations"], rejected: [], notes: [] },
    });
    assert.deepStrictEqual(
      JSON.parse(readFileSync(file, "utf8"))["folder.destinations"],
      { work: { path: "/mnt/nas/lophn" } },
    );
    // data root 안의 경로는 사람에게 보이기 전에 거절한다.
    const inside = await update(AGENT, {
      tool_call: TOOL_CALL,
      changes: [
        {
          key: "folder.destinations",
          action: "set",
          value: { work: { path: join(file, "..", "x") } },
        },
      ],
    });
    assert.ok(
      (inside as { value: { rejected: { reason: string }[] } }).value
        .rejected[0]?.reason === "invalid_value",
    );
    assert.deepStrictEqual(asked, []);
  });
});

// 기기가 remote를 끄면 모든 기기(자기도)가 끊기고, relay·push 주소를 바꾸면 알림 글이 다른 곳으로 간다.
test("기기 자격의 remote 설정 쓰기는 forbidden이고 같이 보낸 바꿈도 쓰이지 않는다", async () => {
  await withDestinations(async ({ update, file, original }) => {
    const device = {
      actor: "user",
      principal: `device:dev_0${"1".repeat(25)}`,
      conditions: { process: "remote" },
    } as never;
    const done = await update(device, {
      changes: [
        {
          key: "folder.destinations",
          action: "set",
          value: { work: { path: "/mnt/nas/lophn" } },
        },
        { key: "remote.enabled", action: "set", value: false },
      ],
    });
    assert.equal(
      (done as { ok: boolean; error?: { code: string } }).error?.code,
      "forbidden",
    );
    assert.equal(readFileSync(file, "utf8"), original);
  });
});

// remote.addresses는 폰이 거는 곳을 정한다: agent의 바꾸기는 사람이 바뀜을 보고 허락하고, 사람(Settings 화면)은 바로 쓴다.
test("remote.addresses는 agent가 바꾸면 승인 카드에 바뀜을 보이고 사람은 바로 쓴다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-settings-addresses-"));
  const store = createSettingsStore({
    root,
    registry: createSettingsRegistry([remoteAddressesSetting]),
    publish: () => {},
    log: () => {},
  });
  const asked: ToolGateInput[] = [];
  const update = settingsUpdateHandler(store, (_who, one) => {
    asked.push(one);
    return Promise.resolve(ok({ kind: "run" }));
  });
  try {
    const first = await update(
      { ...(PERSON as object), principal: "user" } as never,
      {
        changes: [
          { key: "remote.addresses", action: "set", value: ["a.example.com"] },
        ],
      },
    );
    assert.deepStrictEqual(asked, []);
    assert.equal((first as { ok: boolean }).ok, true);

    const second = await update(
      { ...(AGENT as object), principal: "user" } as never,
      {
        tool_call: TOOL_CALL,
        changes: [
          {
            key: "remote.addresses",
            action: "set",
            value: ["studio.tail1234.ts.net"],
          },
        ],
      },
    );
    assert.deepStrictEqual(
      asked.map((one: ToolGateInput) => one.call),
      [
        {
          kind: "setting",
          key: "remote.addresses",
          lines: [
            "Add address studio.tail1234.ts.net",
            "Remove address a.example.com",
          ],
        },
      ],
    );
    assert.deepStrictEqual(second, {
      ok: true,
      value: { changed: ["remote.addresses"], rejected: [], notes: [] },
    });

    // Rejecting leaves the saved addresses unchanged.
    const refused = await settingsUpdateHandler(store, () =>
      Promise.resolve(
        ok({ kind: "rejected", reason: "wrong host", by: "person" }),
      ),
    )({ ...(AGENT as object), principal: "user" } as never, {
      tool_call: TOOL_CALL,
      changes: [
        { key: "remote.addresses", action: "set", value: ["evil.example"] },
      ],
    });
    assert.deepStrictEqual(refused, {
      ok: true,
      value: {
        changed: [],
        rejected: [
          {
            key: "remote.addresses",
            reason: "needs_approval",
            message: "the person rejected this change: wrong host",
          },
        ],
        notes: [],
      },
    });
    assert.deepStrictEqual(store.chosen()["remote.addresses"], [
      "studio.tail1234.ts.net",
    ]);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

// browser profile 목록은 agent가 쓰는 cookie와 저장 login을 정한다. 깨지면 agent가 profile을 지우거나 더해 다른 로그인으로 옮겨 간다.
test("agent 자격은 shell.browser_profiles를 바꾸지 못하고 사람은 바꾼다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-settings-profiles-"));
  const store = createSettingsStore({
    root,
    registry: createSettingsRegistry(shellSettings, shellSettingFolders),
    publish: () => {},
    log: () => {},
  });
  const update = settingsUpdateHandler(store, () =>
    Promise.resolve(ok({ kind: "run" })),
  );
  const change = {
    changes: [
      {
        key: "shell.browser_profiles",
        action: "set",
        value: [{ id: `bpf_${"1".repeat(26)}`, name: "Work", color: "sage" }],
      },
    ],
  };
  try {
    const refused = await update(
      { ...(AGENT as object), principal: "user" } as never,
      { tool_call: TOOL_CALL, ...change },
    );
    assert.deepStrictEqual(refused, {
      ok: true,
      value: {
        changed: [],
        rejected: [{ key: "shell.browser_profiles", reason: "locked" }],
        notes: [],
      },
    });
    const written = () => {
      try {
        return readFileSync(join(root, "settings.json"), "utf8");
      } catch {
        return "";
      }
    };
    assert.ok(!written().includes("shell.browser_profiles"));
    const done = await update(
      { ...(PERSON as object), principal: "user" } as never,
      change,
    );
    assert.deepStrictEqual(
      (done as { value: { changed: string[] } }).value.changed,
      ["shell.browser_profiles"],
    );
    assert.ok(written().includes("shell.browser_profiles"));
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
