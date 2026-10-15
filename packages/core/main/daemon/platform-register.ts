// platform이 만드는 approvals 등록 출처. contract ROUTES가 approvals route를
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
import type { EventDefinition } from "../../../protocol/events/mod.ts";
import {
  APPROVAL_BLOB_FIELDS,
  APPROVAL_SCHEMA_STEPS,
  approvalsGetRead,
  approvalsListRead,
  approvalsTextRead,
  type ApprovalTextEnvironment,
  createApprovalCommands,
} from "../../approvals/mod.ts";
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

// notifications 구독자였던 core 내부 machine 자격 이름이다. 계기 event 공개 정책
// (`notificationsOnlyVisibility`)이 쓴다. events 단위가 그 정책 장치와 함께 지운다.
export const NOTIFICATIONS_PRINCIPAL = "machine:notifications";

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

export const platformDefinitions = {
  schemaSteps: APPROVAL_SCHEMA_STEPS,
  commands: [
    approvalCommands.create,
    approvalCommands.cancel,
    approvalCommands.grant,
    approvalCommands.reject,
  ],
  reads: [
    approvalsGetRead(),
    approvalsListRead(),
    // SetSecret·RemoveSecret의 display_read다. 이름·설정 여부·판만 보인다.
    secretsListRead(),
  ],
  blobFields: APPROVAL_BLOB_FIELDS,
};

// writer Worker가 이 모듈을 다시 import해 command·cursor gate를 모은다. approvals
// 외 command는 다른 팀 등록이 낸다.
export function createCoreRegistration() {
  return {
    commands: platformDefinitions.commands,
    blobFields: platformDefinitions.blobFields,
    subscribers: platformSubscribers(),
  };
}

export function platformSubscribers(): SubscriberBinding[] {
  return [
    // AppCreated 반응 구독자만 자기 cursor를 올린다.
    {
      name: ASSIGNMENT_SUBSCRIBER,
      authorize: (ctx) => ok(isAssignmentReactions(ctx)),
    },
  ];
}

// reader Worker가 이 모듈에서 approvals read를 다시 조립한다.
export function createReaderRegistration(): ReaderRegistration {
  return {
    reads: [...platformDefinitions.reads],
    ports: new Map(),
  };
}

// platform이 소유한 approval event다. 정책이 없는 event는 events/list에서 숨김이므로 사람에게 연다.
const approvalCreatedVisibility: EventVisibilityDefinition<
  typeof approvalRequestCreated
> = {
  event: approvalRequestCreated,
  handle(_snapshot, ctx) {
    return ok(ctx.actor === "user" || isNotifications(ctx));
  },
};

export function createEventRegistration(): EventRegistration {
  return {
    visibility: [
      approvalCreatedVisibility,
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
