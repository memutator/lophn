import { z } from "zod";
import { err, ok, type Result } from "../../../base/mod.ts";
import { defineRead, withReadCommon } from "../../../protocol/server/mod.ts";
import type { ReaderRegistration } from "./reads.ts";

const modes = [
  "valid",
  "json_extra",
  "function_extra",
  "symbol_extra",
  "undefined_extra",
  "zero_extra",
  "nan_extra",
  "symbol_key",
  "metadata_extra",
  "negative_zero",
  "plain_zero",
  "details_extra",
  "details_zero",
  "valid_error",
  "json_error_extra",
] as const;

export const outputRead = defineRead({
  resource: "output-fixture",
  method: "read",
  name: "ReadOutputFixture",
  input: z.strictObject({ mode: z.enum(modes) }),
  output: withReadCommon(z.object({ data: z.number() })),
  actors: ["user"],
  errors: ["invalid_input", "internal"],
});

export const zeroRead = defineRead({
  resource: "output-fixture",
  method: "negative-zero",
  name: "ReadNegativeZeroFixture",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({ data: z.number().refine((value) => Object.is(value, -0)) }),
  ),
  actors: ["user"],
  errors: ["internal"],
});

export function createReaderRegistration(): ReaderRegistration {
  return {
    ports: new Map(),
    reads: [
      {
        route: outputRead,
        handle(_snapshot, _ctx, raw) {
          const { mode } = outputRead.input.parse(raw);
          const value: Record<string | symbol, unknown> = {
            data: 1,
            as_of_seq: "999",
            next_cursor: null,
          };
          if (mode === "json_extra") {
            value.extra = { nested: [null, true, "safe"] };
          }
          if (mode === "function_extra") value.extra = () => "private";
          if (mode === "symbol_extra") value.extra = Symbol("private");
          if (mode === "undefined_extra") value.extra = undefined;
          if (mode === "zero_extra") value.extra = -0;
          if (mode === "nan_extra") value.extra = NaN;
          if (mode === "symbol_key") value[Symbol("private")] = "hidden";
          if (mode === "metadata_extra") value.as_of_seq = () => "private";
          if (mode === "negative_zero") value.data = -0;
          if (mode === "plain_zero") value.data = 0;
          if (mode === "details_extra") {
            return err(
              {
                code: "invalid_input",
                message: "fixture failure",
                raw: () => "private",
              } as never,
            );
          }
          if (mode === "details_zero") {
            return err({
              code: "invalid_input",
              message: "fixture failure",
              details: { number: -0 },
            });
          }
          if (mode === "valid_error" || mode === "json_error_extra") {
            return err({
              code: "invalid_input",
              message: "fixture failure",
              ...(mode === "json_error_extra" ? { raw: "stripped" } : {}),
            });
          }
          return ok(value) as Result<never>;
        },
      },
      {
        route: zeroRead,
        handle: () => ok({ data: -0, as_of_seq: "999", next_cursor: null }),
      },
    ],
  };
}
