import { z } from "zod";

export const problemCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{1,47}$/);
