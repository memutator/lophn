// sync이다(mcp#R19 도구 재배포). 사람이 고른 target 하나의 앱
// 범위(app_realpath)에 도구를 다시 맞춘다. 두 통로(MCP tool과 CLI command)가 이 한 흐름을
// 지나므로 같은 입력의 결과와 거절이 같다.
//
// 통로는 다섯이다.
// - MCP 설정·skill·관리 구간 안내(Claude의 CLAUDE.md 관리 구간 등)는 사람이 고른 plan의
//   몫과 같은 engine(harnesses의 installSelected·installSkills)을 재사용한다. conflict
//   규칙(receipt 없는 동명·사람 수정·외부 symlink는 덮지 않는다)도 같다.
// - ignore 안내는 source의 관리 ignore 구간을 이 모듈이 쓴다(managed-files의 bytes 보존).
//
// 재배포는 앱 code와 사람 몫 구간·다른 MCP 설정을 건드리지 않는다. 같은 배포를
// 두 번 해도 소유 조각의 unchanged로 중복이 없다. 파일 변경이 생기면 이 모듈이
// 파일별 결과를 풀어 준다.
import { err, ok, type Result } from "../../base/mod.ts";
import type {
  IntegrationTarget,
  ReceiptOutcome,
  ResourceInstallResult,
} from "../../protocol/coding-agent/mod.ts";
import type { RootInputs } from "../harnesses/mod.ts";
import { installSelected } from "../harnesses/mod.ts";
import type { ManagedFilesPort } from "./managed-files.ts";
import { updateGuideRegion } from "./managed-files.ts";
import type { DistributedSkill } from "./distribution.ts";
import { installSkills } from "./install.ts";

export type SyncFileResult = {
  // 두 통로가 같은 이름으로 보여 주는 재배포 대상이다(cli#R29의 MCP·skill·공통
  // 안내·ignore 안내별 항목).
  target: "mcp" | "guide" | "ignore" | "skill";
  name: string;
  outcome: ReceiptOutcome;
  reason: string;
};

export type SyncToolsOutcome = {
  files: SyncFileResult[];
  notices: string[];
  status: "complete" | "partial" | "failed";
};

export type SyncToolsInput = {
  target: IntegrationTarget;
  // 설치할 skill 이름이다. 없으면 배포하는 skill 전부다.
  names?: readonly string[];
  skills: readonly DistributedSkill[];
  roots: RootInputs;
  launch: Parameters<typeof installSkills>[0]["launch"];
  // 사람이 고른 connection 참조다. token 원문은 없다.
  connection: string | null;
  operationId: string;
  now: string;
};

export type SyncToolsPorts = {
  files: Parameters<typeof installSkills>[1]["files"];
  store: Parameters<typeof installSkills>[1]["store"];
};

// 무변경 충돌 안내다. 읽어 둔 hash가 현재와 달라 파일을 바꾸지 않았다.
export function staleGuideMessage(): string {
  return "안내 파일을 읽은 뒤 사람 동시 편집이 생겼다. 파일을 다시 읽고 같은 갱신을 다시 접수한다. lophn은 파일을 바꾸지 않았다";
}

// engine의 resource별 결과를 재배포 항목으로 옮긴다. identity의 앞부분이
// builder의 규칙이다. hook identity는(sync는 hook을 다시 맞추지 않는다) 건너뜀 결과로
// 옮기지 않고 이 결과에 싣지 않는다.
function fileResultOf(
  identity: string,
  result: ResourceInstallResult,
): SyncFileResult | null {
  if (identity.startsWith("hook:")) return null;
  const kind: SyncFileResult["target"] = identity.startsWith("mcp:")
    ? "mcp"
    : identity.startsWith("skill:")
    ? "skill"
    : "guide";
  return {
    target: kind,
    name: identity,
    outcome: result.outcome,
    reason: result.reason,
  };
}

// ignore 관리 파일의 같은 폴더 temp·rename 눈이다(managed-files의 port를 파일 눈으로
// 쳐 낸다). symlink는 따라가지 않는다(managed-files).
function managedIgnorePort(
  files: Parameters<typeof installSkills>[1]["files"],
): ManagedFilesPort {
  return {
    async readBytes(path) {
      const read = await files.read(path);
      if (read.kind === "file") return ok(new TextEncoder().encode(read.text));
      if (read.kind === "absent") return ok(null);
      return err({ code: "unavailable", message: "파일을 읽지 못했다" });
    },
    async writeBytesAtomic(path, bytes) {
      const wrote = await files.writeAtomic(
        path,
        new TextDecoder().decode(bytes),
      );
      return wrote
        ? ok(null)
        : err({ code: "unavailable", message: "쓰기에 실패했다" });
    },
  };
}

// 무변경 재배포 sync의 기준 bytes다. 안내 원본이 cli#R29의 재배포 항목이다. 관리 ignore
// 구간 기준 bytes다. sync의 ignore 갱신은 관리 구간 안쪽을 이 몸통으로만 두고 바깥 사람
// 내용을 bytes 그대로 둔다. 어느 몸통이든 sync의 몫 구간(bytes 보존)은 managed-files다.
const IGNORE_ORIGINAL = "# begin lophn-managed\n# end lophn-managed\n";
const IGNORE_BODY = ".lophn/\ndist/\nnode_modules/\n";

// app source의 개발 도구를 다시 맞춘다. 결과의 files는 cli#R29의 재배포 항목별
// 결과다. sync는 앱 하나 범위의 target만 받고(MCP 설정·skill·안내는 이 target의
// app_realpath에 쓴다) user target은 오류이다.
export async function syncTools(
  input: SyncToolsInput,
  ports: SyncToolsPorts,
): Promise<Result<SyncToolsOutcome>> {
  if (input.target.scope_kind === "user") {
    return err({
      code: "invalid_input",
      message: "sync는 앱 하나 범위의 target만 받는다(--app 범위 target)",
    });
  }
  const results: SyncFileResult[] = [];
  const notices: string[] = [];

  // 통로 1·3: MCP 설정과 관리 구간 안내다. 사람이 고른 plan의 몫과 같은 engine이다.
  const instruction = await installSelected({
    target: input.target,
    connection: input.connection,
    launch: input.launch,
    version: null,
    roots: input.roots,
    operationId: `${input.operationId}:instruction`,
    now: input.now,
    components: ["mcp", "guide"],
  }, ports);
  if (!instruction.ok) return instruction;
  const resources: (SyncFileResult | null)[] = instruction.value.resources.map(
    (r) => fileResultOf(r.resource_identity, r),
  );
  results.push(...resources.filter((r): r is SyncFileResult => r !== null));
  notices.push(...instruction.value.notices);

  // 통로 2: skill이다. 같은 engine이다.
  const wanted = input.names ?? input.skills.map((skill) => skill.name);
  const synced = await installSkills({
    target: input.target,
    names: wanted,
    skills: input.skills,
    roots: input.roots,
    launch: input.launch,
    connection: input.connection,
    operationId: `${input.operationId}:skill`,
    now: input.now,
  }, ports);
  if (!synced.ok) return synced;
  for (const skill of synced.value.skills) {
    results.push({
      target: "skill",
      name: skill.name,
      outcome: skill.outcome,
      reason: skill.reason,
    });
  }
  notices.push(...synced.value.notices);

  // 통로 4: ignore 안내다. source의 관리 ignore 구간을 쓴다(managed-files).
  // 무변경 재배포 기준이다. 관리 ignore 구간 기준 bytes다.
  const ignorePath = `${
    input.target.app_realpath.replace(/\/$/, "")
  }/.gitignore`;
  const ignore = await updateGuideRegion(
    {
      guide: IGNORE_BODY,
      guidePath: ignorePath,
      guideOriginalBytes: new TextEncoder().encode(IGNORE_ORIGINAL),
    },
    managedIgnorePort(ports.files),
  );
  results.push({
    target: "ignore",
    name: ".gitignore",
    outcome: ignore.ok ? "changed" : "unchanged",
    reason: ignore.ok ? "ignore 구간을 썼다" : ignore.error.message,
  });

  const wrote = results.some((item) =>
    item.outcome === "changed" || item.outcome === "unchanged"
  );
  const allClean = results.length > 0 &&
    results.every((item) =>
      item.outcome === "changed" || item.outcome === "unchanged"
    );
  const receiptClean = instruction.value.status !== "failed" &&
    synced.value.status !== "failed";
  return ok({
    files: results,
    notices,
    status: allClean && receiptClean
      ? "complete"
      : wrote
      ? "partial"
      : "failed",
  });
}
