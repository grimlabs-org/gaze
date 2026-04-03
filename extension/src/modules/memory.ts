import type { MemoryData } from "../shared/types";
import type { CdpBridge } from "../background/cdp-bridge";

const MIN_STRING_LENGTH = 8;
const MAX_STRINGS = 500;

export async function observeMemory(bridge: CdpBridge, _url: string): Promise<MemoryData> {
  const snapshotJson = await bridge.takeHeapSnapshot();

  // Parse only the strings section — avoid loading the full snapshot into memory
  const snapshot = JSON.parse(snapshotJson) as {
    snapshot: { meta: { node_fields: string[] } };
    strings: string[];
    nodes: number[];
  };

  const strings = snapshot.strings ?? [];
  const totalNodes = (snapshot.nodes ?? []).length;

  // Count string occurrences
  const counts = new Map<string, number>();
  for (const s of strings) {
    if (s.length >= MIN_STRING_LENGTH) {
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
  }

  // Sort by length descending — longer strings more likely to be interesting
  const sorted = [...counts.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .slice(0, MAX_STRINGS)
    .map(([value, occurrences]) => ({ value, length: value.length, occurrences }));

  return {
    strings: sorted,
    summary: {
      totalNodes,
      totalSize: snapshotJson.length,
      stringCount: strings.length,
    },
  };
}
