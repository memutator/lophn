// format read·worker의 순수 handler. route 등록은 API 작업으로 남긴다.
// 파일 바이트는 준비 worker가 이미 guest 입력으로 바꿔 넘긴다.
import type { LophnError, Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import {
  type BuiltinFormatName,
  type FormatDeclaration,
  formatGetInputSchema,
} from "../../../protocol/projects/mod.ts";
import { checkExtraction, checkValidation } from "./check.ts";
import { moduleFrom } from "./module-store.ts";
import { findModule, type StoredModule } from "./modules.ts";
import { formatDeclaration, formatDeclarations } from "./model.ts";
import type { FormatModuleInput } from "./pure/input.ts";
import type { RunnerRequest } from "./runner/protocol.ts";
import { runFormat, type RunnerClientOptions } from "./work.ts";

export type FormatCall = {
  operation: "validate" | "extract";
  name: BuiltinFormatName;
  module_hash: string;
  input: FormatModuleInput;
};

export type FormatHandlers = {
  list(): FormatDeclaration[];
  get(input: unknown): Promise<Result<FormatDeclaration, LophnError>>;
  call(
    input: FormatCall,
    options?: RunnerClientOptions,
  ): Promise<Result<unknown, LophnError>>;
};

function invalid(message: string): Result<never, LophnError> {
  return err({ code: "invalid_input", message });
}

function notFound(message: string): Result<never, LophnError> {
  return err({ code: "not_found", message });
}

function unavailable(message: string): Result<never, LophnError> {
  return err({ code: "unavailable", message });
}

// 옛 module은 보존 목록(preserved)이나 blob 보존 읽기(bytes)에서 찾는다.
// 둘 다 없으면 내장 module만 찾는다. 없는 hash는 누락이고 최신 module로 대체하지 않는다.
export type PreservedModules = {
  preserved?: readonly StoredModule[];
  bytes?: import("./module-store.ts").ModuleBytes;
};

export function createFormatHandlers(
  source: PreservedModules = {},
): FormatHandlers {
  const preserved = source.preserved ?? [];
  const bytes = source.bytes;
  const lookup = async (hash: string) => {
    const looked = await findModule(hash, preserved);
    if (looked.found || bytes === undefined) return looked;
    // blob 보존의 참조에서 hash로 되찾는다. 없는 hash는 누락이다.
    return await moduleFrom(hash, bytes);
  };
  return {
    list: () => formatDeclarations(),
    get: async (input) => {
      const parsed = formatGetInputSchema.safeParse(input);
      if (!parsed.success) return invalid("format get input is invalid");
      const looked = await lookup(parsed.data.module_hash);
      if (!looked.found) return notFound("format module is missing");
      const declaration = formatDeclaration(parsed.data.name);
      if (declaration.module_hash !== parsed.data.module_hash) {
        return notFound("format module is missing");
      }
      return ok(declaration);
    },
    call: async (input, options = {}) => {
      if (input.input.module_hash !== input.module_hash) {
        return invalid("input module_hash does not match the call");
      }
      const looked = await lookup(input.module_hash);
      if (!looked.found) return notFound("format module is missing");
      const request: RunnerRequest = {
        operation: input.operation,
        name: input.name,
        module_hash: input.module_hash,
        bundle: looked.module.bundle,
        input: input.input,
      };
      const ran = await runFormat(request, options);
      if (!ran.ok) {
        if (ran.failure === "missing_module") return notFound(ran.detail);
        return unavailable(ran.detail);
      }
      const checked = input.operation === "validate"
        ? checkValidation(ran.output)
        : checkExtraction(ran.output);
      if (!checked.ok) return unavailable(checked.reason);
      return ok(checked.value);
    },
  };
}
