import { ok, type Result } from "../../../base/mod.ts";
import {
  type AgentDefinitionIssue,
  type AgentRef,
  type Place,
  placeOfAgentRef,
  type Role,
} from "../../../protocol/lophn-agent/mod.ts";
import { type AgentFileDefinition, parseAgentFile } from "./definition-file.ts";
import type { AgentDeps, AgentLookups, ReadSql } from "./ports.ts";
import type { AgentRoleTable } from "./role-table.ts";
import { workingDomains } from "./resolve.ts";
import {
  type AgentFile,
  type AgentSlot,
  type AgentStore,
  createAgentStore,
  dataRootOf,
} from "./store.ts";

// 읽기와 쓰기가 함께 쓰는 것: agent 하나의 정의 파일을 찾아 읽고 검사한다.

export type AgentContext = {
  lookups: AgentLookups;
  store: AgentStore;
  roles: AgentRoleTable;
};

export function openAgentContext(
  deps: AgentDeps,
  sql: ReadSql,
): Result<AgentContext> {
  const root = dataRootOf(sql, deps.dataRoot);
  if (!root.ok) return root;
  return ok({
    lookups: deps.lookups(sql),
    store: createAgentStore(
      deps.files,
      root.value,
      (place) => deps.roles.agentsFolderOf(root.value, place),
    ),
    roles: deps.roles,
  });
}

export function issuesOfError(error: unknown): AgentDefinitionIssue[] {
  const details = (error as { details?: { issues?: AgentDefinitionIssue[] } })
    .details;
  return details?.issues ?? [];
}

// 읽은 agent 하나. 정의 파일이 없는 built-in은 file과 definition이 null이다.
export type Loaded = {
  ref: AgentRef;
  role: Role;
  place: Place | null;
  slot: AgentSlot;
  file: AgentFile | null;
  definition: AgentFileDefinition | null;
  issues: AgentDefinitionIssue[];
};

// agent가 일하는 domain id다. 정의가 고른 것과 그 place 그릇의 active domain의 교집합이다.
export function domainsOf(context: AgentContext, loaded: Loaded): string[] {
  const chosen = loaded.definition !== null && "domains" in loaded.definition
    ? loaded.definition.domains ?? []
    : [];
  return workingDomains(context.lookups.domains(loaded.place), chosen);
}

// Operator는 ref에 place가 없어 place 폴더를 훑어 파일이 있는 곳을 찾는다.
export function findOperator(
  context: AgentContext,
  id: string,
): Result<{ place: Place; slot: AgentSlot; file: AgentFile } | null> {
  for (const place of context.lookups.places()) {
    const slot = context.roles.slotOf(
      context.store.root,
      context.roles.operatorRef(id),
      place,
    )!;
    const file = context.store.read(slot);
    if (!file.ok) return file;
    if (file.value !== null) return ok({ place, slot, file: file.value });
  }
  return ok(null);
}

// 이 agent를 읽는다. 없는 place의 agent와 파일이 없는 Operator는 agent가 아니라 null이다.
export function loadAgent(
  context: AgentContext,
  ref: AgentRef,
): Result<Loaded | null> {
  let place: Place | null = null;
  let slot: AgentSlot | null;
  let file: AgentFile | null = null;
  // place가 ref에 없는 agent(Operator)는 place 폴더를 훑어 찾는다.
  const refPlace = placeOfAgentRef(ref);
  if (refPlace === undefined) {
    const found = findOperator(context, operatorIdOf(ref));
    if (!found.ok) return found;
    if (found.value === null) return ok(null);
    ({ place, slot, file } = found.value);
  } else {
    place = refPlace;
    if (place !== null && !context.lookups.placeExists(place)) return ok(null);
    slot = context.roles.slotOf(context.store.root, ref)!;
    const read = context.store.read(slot);
    if (!read.ok) return read;
    file = read.value;
  }

  return ok(parsedAgent(context.roles, ref, place, slot, file));
}

export function operatorIdOf(ref: AgentRef): string {
  return (ref as { agent: string }).agent;
}

function parsedAgent(
  roles: AgentRoleTable,
  ref: AgentRef,
  place: Place | null,
  slot: AgentSlot,
  file: AgentFile | null,
): Loaded {
  let definition: AgentFileDefinition | null = null;
  const issues: AgentDefinitionIssue[] = [];
  if (file !== null) {
    const parsed = parseAgentFile(file.text, {
      role: ref.role,
      place: place?.kind ?? null,
    }, roles);
    if (parsed.ok) definition = parsed.value;
    else issues.push(...issuesOfError(parsed.error));
  }
  return { ref, role: ref.role, place, slot, file, definition, issues };
}

// 이름과 profile은 Operator는 정의가, built-in은 제품이 정한다.
export function nameOf(roles: AgentRoleTable, loaded: Loaded): string {
  const builtin = roles.builtinName(loaded.role);
  if (builtin !== null) return builtin;
  const name = loaded.definition !== null && "name" in loaded.definition
    ? loaded.definition.name
    : undefined;
  return name ?? operatorIdOf(loaded.ref);
}

export function profileOf(roles: AgentRoleTable, loaded: Loaded) {
  const profile = loaded.definition !== null && "profile" in loaded.definition
    ? loaded.definition.profile
    : undefined;
  return profile ?? roles.defaultProfile(loaded.role);
}

// 모든 Operator의 id와 이름과 place. 틀린 파일은 이름을 알 수 없어 id가 이름이다.
export function listOperators(
  context: AgentContext,
  within?: Place,
): Result<Loaded[]> {
  const found: Loaded[] = [];
  for (
    const place of within === undefined ? context.lookups.places() : [within]
  ) {
    const ids = context.store.operatorIds(place);
    if (!ids.ok) return ids;
    for (const id of ids.value) {
      const ref = context.roles.operatorRef(id);
      const slot = context.roles.slotOf(context.store.root, ref, place)!;
      const file = context.store.read(slot);
      if (!file.ok) return file;
      found.push(parsedAgent(context.roles, ref, place, slot, file.value));
    }
  }
  return ok(found);
}
