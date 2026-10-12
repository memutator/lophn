// `lophn skills list|install` 실행 시험이다(cli#R10). 배포 원본과 설치 engine은 fake이고 파일은 쓰지 않는다.
import { assert, assertEquals, assertFalse } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import type { IntegrationTarget } from "../../../protocol/coding-agent/mod.ts";
import type { SkillsInstallOutcome } from "../../guides/mod.ts";
import { runSkillsInstall, runSkillsList, SKILLS_COMMANDS } from "./skills.ts";

const TARGET: IntegrationTarget = {
  scope_kind: "user",
  environment: { kind: "host", identity: "native" },
  profile_id: null,
  harness_id: "claude",
  app: null,
  app_realpath: null,
};

const HASH = "a".repeat(64);

const distribution = () =>
  Promise.resolve(ok({
    skills: [{
      name: "lophn-save",
      description: "저장 절차",
      version: "1.0.0",
      hash: HASH,
      body: "본문은 목록에 없다",
      files: [{ path: "SKILL.md", content: "x" }],
    }],
    rejected: [],
  }));

function outcome(status: SkillsInstallOutcome["status"]): SkillsInstallOutcome {
  return {
    status,
    notices: [],
    skills: [{
      name: "lophn-save",
      version: "1.0.0",
      hash: HASH,
      outcome: status === "complete" ? "changed" : "conflict",
      reason: status === "complete"
        ? "썼다"
        : "receipt 없는 동명 resource는 덮지 않는다",
      files: [{
        path: "SKILL.md",
        outcome: status === "complete" ? "changed" : "conflict",
        reason: "r",
      }],
    }],
  };
}

Deno.test("coding-agent/cli#R10: command 표에 skills list·install이 있다", () => {
  assertEquals(SKILLS_COMMANDS.map((entry) => entry.name), [
    "skills list",
    "skills install",
  ]);
});

Deno.test("coding-agent/cli#R10: skills list는 이름·설명·version·hash를 내고 본문은 내지 않는다", async () => {
  const listed = await runSkillsList({ distribution });
  assert(listed.ok);
  const data = listed.value.data as {
    skills: Record<string, unknown>[];
    rejected: unknown[];
  };
  assertEquals(data.skills, [{
    name: "lophn-save",
    description: "저장 절차",
    version: "1.0.0",
    hash: HASH,
  }]);
  assertFalse(JSON.stringify(listed.value).includes("본문은"));
  assertEquals(listed.value.isError, undefined);
});

Deno.test("coding-agent/cli#R10: 검사를 통과하지 못한 원본은 이유와 함께 목록에 남고 오류로 표시한다", async () => {
  const listed = await runSkillsList({
    distribution: () =>
      Promise.resolve(ok({
        skills: [],
        rejected: [{
          directory: "bad",
          issues: ["name이 디렉터리 이름과 다르다"],
        }],
      })),
  });
  assert(listed.ok);
  assertEquals(listed.value.isError, true);
  assert(JSON.stringify(listed.value.data).includes("name이 디렉터리"));
});

Deno.test("coding-agent/cli#R10: skills install은 사람 전용이고 설치하지 않는다", async () => {
  let called = false;
  const result = await runSkillsInstall({ target: TARGET }, {
    actor: "coding_agent",
    distribution,
    install() {
      called = true;
      return Promise.resolve(ok(outcome("complete")));
    },
  });
  assertFalse(result.ok);
  assertEquals(result.error.code, "forbidden");
  assertFalse(called);
});

Deno.test("coding-agent/cli#R10: 설치 결과는 skill별·파일별 변경·충돌을 담고 충돌은 오류 종료로 구별한다", async () => {
  const requests: unknown[] = [];
  const deps = (status: SkillsInstallOutcome["status"]) => ({
    actor: "user" as const,
    distribution,
    install(request: unknown) {
      requests.push(request);
      return Promise.resolve(ok(outcome(status)));
    },
  });
  const clean = await runSkillsInstall(
    { target: TARGET, names: ["lophn-save"], operation_id: "op-1" },
    deps("complete"),
  );
  assert(clean.ok);
  assertEquals(clean.value.isError, undefined);
  assertEquals(
    (clean.value.data as { skills: { files: { outcome: string }[] }[] })
      .skills[0].files[0].outcome,
    "changed",
  );
  assertEquals(requests[0], {
    target: TARGET,
    names: ["lophn-save"],
    operationId: "op-1",
  });

  const conflicted = await runSkillsInstall(
    { target: TARGET },
    deps("partial"),
  );
  assert(conflicted.ok);
  assertEquals(conflicted.value.isError, true);
  assert(conflicted.value.summary.includes("덮지 않았다"));
  assertEquals(
    (conflicted.value.data as { skills: { files: { outcome: string }[] }[] })
      .skills[0].files[0].outcome,
    "conflict",
  );
});
