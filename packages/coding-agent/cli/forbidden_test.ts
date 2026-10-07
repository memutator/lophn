// coding-agent#T15: 사람 관리 command가 CLI 표에 없고 표가 부르는 route는 금지 route가
// 아니다(cli#R6, R16, R17, R23, R38). 표 밖 command는 실행 전에 거절이다(cli#R4).
// daemon 쪽 거절은 apps/core/coding-agent-scope_test.ts가 실제 core로 본다.
import { assert, assertEquals } from "@std/assert";
import { contractRoutesByName } from "../connection/testing/mod.ts";
import { forbiddenRouteNames } from "../connection/mod.ts";
import { COMMANDS, findCommand } from "./registry.ts";
import { parseArgs, splitCommand } from "./parser.ts";

// 요구가 "command가 없다"고 말한 것들이다. 묶음 이름은 요구 번호다.
const ABSENT_COMMANDS: Record<string, readonly string[]> = {
  // cli#R16: 문서의 자리 놓기·원본 제거·보관 복귀
  R16: [
    "place",
    "unplace",
    "unarchive",
    "document place",
    "document unplace",
    "document unarchive",
    "document archive",
    "document move",
    "document rename",
  ],
  // cli#R17: 원본 파일의 추적 규칙·편집 세션·판 복원
  R17: [
    "file",
    "file show",
    "file track",
    "file edit",
    "file restore",
    "document restore",
  ],
  // cli#R23: 프로젝트 폴더의 추가·수정·등록 제거
  R23: ["folder", "folder add", "folder update", "folder remove"],
  // cli#R38: secret 이름 조회·값 등록·삭제·잠금·password unlock
  R38: [
    "secrets",
    "secrets status",
    "secrets list",
    "secrets set",
    "secrets delete",
    "secrets lock",
    "secrets unlock",
    "secret",
    "secret set",
  ],
  // cli#R6: 프로젝트·tracking·context·term·assignment 관리, 승인 결정·grant, 문제 닫힘·무시.
  // `problem confirm`·`problem dismiss`는 결정 화면 안내만 내는 사람 전용 command라 표에 있다(T44, D27).
  R6: [
    "project register",
    "project create",
    "project track",
    "project archive",
    "context define",
    "context create",
    "term define",
    "term propose",
    "assignment",
    "assignment change",
    "approval grant",
    "approval reject",
    "approval decide",
    "grant",
    "grant create",
    "grant revoke",
    "problem close",
    "problem ignore",
    "backup",
    "backup list",
    "db",
    "sql",
  ],
};

Deno.test("coding-agent/cli#R16 #R17 #R23 #R38 #R6: 사람 관리 command와 금지 동작이 CLI command 표에 없다", () => {
  const names = new Set(COMMANDS.map((entry) => entry.name));
  for (const [requirement, commands] of Object.entries(ABSENT_COMMANDS)) {
    for (const command of commands) {
      assert(!names.has(command), `${requirement}: ${command}이 표에 있다`);
      assertEquals(findCommand(command), undefined, command);
    }
  }
  // 첫 단어(group)로도 사람 관리 group이 없다.
  const groups = new Set(COMMANDS.map((entry) => entry.name.split(" ")[0]));
  for (
    const group of [
      "place",
      "unplace",
      "file",
      "folder",
      "secrets",
      "secret",
      "grant",
      "assignment",
      "backup",
    ]
  ) {
    assert(!groups.has(group), `${group} group이 표에 있다`);
  }
});

Deno.test("coding-agent/cli#R6 #R4: 사람 관리 command를 직접 불러도 표를 못 찾아 실행 전에 거절이다", () => {
  for (const commands of Object.values(ABSENT_COMMANDS)) {
    for (const command of commands) {
      const parsed = parseArgs([...command.split(" "), "--json"]);
      assertEquals(parsed.errors, []);
      assert(parsed.command !== undefined);
      const ref = splitCommand(parsed.command);
      if (!ref.ok) continue;
      const name = ref.value.name === undefined
        ? ref.value.group
        : `${ref.value.group} ${ref.value.name}`;
      assertEquals(findCommand(name), undefined, command);
    }
  }
});

Deno.test("coding-agent/cli#R6 #R16 #R17 #R23 #R38: CLI 표가 부르는 소유 route는 금지 route가 아니고 모두 coding_agent actor를 받는다", () => {
  const forbidden = new Set(forbiddenRouteNames());
  const byName = contractRoutesByName();
  let checked = 0;
  for (const command of COMMANDS) {
    const routes = [
      command.monoRoute,
      ...Object.values(command.opRoutes ?? {}),
    ];
    for (const route of routes) {
      const name = (route as { name?: string } | undefined)?.name;
      if (name === undefined) continue;
      checked += 1;
      assert(
        !forbidden.has(name),
        `${command.name}이 금지 route ${name}을 부른다`,
      );
      assert(
        byName.get(name)?.actors.includes("coding_agent"),
        `${command.name}의 route ${name}이 coding_agent actor를 받지 않는다`,
      );
    }
  }
  assert(checked >= 20, `검사한 route가 너무 적다: ${checked}`);
  // 문서 저장의 길은 정본 저장 하나다. 자리·원본·복원 route는 save의 route 표에 없다.
  const save = COMMANDS.find((entry) => entry.name === "save");
  assert(save?.opRoutes);
  assertEquals(
    Object.values(save.opRoutes).map((route) =>
      (route as { name: string }).name
    )
      .sort(),
    [
      "document.list",
      "document.prepare",
      "document.save",
      "series.add_instance",
      "series.get",
    ],
  );
});
