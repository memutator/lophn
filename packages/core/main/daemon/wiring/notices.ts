// program이 사람에게 남기는 기록(notices.record)을 core 안 다른 wiring이 쓰는 길이다. `ctx.noticeRecorder`가 core 안 machine
// 자격으로 쓰기 층을 지난다(commit 뒤 Bus까지 사람이 낸 것과 같다). 사람·agent·앱·renderer는 이 route를 부르지 못한다
// (route actors와 operation 정책이 machine뿐이다).
// 표를 합치는 ledger step(`apps.notices.unified`)은 낸 step 목록의 맨 끝에 붙어야 해서(schema-steps.lock.json) 앱 팀의
// schemaSteps가 아니라 목록 맨 뒤 wiring의 schemaStepsAfterTeams에 둔다.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { err, errorCode, ok, type Result } from "../../../../base/mod.ts";
import {
  type NoticeRecordInput,
  noticeRecord,
  noticesObserveVersion,
} from "../../../../protocol/apps/notice.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { BUNDLED_SKILLS_ROOT } from "../../../agent-workspaces/skills/root.ts";
import {
  noticeUnifiedSchemaSteps,
  productVersionSchemaSteps,
} from "../../../apps/notices/mod.ts";
import { appDeleteSchemaSteps } from "../../../apps/registration/mod.ts";
import { readInstalledVersions } from "../../../apps/sdk-status/mod.ts";
import type { WiringFactory } from "./context.ts";

const NOTICE_RECORDER_PRINCIPAL = "machine:notice-recorder";
const NOTICE_RECORDER_CONTEXT: AuthenticatedContext = {
  principal: NOTICE_RECORDER_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [noticeRecord.name, noticesObserveVersion.name],
    targets: {},
  },
  conditions: {},
  credential_ref: NOTICE_RECORDER_PRINCIPAL,
};

export type NoticeRecorder = (
  input: NoticeRecordInput,
) => Promise<Result<{ id: string }>>;

// 제품 판은 root package.json 하나다. 이 file 위치에서 본 repo root(개발)이거나 설치본의 platform/(tools/package가 root package.json을 싣는다)다.
const PRODUCT_PACKAGE_JSON = fileURLToPath(
  new URL("../../../../../package.json", import.meta.url),
);

export async function readProductVersion(): Promise<Result<string>> {
  try {
    const version = JSON.parse(
      await readFile(PRODUCT_PACKAGE_JSON, "utf8"),
    ).version;
    if (typeof version === "string" && version.length > 0) return ok(version);
  } catch {
    // 아래 오류로 이어진다.
  }
  return err({ code: "internal", message: "product version is unreadable" });
}

export async function readPlatformNoteIds(
  skillsRoot = BUNDLED_SKILLS_ROOT,
): Promise<string[]> {
  try {
    const raw = await readFile(
      `${skillsRoot}/update/platform-notes.json`,
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
  } catch (cause) {
    if (errorCode(cause) === "ENOENT" || cause instanceof SyntaxError) {
      return [];
    }
    throw cause;
  }
}

export function createNoticesWiring(
  productVersion: () => Promise<Result<string>>,
): WiringFactory {
  return () => ({
    name: "notices",
    // 낸 때 목록의 맨 끝이던 step이다. 그 뒤에 낸 step은 WIRINGS(assembly.ts)의 맨 뒤 wiring에 붙는다.
    schemaStepsAfterTeams: [
      ...noticeUnifiedSchemaSteps,
      ...productVersionSchemaSteps,
      // 앱 팀의 schemaSteps는 목록 중간이라 이미 낸 뒤에 더하는 step은 여기에 붙는다.
      ...appDeleteSchemaSteps,
    ],
    operations: () => [
      { name: noticeRecord.name, actors: ["machine"], kind: "command" },
      {
        name: noticesObserveVersion.name,
        actors: ["machine"],
        kind: "command",
      },
    ],
    records: () => [NOTICE_RECORDER_CONTEXT],
    build(ctx) {
      const record: NoticeRecorder = async (input) => {
        const done = await ctx.writer.command(NOTICE_RECORDER_CONTEXT, {
          command: noticeRecord.name,
          input,
          compare: {},
          idempotency_key: crypto.randomUUID(),
          prepared: [],
        });
        if (!done.ok) return done;
        const id = (done.value.result as { id?: unknown } | null)?.id;
        return typeof id === "string"
          ? ok({ id })
          : err({ code: "internal", message: "notices.record returned no id" });
      };
      ctx.provide("noticeRecorder", record);
      return ok({});
    },
    // API가 열린 뒤(writer가 쓰기 층을 다 지난 뒤)에 판을 견주고 올린 쪽을 부른다. 실패해도 core 기동을 막지 않고 log만 남긴다.
    async afterReady(ctx) {
      const logFailure = (event: string, thrown: unknown) =>
        ctx.telemetry.logger.error({
          component: "notices",
          event,
          fields: { message: String(thrown) },
        });
      const version = await productVersion();
      if (!version.ok)
        return logFailure("product_version_failed", version.error.message);
      // 설치 사본을 못 읽으면 SDK 판은 견주지 않고 제품 판만 본다.
      const sdks = await readInstalledVersions(ctx.root.path).catch(
        (thrown) => {
          logFailure("sdk_versions_failed", thrown);
          return undefined;
        },
      );
      const platformNotes = await readPlatformNoteIds().catch((thrown) => {
        logFailure("platform_notes_failed", thrown);
        return [];
      });
      const done = await ctx.writer.command(NOTICE_RECORDER_CONTEXT, {
        command: noticesObserveVersion.name,
        input: {
          version: version.value,
          sdks,
          platform_notes: platformNotes,
          // 이번 기동이 step을 전부 새로 적용했으면 새 data root다.
          fresh: ctx.migrationsApplied === ctx.schemaSteps.length,
        },
        compare: {},
        idempotency_key: crypto.randomUUID(),
        prepared: [],
      });
      if (!done.ok)
        return logFailure("product_version_failed", done.error.message);
      const observed = done.value.result as {
        changed: boolean;
        from: string | null;
        sdks_changed: boolean;
        platform_notes_changed?: boolean;
      };
      for (const listener of ctx.productStartListeners) {
        try {
          await listener({
            version: version.value,
            changed: observed.changed,
            from: observed.from,
            sdksChanged:
              observed.sdks_changed || observed.platform_notes_changed === true,
          });
        } catch (thrown) {
          logFailure("product_start_listener_failed", thrown);
        }
      }
    },
  });
}

export const noticesWiring = createNoticesWiring(readProductVersion);
