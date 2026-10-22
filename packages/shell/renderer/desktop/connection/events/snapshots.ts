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
import { type JobHold, jobHolds } from "../../../../../protocol/jobs/jobs.ts";

export async function readSessionSnapshots(
  core: CoreSource,
  sessions?: string[],
): Promise<SessionSnapshot[] | null> {
  const reply = await core.call({
    kind: "read",
    resource: sessionSnapshotsList.resource,
    method: sessionSnapshotsList.method,
    body: sessions ? { sessions } : {},
  }).catch(() => null);
  if (!reply?.ok) return null;
  const parsed = sessionSnapshotsList.output.safeParse(reply.value);
  return parsed.success ? parsed.data.snapshots : null;
}

export async function readActivationConsents(
  core: CoreSource,
): Promise<ActivationConsent[] | null> {
  const reply = await core.call({
    kind: "read",
    resource: activationConsents.resource,
    method: activationConsents.method,
    body: {},
  }).catch(() => null);
  if (!reply?.ok) return null;
  const parsed = activationConsents.output.safeParse(reply.value);
  return parsed.success ? parsed.data.consents : null;
}

export async function readJobHolds(
  core: CoreSource,
): Promise<JobHold[] | null> {
  const reply = await core.call({
    kind: "read",
    resource: jobHolds.resource,
    method: jobHolds.method,
    body: {},
  }).catch(() => null);
  if (!reply?.ok) return null;
  const parsed = jobHolds.output.safeParse(reply.value);
  return parsed.success ? parsed.data.holds : null;
}
