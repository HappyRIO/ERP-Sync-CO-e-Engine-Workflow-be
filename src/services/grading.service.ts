// Grading Service
import { NotFoundError, ValidationError } from '../utils/errors';
import prisma from '../config/database';
import { BookingRepository } from '../repositories/booking.repository';
import { logger } from '../utils/logger';

const bookingRepo = new BookingRepository();

export interface GradingRecordData {
  id: string;
  bookingId: string;
  assetId: string; // categoryId (frontend legacy naming)
  assetCategory: string;
  grade: 'A' | 'B' | 'C' | 'D' | 'Q';
  quantity: number;
  resaleValue: number;
  gradedAt: string;
  gradedBy: string;
  notes?: string;
  condition?: string; // conditionCode (frontend legacy naming)
  serialNumbers?: string[];
  imeiNumbers?: string[];
}

function categoryRequiresImei(categoryName: string): boolean {
  const c = String(categoryName || '')
    .trim()
    .toLowerCase();
  return (
    c === 'smart phones' ||
    c === 'smart phone' ||
    c === 'phone' ||
    c === 'tablets' ||
    c === 'tablet' ||
    c === 'mobile'
  );
}

const gradeConditionFactors: Record<string, number> = {
  'A': 1.10,     // +10% above Grade B baseline
  'B': 1.0,      // Baseline (100% - buybackFloor)
  'C': 0.75,     // -25% below Grade B baseline
  'D': 0,        // Zero value (disposal)
  'Q': 0,        // Quarantine / disposal
};

export class GradingService {
  /**
   * Get grading records for a booking
   */
  async getGradingRecords(bookingId: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    const records = await prisma.gradingRecord.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });

    return records.map((r) => ({
      id: r.id,
      bookingId: r.bookingId,
      assetId: r.categoryId,
      assetCategory: r.categoryName,
      grade: r.grade as any,
      quantity: r.quantity,
      resaleValue: r.resaleValue,
      gradedAt: r.createdAt.toISOString(),
      gradedBy: r.gradedBy,
      notes: r.notes ?? undefined,
      condition: r.conditionCode ?? undefined,
      serialNumbers: r.serialNumbers ?? [],
      imeiNumbers: r.imeiNumbers ?? [],
    } satisfies GradingRecordData));
  }

  /**
   * Create a grading record
   */
  async createGradingRecord(
    bookingId: string,
    assetId: string,
    assetCategory: string,
    grade: 'A' | 'B' | 'C' | 'D' | 'Q',
    gradedBy: string,
    condition?: string,
    notes?: string,
    quantity?: number,
    serialNumbers?: string[],
    imeiNumbers?: string[]
  ) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    const job = await prisma.job.findUnique({
      where: { bookingId },
      include: {
        assets: {
          include: {
            category: true,
          },
        },
      },
    });

    if (!job) {
      throw new ValidationError('Job not found for this booking');
    }

    // Find the asset in the job (category group)
    const jobAsset = job.assets.find(asset => asset.categoryId === assetId);
    if (!jobAsset) {
      throw new NotFoundError('Asset', assetId);
    }

    const qty = quantity ?? 1;
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new ValidationError('quantity must be a positive integer');
    }
    if (qty > jobAsset.quantity) {
      throw new ValidationError(`quantity cannot exceed booked quantity (${jobAsset.quantity})`);
    }
    const normalizedSerials = (serialNumbers ?? [])
      .map(s => String(s).trim())
      .filter(Boolean);
    const normalizedImeis = (imeiNumbers ?? [])
      .map(s => String(s).trim())
      .filter(Boolean);

    if (['A', 'B', 'C'].includes(grade)) {
      if (normalizedSerials.length !== qty) {
        throw new ValidationError(`serialNumbers must contain exactly ${qty} values for grade ${grade}`);
      }
    } else if (normalizedImeis.length > 0) {
      throw new ValidationError('imeiNumbers are only used for grades A, B, and C');
    }

    // Get category from database
    const category = jobAsset.category || await prisma.assetCategory.findUnique({
      where: { id: jobAsset.categoryId },
    });

    if (!category) {
      throw new ValidationError(`Category not found for asset: ${assetId}`);
    }

    if (['A', 'B', 'C'].includes(grade) && categoryRequiresImei(category.name)) {
      if (normalizedImeis.length !== qty) {
        throw new ValidationError(
          `imeiNumbers must contain exactly ${qty} value(s) for ${category.name} at grade ${grade}`
        );
      }
    } else if (normalizedImeis.length > 0) {
      throw new ValidationError('IMEI is only required for phone/tablet categories (grades A, B, C)');
    }
    
    // Use buybackFloor directly (same as new booking calculation)
    const buybackFloor = category.buybackFloor ?? 0;
    
    if (buybackFloor === 0) {
      logger.warn('No buybackFloor defined for category', {
        categoryId: jobAsset.categoryId,
        categoryName: category.name,
      });
    }
    
    // Get grade-based condition factor
    const conditionFactor = gradeConditionFactors[grade] || 0;
    
    // Simple calculation matching new booking: buybackFloor × conditionFactor
    const resaleValuePerUnit = buybackFloor * conditionFactor;
    const totalResaleValue = Math.round(resaleValuePerUnit * qty * 100) / 100;
    
    // Log resale value calculation (debug level)
    logger.debug('Resale value calculation (matching new booking formula)', {
      assetCategory,
      categoryName: category.name,
      categoryId: jobAsset.categoryId,
      buybackFloor,
      grade,
      conditionFactor,
      resaleValuePerUnit,
      quantity: qty,
      totalResaleValue,
    });

    const record = await prisma.gradingRecord.create({
      data: {
        bookingId,
        jobId: job.id,
        jobAssetId: jobAsset.id,
        categoryId: jobAsset.categoryId,
        categoryName: jobAsset.categoryName,
        grade: grade as any,
        quantity: qty,
        conditionCode: condition ? String(condition).trim() : null,
        serialNumbers: normalizedSerials,
        imeiNumbers: normalizedImeis,
        resaleValue: resaleValuePerUnit,
        gradedBy,
        notes: notes ? String(notes).trim() : null,
      },
    });

    return {
      id: record.id,
      bookingId,
      assetId,
      assetCategory,
      grade,
      quantity: record.quantity,
      resaleValue: resaleValuePerUnit,
      gradedAt: record.createdAt.toISOString(),
      gradedBy,
      notes,
      condition,
      serialNumbers: normalizedSerials,
      imeiNumbers: normalizedImeis,
    } satisfies GradingRecordData;
  }

  /**
   * Calculate resale value for a category and grade
   * Uses the same simple formula as new booking calculation: buybackFloor × conditionFactor × quantity
   * 
   * Grade adjustments:
   * - Grade A: +10% (1.10 × buybackFloor)
   * - Grade B: baseline (1.0 × buybackFloor)
   * - Grade C: -25% (0.75 × buybackFloor)
   * - Grade D: zero (0 × buybackFloor)
   * - Grade Q: zero (0 × buybackFloor)
   */
  async calculateResaleValue(category: string, grade: 'A' | 'B' | 'C' | 'D' | 'Q', quantity: number): Promise<number> {
    // Find category in database (case-insensitive)
    const categoryRecord = await prisma.assetCategory.findFirst({
      where: {
        name: {
          equals: category,
          mode: 'insensitive',
        },
      },
    });
    
    if (!categoryRecord) {
      logger.warn(`Category not found for resale value calculation: ${category}`);
      return 0;
    }

    // Use buybackFloor directly (same as new booking calculation)
    const buybackFloor = categoryRecord.buybackFloor ?? 0;
    
    if (buybackFloor === 0) {
      logger.warn(`No buybackFloor defined for category: ${categoryRecord.name}`);
      return 0;
    }
    
    // Get grade-based condition factor
    const conditionFactor = gradeConditionFactors[grade] ?? 0;
    
    // Simple calculation matching new booking: buybackFloor × conditionFactor × quantity
    const resaleValuePerUnit = buybackFloor * conditionFactor;
    const totalResaleValue = Math.round(resaleValuePerUnit * quantity * 100) / 100;
    
    return totalResaleValue;
  }
}

