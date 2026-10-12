// lophn-agent/harness/tools#R7(SDK): SDK 안내 tool은 목록·version·사용 예를 읽기로만 주고 SDK를 설치하거나
// 문서를 저장하지 않는다. 소유 contract(packages.list·versions·usage)는 대역이 받는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  executeTool,
  SDK_TOOL_NAMES,
  SDK_TOOLS,
  TOOL_BUNDLES,
} from "./mod.ts";
import type { AgentToolPorts } from "./mod.ts";

const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";

const HASH = (letter: string) => letter.repeat(64);

function packageOf(n: number) {
  const name = `@lophn/pkg-${String(n).padStart(2, "0")}`;
  return {
    id: `pkg_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`.slice(0, 30),
    name,
    description: `package ${n}`,
    kind: "component",
    versions: [{
      version: "1.0.0",
      bundle_hash: HASH("a"),
      guide_hash: HASH("b"),
    }],
  };
}

function rig() {
  const calls: { contract: string; input: Record<string, unknown> }[] = [];
  const catalog = Array.from(
    { length: 45 },
    (_, index) => packageOf(index + 1),
  );
  const ports = {
    call(contract: string, input: unknown): Promise<Result<unknown>> {
      const value = input as Record<string, unknown>;
      calls.push({ contract, input: value });
      if (contract === "packages.list") {
        const offset = value["cursor"] === undefined
          ? 0
          : Number(value["cursor"]);
        const limit = Number(value["limit"] ?? 50);
        const page = catalog.slice(offset, offset + limit);
        return Promise.resolve(ok({
          packages: page,
          as_of_seq: "1",
          next_cursor: offset + limit < catalog.length
            ? String(offset + limit)
            : null,
        }));
      }
      if (contract === "packages.versions") {
        const found = catalog.find((entry) => entry.name === value["name"]);
        if (found === undefined) {
          return Promise.resolve(
            err({ code: "not_found", message: "no such package" }),
          );
        }
        return Promise.resolve(ok({
          name: found.name,
          versions: [
            { version: "1.1.0", bundle_hash: HASH("c"), guide_hash: HASH("d") },
            ...found.versions,
          ],
          as_of_seq: "1",
          next_cursor: null,
        }));
      }
      if (contract === "packages.usage") {
        return Promise.resolve(ok({
          name: value["name"],
          version: value["version"],
          usages: [{ app: APP, release: RELEASE }],
          as_of_seq: "1",
          next_cursor: null,
        }));
      }
      return Promise.resolve(
        err({ code: "not_found", message: "contract is not open" }),
      );
    },
  };
  const handlers = createBuiltinToolHandlers({
    ...ports,
    newId: () => "id",
    runFacts: () =>
      Promise.resolve(
        ok({ session: null, role: "lophn" as never, original_message: null }),
      ),
  } as AgentToolPorts);
  const listed = SDK_TOOLS;
  const credential = {
    run: RUN,
    targets: new Set<string>(),
    operations: new Set(listed.map((tool) => tool.contract)),
  };
  const run = (name: string, input: unknown) =>
    executeTool({ listed, handlers, credential }, name, input);
  return { calls, run };
}

Deno.test("lophn-agent/harness/tools#R7: SDK 안내 tool은 목록·규칙·예시를 읽기 contract 하나씩으로만 읽고 설치·저장 동작이 없다", async () => {
  // 정의가 모두 읽기이고 설치·추가·등록·문서 저장 contract를 소유 contract로 갖지 않는다.
  assertEquals(SDK_TOOL_NAMES, ["sdk.list", "sdk.contract", "sdk.examples"]);
  for (const tool of SDK_TOOLS) {
    assertEquals(tool.effect, "read");
    assertEquals(tool.confirm, false);
    assert(
      ["packages.list", "packages.versions", "packages.usage"].includes(
        tool.contract,
      ),
      tool.contract,
    );
  }
  assertEquals(
    BUILTIN_TOOLS.some((tool) =>
      /^sdk\.(add|install|register|apply)/.test(tool.name)
    ),
    false,
  );
  assertEquals(TOOL_BUNDLES.get("sdk"), SDK_TOOL_NAMES);

  const { calls, run } = rig();
  const list = await run("sdk.list", {});
  assertEquals(list.outcome.kind, "success");
  const contract = await run("sdk.contract", { name: "@lophn/pkg-03" });
  assertEquals(contract.outcome.kind, "success");
  const content = contract.result.content as {
    version: string;
    bundle_hash: string;
    guide_hash: string;
    guide: unknown;
    versions: string[];
  };
  // version을 고르지 않으면 목록의 첫 version이고 안내 원문은 아직 읽을 수 없어 hash와 사실만 있다.
  assertEquals(content.version, "1.1.0");
  assertEquals(content.guide_hash, HASH("d"));
  assertEquals(content.guide, null);
  assertEquals(content.versions, ["1.1.0", "1.0.0"]);
  const pinned = await run("sdk.contract", {
    name: "@lophn/pkg-03",
    version: "1.0.0",
  });
  assertEquals((pinned.result.content as { version: string }).version, "1.0.0");
  const examples = await run("sdk.examples", {
    name: "@lophn/pkg-03",
    version: "1.0.0",
  });
  assertEquals(examples.outcome.kind, "success");
  assertEquals(
    (examples.result.content as { usages: unknown[] }).usages,
    [{ app: APP, release: RELEASE }],
  );

  // 호출 전체에서 부른 소유 contract는 읽기 세 가지뿐이라 설치 상태·문서 version이 바뀔 길이 없다.
  assertEquals(
    [...new Set(calls.map((call) => call.contract))].sort(),
    ["packages.list", "packages.usage", "packages.versions"],
  );
});

Deno.test("lophn-agent/harness/tools#R7: 없는 package·version과 틀린 입력은 소유 contract를 더 부르지 않거나 같은 not_found로 답한다", async () => {
  const { calls, run } = rig();
  const missing = await run("sdk.contract", { name: "@lophn/absent" });
  assertEquals(missing.outcome, { kind: "failure", code: "not_found" });
  const noVersion = await run("sdk.contract", {
    name: "@lophn/pkg-01",
    version: "9.9.9",
  });
  assertEquals(noVersion.outcome, { kind: "failure", code: "not_found" });
  assertEquals(noVersion.result.summary, missing.result.summary);
  const before = calls.length;
  // ^1.0.0·latest 같은 범위 표기와 선언 밖 입력은 진입 전에 거절한다.
  for (
    const bad of [
      { name: "@lophn/pkg-01", version: "^1.0.0" },
      { name: "@lophn/pkg-01", version: "latest" },
      { name: "pkg-01" },
      { name: "@lophn/pkg-01", install: true },
    ]
  ) {
    const outcome = await run("sdk.contract", bad);
    assertEquals(outcome.outcome.kind, "failure", JSON.stringify(bad));
  }
  assertEquals(calls.length, before);
});

Deno.test("lophn-agent/harness/tools#R13: sdk 목록은 20개씩 이어 읽고 조건이 다른 cursor는 거절한다", async () => {
  const { run } = rig();
  const first = await run("sdk.list", {});
  const names = (outcome: Awaited<ReturnType<typeof run>>) =>
    (outcome.result.content as { packages: { name: string }[] }).packages.map((
      entry,
    ) => entry.name);
  assertEquals(names(first).length, 20);
  const second = await run("sdk.list", {
    cursor: first.result.continuation!.read_next,
  });
  const third = await run("sdk.list", {
    cursor: second.result.continuation!.read_next,
  });
  assertEquals(names(second).length, 20);
  assertEquals(names(third).length, 5);
  assertEquals(third.result.continuation, null);
  const all = [...names(first), ...names(second), ...names(third)];
  assertEquals(new Set(all).size, 45);
  // 다른 조건(name)의 목록에서 온 cursor는 쓸 수 없다.
  const other = await run("sdk.list", {
    name: "@lophn/pkg-01",
    cursor: first.result.continuation!.read_next,
  });
  assertEquals(other.outcome.kind, "failure");
});
