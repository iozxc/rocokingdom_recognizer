import { EncounterRecord, PetItem } from '../types';

/**
 * Formats a pet file name or identifier into a clean display name
 * by stripping ONLY file extensions like .png, .jpg, .jpeg, etc.
 * Example: '暗影灵面_闭眼.png' -> '暗影灵面_闭眼', '暗影灵面_睁眼.png' -> '暗影灵面_睁眼'
 */
export function formatPetName(name?: string | null): string {
  if (!name) return '';
  return name.replace(/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i, '').trim();
}

/**
 * Returns the standardized clean pet name (preserving any variant suffixes like _闭眼, _睁眼).
 */
export function getBasePetName(name?: string | null): string {
  return formatPetName(name);
}

/**
 * Checks whether two pet names refer to the exact same pet item.
 * ONLY handles case-insensitivity and file extension presence (.png vs no .png).
 * '暗影灵面_闭眼' and '暗影灵面_睁眼' are treated as DISTINCT different pets!
 */
export function isSamePetName(name1?: string | null, name2?: string | null): boolean {
  if (!name1 || !name2) return false;
  const raw1 = name1.trim().toLowerCase();
  const raw2 = name2.trim().toLowerCase();
  if (raw1 === raw2) return true;

  const clean1 = formatPetName(name1).toLowerCase();
  const clean2 = formatPetName(name2).toLowerCase();
  if (clean1 === clean2) return true;

  return false;
}

/**
 * Finds all existing keys in records matching this exact pet on the specific map
 * (e.g. resolves map1_暗影灵面_闭眼.png and map1_暗影灵面_闭眼 without matching _睁眼).
 */
export function findMatchingRecordKeys(
    records: Record<string, EncounterRecord> | undefined | null,
    mapId: string,
    petName: string
): string[] {
  if (!records || !mapId || !petName) return [];
  const matchedKeys = new Set<string>();

  const cleanName = formatPetName(petName);

  const directCandidates = [
    `${mapId}_${petName}`,
    `${mapId}_${cleanName}`,
    `${mapId}_${cleanName}.png`,
  ];

  directCandidates.forEach((key) => {
    if (records[key]) {
      matchedKeys.add(key);
    }
  });

  // Scan all records for mapId matching petName exactly
  Object.keys(records).forEach((key) => {
    const record = records[key];
    if (!record) return;
    const keyPrefix = `${mapId}_`;
    if (record.mapId === mapId || key.startsWith(keyPrefix)) {
      const recFilename = record.filename || key.replace(keyPrefix, '');
      if (isSamePetName(recFilename, petName)) {
        matchedKeys.add(key);
      }
    }
  });

  return Array.from(matchedKeys);
}

/**
 * Unified helper to check whether a specific pet is marked as encountered in records.
 * Robust against .png extensions without falsely mixing variants (_闭眼 vs _睁眼).
 */
export function isPetEncounteredInRecords(
    records: Record<string, EncounterRecord> | undefined | null,
    mapId: string,
    petName: string
): boolean {
  if (!records || !mapId || !petName) return false;

  // Direct fast lookups first
  const cleanName = formatPetName(petName);

  if (records[`${mapId}_${petName}`]?.encountered) return true;
  if (cleanName && records[`${mapId}_${cleanName}`]?.encountered) return true;
  if (cleanName && records[`${mapId}_${cleanName}.png`]?.encountered) return true;

  // Scan through records for exact match
  const keyPrefix = `${mapId}_`;
  for (const record of Object.values(records)) {
    if (!record || !record.encountered) continue;
    if (record.mapId === mapId || record.key?.startsWith(keyPrefix)) {
      const recFilename = record.filename || record.key?.replace(keyPrefix, '');
      if (isSamePetName(recFilename, petName)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculates the exact encountered count for a given map's pets list.
 */
export function getMapEncounteredCount(
    records: Record<string, EncounterRecord> | undefined | null,
    mapId: string,
    pets: PetItem[]
): number {
  if (!pets || pets.length === 0) return 0;
  return pets.filter((pet) => isPetEncounteredInRecords(records, mapId, pet.name)).length;
}

/**
 * 根据改名映射（{旧名字: 新名字}，不含扩展名）把遇到记录里的旧名字统一迁移到新名字。
 * 保留 count / encountered / firstSeenAt / lastSeenAt；键与 filename 同步更新。
 */
export function applyPetRenames(
    records: Record<string, EncounterRecord> | undefined | null,
    renames: Record<string, string> | undefined | null
): Record<string, EncounterRecord> {
  if (!records || !renames) return records || {};

  const stripExt = (n: string) => n.replace(/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i, '');
  const out: Record<string, EncounterRecord> = {};

  for (const [key, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object') {
      out[key] = rec as EncounterRecord;
      continue;
    }
    const recCopy = { ...rec };
    const fn = recCopy.filename || '';
    const base = stripExt(fn);
    const target = renames[base];

    if (target) {
      const ext = fn.slice(base.length);
      recCopy.filename = target + ext;
      const mapId = recCopy.mapId || key.split('_')[0];
      recCopy.mapId = mapId;
      recCopy.key = `${mapId}_${target}${ext}`;
    }

    const newKey = recCopy.key || key;
    if (out[newKey]) {
      const prev = out[newKey];
      prev.count = (prev.count || 0) + (recCopy.count || 0);
      prev.encountered = true;
      if (recCopy.firstSeenAt && (!prev.firstSeenAt || recCopy.firstSeenAt < prev.firstSeenAt)) {
        prev.firstSeenAt = recCopy.firstSeenAt;
      }
      if (recCopy.lastSeenAt && (!prev.lastSeenAt || recCopy.lastSeenAt > prev.lastSeenAt)) {
        prev.lastSeenAt = recCopy.lastSeenAt;
      }
    } else {
      out[newKey] = recCopy;
    }
  }
  return out;
}
