// platform이 만드는 approvals·notifications 등록 출처. contract ROUTES가 이 둘의 route를
// 이미 고정하므로, 팀 등록(assemble)에 다시 올리면 route가 겹쳐 기동이 거절된다. 그래서
// settings(settings.ts)처럼 team 목록 밖에서 한 번만 조립한다: schema·command·read·blob field는
// 여기서 core 조립(withPlatform)과 writer·reader Worker가 같은 모듈로 모은다. route는 ROUTES만
// 소유한다. 이 모듈은 core 기동이 항상 붙이고 팀이 따로 등록하지 않는다.
//
// 사람 결정(허락·거절)의 confirmation handle은 route 선언(`confirmation: "required"`)과 writer
// 실행기가 강제한다. 여기서는 그 command를 등록할 뿐 handle 검사를 우회하지 않는다.
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  approvalRequestCreated,
  type EventVisibilityDefinition,
  type RequestContext,
} from "../../packages/contracts/platform/mod.ts";
import {
  APPROVAL_BLOB_FIELDS,
  APPROVAL_SCHEMA_STEPS,
  approvalsGetRead,
  approvalsListRead,
  createApprovalCommands,
} from "../../packages/platform/approvals/mod.ts";
import {
  NOTIFICATION_COMMANDS,
  NOTIFICATION_SUBSCRIBER,
  NOTIFICATIONS_SCHEMA_STEPS,
  notificationsGetRead,
  notificationsListRead,
} from "../../packages/platform/notifications/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
  SubscriberBinding,
} from "../../packages/platform/ledger/mod.ts";
import type { Assembled } from "./registration.ts";

// notifications 구독자의 core 내부 machine 자격이다. token이 없어 HTTP로는 이 principal이 될 수
// 없고, ledger credential 기록으로만 reader·writer가 현재 자격을 다시 본다.
export const NOTIFICATIONS_PRINCIPAL = "machine:notifications";

// 읽기(ListEvents)와 생성·cursor 전진 operation만 둔다. notification 본문을 만드는 일은 없다.
export const NOTIFICATIONS_CONTEXT: RequestContext = {
  principal: NOTIFICATIONS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      "ListEvents",
      "create_notification",
      "AdvanceSubscriberCursor",
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: NOTIFICATIONS_PRINCIPAL,
};

function isNotifications(ctx: RequestContext): boolean {
  return ctx.actor === "machine" && ctx.principal === NOTIFICATIONS_PRINCIPAL &&
    ctx.credential_ref === NOTIFICATIONS_PRINCIPAL;
}

const approvalCommands = createApprovalCommands();

export const platformDefinitions = {
  schemaSteps: [...APPROVAL_SCHEMA_STEPS, ...NOTIFICATIONS_SCHEMA_STEPS],
  commands: [
    approvalCommands.create,
    approvalCommands.expire,
    approvalCommands.cancel,
    approvalCommands.grant,
    approvalCommands.reject,
    ...NOTIFICATION_COMMANDS,
  ],
  reads: [
    approvalsGetRead(),
    approvalsListRead(),
    notificationsGetRead(),
    notificationsListRead(),
  ],
  blobFields: APPROVAL_BLOB_FIELDS,
};

// writer Worker가 이 모듈을 다시 import해 command·cursor gate를 모은다. approvals·notifications
// 외 command는 다른 팀 등록이 낸다.
export function createCoreRegistration() {
  return {
    commands: platformDefinitions.commands,
    blobFields: platformDefinitions.blobFields,
    // notifications 구독자만 자기 cursor를 올린다(platform/notifications#R1, R2).
    subscribers: platformSubscribers(),
  };
}

export function platformSubscribers(): SubscriberBinding[] {
  return [{
    name: NOTIFICATION_SUBSCRIBER,
    authorize: (ctx) => ok(isNotifications(ctx)),
  }];
}

// reader Worker가 이 모듈에서 approvals·notifications read를 다시 조립한다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [...platformDefinitions.reads],
    ports: new Map(),
  };
}

// notification 계기 중 platform이 소유한 event다. 정책이 없는 event는 events/list에서 숨김이므로
// notifications 구독자가 읽도록 이 event만 공개한다. 사람은 결정 대기를 볼 수 있다. 다른 소유
// concern(problems·lophn-agent·coding-agent·documents·apps)의 계기 event는 그 owner가 자기
// 등록 파일의 공개 정책에 notifications 구독자(`NOTIFICATIONS_PRINCIPAL`)를 더해야 켜진다.
const approvalCreatedVisibility: EventVisibilityDefinition<
  typeof approvalRequestCreated
> = {
  event: approvalRequestCreated,
  handle(_snapshot, ctx) {
    return ok(ctx.actor === "user" || isNotifications(ctx));
  },
};

export function createEventRegistration(): EventRegistration {
  return { visibility: [approvalCreatedVisibility] };
}

// core 조립이 team 조립 결과에 platform 항목을 더한다. command 이름·read 경로·schema id·blob
// field가 팀 등록과 겹치면 거절한다. route는 더하지 않는다: contract ROUTES가 소유한다.
export function withPlatform(assembled: Result<Assembled>): Result<Assembled> {
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
