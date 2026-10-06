import { ok, type Result, sha256Hex } from "../../base/mod.ts";
import type { WorkPlace } from "../../contracts/lophn-agent/mod.ts";
import {
  attachmentOrder,
  inspectInstruction,
  type InstructionFile,
  type InstructionFiles,
  type InstructionLayer,
  type InstructionLayerKind,
  instructionLocations,
  type InstructionResolution,
  resolveLayers,
} from "./model.ts";

export type InstructionDeps = {
  files: InstructionFiles;
  // 전송 본문을 안전화한다. 끝내지 못하면 null이고 그 층은 전송하지 않는다(platform redaction).
  redact(text: string): string | null;
};

function absent(kind: InstructionLayerKind, place: string | null) {
  return layerOf(kind, place, { status: "absent" });
}

function layerOf(
  kind: InstructionLayerKind,
  place: string | null,
  fields: Partial<InstructionLayer> & Pick<InstructionLayer, "status">,
): InstructionLayer {
  return {
    kind,
    place,
    document: null,
    version: null,
    source_hash: null,
    transmitted_hash: null,
    bytes: 0,
    reason: null,
    text: null,
    ...fields,
  };
}

async function readLayer(
  deps: InstructionDeps,
  kind: InstructionLayerKind,
  place: string | null,
  file: InstructionFile,
): Promise<InstructionLayer> {
  const base = { document: file.document, version: file.version };
  const inspected = inspectInstruction(file);
  if (inspected.status !== "present") {
    return layerOf(kind, place, {
      ...base,
      status: inspected.status,
      bytes: file.size_bytes,
      reason: inspected.reason,
    });
  }
  const text = deps.redact(inspected.text);
  if (text === null) {
    return layerOf(kind, place, {
      ...base,
      status: "unavailable",
      bytes: file.size_bytes,
      reason: "instruction redaction did not finish",
    });
  }
  return layerOf(kind, place, {
    ...base,
    status: "present",
    bytes: file.size_bytes,
    source_hash: await sha256Hex(file.bytes),
    transmitted_hash: await sha256Hex(text),
    text,
  });
}

function unavailable(
  kind: InstructionLayerKind,
  place: string | null,
  document: string | null,
  reason: string,
): InstructionLayer {
  return layerOf(kind, place, { status: "unavailable", document, reason });
}

// model call 직전마다 부른다. 전역 → project → app → preset 첨부 순으로 지금의 확정 판을 다시
// 읽고 그 call의 고정 snapshot을 만든다. 읽기 실패·상한 초과는 층 상태로 남기고 call을 막는다.
// 정해진 자리와 preset 첨부 밖의 파일은 묻지 않으므로 읽은 자료 속 LOPHN 파일은 지침이 되지 않는다.
export async function resolveInstructions(
  deps: InstructionDeps,
  input: {
    place: WorkPlace;
    attachments: readonly { document: string; order: number }[];
  },
): Promise<Result<InstructionResolution>> {
  let appProject: string | null = null;
  if (input.place.kind === "app") {
    const found = await deps.files.projectOf(input.place.id);
    if (!found.ok) return found;
    appProject = found.value;
  }
  const layers: InstructionLayer[] = [];
  for (const location of instructionLocations(input.place, appProject)) {
    const kind = location.layer;
    const place = kind === "global" ? null : location.place;
    const read = await deps.files.registered(location);
    if (!read.ok) {
      layers.push(unavailable(kind, place, null, "instruction read failed"));
    } else if (read.value === null) {
      layers.push(absent(kind, place));
    } else {
      layers.push(await readLayer(deps, kind, place, read.value));
    }
  }
  const included = new Set(
    layers.flatMap((layer) => layer.document === null ? [] : [layer.document]),
  );
  for (const document of attachmentOrder(input.attachments, included)) {
    const read = await deps.files.attached(document);
    layers.push(
      read.ok ? await readLayer(deps, "preset", null, read.value) : unavailable(
        "preset",
        null,
        document,
        "attached instruction read failed",
      ),
    );
  }
  return ok(resolveLayers(input.place, layers));
}
