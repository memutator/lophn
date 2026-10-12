import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";

// 사람이 구한 package의 로컬 안내 metadata다. OS 검증 결과는 metadata만으로
// 증명하지 않으며, 실제 배포 검증 전에는 available로 승격하지 않는다.
const packageSchema = z.object({
  version: z.string().min(1),
  os: z.enum(["linux", "darwin", "windows"]),
  format: z.enum(["deb", "dmg", "exe"]),
  schema: z.number().int().nonnegative(),
}).strict();

export type UpdatePackage = z.infer<typeof packageSchema>;
export type UpdateNotice = {
  installed_version: string;
  new_version: string;
  os: UpdatePackage["os"];
  package_format: UpdatePackage["format"];
  // schema 판 번호 비교일 뿐, 이력 hash·무결성은 다음 core 기동에서 검증한다.
  schema: "compatible" | "migration_required" | "newer_than_package";
  schema_history: "unverified";
  restart_required: true;
  method: "manual";
  deployment: "unverified";
  instructions: readonly string[];
};

// URL이나 update server를 받지 않는다. 사람이 고른 로컬 metadata를 읽을 뿐,
// package 다운로드·설치·재시작은 이 함수에 없다.
export async function readUpdatePackage(
  path: string,
): Promise<Result<UpdatePackage>> {
  try {
    const parsed = packageSchema.safeParse(
      JSON.parse(await Deno.readTextFile(path)),
    );
    if (parsed.success) return ok(parsed.data);
  } catch {
    return err({
      code: "unavailable",
      message: "로컬 update metadata를 읽을 수 없다",
    });
  }
  return err({
    code: "invalid_input",
    message: "update metadata 모양이 올바르지 않다",
  });
}

export function updateNotice(input: {
  installedVersion: string;
  installedSchema: number;
  os: string;
  candidate: UpdatePackage;
}): Result<UpdateNotice> {
  const candidate = packageSchema.safeParse(input.candidate);
  if (
    !candidate.success || candidate.data.os !== input.os ||
    (input.os === "linux" && candidate.data.format !== "deb") ||
    (input.os === "darwin" && candidate.data.format !== "dmg") ||
    (input.os === "windows" && candidate.data.format !== "exe")
  ) {
    return err({
      code: "invalid_input",
      message: "이 OS의 설치 package가 아니다",
    });
  }
  const schema = input.installedSchema > candidate.data.schema
    ? "newer_than_package"
    : input.installedSchema < candidate.data.schema
    ? "migration_required"
    : "compatible";
  return ok({
    installed_version: input.installedVersion,
    new_version: candidate.data.version,
    os: candidate.data.os,
    package_format: candidate.data.format,
    schema,
    schema_history: "unverified",
    restart_required: true,
    method: "manual",
    deployment: "unverified",
    instructions: [
      "진행 작업과 lophn을 정상 정지한 뒤 사람이 새 설치 package를 적용한다.",
      "설치 파일만 교체하고 데이터 폴더는 초기화하지 않는다. 자동 다운로드·설치·재시작은 하지 않는다.",
      ...(schema === "migration_required"
        ? [
          "다음 기동에서 검증 backup을 만들고 포함된 schema migration을 순서대로 적용한다. 실패한 단계는 rollback한다.",
        ]
        : []),
      "이전 설치로 돌아가려면 호환되는 검증 backup과 잃을 최신 기록을 확인하고 사람의 명시 승인으로 restore한다. 자동 downgrade는 하지 않는다.",
      "OS 실제 build·설치·sandbox·기동·앱 호출·backup restore는 미검증이다. 기동만으로 업무나 미확인 외부 효과의 성공을 주장하지 않는다.",
    ],
  });
}
