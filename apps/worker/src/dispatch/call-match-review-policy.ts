function nameTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 3));
}

export function peopleNamesOverlap(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const a = nameTokens(left);
  const b = nameTokens(right);
  const common = [...a].filter((token) => b.has(token)).length;
  return common >= Math.min(2, a.size, b.size);
}
