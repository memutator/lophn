import { z } from "zod";
import { anyIdSchema } from "./ids.ts";

// 소유 concern이 등록하는 `<Entity><과거형 동사>` 이름.
const EVENT_TYPE = /^[A-Z][A-Za-z0-9]*$/;

export const eventTypeSchema = z.string().regex(EVENT_TYPE);

// entity는 ID, 이름 record는 `<종류>:<키>`, lophn 전체 단일 공통 설정만 null.
const SUBJECT_KEY = /^[a-z][a-z0-9_]*:[A-Za-z0-9_.:-]+$/;

export const subjectSchema = z.union([
  anyIdSchema,
  z.string().regex(SUBJECT_KEY),
  z.null(),
]);

export type EventDefinition<
  T extends string = string,
  S extends z.ZodType = z.ZodType,
  P extends z.ZodType = z.ZodType,
> = {
  type: T;
  subject: S;
  payload: P;
};

// 다른 owner가 자기 event를 적는다. 결과 값은 {type, payload} 모양을 만족한다.
export function defineEvent<
  T extends string,
  S extends z.ZodType,
  P extends z.ZodType,
>(type: T, definition: { subject: S; payload: P }): EventDefinition<T, S, P> {
  if (!EVENT_TYPE.test(type)) {
    throw new Error("event type must be <Entity><과거형 동사> PascalCase");
  }
  return { type, subject: definition.subject, payload: definition.payload };
}
