// 초안 폴더 test(`bundle.test_draft`)의 보고를 만든다. 보고는 CheckReport 모양이지만 판도 검사도 만들지 않는다.
//   - bundle.json이 BundleContent 검사를 지나지 못하면 파일을 읽을 것 없이 바로 실패 보고다(schemaFailure).
//   - 지나면 격리 검사(context worker)가 파일을 돌려야 하므로 running 보고를 먼저 만들고(running),
//     worker의 결과로 끝낸다(finished).
import {
  bundleContentSchema,
  type CheckReport,
} from "../../../../protocol/projects/mod.ts";
import type { ProjectFiles } from "../extract/types.ts";
import { runCheck } from "./runner.ts";

const NO_FILES: ProjectFiles = { paths: () => [], read: () => null };

// 보고의 id는 판의 id에서 낸다(같은 초안은 같은 id). 판 id `cbn_<ulid>` → `chk_<ulid>`.
function reportIdOf(bundle: string): string {
  return `chk_${bundle.slice(4)}`;
}

type Subject = { context: string; bundle: string; at: string };

export function runningReport(subject: Subject): CheckReport {
  return {
    id: reportIdOf(subject.bundle),
    context: subject.context,
    bundle: subject.bundle,
    status: "running",
    snapshot_hash: null,
    findings: [],
    violation_count: null,
    started_at: subject.at,
    finished_at: null,
  } as CheckReport;
}

type FinishedCheck =
  & Pick<
    CheckReport,
    "snapshot_hash" | "findings" | "violation_count"
  >
  & { status: "passed" | "failed" };

export function finishedReport(
  running: CheckReport,
  done: FinishedCheck,
  at: string,
): CheckReport {
  return { ...running, ...done, finished_at: at } as CheckReport;
}

// 모양 검사를 지나지 못한 내용이면 실패 보고, 지났으면 null이다.
export function schemaFailure(
  subject: Subject,
  content: unknown,
): CheckReport | null {
  if (bundleContentSchema.safeParse(content).success) return null;
  const outcome = runCheck({
    bundle: content,
    files: NO_FILES,
    appData: () => undefined,
    env: { externalTypes: [], appApiEffect: () => "unknown" },
    user_saved_views: [],
  });
  return finishedReport(runningReport(subject), outcome, subject.at);
}
