import { toNestErrors } from "@hookform/resolvers";
import type { FieldError, FieldValues, Resolver } from "react-hook-form";
import type { ZodType } from "zod";

// The installed resolver reads Zod 3's error.errors. Our shared schemas expose Zod 4's issues.
export function formResolver<T extends FieldValues>(schema: ZodType<T>): Resolver<T> {
  return (values, _context, options) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };
    const errors: Record<string, FieldError> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "root";
      errors[path] ??= { type: issue.code, message: issue.message };
    }
    return { values: {}, errors: toNestErrors(errors, options) };
  };
}
