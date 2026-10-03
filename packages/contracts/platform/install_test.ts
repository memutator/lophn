import { assert, assertEquals } from "@std/assert";
import {
  CLEAN_SHUTDOWN_STEPS,
  cleanShutdownSchema,
  INSTALL_COMMANDS,
  installReleaseSchema,
  instanceStateSchema,
  LINUX_DATA_ENTRIES,
  LINUX_DATA_ROOT,
  LINUX_DATA_ROOT_ENV,
  LINUX_DENO_CACHE,
  schemaCompatibilityStateSchema,
  SUPPORTED_OS,
  updateNoticeSchema,
} from "./install.ts";

Deno.test("platform/install-and-update#R1, platform/install-and-update#R2, platform/install-and-update#R6: 설치 판은 지원 OS와 실행 이름을 보여 준다", () => {
  assertEquals([...SUPPORTED_OS], ["linux", "macos", "windows"]);
  assertEquals([...INSTALL_COMMANDS], ["lophn-desktop", "lophn", "lophn-mcp"]);
  assert(
    installReleaseSchema.safeParse({
      os: "linux",
      method: "deb",
      version: "0.1.0",
      readiness: "unverified",
      commands: [...INSTALL_COMMANDS],
    }).success,
  );
  assert(
    !installReleaseSchema.safeParse({
      os: "linux",
      method: "exe",
      version: "0.1.0",
      readiness: "verified",
      commands: [...INSTALL_COMMANDS],
    }).success,
  );
  assert(
    !installReleaseSchema.safeParse({
      os: "linux",
      method: "appimage",
      version: "0.1.0",
      readiness: "verified",
      commands: [...INSTALL_COMMANDS],
      sandbox: "off",
    }).success,
  );
});

Deno.test("platform/install-and-update#R10, platform/backup-and-migration#R6: schema 호환과 instance 상태를 거절 포함해 구분한다", () => {
  assert(
    schemaCompatibilityStateSchema.safeParse({
      installed_version: 4,
      applied_version: 4,
      compatibility: "current",
    }).success,
  );
  assert(
    schemaCompatibilityStateSchema.safeParse({
      installed_version: 3,
      applied_version: 4,
      compatibility: "unsupported",
    }).success,
  );
  assert(
    !schemaCompatibilityStateSchema.safeParse({
      installed_version: 3,
      applied_version: 4,
      compatibility: "current",
    }).success,
  );
  assert(instanceStateSchema.safeParse("running").success);
  assert(!instanceStateSchema.safeParse("second_writer").success);
});

Deno.test("platform/install-and-update#R7, platform/install-and-update#R8, shell/desktop#R20: 데이터 위치와 정상 정지·재시작 필요만 값으로 둔다", () => {
  assertEquals(LINUX_DATA_ROOT, "~/.lophn");
  assertEquals(LINUX_DATA_ROOT_ENV, "LOPHN_HOME");
  assertEquals(LINUX_DENO_CACHE, "~/.cache/lophn/deno");
  assert(LINUX_DATA_ENTRIES.includes("backups"));
  assertEquals(LINUX_DATA_ENTRIES.length, 8);
  assertEquals(CLEAN_SHUTDOWN_STEPS[0], "close_admission");
  assertEquals(CLEAN_SHUTDOWN_STEPS.at(-1), "release_lock");
  assert(
    cleanShutdownSchema.safeParse({
      completed_through: "stop_children",
      unknown_results: true,
    }).success,
  );
  assert(
    updateNoticeSchema.safeParse({
      current_version: "0.1.0",
      offered_version: "0.2.0",
      os: "linux",
      schema: {
        installed_version: 4,
        applied_version: 3,
        compatibility: "migration_pending",
      },
      restart: "after_clean_stop",
    }).success,
  );
  assert(
    !updateNoticeSchema.safeParse({
      current_version: "0.1.0",
      offered_version: "0.2.0",
      os: "linux",
      schema: {
        installed_version: 4,
        applied_version: 4,
        compatibility: "current",
      },
      restart: "immediate",
      auto_install: true,
    }).success,
  );
});
