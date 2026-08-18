/**
 * Formats a pet file name or identifier into a clean display name
 * by stripping file extensions like .png, .jpg, .jpeg, etc.
 */
export function formatPetName(name?: string | null): string {
  if (!name) return '';
  return name.replace(/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i, '').trim();
}

/**
 * Checks whether two pet names match, ignoring case and file extensions.
 */
export function isSamePetName(name1?: string | null, name2?: string | null): boolean {
  if (!name1 || !name2) return false;
  return formatPetName(name1).toLowerCase() === formatPetName(name2).toLowerCase();
}
