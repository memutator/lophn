import { z } from "zod";
import { REPORTING_LIMITS } from "./sdk-report.ts";

// 글은 1~500 scalar. 제보 화면과 problem 제보가 같은 규칙을 쓴다.
export const feedbackTextSchema = z.string().regex(/\S/).refine((text) => {
  const scalars = [...text];
  return scalars.length >= 1 &&
    scalars.length <= REPORTING_LIMITS.feedback_text_scalars &&
    scalars.every((scalar) => {
      const code = scalar.codePointAt(0)!;
      return code < 0xd800 || code > 0xdfff;
    });
}, { message: "feedback text must have 1..500 Unicode scalars" });
