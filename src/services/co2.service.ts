// CO2 Calculation Service

import { calculateCO2e, calculateRoundTripDistance } from '../utils/co2';
import { config } from '../config/env';
import prisma from '../config/database';

export class CO2Service {
  /**
   * Calculate CO2e for a booking request
   */
  async calculateBookingCO2e(data: {
    assets: Array<{ categoryId: string; quantity: number }>;
    collectionLat?: number;
    collectionLng?: number;
    distanceKm?: number;
    vehicleType?: 'petrol' | 'diesel' | 'electric';
    tenantId: string;
  }) {
    const categories = await prisma.assetCategory.findMany({
      orderBy: { name: 'asc' },
    });

    if (categories.length === 0) {
      throw new Error('No asset categories found');
    }

    let distanceKm = data.distanceKm;
    if (!distanceKm && data.collectionLat && data.collectionLng) {
      try {
        distanceKm = await calculateRoundTripDistance(
          data.collectionLat,
          data.collectionLng,
          config.warehouse.lat,
          config.warehouse.lng,
          config.routing?.openRouteServiceApiKey
        );
      } catch (error) {
        // Log error - do not use default value, let UI show error/warning
        // This can fail if fetch API is not available (Node.js < 18) or network issues
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error calculating road distance, distance will be 0:', errorMsg);
        distanceKm = 0; // Set to 0 to indicate calculation failed
      }
    }
    if (!distanceKm || isNaN(distanceKm) || distanceKm <= 0) {
      distanceKm = 0; // Set to 0 to indicate distance is not available or invalid
    }

    // Convert categories to format expected by calculation
    const categoryData = categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      co2ePerUnit: cat.co2ePerUnit,
      avgWeight: cat.avgWeight,
      avgBuybackValue: cat.avgBuybackValue,
    }));

    const result = calculateCO2e({
      assets: data.assets,
      distanceKm,
      vehicleType: data.vehicleType,
      categories: categoryData,
    });

    return result;
  }

  /**
   * Save CO2 calculation results for a job
   */
  async saveJobCO2Results(jobId: string, data: {
    reuseSavings: number;
    travelEmissions: number;
    netImpact: number;
    distanceKm: number;
    distanceMiles: number;
    vehicleEmissionsPetrol: number;
    vehicleEmissionsDiesel: number;
    vehicleEmissionsElectric: number;
    treesPlanted: number;
    householdDays: number;
    carMiles: number;
    flightHours: number;
    calculationType: 'pre_job' | 'post_job';
  }) {
    await prisma.cO2Result.deleteMany({
      where: { jobId },
    });

    return prisma.cO2Result.create({
      data: {
        jobId,
        ...data,
      },
    });
  }

  /**
   * Get CO2 results for a job
   */
  async getJobCO2Results(jobId: string) {
    return prisma.cO2Result.findUnique({
      where: { jobId },
    });
  }

  /**
   * Calculate CO2 per serial number based on reuse count
   * Formula: CO2_per_user = total_CO2 / reuse_count
   * Example: 350kg CO2 / 10 users = 35kg per user
   */
  async calculateSerialCO2e(
    _serialNumber: string,
    totalCO2e: number,
    reuseCount: number
  ): Promise<number> {
    if (reuseCount <= 0) {
      return totalCO2e; // First use, full CO2 value
    }
    // CO2 per user = total CO2 / reuse count
    return totalCO2e / reuseCount;
  }
}
