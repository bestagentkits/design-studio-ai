import { z } from 'zod';
/** Patch fields must stay absent: Zod defaults belong to complete records, not partial writes. */
export function patchShape<T extends z.ZodRawShape>(shape:T): {[K in keyof T]: T[K] extends z.ZodDefault<infer U> ? U : T[K]} {
  return Object.fromEntries(Object.entries(shape).map(([key,value])=>[key,value instanceof z.ZodDefault?value.removeDefault():value])) as {[K in keyof T]: T[K] extends z.ZodDefault<infer U> ? U : T[K]};
}
