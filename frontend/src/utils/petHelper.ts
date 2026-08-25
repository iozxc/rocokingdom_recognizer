import { EncounterRecord, PetItem } from '../types';

/**
 * Formats a pet file name or identifier into a clean display name
 * by stripping ONLY file extensions like .png, .jpg, .jpeg, etc.
 * Example: '暗影灵面_闭眼.png' -> '暗影灵面_闭眼', '暗影灵面_睁眼.png' -> '暗影灵面_睁眼'
 */
export function formatPetName(name?: string | null): string {
  if (!name) return '';
  let cleaned = name.replace(/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i, '').trim();
  // 兼容新命名 <id>_<seq>_<名字>.png：去掉数字 id 前缀与形态序号，只保留展示名。
  // 例：'001_01_迪莫.png' -> '迪莫'；'004_02_叶冕魔力猫.png' -> '叶冕魔力猫'。
  const m = cleaned.match(/^(\d{1,4})_(\d{1,3})_(.+)$/);
  if (m) {
    return m[3];
  }
  const m2 = cleaned.match(/^(\d{1,4})_(.+)$/);
  if (m2) {
    return m2[2];
  }
  return cleaned;
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
