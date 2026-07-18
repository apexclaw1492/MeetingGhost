export function segmentIdsFromNames(names: string[]): number[] {
  return names
    .map(name => /^seg-(\d+)$/.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

export function segmentIdsFromKeys(meetingId: string, keys: Array<IDBValidKey | string>): number[] {
  const prefix = `${meetingId}:seg:`;
  return keys
    .map(key => String(key).startsWith(prefix) ? /^(\d+)$/.exec(String(key).slice(prefix.length))?.[1] : undefined)
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
}

export function normalizedSegmentIds(segmentIds?: number[], count = 0): number[] {
  if (!segmentIds?.length) return Array.from({ length: Math.max(0, count) }, (_, i) => i);
  return [...new Set(segmentIds.filter(id => Number.isSafeInteger(id) && id >= 0))].sort((a, b) => a - b);
}
