import type { ContextTarget } from "../../../contracts/documents/mod.ts";
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
// 포장한다. 주소·version·관점은 machine id라서 포장 밖 머리줄에 둔다.

export type MaterialSource = {
  target: ContextTarget;
  perspective: "basis" | "reference" | "watch";
  title: string;
  // 읽은 version. 읽을 수 없으면 null.
  version: string | null;
  summary: string | null;
  // 문서 outline의 section들. 최상위(parent null)만 쓴다.
  outline: readonly { key: string; title: string; parent: string | null }[];
  // watch만: 읽은 뒤 바뀌었는지와 변경 순서(작을수록 오래됨).
  changed: boolean;
  change_seq: number | null;
  // 요청한 section 본문만. 요청이 없으면 비어 있다.
  sections: readonly { key: string; text: string }[];
};

export type MaterialRenderOptions = {
  collected_at: string;
  // tool 이력이 이미 담은 section 본문의 `historySectionKey`. 초기 자료에 다시 붙이지 않는다.
  in_history?: ReadonlySet<string>;
};

export type RenderedMaterial = {
  materials: string[];
  references: MaterialReference[];
  omissions: MaterialOmission[];
};

export function sourceAddress(target: ContextTarget): string {
  return target.kind === "document"
    ? `document ${target.document}${
      target.section === null ? "" : `#${target.section}`
    }`
    : `app_command ${target.app} ${target.command}`;
}

export function historySectionKey(
  document: string,
  version: string,
  section: string,
): string {
  return `${document}\u0000${version}\u0000${section}`;
}

// 같은 대상·version·관점은 처음 한 번만 남긴다. version이나 관점이 다르면 제목이 같아도 합치지 않는다(R5).
export function dedupeSources(
  sources: readonly MaterialSource[],
): MaterialSource[] {
  const seen = new Set<string>();
  const kept: MaterialSource[] = [];
  for (const source of sources) {
    const key = `${sourceAddress(source.target)}\u0000${
      source.version ?? ""
    }\u0000${source.perspective}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(source);
  }
  return kept;
}

// 한 자료에서 지금 보여 줄 것. 줄이기는 이 값을 끈다.
type Shown = { summary: boolean; outline: boolean; sections: boolean };

function initialShown(source: MaterialSource): Shown {
  const changed = source.perspective !== "watch" || source.changed;
  return {
    summary: changed && source.summary !== null,
    // 기준만 outline을 싣는다.
    outline: source.perspective === "basis" && changed &&
      source.outline.some((section) => section.parent === null),
    sections: changed && source.sections.length > 0,
  };
}

async function renderOne(
  source: MaterialSource,
  shown: Shown,
  options: MaterialRenderOptions,
): Promise<{ text: string; reference: MaterialReference }> {
  const address = sourceAddress(source.target);
  const version = source.version;
  const head = [
    `[자료 ${source.perspective}] ${address}`,
    version === null ? "version 없음" : `version ${version}`,
  ];
  if (source.perspective === "watch") {
    head.push(source.changed ? "변경됨" : "미변경");
  }
  const body: string[] = [];
  const included: string[] = [];
  const documentId = source.target.kind === "document"
    ? source.target.document
    : null;
  if (shown.summary || shown.outline || shown.sections) {
    body.push(`제목: ${source.title}`);
  }
  if (shown.summary && source.summary !== null) {
    body.push(`summary: ${source.summary}`);
  }
  if (shown.outline) {
    const top = source.outline.filter((section) => section.parent === null);
    if (top.length > 0) {
      body.push(
        `outline:\n${top.map((s) => `- ${s.key} ${s.title}`).join("\n")}`,
      );
    }
  }
  if (shown.sections) {
    for (const section of source.sections) {
      if (
        documentId !== null && version !== null &&
        options.in_history?.has(
          historySectionKey(documentId, version, section.key),
        )
      ) {
        continue;
      }
      body.push(`[section ${section.key}]\n${section.text}`);
      included.push(section.key);
    }
  }
  const reference: MaterialReference = {
    address,
    version,
    perspective: source.perspective,
    depth: body.length > 0 ? "full" : "address_only",
    sections: included,
  };
  if (body.length === 0) return { text: head.join(" | "), reference };
  const wired = await wireData(body.join("\n"), {
    kind: "document_context",
    address,
    collected_at: options.collected_at,
  });
  return { text: `${head.join(" | ")}\n${wired.wrapped}`, reference };
}

const LEVEL_LABEL = {
  reference_summary: "참고 summary",
  basis_outline: "기준 outline",
  selected_material: "선택 자료",
} as const;

function noticeOf(omissions: readonly MaterialOmission[]): string | null {
  if (omissions.length === 0) return null;
  const parts: string[] = [];
  for (const level of Object.keys(LEVEL_LABEL) as MaterialOmission["level"][]) {
    const count = omissions.filter((o) => o.level === level).length;
    if (count > 0) parts.push(`${LEVEL_LABEL[level]} ${count}개`);
  }
  return `[자료 생략] 입력 예산 때문에 ${
    parts.join(", ")
  }를 주소만 남기고 줄였다. 필요하면 tool로 다시 읽는다.`;
}

async function renderWith(
  sources: readonly MaterialSource[],
  shown: readonly Shown[],
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

// 중복을 접고 기준·참고·watch를 관점별 초기 입력으로 만든다(R4, R5).
export function renderMaterial(
  sources: readonly MaterialSource[],
  options: MaterialRenderOptions,
): Promise<RenderedMaterial> {
  const kept = dedupeSources(sources);
  return renderWith(kept, kept.map(initialShown), [], options);
}

// `blocked: input_over_budget`을 받은 쪽이 부른다. 참고 summary → 기준 outline → 남은 선택 자료 순으로
// 한 자료씩 줄이고 `fits`가 참이 되면 멈춘다. 선택 자료는 오래된 변경부터 주소만 남긴다. 줄인 곳은
// omissions와 안내 줄에 수와 함께 남는다. 다 줄여도 안 맞으면 fits는 false다(필수 입력 초과).
export async function shrinkMaterial(
  sources: readonly MaterialSource[],
  options: MaterialRenderOptions,
  fits: (rendered: RenderedMaterial) => Promise<boolean>,
): Promise<RenderedMaterial & { fits: boolean }> {
  const kept = dedupeSources(sources);
  const shown = kept.map(initialShown);
  const omissions: MaterialOmission[] = [];
  const steps: (() => void)[] = [];
  const omit = (i: number, level: MaterialOmission["level"]) =>
    omissions.push({
      source: sourceAddress(kept[i].target),
      level,
      reason: "input_over_budget",
    });
  kept.forEach((source, i) => {
    if (source.perspective === "reference" && shown[i].summary) {
      steps.push(() => {
        shown[i].summary = false;
        omit(i, "reference_summary");
      });
    }
  });
  kept.forEach((source, i) => {
    if (source.perspective === "basis" && shown[i].outline) {
      steps.push(() => {
        shown[i].outline = false;
        omit(i, "basis_outline");
      });
    }
  });
  const order = kept.map((_, i) => i).sort((a, b) => {
    const x = kept[a].change_seq ?? Number.POSITIVE_INFINITY;
    const y = kept[b].change_seq ?? Number.POSITIVE_INFINITY;
    return x === y ? a - b : x < y ? -1 : 1;
  });
  for (const i of order) {
    steps.push(() => {
      const before = shown[i];
      if (!before.summary && !before.outline && !before.sections) return;
      shown[i] = { summary: false, outline: false, sections: false };
      omit(i, "selected_material");
    });
  }
  let rendered = await renderWith(kept, shown, omissions, options);
  if (await fits(rendered)) return { ...rendered, fits: true };
  for (const step of steps) {
    const before = omissions.length;
    step();
    // 이미 주소만인 자료는 줄일 것이 없어 다시 조립하지 않는다.
    if (omissions.length === before) continue;
    rendered = await renderWith(kept, shown, omissions, options);
    if (await fits(rendered)) return { ...rendered, fits: true };
  }
  return { ...rendered, fits: false };
}

// ---- skill (R6) ----

export const SKILL_READ_HINT =
  "skill 본문은 이 목록에 없다. 쓰기 전에 skill.read로 읽고, 이력이 줄어 본문이 사라졌으면 다시 읽는다.";

// agent가 고른 skill의 이름·설명만 역할 지시(role_agent) 끝에 붙일 글로 만든다. 이름 사전순, 본문은 없다.
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
