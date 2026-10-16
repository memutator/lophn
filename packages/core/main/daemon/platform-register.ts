// platform 등록 출처. contract ROUTES가 platform route를 이미 고정하므로, 팀 등록(assemble)에 다시 올리면 route가
// 겹쳐 기동이 거절된다. 그래서 settings(settings.ts)처럼 team 목록 밖에서 한 번만 조립한다.
// 이 모듈은 core 기동이 항상 붙이고 팀이 따로 등록하지 않는다. approvals는 자기 등록(`approvals/registration.ts`)을 낸다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  CommandDefinition,
  SchemaStep,
} from "../../../protocol/server/mod.ts";
import type { BlobFieldDefinition } from "../../../protocol/storage/mod.ts";
import { secretsListRead } from "../../secrets/mod.ts";
import type { ReaderRegistration } from "../../storage/ledger/mod.ts";
import type { Assembled } from "./registration.ts";

const platformDefinitions = {
  schemaSteps: [] as SchemaStep[],
  commands: [] as CommandDefinition[],
  reads: [
    // SetSecret·RemoveSecret의 display_read다. 이름·설정 여부·판만 보인다.
    secretsListRead(),
  ],
  blobFields: [] as BlobFieldDefinition[],
};

// reader Worker가 이 모듈에서 read를 다시 조립한다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [...platformDefinitions.reads],
    ports: new Map(),
  };
}

// core 조립이 team 조립 결과에 platform 항목을 더한다. command 이름·read 경로·schema id·blob
// field가 팀 등록과 겹치면 거절한다. route는 더하지 않는다: contract ROUTES가 소유한다.
export function withPlatform(
  assembled: Result<Assembled>,
  _environment: unknown = {},
): Result<Assembled> {
  if (!assembled.ok) return assembled;
  const value = assembled.value;
  const commands = new Set(value.commands.map((c) => c.route.name));
  const reads = new Set(
    [...value.reads, ...value.apiReads].map((r) =>
      `${r.route.resource}/${r.route.method}`
    ),
  );
  const schema = new Set(value.schemaSteps.map((step) => step.id));
  const overlap = (what: string, key: string): Result<never> =>
    err({
      code: "internal",
      message: `등록이 겹친다: ${what} ${key}`,
    });
  for (const command of platformDefinitions.commands) {
    if (commands.has(command.route.name)) {
      return overlap("command", command.route.name);
    }
  }
  for (const read of platformDefinitions.reads) {
    const key = `${read.route.resource}/${read.route.method}`;
    if (reads.has(key)) return overlap("read", key);
  }
  for (const step of platformDefinitions.schemaSteps) {
    if (schema.has(step.id)) return overlap("schema", step.id);
  }
  return ok({
    ...value,
    // platform 표는 팀 표가 참조할 수 있으므로 팀 schema보다 앞에 둔다.
    schemaSteps: [...platformDefinitions.schemaSteps, ...value.schemaSteps],
    commands: [
      ...value.commands,
      ...platformDefinitions.commands as unknown as Assembled["commands"],
    ],
    reads: [
      ...value.reads,
      ...platformDefinitions.reads as unknown as Assembled["reads"],
    ],
    blobFields: [...value.blobFields, ...platformDefinitions.blobFields],
  });
}
