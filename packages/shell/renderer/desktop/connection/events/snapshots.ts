// ready 뒤에 읽는 snapshot. 읽기나 모양이 틀리면 null이고, store는 지금 값을 그대로 두고 다음 ready를 기다린다.
import type { CoreSource } from "../connection.ts";
import {
  type SessionSnapshot,
  sessionSnapshotsList,
} from "../../../../../protocol/events/mod.ts";
import {
  type ActivationConsent,
  activationConsents,
} from "../../../../../protocol/apps/activation/consent.ts";
import {
  type ShareRequest,
  shareRequestList,
} from "../../../../../protocol/approvals/share-request.ts";
import {
  type Notice,
  noticesOpen,
} from "../../../../../protocol/apps/notice.ts";
import {
  type JobHold,
  type JobRecord,
  jobHolds,
  jobPending,
} from "../../../../../protocol/jobs/jobs.ts";

import {
  type MailHold,
  mailHolds,
} from "../../../../../protocol/lophn-agent/mail.ts";

export async function readSessionSnapshots(
  core: CoreSource,
  sessions?: string[],
): Promise<SessionSnapshot[] | null> {
  const reply = await core
    .call({
      kind: "read",
      resource: sessionSnapshotsList.resource,
      method: sessionSnapshotsList.method,
      body: sessions ? { sessions } : {},
    })
    .catch(() => null);
  if (!reply?.ok) return null;
  const parsed = sessionSnapshotsList.output.safeParse(reply.value);
  return parsed.success ? parsed.data.snapshots : null;
}

export async function readActivationConsents(
  core: CoreSource,
): Promise<ActivationConsent[] | null> {
  const reply = await core
    .call({
      kind: "read",
      resource: activationConsents.resource,
      method: activationConsents.method,
      body: {},
    })
    .catch(() => null);
  if (!reply?.ok) return null;
  const parsed = activationConsents.output.safeParse(reply.value);
  return parsed.success ? parsed.data.consents : null;
}

export async function readJobHolds(
  core: CoreSource,
): Promise<JobHold[] | null> {
  const reply = await core
    .call({
      kind: "read",
      resource: jobHolds.resource,
      method: jobHolds.method,
      body: {},
    })
    .catch(() => null);
  if (!reply?.ok) return null;
  const parsed = jobHolds.output.safeParse(reply.value);
  return parsed.success ? parsed.data.holds : null;
}

export async function readJobPending(
  core: CoreSource,
): Promise<JobRecord[] | null> {
  const reply = await core
    .call({
      kind: "read",
      resource: jobPending.resource,
      method: jobPending.method,
      body: {},
    })
    .catch(() => null);
  if (!reply?.ok) return null;
  const parsed = jobPending.output.safeParse(reply.value);
  return parsed.success ? parsed.data.jobs : null;
}

export async function readShareRequests(
  core: CoreSource,
): Promise<ShareRequest[] | null> {
  const reply = await core
    .call({
      kind: "read",
      resource: shareRequestList.resource,
      method: shareRequestList.method,
      body: {},
    })
    .catch(() => null);
  if (!reply?.ok) return null;
  const parsed = shareRequestList.output.safeParse(reply.value);
  return parsed.success ? parsed.data.requests : null;
}

export async function readOpenNotices(
  core: CoreSource,
): Promise<Notice[] | null> {
  const reply = await core
    .call({
      kind: "read",
      resource: noticesOpen.resource,
      method: noticesOpen.method,
      body: {},
    })
    .catch(() => null);
  if (!reply?.ok) return null;
  const parsed = noticesOpen.output.safeParse(reply.value);
  return parsed.success ? parsed.data.notices : null;
}

/**
 * 늦게 닿은 mail의 대기 목록. 그 기계의 lophn이 이 route를 모르는 옛 판이면(not_found) 빈 목록이다.
 * job 읽기와 묶지 않는다: 이쪽이 실패해도 job 항목은 맞춘다.
 */
export async function readMailHolds(
  core: CoreSource,
): Promise<MailHold[] | null> {
  const reply = await core
    .call({
      kind: "memory",
      resource: mailHolds.resource,
      method: mailHolds.method,
      body: {},
    })
    .catch(() => null);
  if (reply?.ok === false && reply.error?.code === "not_found") return [];
  if (!reply?.ok) return null;
  const parsed = mailHolds.output.safeParse(reply.value);
  return parsed.success ? parsed.data.holds : null;
}
