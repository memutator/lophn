// platform이 만드는 approvals·notifications 등록 출처. contract ROUTES가 이 둘의 route를
// 이미 고정하므로, 팀 등록(assemble)에 다시 올리면 route가 겹쳐 기동이 거절된다. 그래서
// settings(settings.ts)처럼 team 목록 밖에서 한 번만 조립한다: schema·command·read·blob field는
// 여기서 core 조립(withPlatform)과 writer·reader Worker가 같은 모듈로 모은다. route는 ROUTES만
// 소유한다. 이 모듈은 core 기동이 항상 붙이고 팀이 따로 등록하지 않는다.
//
// 사람 결정(허락·거절)의 confirmation handle은 route 선언(`confirmation: "required"`)과 writer
// 실행기가 강제한다. 여기서는 그 command를 등록할 뿐 handle 검사를 우회하지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { ASSIGNMENT_SUBSCRIBER } from "../../../protocol/lophn-agent/mod.ts";
import { ASSIGNMENT_REACTION_OPERATIONS } from "../../lophn-agent/assignments/reaction.ts";
import type {
  EventVisibilityDefinition,
  RequestContext,
} from "../../../protocol/server/mod.ts";
import { approvalRequestCreated } from "../../../protocol/approvals/mod.ts";
import type { CommandRoute } from "../../../protocol/base/mod.ts";
import type { EventDefinition } from "../../../protocol/events/mod.ts";
import {
  notificationCreated,
  notificationRead,
} from "../../../protocol/notifications/mod.ts";
import {
  APPROVAL_BLOB_FIELDS,
  APPROVAL_SCHEMA_STEPS,
  approvalExpirySweepRead,
  approvalsGetRead,
  approvalsListRead,
  approvalsTextRead,
  type ApprovalTextEnvironment,
  createApplyCommand,
  createApprovalCommands,
} from "../../approvals/mod.ts";
import {
  NOTIFICATION_COMMANDS,
  NOTIFICATION_SUBSCRIBER,
  NOTIFICATIONS_SCHEMA_STEPS,
  notificationsDisplayRead,
  notificationsGetRead,
  notificationsListRead,
} from "../../notifications/mod.ts";
import { secretsListRead } from "../../secrets/mod.ts";
import type {
  EventRegistration,
  ReaderRegistration,
  SubscriberBinding,
} from "../../storage/ledger/mod.ts";
import type { Assembled } from "./registration.ts";
import {
  type BackupReadEnvironment,
  backupReads,
} from "../../storage/migration/backup-reads.ts";

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

// AppCreated·자리 보관 반응 구독자의 core 내부 machine 자격이다. token이 없어 HTTP로는 이 principal이 될 수
// 없고, ledger credential 기록으로만 reader·writer가 현재 자격을 다시 본다. 구독자 이름은
// contracts의 ASSIGNMENT_SUBSCRIBER("lophn-agent-assignments")다.
export const ASSIGNMENT_REACTIONS_PRINCIPAL = "machine:lophn-agent-assignments";

// 읽기(event·assignment)와 생성·멈춤·재개·cursor 전진 operation만 둔다. assignment 본문 조립은
// 하지 않는다.
export const ASSIGNMENT_REACTIONS_CONTEXT: RequestContext = {
  principal: ASSIGNMENT_REACTIONS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [...ASSIGNMENT_REACTION_OPERATIONS],
    targets: {},
  },
  conditions: {},
  credential_ref: ASSIGNMENT_REACTIONS_PRINCIPAL,
};

// approval 만료 정리의 core 내부 machine 자격이다. token이 없어 HTTP로는 이 principal이 될 수 없다.
// 기한에 도달한 대기를 읽고 `expire_approval_request`만 낸다. 허락·거절·취소·사용은 하지 못한다.
export const APPROVAL_EXPIRY_PRINCIPAL = "machine:approval-expiry";

export const APPROVAL_EXPIRY_CONTEXT: RequestContext = {
  principal: APPROVAL_EXPIRY_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: ["ApprovalExpirySweep", "expire_approval_request"],
    targets: {},
  },
  conditions: {},
  credential_ref: APPROVAL_EXPIRY_PRINCIPAL,
};

export function isNotifications(ctx: RequestContext): boolean {
  return ctx.actor === "machine" && ctx.principal === NOTIFICATIONS_PRINCIPAL &&
    ctx.credential_ref === NOTIFICATIONS_PRINCIPAL;
}

export function isAssignmentReactions(ctx: RequestContext): boolean {
  return ctx.actor === "machine" &&
    ctx.principal === ASSIGNMENT_REACTIONS_PRINCIPAL &&
    ctx.credential_ref === ASSIGNMENT_REACTIONS_PRINCIPAL;
}

// 계기 event의 소유 concern이 자기 등록 파일에서 쓰는 공개 정책이다. notifications 구독자만
// 읽고, 사람·agent·app·다른 machine은 정책이 없을 때와 똑같이 못 본다(정책 없음 = 숨김).
// 사람에게 event를 보이는 일은 notification read가 맡는다. 소유 concern이 사람·다른 자격에게
// 이미 공개하는 event라면 이 정책을 그 정책 뒤에 이어 쓴다(owner 정책 || isNotifications).
export function notificationsOnlyVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return { event, handle: (_snapshot, ctx) => ok(isNotifications(ctx)) };
}

// AppCreated·AppArchived처럼 assignments 반응 구독자만 읽는 계기 event의 공개 정책이다.
// 다른 자격은 정책이 없을 때와 똑같이 못 본다.
export function assignmentReactionsOnlyVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return { event, handle: (_snapshot, ctx) => ok(isAssignmentReactions(ctx)) };
}

const approvalCommands = createApprovalCommands();

// apply_approved_action이 dispatch할 수 있는 소유 command route다. writer가 모든 등록을 모은 뒤
// dispatchable로 표시된 command만 여기 묶는다(bindApprovalOwners). 묶기 전에는 비어 있어 어느
// command도 적용하지 않는다. writer Worker마다 이 module 상태가 따로 있다.
let approvalOwners: readonly CommandRoute[] = [];

export function bindApprovalOwners(routes: readonly CommandRoute[]): void {
  approvalOwners = [...routes];
}

export const platformDefinitions = {
  schemaSteps: [...APPROVAL_SCHEMA_STEPS, ...NOTIFICATIONS_SCHEMA_STEPS],
  commands: [
    approvalCommands.create,
    approvalCommands.expire,
    approvalCommands.cancel,
    approvalCommands.grant,
    approvalCommands.reject,
    createApplyCommand(() => approvalOwners),
    ...NOTIFICATION_COMMANDS,
  ],
  reads: [
    approvalsGetRead(),
    approvalsListRead(),
    approvalExpirySweepRead(),
    notificationsGetRead(),
    notificationsListRead(),
    notificationsDisplayRead(),
    // SetSecret·RemoveSecret의 display_read다. 이름·설정 여부·판만 보인다.
    secretsListRead(),
  ],
  blobFields: APPROVAL_BLOB_FIELDS,
};

// writer Worker가 이 모듈을 다시 import해 command·cursor gate를 모은다. approvals·notifications
// 외 command는 다른 팀 등록이 낸다.
export function createCoreRegistration() {
  return {
    commands: platformDefinitions.commands,
    blobFields: platformDefinitions.blobFields,
    // notifications 구독자만 자기 cursor를 올린다.
    subscribers: platformSubscribers(),
  };
}

export function platformSubscribers(): SubscriberBinding[] {
  return [
    {
      name: NOTIFICATION_SUBSCRIBER,
      authorize: (ctx) => ok(isNotifications(ctx)),
    },
    // AppCreated 반응 구독자만 자기 cursor를 올린다.
    {
      name: ASSIGNMENT_SUBSCRIBER,
      authorize: (ctx) => ok(isAssignmentReactions(ctx)),
    },
  ];
}

// reader Worker가 이 모듈에서 approvals·notifications read를 다시 조립한다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [...platformDefinitions.reads],
    ports: new Map(),
  };
}

// notification 계기 중 platform이 소유한 event다. 정책이 없는 event는 events/list에서 숨김이므로
// notifications 구독자가 읽도록 이 event를 공개한다. 사람은 결정 대기를 볼 수 있다. 다른 소유
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

// shell/desktop가 구독하는 notification 자신의 event다. 정책이 없으면 사람 token의
// events/list와 구독이 둘 다 숨겨, shell main이 표시·실패 보고까지 가지 못한다.
// 계기 event는 각 owner의 notifications 구독자 정책에 남긴다.
function userNotificationVisibility<D extends EventDefinition>(
  event: D,
): EventVisibilityDefinition<D> {
  return { event, handle: (_snapshot, ctx) => ok(ctx.actor === "user") };
}

export function createEventRegistration(): EventRegistration {
  return {
    visibility: [
      approvalCreatedVisibility,
      userNotificationVisibility(notificationCreated),
      userNotificationVisibility(notificationRead),
    ],
  };
}

// ReadApprovalText는 ledger snapshot에서 참조를 판정한 뒤 blob 바이트를 기다리는 core read다.
// core가 기동 때 읽기 통로를 넣고, 넣지 않은 등록은 unavailable이다.
const UNATTACHED_APPROVAL_TEXT: ApprovalTextEnvironment = {
  snapshot: () =>
    err({
      code: "unavailable",
      message: "approval 글 읽기 통로가 붙어 있지 않다",
    }),
  bytes: () =>
    Promise.resolve(err({
      code: "unavailable",
      message: "blob 읽기 통로가 붙어 있지 않다",
    })),
};

// core 조립이 team 조립 결과에 platform 항목을 더한다. command 이름·read 경로·schema id·blob
// field가 팀 등록과 겹치면 거절한다. route는 더하지 않는다: contract ROUTES가 소유한다.
export function withPlatform(
  assembled: Result<Assembled>,
  environment: {
    approvalText?: ApprovalTextEnvironment;
    /** settings Backup 탭의 backups/list·get. 데이터 root가 없는 조립(시험)은 붙이지 않는다. */
    backups?: BackupReadEnvironment;
  } = {},
): Result<Assembled> {
  if (!assembled.ok) return assembled;
  const value = assembled.value;
  const apiReads = [
    approvalsTextRead(environment.approvalText ?? UNATTACHED_APPROVAL_TEXT),
    ...(environment.backups ? backupReads(environment.backups) : []),
  ];
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
  for (const read of [...platformDefinitions.reads, ...apiReads]) {
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
    apiReads: [
      ...value.apiReads,
      ...apiReads as unknown as Assembled["apiReads"],
    ],
    blobFields: [...value.blobFields, ...platformDefinitions.blobFields],
  });
}
