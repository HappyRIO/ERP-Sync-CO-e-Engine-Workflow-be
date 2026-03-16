// Serial Reuse Service
// Tracks serial number reuse history and calculates CO2 savings per serial

import prisma from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { BookingType, JMLSubType } from '@prisma/client';

export class SerialReuseService {
  /**
   * Track serial number reuse
   * Called when a device is allocated to a booking
   */
  async trackSerialReuse(
    serialNumber: string,
    bookingId: string,
    bookingType: BookingType,
    jmlSubType?: JMLSubType | null,
    co2eSaved?: number
  ) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true, job: true },
    });

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    // Get current reuse count for this serial
    const existingHistory = await prisma.serialReuseHistory.findFirst({
      where: {
        serialNumber,
        clientId: booking.clientId,
      },
      orderBy: { createdAt: 'desc' },
    });

    const reuseCount = existingHistory ? existingHistory.reuseCount + 1 : 1;

    // Calculate CO2 per user if we have total CO2
    // Formula: CO2_per_user = total_CO2 / reuse_count
    // Example: 350kg CO2 / 10 users = 35kg per user
    let calculatedCO2e = co2eSaved || 0;
    if (co2eSaved && reuseCount > 1) {
      // Get the category CO2 value for this device type
      // For now, use a default or calculate from booking
      calculatedCO2e = co2eSaved / reuseCount;
    }

    // Create reuse history record
    const history = await prisma.serialReuseHistory.create({
      data: {
        serialNumber,
        clientId: booking.clientId,
        tenantId: booking.tenantId,
        bookingId,
        jobId: booking.jobId || null,
        bookingType,
        jmlSubType: jmlSubType || null,
        reuseCount,
        co2eSaved: calculatedCO2e,
        allocatedDate: new Date(),
      },
    });

    return history;
  }

  /**
   * Get reuse count for a serial number
   */
  async getSerialReuseCount(serialNumber: string, clientId: string): Promise<number> {
    const latestHistory = await prisma.serialReuseHistory.findFirst({
      where: {
        serialNumber,
        clientId,
      },
      orderBy: { createdAt: 'desc' },
    });

    return latestHistory?.reuseCount || 0;
  }

  /**
   * Get CO2 history for a serial number
   */
  async getSerialCO2History(serialNumber: string, clientId: string) {
    const history = await prisma.serialReuseHistory.findMany({
      where: {
        serialNumber,
        clientId,
      },
      include: {
        booking: {
          include: {
            client: true,
          },
        },
        job: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return history;
  }

  /**
   * Calculate total CO2 saved for a serial number
   */
  async calculateSerialCO2Savings(serialNumber: string, clientId: string): Promise<{
    totalCO2e: number;
    reuseCount: number;
    averageCO2ePerReuse: number;
    firstUseDate: Date | null;
    lastUseDate: Date | null;
  }> {
    const history = await prisma.serialReuseHistory.findMany({
      where: {
        serialNumber,
        clientId,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (history.length === 0) {
      return {
        totalCO2e: 0,
        reuseCount: 0,
        averageCO2ePerReuse: 0,
        firstUseDate: null,
        lastUseDate: null,
      };
    }

    const totalCO2e = history.reduce((sum, h) => sum + h.co2eSaved, 0);
    const reuseCount = history.length;
    const averageCO2ePerReuse = totalCO2e / reuseCount;
    const firstUseDate = history[0].allocatedDate;
    const lastUseDate = history[history.length - 1].allocatedDate;

    return {
      totalCO2e,
      reuseCount,
      averageCO2ePerReuse,
      firstUseDate,
      lastUseDate,
    };
  }

  /**
   * Mark serial as returned (update returnedDate)
   */
  async markSerialReturned(
    serialNumber: string,
    bookingId: string,
    returnedDate?: Date
  ) {
    const history = await prisma.serialReuseHistory.findFirst({
      where: {
        serialNumber,
        bookingId,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!history) {
      throw new NotFoundError('Serial reuse history', `${serialNumber}-${bookingId}`);
    }

    return prisma.serialReuseHistory.update({
      where: { id: history.id },
      data: {
        returnedDate: returnedDate || new Date(),
      },
    });
  }

  /**
   * Get all serial reuse statistics for a client
   */
  async getClientSerialStats(clientId: string) {
    const stats = await prisma.serialReuseHistory.groupBy({
      by: ['serialNumber'],
      where: {
        clientId,
      },
      _count: {
        id: true,
      },
      _sum: {
        co2eSaved: true,
      },
      _min: {
        allocatedDate: true,
      },
      _max: {
        allocatedDate: true,
      },
    });

    return stats.map(stat => ({
      serialNumber: stat.serialNumber,
      reuseCount: stat._count.id,
      totalCO2eSaved: stat._sum.co2eSaved || 0,
      firstUseDate: stat._min.allocatedDate,
      lastUseDate: stat._max.allocatedDate,
      averageCO2ePerReuse: stat._sum.co2eSaved ? stat._sum.co2eSaved / stat._count.id : 0,
    }));
  }
}
