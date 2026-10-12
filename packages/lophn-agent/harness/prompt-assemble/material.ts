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

// context 한 개의 자료. overview와 용어집은 호출한 쪽이 이미 만들었고, 줄일 때는 용어집 → overview 순으로
// 쪼개 줄이므로 따로 받는다(R18).
export type MaterialSource = {
  // context id.
  address: string;
  title: string;
  // 적용된 판의 hash.
  version: string | null;
  // type·뜻·개수와 관계 글.
  overview: string;
  // type 이름(계약 순서). overview를 줄여도 남는다.
  type_names: readonly string[];
  // 용어집 글. 항목이 없으면 `용어집: 없음` 같은 글이고 `has_glossary`가 거짓이라 줄일 것이 없다.
  glossary: string;
  has_glossary: boolean;
  // 고른 context인데 읽지 못했을 때 그 이유. 있으면 overview는 이 이유를 알리는 자리표시 글이고
  // omissions에 `load_failed`로 남으며 줄이지 않는다.
  unavailable?: string;
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

// context 하나를 얼마나 남기는가(`MaterialReference.depth`).
type Depth = MaterialReference["depth"];

function bodyOf(source: MaterialSource, depth: Depth): string {
  if (depth === "full") return `${source.overview}\n${source.glossary}`;
  if (depth === "overview_only") return source.overview;
  return `type: ${source.type_names.join(", ")}`;
}

async function renderOne(
  source: MaterialSource,
  depth: Depth,
  options: MaterialRenderOptions,
): Promise<{ text: string; reference: MaterialReference }> {
  const head = `[context] ${source.title} | ${source.address} | ${
    source.version === null ? "version 없음" : `version ${source.version}`
  }`;
  const reference: MaterialReference = {
    address: source.address,
    version: source.version,
    depth,
  };
  const wired = await wireData(bodyOf(source, depth), {
    kind: "document_context",
    address: source.address,
    collected_at: options.collected_at,
  });
  return { text: `${head}\n${wired.wrapped}`, reference };
}

// 읽지 못한 context의 생략 기록. 예산 때문에 줄인 기록보다 앞에 둔다.
function unavailableOf(sources: readonly MaterialSource[]): MaterialOmission[] {
  return sources.flatMap((source) =>
    source.unavailable === undefined ? [] : [{
      source: source.address,
      level: "material" as const,
      reason: "load_failed" as const,
      detail: source.unavailable,
    }]
  );
}

function noticeOf(omissions: readonly MaterialOmission[]): string | null {
  if (!omissions.some((o) => o.reason === "input_over_budget")) return null;
  const count = (level: MaterialOmission["level"]) =>
    omissions.filter((o) => o.level === level).length;
  return `[자료 생략] 입력 예산 때문에 context 용어집 ${
    count("glossary")
  }개, overview ${
    count("overview")
  }개를 줄였다(overview는 type 이름만 남긴다). 필요하면 tool로 다시 읽는다.`;
}

async function renderWith(
  sources: readonly MaterialSource[],
  depths: readonly Depth[],
  omissions: readonly MaterialOmission[],
  options: MaterialRenderOptions,
): Promise<RenderedMaterial> {
  const materials: string[] = [];
  const references: MaterialReference[] = [];
  const notice = noticeOf(omissions);
  if (notice !== null) materials.push(notice);
  for (let i = 0; i < sources.length; i++) {
    const rendered = await renderOne(sources[i], depths[i], options);
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
  return renderWith(kept, kept.map(() => "full"), unavailableOf(kept), options);
}

// `blocked: input_over_budget`을 받은 쪽이 부른다. 용어집을 뒤 context부터 한 개씩 줄이고, 그래도 안 맞으면
// overview를 뒤 context부터 type 이름만 남기고 줄이며, `fits`가 참이 되면 멈춘다(R18). context 이름·id는 늘
// 남는다. 줄인 곳은 omissions와 안내 줄에 수와 함께 남는다. 다 줄여도 안 맞으면 fits는 false다.
export async function shrinkMaterial(
  sources: readonly MaterialSource[],
  options: MaterialRenderOptions,
  fits: (rendered: RenderedMaterial) => Promise<boolean>,
): Promise<RenderedMaterial & { fits: boolean }> {
  const kept = dedupeSources(sources);
  const depths: Depth[] = kept.map(() => "full");
  const omissions: MaterialOmission[] = unavailableOf(kept);
  let rendered = await renderWith(kept, depths, omissions, options);
  if (await fits(rendered)) return { ...rendered, fits: true };
  for (const level of ["glossary", "overview"] as const) {
    for (let i = kept.length - 1; i >= 0; i--) {
      // 줄일 용어집이 없는 context는 이 단계에서 달라지는 것이 없다.
      if (level === "glossary" && !kept[i].has_glossary) continue;
      // 읽지 못한 context의 overview는 이유뿐이라 줄이면 이유가 사라진다.
      if (kept[i].unavailable !== undefined) continue;
      depths[i] = level === "glossary" ? "overview_only" : "names_only";
      omissions.push({
        source: kept[i].address,
        level,
        reason: "input_over_budget",
      });
      rendered = await renderWith(kept, depths, omissions, options);
      if (await fits(rendered)) return { ...rendered, fits: true };
    }
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
