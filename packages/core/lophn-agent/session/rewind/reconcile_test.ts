import { assertEquals } from "@std/assert";
import {
  agentWrite,
  doRedo,
  doRewind,
  type Env,
  humanEdit,
  itemsOf,
  openEnv,
} from "./testing/flow.ts";
import {
  machineCtx,
  MSG,
  must,
  RVT,
  TCL,
  writeProjectFile,
} from "./testing/mod.ts";
import { reconcileRewindInstalls } from "./reconcile.ts";

// 시작 때 맞추기(lophn-agent/revert R17; agent-RW3d). command가 확정된 뒤 설치 전에 process가 죽어 ledger는
// restored인데 파일은 그대로인 경로만 AmendRevertInstall로 고친다.

// 사람 요청 M1이 a.md를 쓰고(a0 → a1) restore_all rewind가 확정된 상태다.
async function rewound(): Promise<Env> {
  const env = openEnv();
  const first = env.world.addRequest(1);
  env.world.addToolCall(1, first.run);
  writeProjectFile(env.root, "a.md", "a0");
  must(
    await agentWrite(env, {
      tool_call: TCL(1),
      run: first.run,
      path: "a.md",
      content: "a1",
    }),
  );
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  return env;
}

function reconcile(env: Env) {
  const amended: { revert: string; paths: readonly string[] }[] = [];
  return {
    amended,
    run: () =>
      reconcileRewindInstalls({
        snapshot: (read) => ({ ok: true, value: read(env.world.lookup) }),
        rootOf: env.deps.rootOf,
        amend: (revert, paths) => {
          amended.push({ revert, paths });
          return Promise.resolve(
            env.world.call(env.commands.amend, machineCtx, {
              revert,
              paths: [...paths],
            }),
          );
        },
      }),
  };
}

Deno.test("lophn-agent/revert#R17 [agent-RW3d]: a restored file the install never wrote is amended to skipped", async () => {
  const env = await rewound();
  // 설치 전에 죽었다: 파일은 agent가 마지막으로 쓴 그대로다.
  writeProjectFile(env.root, "a.md", "a1");
  const r = reconcile(env);
  assertEquals(await r.run(), 1);
  assertEquals(r.amended, [{ revert: RVT(1), paths: ["a.md"] }]);
  const [item] = itemsOf(env, RVT(1));
  assertEquals([item!.result, item!.reason], ["skipped", "edited_outside"]);
  // 고친 뒤에는 더 할 것이 없다.
  assertEquals(await r.run(), 0);
});

Deno.test("lophn-agent/revert#R17 [agent-RW3d]: a file that was installed or changed by a person afterwards is left as it is", async () => {
  const installed = await rewound();
  const a = reconcile(installed);
  assertEquals(await a.run(), 0);
  assertEquals(a.amended, []);

  const edited = await rewound();
  humanEdit(edited, "a.md", "written by a person");
  const b = reconcile(edited);
  assertEquals(await b.run(), 0);
  assertEquals(b.amended, []);
});

Deno.test("lophn-agent/revert#R17 [agent-RW3d]: a redone rewind is not looked at, since the file went back on purpose", async () => {
  const env = await rewound();
  must(await doRedo(env, RVT(1)));
  const r = reconcile(env);
  assertEquals(await r.run(), 0);
  assertEquals(r.amended, []);
});

Deno.test("lophn-agent/revert#R17 [agent-RW3d]: only the latest revert of a session is looked at, and one the agent wrote over afterwards is not", async () => {
  const env = await rewound();
  // 복원 뒤에 agent가 같은 경로를 다시 썼다.
  const next = env.world.addRequest(2);
  env.world.addToolCall(2, next.run);
  must(
    await agentWrite(env, {
      tool_call: TCL(2),
      run: next.run,
      path: "a.md",
      content: "a1",
    }),
  );
  const r = reconcile(env);
  assertEquals(await r.run(), 0);
  assertEquals(r.amended, []);
});
