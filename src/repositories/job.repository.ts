import prisma from '../config/database';
import { JobStatus } from '../types';

export class JobRepository {
  async findById(id: string) {
    return prisma.job.findUnique({
      where: { id },
      include: {
        booking: {
          include: { 
            client: true,
            site: true,
            statusHistory: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        assets: {
          include: { category: true },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
        evidence: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        certificates: true,
        co2Results: true,
        buybackResults: true,
        financeStatus: true,
        driver: {
          include: {
            driverProfile: true,
            vehicleDrivers: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
    });
  }

  async findByErpJobNumber(erpJobNumber: string) {
    return prisma.job.findUnique({
      where: { erpJobNumber },
      include: {
        booking: {
          include: { 
            client: true,
            site: true,
            statusHistory: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        assets: {
          include: { category: true },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
        evidence: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        certificates: true,
        co2Results: true,
        buybackResults: true,
        financeStatus: true,
        driver: {
          include: {
            driverProfile: true,
            vehicleDrivers: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
    });
  }

  async findByBookingId(bookingId: string) {
    return prisma.job.findUnique({
      where: { bookingId },
      include: {
        booking: {
          include: { 
            client: true,
            site: true,
            statusHistory: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        assets: {
          include: { category: true },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
        evidence: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        certificates: true,
        co2Results: true,
        buybackResults: true,
        financeStatus: true,
        driver: {
          include: {
            driverProfile: true,
            vehicleDrivers: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
    });
  }

  async create(data: {
    erpJobNumber: string;
    bookingId?: string;
    tenantId: string;
    clientName: string;
    siteName: string;
    siteAddress: string;
    status: JobStatus;
    scheduledDate: Date;
    co2eSaved: number;
    travelEmissions: number;
    buybackValue: number;
    charityPercent: number;
    driverId?: string;
  }) {
    return prisma.job.create({
      data: data as any, // Type assertion needed due to Prisma enum type mismatch
      include: {
        booking: {
          include: { 
            client: true,
            site: true,
            statusHistory: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        assets: {
          include: { category: true },
        },
        driver: {
          include: {
            driverProfile: true,
            vehicleDrivers: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
    });
  }

  async update(id: string, data: {
    status?: JobStatus;
    completedDate?: Date;
    co2eSaved?: number;
    travelEmissions?: number;
    buybackValue?: number;
    driverId?: string | null;
    dial2Collection?: string;
    securityRequirements?: string;
    idRequired?: string;
    loadingBayLocation?: string;
    vehicleHeightRestrictions?: string;
    doorLiftSize?: string;
    roadWorksPublicEvents?: string;
    manualHandlingRequirements?: string;
  }) {
    return prisma.job.update({
      where: { id },
      data: data as any, // Type assertion needed due to Prisma enum type mismatch
      include: {
        booking: {
          include: { 
            client: true,
            site: true,
            statusHistory: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        assets: {
          include: { category: true },
        },
        driver: {
          include: {
            driverProfile: true,
            vehicleDrivers: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
    });
  }

  async addStatusHistory(jobId: string, data: {
    status: JobStatus;
    changedBy?: string;
    notes?: string;
  }) {
    return prisma.jobStatusHistory.create({
      data: {
        jobId,
        ...data,
      },
    });
  }

  async findByDriver(driverId: string, filters?: {
    status?: JobStatus;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { 
      driverId,
      booking: {
        bookingType: 'itad_collection', // Drivers only see ITAD collection jobs, not JML jobs
      },
    };
    if (filters?.status) {
      where.status = filters.status;
    }
    // Drivers can only see ITAD collection jobs (JML jobs are handled by couriers)

    return prisma.job.findMany({
      where,
      include: {
        booking: {
          include: { 
            client: true,
            site: true,
            statusHistory: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        assets: {
          include: { category: true },
        },
        evidence: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        driver: {
          include: {
            driverProfile: true,
            vehicleDrivers: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
      orderBy: { scheduledDate: 'asc' },
      take: filters?.limit,
      skip: filters?.offset,
    });
  }

  async findByTenant(tenantId: string, filters?: {
    status?: JobStatus;
    clientName?: string;
    searchQuery?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { tenantId };
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.clientName) {
      where.clientName = {
        contains: filters.clientName,
        mode: 'insensitive',
      };
    }
    if (filters?.searchQuery) {
      where.OR = [
        { clientName: { contains: filters.searchQuery, mode: 'insensitive' } },
        { erpJobNumber: { contains: filters.searchQuery, mode: 'insensitive' } },
        { siteName: { contains: filters.searchQuery, mode: 'insensitive' } },
        { siteAddress: { contains: filters.searchQuery, mode: 'insensitive' } },
      ];
    }

    return prisma.job.findMany({
      where,
      include: {
        booking: {
          include: { 
            client: true,
            site: true,
            statusHistory: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
        assets: {
          include: { category: true },
        },
        driver: {
          include: {
            driverProfile: true,
            vehicleDrivers: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit,
      skip: filters?.offset,
    });
  }
}

