export const APEX_VERSION = "0.10.0-next.5" as const;
export const MINIMUM_NODE_VERSION = "26.9.0" as const;

export function meetsMinimumVersion(current: string, minimum: string): boolean {
  const currentParts = current.split(".").map(Number);
  const minimumParts = minimum.split(".").map(Number);
  if (
    currentParts.length !== 3 ||
    minimumParts.length !== 3 ||
    currentParts.some((part) => !Number.isInteger(part) || part < 0) ||
    minimumParts.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return false;
  }
  for (let index = 0; index < 3; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (currentPart !== minimumPart) return currentPart > minimumPart;
  }
  return true;
}
