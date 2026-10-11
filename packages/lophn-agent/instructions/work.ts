import { ok, type Result, sha256Hex } from "../../base/mod.ts";
import type { WorkPlace } from "../../contracts/lophn-agent/mod.ts";
import {
  inspectInstruction,
  type InstructionFile,
  type InstructionFiles,
  type InstructionLayer,
  type InstructionLayerKind,
  instructionLayers,
  type InstructionResolution,
  resolveLayers,
} from "./model.ts";

export type InstructionDeps = {
  files: InstructionFiles;
  // 전송 본문을 안전화한다. 끝내지 못하면 null이고 그 층은 전송하지 않는다(platform redaction).
  redact(text: string): string | null | Promise<string | null>;
};

function layerOf(
  kind: InstructionLayerKind,
  place: string | null,
  fields: Partial<InstructionLayer> & Pick<InstructionLayer, "status">,
): InstructionLayer {
  return {
    kind,
    place,
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
  const inspected = inspectInstruction(file);
  if (inspected.status !== "present") {
    return layerOf(kind, place, {
      status: inspected.status,
      bytes: file.size_bytes,
      reason: inspected.reason,
    });
  }
  const text = await deps.redact(inspected.text);
  if (text === null) {
    return layerOf(kind, place, {
      status: "unavailable",
      bytes: file.size_bytes,
      reason: "instruction redaction did not finish",
    });
  }
  return layerOf(kind, place, {
    status: "present",
    bytes: file.size_bytes,
    source_hash: await sha256Hex(file.bytes),
    transmitted_hash: await sha256Hex(text),
    text,
  });
}

// model call 직전마다 부른다. 전역 → project 또는 app → agent 본문 순으로 지금의 파일을 다시 읽고 그
// call의 고정 snapshot을 만든다. 읽기 실패·상한 초과는 층 상태로 남기고 call을 막는다. 정해진 층 밖의
// 파일은 묻지 않으므로 읽은 자료 속 LOPHN 파일은 지침이 되지 않는다.
export async function resolveInstructions(
  deps: InstructionDeps,
  input: { place: WorkPlace },
): Promise<Result<InstructionResolution>> {
  const layers: InstructionLayer[] = [];
  for (const kind of instructionLayers(input.place)) {
    const place = kind === "project" || kind === "app" ? input.place.id : null;
    const read = await deps.files.read(kind);
    if (!read.ok) {
      layers.push(
        layerOf(kind, place, {
          status: "unavailable",
          reason: "instruction read failed",
        }),
      );
    } else if (read.value === null) {
      layers.push(layerOf(kind, place, { status: "absent" }));
    } else {
      layers.push(await readLayer(deps, kind, place, read.value));
    }
  }
  return ok(resolveLayers(input.place, layers));
}
