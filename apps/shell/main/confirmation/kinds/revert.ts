// 끝난 run 하나의 revert. 정본은 reverts/preview의 묶음(groups)과 그 지문(binding_hash)이다.
// 복원 불가·유지·충돌 묶음이 있으면 기본 적용에서 빼고, 남을 영향을 다시 보이는 2차 확인 뒤에만
// 안전한 복원 가능 묶음 전체를 적용한다(allow_partial). 제출 때 복원할 문서마다 이전 판을 사람
// 자격의 documents/prepare로 준비해 lophn-agent buildRevertInput과 같은 규칙으로 RevertRun
// 입력의 groups를 만든다. shell main은 packages를 import하지 않으므로 그 규칙을 여기 옮긴다.
// 앱 단계가 있는 revert(applying 접수)는 접수 뒤 core의 `reverts/run_apps`로 이어 실행한다(lophn-agent#T48).
import { contentBasis, type LiveHandle } from "../handle.ts";
import {
  bindingOf,
  failed,
  type KindCore,
  type Read,
  readFailure,
  record,
  sendCommand,
  type Sent,
  text,
} from "./core.ts";
import type { ConfirmationResult } from "../types.ts";

/** contracts REVERT_RUN_DECISION(= command 이름 RevertRun). */
export const REVERT_RUN = "RevertRun";
export const REVERT_CONCERN = "lophn-agent/revert";

const BINDING = ["id", "run", "allow_partial", "preview_hash"] as const;

export interface PreviewGroup {
  readonly ordinal: number;
  readonly owner: string;
  readonly target: string | null;
  readonly source_seqs: readonly string[];
  readonly capability: "reversible" | "retained" | "irreversible" | "conflict";
  readonly reason: string | null;
  readonly comparison: Record<string, unknown> | null;
}

export interface RevertRunGroup {
  source_seqs: readonly string[];
  comparison: Record<string, unknown>;
  prepared_ref: string | null;
}

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** `rvt_` + ULID(26자, Crockford base32 소문자). 창 하나가 같은 id로 결합한다. */
export function newRevertId(
  now: number,
  random: (bytes: Uint8Array) => Uint8Array,
): string {
  let time = "";
  let rest = Math.max(0, Math.floor(now));
  for (let index = 0; index < 10; index++) {
    time = ALPHABET[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  const bytes = random(new Uint8Array(16));
  let tail = "";
  for (const byte of bytes) tail += ALPHABET[byte % 32];
  return `rvt_${time}${tail}`;
}

/** core hashOf와 같다: canonical JSON의 sha256 hex. */
export function preparedRefOf(value: unknown): string {
  return contentBasis(value);
}

/**
 * lophn-agent buildRevertInput과 같은 규칙. 복원 가능한 묶음마다 준비 결과가 있으면
 * comparison.prepared에 싣고 그 hash를 prepared_ref로 둔다. 준비하지 못한 묶음은 그대로 두고
 * owner가 복원 준비 불충족으로 막는다. 준비가 실패하면 입력을 만들지 않는다.
 */
export async function buildRevertGroups(
  groups: readonly PreviewGroup[],
  prepare: (
    group: PreviewGroup,
  ) => Promise<
    | { ok: true; value: Record<string, unknown> | null }
    | { ok: false; error: { code: string; message: string } }
  >,
): Promise<
  | { ok: true; value: RevertRunGroup[] }
  | { ok: false; error: { code: string; message: string } }
> {
  const items: RevertRunGroup[] = [];
  for (const group of groups) {
    const comparison = group.comparison ?? {};
    if (group.capability !== "reversible") {
      items.push({
        source_seqs: group.source_seqs,
        comparison,
        prepared_ref: null,
      });
      continue;
    }
    const prepared = await prepare(group);
    if (!prepared.ok) return prepared;
    items.push(
      prepared.value === null
        ? { source_seqs: group.source_seqs, comparison, prepared_ref: null }
        : {
          source_seqs: group.source_seqs,
          comparison: { ...comparison, prepared: prepared.value },
          prepared_ref: preparedRefOf(prepared.value),
        },
    );
  }
  return { ok: true, value: items };
}

function groupsOf(value: unknown): PreviewGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const group = record(item);
    const comparison = group.comparison;
    return {
      ordinal: Number(group.ordinal),
      owner: String(group.owner),
      target: text(group.target),
      source_seqs: Array.isArray(group.source_seqs)
        ? group.source_seqs.map(String)
        : [],
      capability: group.capability as PreviewGroup["capability"],
      reason: text(group.reason),
      comparison: comparison === null ? null : record(comparison),
    };
  });
}

/** 문서 내용 복원 하나. 옛 판의 원문 blob 참조로 이전 내용을 새 판으로 준비한다. */
export async function prepareDocumentRestore(
  core: KindCore,
  group: PreviewGroup,
  key: string,
): Promise<
  | { ok: true; value: Record<string, unknown> | null }
  | { ok: false; error: { code: string; message: string } }
> {
  const comparison = group.comparison;
  if (comparison === null || comparison.kind !== "restore") {
    return { ok: true, value: null };
  }
  const document = String(comparison.document);
  const fixed = await core.internal("read", "documents", "get", {
    document,
    version: String(comparison.restore_version),
  });
  if (!fixed.ok) return readFailure(fixed);
  const version = record(record(fixed.value).version);
  const files = Array.isArray(version.files) ? version.files.map(record) : [];
  const prepared = await core.internal("worker", "documents", "prepare", {
    document,
    base_version: String(comparison.base_version),
    files: files.map((file) => ({
      path: file.path,
      blob_hash: file.blob_hash,
      bytes: file.bytes,
      media_type: file.media_type,
      primary: file.primary,
      content: {
        kind: "existing",
        reference: {
          owner_kind: "document_version",
          owner_key: `${String(version.id)}/${String(file.path)}`,
          field: "file",
          hash: file.blob_hash,
          registered_seq: "1",
        },
      },
    })),
    format: version.format,
    source: null,
    idempotency_key: key,
  });
  if (!prepared.ok) return readFailure(prepared);
  return { ok: true, value: record(prepared.value) };
}

export interface RevertState {
  /** 창마다 고정한 revert id. 같은 창의 다시 읽기는 같은 id로 결합한다. */
  idFor(windowId: string): string;
  /** 사람이 본 preview. 제출은 이 묶음으로만 입력을 만든다. */
  remember(
    windowId: string,
    preview: { hash: string; groups: PreviewGroup[] },
  ): void;
  shown(windowId: string): { hash: string; groups: PreviewGroup[] } | undefined;
  forget(windowId: string): void;
}

export function revertState(newId: () => string): RevertState {
  const ids = new Map<string, string>();
  const previews = new Map<string, { hash: string; groups: PreviewGroup[] }>();
  return {
    idFor(windowId) {
      const found = ids.get(windowId);
      if (found !== undefined) return found;
      const id = newId();
      ids.set(windowId, id);
      return id;
    },
    remember: (windowId, preview) => previews.set(windowId, preview),
    shown: (windowId) => previews.get(windowId),
    forget(windowId) {
      ids.delete(windowId);
      previews.delete(windowId);
    },
  };
}

export async function readRevert(
  core: KindCore,
  state: RevertState,
  windowId: string,
  run: string,
): Promise<Read> {
  const got = await core.internal("read", "reverts", "preview", { run });
  if (!got.ok) return readFailure(got);
  const preview = record(got.value);
  const groups = groupsOf(preview.groups);
  const hash = String(preview.binding_hash);
  if (groups.length === 0) return failed("not_found", "되돌릴 변경이 없다");
  const reversible = groups.filter((group) =>
    group.capability === "reversible"
  );
  const kept = groups.length - reversible.length;
  // 복원 가능한 것이 없으면 고를 결정이 없다. 안전하지 않은 묶음이 섞이면 그 묶음을 빼고
  // 안전한 묶음만 적용하는 부분 적용을 2차 확인 뒤에만 고른다.
  const allowPartial = reversible.length > 0 && kept > 0;
  const id = state.idFor(windowId);
  state.remember(windowId, { hash, groups });
  const bound = bindingOf(BINDING, {
    id,
    run,
    allow_partial: allowPartial,
    preview_hash: hash,
  });
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      allowed: reversible.length > 0 ? [REVERT_RUN] : [],
      expiresAt: null,
      secondConfirm: allowPartial,
      request: {
        kind: "owner_decision",
        concern: REVERT_CONCERN,
        decision: REVERT_RUN,
        targets: [run],
        input: { kind: "inline", value: bound.content },
        comparison: { preview_hash: hash },
      },
      view: {
        kind: "revert",
        allow_partial: allowPartial,
        groups: groups.map((group) => ({
          ordinal: group.ordinal,
          owner: group.owner,
          target: group.target,
          capability: group.capability,
          reason: group.reason,
          change: text(group.comparison?.kind),
          included: group.capability === "reversible",
        })),
      },
    },
  };
}

const OUTCOMES = new Set<ConfirmationResult>([
  "applying",
  "applied",
  "partial",
  "uncertain",
  "blocked",
]);

/** RevertRun은 결정 자체가 적용이다. 결과는 실제 복원 결과다. */
export async function submitRevert(
  core: KindCore,
  state: RevertState,
  input: {
    handle: LiveHandle;
    content: Record<string, unknown>;
  },
): Promise<Sent> {
  const shown = state.shown(input.handle.windowId);
  const id = String(input.content.id);
  if (shown === undefined || shown.hash !== input.content.preview_hash) {
    return {
      ok: false,
      unknown: false,
      error: { code: "conflict", message: "본 내용과 다르다" },
    };
  }
  const built = await buildRevertGroups(
    shown.groups,
    (group) =>
      prepareDocumentRestore(core, group, `revert:${id}:${group.ordinal}`),
  );
  if (!built.ok) {
    return { ok: false, unknown: false, error: built.error };
  }
  const prepared = built.value
    .map((group) => record(group.comparison.prepared).preparation_ref)
    .filter((ref): ref is string => typeof ref === "string");
  const sent = await sendCommand(core, "reverts", "apply", {
    input: { ...input.content, groups: built.value },
    idempotency_key: `confirmation:${input.handle.ref}`,
    compare: { preview_hash: input.content.preview_hash },
    prepared,
    confirmation: input.handle.ref,
  });
  if (!sent.ok) return sent;
  let outcome = record(sent.value).outcome as ConfirmationResult;
  // 앱 단계가 있는 revert는 applying으로 접수만 됐다. 이어 실행은 core가 한다: 호출한 사람의 앱 통로로 앱의
  // revert command를 원래 호출 역순으로 부르고, 기록·끝내기는 core 내부 machine이 한다. 결과는 끝낸 revert의
  // 실제 결과다. 이어 실행이 닿지 못해도 접수는 남아 있어 같은 handle의 다시 보내기가 같은 revert를 이어 받는다.
  if (outcome === "applying") {
    const ran = await core.internal("memory", "reverts", "run_apps", {
      revert: id,
      groups: built.value,
    });
    if (ran.ok) outcome = record(ran.value).outcome as ConfirmationResult;
  }
  return {
    ok: true,
    value: {
      receipt: { kind: "entity", id },
      ...(OUTCOMES.has(outcome) ? { result: outcome } : {}),
    },
  };
}
