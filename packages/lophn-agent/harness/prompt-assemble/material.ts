import type { SkillEntry } from "../../extensions/mod.ts";
import { skillPromptSection } from "../../extensions/mod.ts";
import { wireData } from "../safety/mod.ts";
import type {
  HistoryPart,
  MaterialOmission,
  MaterialReference,
} from "./model.ts";

// 작업 재료 입력을 만든다(lophn-agent/harness/prompt-assemble 요구 R4, R5, R6, R18). 결과 문자열은
// `assemblePrompt`의 `material.materials`로 들어가므로 자료에서 온 글은 모두 safety `wireData`로 이미
// 포장한다. 주소·version은 machine id라서 포장 밖 머리줄에 둔다.

// context 한 개의 자료. `text`는 호출한 쪽이 이미 만든 overview와 용어집이다.
export type MaterialSource = {
  // context id.
  address: string;
  title: string;
  // 적용된 판의 hash.
  version: string | null;
  text: string;
};

export type MaterialRenderOptions = {
  collected_at: string;
};

export type RenderedMaterial = {
  materials: string[];
  references: MaterialReference[];
  omissions: MaterialOmission[];
};

// 같은 context·판은 처음 한 번만 남긴다(R5).
export function dedupeSources(
  sources: readonly MaterialSource[],
): MaterialSource[] {
  const seen = new Set<string>();
  const kept: MaterialSource[] = [];
  for (const source of sources) {
    const key = `${source.address}\u0000${source.version ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(source);
  }
  return kept;
}

async function renderOne(
  source: MaterialSource,
  shown: boolean,
  options: MaterialRenderOptions,
): Promise<{ text: string; reference: MaterialReference }> {
  const head = `[context] ${source.title} | ${source.address} | ${
    source.version === null ? "version 없음" : `version ${source.version}`
  }`;
  const reference: MaterialReference = {
    address: source.address,
    version: source.version,
    depth: shown ? "full" : "address_only",
  };
  if (!shown) return { text: head, reference };
  const wired = await wireData(source.text, {
    kind: "document_context",
    address: source.address,
    collected_at: options.collected_at,
  });
  return { text: `${head}\n${wired.wrapped}`, reference };
}

function noticeOf(omissions: readonly MaterialOmission[]): string | null {
  if (omissions.length === 0) return null;
  return `[자료 생략] 입력 예산 때문에 context 자료 ${omissions.length}개를 주소만 남기고 줄였다. 필요하면 tool로 다시 읽는다.`;
}

async function renderWith(
  sources: readonly MaterialSource[],
  shown: readonly boolean[],
  omissions: readonly MaterialOmission[],
  options: MaterialRenderOptions,
): Promise<RenderedMaterial> {
  const materials: string[] = [];
  const references: MaterialReference[] = [];
  const notice = noticeOf(omissions);
  if (notice !== null) materials.push(notice);
  for (let i = 0; i < sources.length; i++) {
    const rendered = await renderOne(sources[i], shown[i], options);
    materials.push(rendered.text);
    references.push(rendered.reference);
  }
  return { materials, references, omissions: [...omissions] };
}

// 중복을 접고 context마다 자료 하나를 초기 입력으로 만든다(R4, R5).
export function renderMaterial(
  sources: readonly MaterialSource[],
  options: MaterialRenderOptions,
): Promise<RenderedMaterial> {
  const kept = dedupeSources(sources);
  return renderWith(kept, kept.map(() => true), [], options);
}

// `blocked: input_over_budget`을 받은 쪽이 부른다. 뒤 자료부터 한 개씩 주소만 남기고 `fits`가 참이
// 되면 멈춘다. 줄인 곳은 omissions와 안내 줄에 수와 함께 남는다. 다 줄여도 안 맞으면 fits는 false다.
export async function shrinkMaterial(
  sources: readonly MaterialSource[],
  options: MaterialRenderOptions,
  fits: (rendered: RenderedMaterial) => Promise<boolean>,
): Promise<RenderedMaterial & { fits: boolean }> {
  const kept = dedupeSources(sources);
  const shown = kept.map(() => true);
  const omissions: MaterialOmission[] = [];
  let rendered = await renderWith(kept, shown, omissions, options);
  if (await fits(rendered)) return { ...rendered, fits: true };
  for (let i = kept.length - 1; i >= 0; i--) {
    shown[i] = false;
    omissions.push({
      source: kept[i].address,
      level: "material",
      reason: "input_over_budget",
    });
    rendered = await renderWith(kept, shown, omissions, options);
    if (await fits(rendered)) return { ...rendered, fits: true };
  }
  return { ...rendered, fits: false };
}

// ---- skill (R6) ----

export const SKILL_READ_HINT =
  "skill 본문은 이 목록에 없다. 쓰기 전에 skill.read로 읽고, 이력이 줄어 본문이 사라졌으면 다시 읽는다.";

// preset이 고른 skill의 이름·설명만 역할 지시 끝에 붙일 글로 만든다. 이름 사전순, 본문은 없다.
export function skillInstructionText(
  entries: readonly SkillEntry[],
): string | null {
  const section = skillPromptSection(entries);
  if (section.length === 0) return null;
  return `사용할 skill\n${
    section.map((s) => `- ${s.name}: ${s.description}`).join("\n")
  }\n${SKILL_READ_HINT}`;
}

// skill 본문은 tool 이력에만 들어간다. 읽은 결과를 data로 포장한 tool_result 조각이다.
export async function skillHistoryResult(
  callId: string,
  name: string,
  body: string,
  collectedAt: string,
): Promise<HistoryPart> {
  const wired = await wireData(body, {
    kind: "skill",
    address: name,
    collected_at: collectedAt,
  });
  return { kind: "tool_result", id: callId, text: wired.wrapped };
}
