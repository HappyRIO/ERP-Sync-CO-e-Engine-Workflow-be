import prisma from '../config/database';
import { logger } from './logger';
import { isJmlAccessoryOnlyLabel, resolveAssetCategoryForJmlDeviceLabel } from './jml-asset-category';

/**
 * If a JML booking has no BookingAsset rows but device lines exist in status history,
 * recreate assets (and job assets when the job exists with none) so grading / jobs work.
 * Idempotent: only runs when booking.assets is empty.
 *
 * @returns true if booking assets were created (caller may refetch)
 */
export async function repairJmlBookingAssetsFromNotesIfNeeded(bookingId: string): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      assets: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
      job: { include: { assets: true } },
    },
  });

  if (!booking || booking.bookingType !== 'jml') return false;
  if (booking.assets.length > 0) return false;

  const history = booking.statusHistory.find(
    (h) => h.notes && h.notes.includes('Device details:')
  );
  if (!history?.notes) return false;

  const match =
    history.notes.match(
      /Device details:\s*(\[[\s\S]*?\])(?=\s*\.?\s*Replacement Device details:|$)/i
    ) || history.notes.match(/Device details:\s*(\[[\s\S]*?\])/i);

  const jsonStr = match?.[1];
  if (!jsonStr) return false;

  let devices: unknown[];
  try {
    devices = JSON.parse(jsonStr) as unknown[];
  } catch {
    return false;
  }

  if (!Array.isArray(devices) || devices.length === 0) return false;

  const aggregated = new Map<
    string,
    { categoryId: string; categoryName: string; quantity: number }
  >();

  for (const d of devices) {
    const row = d as { category?: string; quantity?: number };
    if (!row?.category) continue;
    if (isJmlAccessoryOnlyLabel(String(row.category))) continue;

    const cat = await resolveAssetCategoryForJmlDeviceLabel(String(row.category));
    if (!cat) {
      logger.warn('Repair: could not map device category to AssetCategory', {
        bookingId,
        label: row.category,
      });
      continue;
    }

    const q = Number.isFinite(row.quantity) ? Math.max(1, Math.floor(Number(row.quantity))) : 1;
    const prev = aggregated.get(cat.id);
    if (prev) prev.quantity += q;
    else aggregated.set(cat.id, { categoryId: cat.id, categoryName: cat.name, quantity: q });
  }

  if (aggregated.size === 0) return false;

  const jobId = booking.jobId;
  const jobHasNoAssets = Boolean(booking.job && booking.job.assets.length === 0);

  await prisma.$transaction(async (tx) => {
    for (const row of aggregated.values()) {
      await tx.bookingAsset.create({
        data: {
          bookingId,
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          quantity: row.quantity,
        },
      });
    }

    if (jobId && jobHasNoAssets) {
      for (const row of aggregated.values()) {
        await tx.jobAsset.create({
          data: {
            jobId,
            categoryId: row.categoryId,
            categoryName: row.categoryName,
            quantity: row.quantity,
          },
        });
      }
    }
  });

  logger.info('Repaired JML booking assets from Device details in status history', {
    bookingId,
    categories: aggregated.size,
  });

  return true;
}
