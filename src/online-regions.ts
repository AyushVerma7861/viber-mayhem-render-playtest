import { ROOM_CODE } from './online-protocol.ts';

export interface GameRegion {
  id: string;
  label: string;
  origin: string;
}

export interface RegionDirectory {
  home: string;
  regions: GameRegion[];
}

export interface RoomRoute {
  code: string;
  region: GameRegion;
}

const REGION_ID = /^[a-z][a-z0-9-]{0,23}$/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function parseRegionDirectory(value: unknown): RegionDirectory | undefined {
  if (!value || typeof value !== 'object') return;
  const { home, regions } = value as Partial<RegionDirectory>;
  if (typeof home !== 'string' || !Array.isArray(regions)) return;
  const ids = new Set<string>();
  const origins = new Set<string>();
  const entries: GameRegion[] = [];
  for (const region of regions) {
    if (!region || typeof region.id !== 'string' || !REGION_ID.test(region.id) ||
      typeof region.label !== 'string' || !region.label.trim() || typeof region.origin !== 'string') return;
    let url: URL;
    try { url = new URL(region.origin); } catch { return; }
    const secure = url.protocol === 'https:' || url.protocol === 'http:' && LOOPBACK.has(url.hostname);
    if (!secure || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      ids.has(region.id) || origins.has(url.origin)) return;
    ids.add(region.id);
    origins.add(url.origin);
    entries.push({ id: region.id, label: region.label.trim(), origin: url.origin });
  }
  if (ids.has(home)) return { home, regions: entries };
}

export function homeRegion(directory: RegionDirectory): GameRegion {
  return directory.regions.find(region => region.id === directory.home)!;
}

export function preferredRegion(directory: RegionDirectory, measured: ReadonlyMap<string, number | null>): GameRegion {
  let selected = homeRegion(directory);
  let fastest = measured.get(selected.id) ?? Infinity;
  for (const region of directory.regions) {
    const ping = measured.get(region.id);
    if (ping === undefined || ping === null || ping >= fastest) continue;
    selected = region;
    fastest = ping;
  }
  return selected;
}

export function readRoomRoute(input: string, directory: RegionDirectory): RoomRoute | undefined {
  let code = input.trim();
  let regionId: string | null = null;
  let sourceOrigin: string | undefined;
  if (/^https?:\/\//i.test(code)) {
    try {
      const url = new URL(code);
      sourceOrigin = url.origin;
      regionId = url.searchParams.get('region');
      code = url.searchParams.get('room') ?? '';
    } catch { return; }
  }
  const separator = code.indexOf(':');
  if (separator >= 0) {
    const prefix = code.slice(0, separator);
    if (regionId !== null && regionId !== prefix) return;
    regionId = prefix;
    code = code.slice(separator + 1);
  }
  if (!ROOM_CODE.test(code)) return;
  const region = regionId === null
    ? directory.regions.find(item => item.origin === sourceOrigin) ?? homeRegion(directory)
    : directory.regions.find(item => item.id === regionId);
  if (region) return { code, region };
}
