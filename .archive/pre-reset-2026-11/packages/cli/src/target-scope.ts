import { ApexError, EXIT_CODES } from "./errors.js";

export const TARGET_SCOPE_PATTERN =
  /^(?:local|\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/resourceGroups\/[-\w.()]{1,90})?)$/iu;

export const TARGET_SCOPE_HINT = "local or /subscriptions/<id>[/resourceGroups/<name>]";

export function assertTargetScope(value: string): string {
  if (!TARGET_SCOPE_PATTERN.test(value))
    throw new ApexError("APEX_USAGE", `--target must be ${TARGET_SCOPE_HINT}`, EXIT_CODES.usage);
  return value;
}
