import prisma from '../config/database';
import type { AssetCategory } from '@prisma/client';

/**
 * Resolve JML UI category labels (e.g. "Phone", "Laptop") to AssetCategory rows.
 * The JML forms use short names; the database uses names like "Smart Phones".
 */
export async function resolveAssetCategoryForJmlDeviceLabel(
  label: string
): Promise<AssetCategory | null> {
  const raw = label.trim();
  if (!raw) return null;

  let cat = await prisma.assetCategory.findFirst({ where: { name: raw } });
  if (cat) return cat;

  cat = await prisma.assetCategory.findFirst({
    where: { name: { equals: raw, mode: 'insensitive' } },
  });
  if (cat) return cat;

  const lower = raw.toLowerCase();
  const mapped =
    lower === 'phone' ||
    lower === 'smart phones' ||
    lower === 'smart phone' ||
    lower === 'smartphones'
      ? 'Smart Phones'
      : lower === 'laptop' || lower === 'desktop'
        ? 'Laptop'
        : lower === 'tablet' || lower === 'tablets'
          ? 'Tablets'
          : null;

  if (mapped) {
    cat = await prisma.assetCategory.findFirst({ where: { name: mapped } });
    if (cat) return cat;
  }

  return null;
}

export function isJmlAccessoryOnlyLabel(label: string): boolean {
  const c = label.trim().toLowerCase();
  return c === 'accessory' || c === 'accessories';
}
