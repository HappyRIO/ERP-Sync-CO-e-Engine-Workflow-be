import prisma from '../config/database';
import { BookingStatus } from '../types';

export class BookingRepository {
  async findById(id: string) {
    return prisma.booking.findUnique({
      where: { id },
      include: {
        client: true,
        site: true,
        assets: {
          include: { category: true },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
        job: true,
        documents: true,
      },
    });
  }

  async findByBookingNumber(bookingNumber: string) {
    return prisma.booking.findUnique({
      where: { bookingNumber },
      include: {
        client: true,
        site: true,
        assets: {
          include: { category: true },
        },
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
        job: true,
      },
    });
  }

  async create(data: {
    bookingNumber: string;
    clientId: string;
    tenantId: string;
    siteId?: string;
    siteName: string;
    siteAddress: string;
    postcode: string;
    lat?: number;
    lng?: number;
    scheduledDate: Date;
    status: BookingStatus;
    charityPercent: number;
    estimatedCO2e: number;
    estimatedBuyback: number;
    preferredVehicleType?: string;
    roundTripDistanceKm?: number;
    roundTripDistanceMiles?: number;
    erpJobNumber?: string;
    resellerId?: string;
    resellerName?: string;
    createdBy: string;
  }) {
    return prisma.booking.create({
      data,
      include: {
        client: true,
        site: true,
        assets: {
          include: { category: true },
        },
      },
    });
  }

  async update(id: string, data: {
    status?: BookingStatus;
    driverId?: string | null;
    driverName?: string | null;
    scheduledBy?: string | null;
    scheduledAt?: Date | null;
    collectedAt?: Date;
    sanitisedAt?: Date;
    gradedAt?: Date;
    completedAt?: Date;
    jobId?: string;
    erpJobNumber?: string;
  }) {
    return prisma.booking.update({
      where: { id },
      data,
      include: {
        client: true,
        site: true,
        assets: {
          include: { category: true },
        },
        job: true,
      },
    });
  }

  async addStatusHistory(bookingId: string, data: {
    status: BookingStatus;
    changedBy?: string;
    notes?: string;
  }) {
    return prisma.bookingStatusHistory.create({
      data: {
        bookingId,
        ...data,
      },
    });
  }

  async findByClient(clientId: string, filters?: {
    status?: BookingStatus;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { clientId };
    if (filters?.status) {
      where.status = filters.status;
    }

    return prisma.booking.findMany({
      where,
      include: {
        client: true,
        site: true,
        assets: {
          include: { category: true },
        },
        job: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit,
      skip: filters?.offset,
    });
  }

  async findByTenant(tenantId: string, filters?: {
    status?: BookingStatus;
    clientId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { tenantId };
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.clientId) {
      where.clientId = filters.clientId;
    }

    return prisma.booking.findMany({
      where,
      include: {
        client: true,
        site: true,
        assets: {
          include: { category: true },
        },
        job: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit,
      skip: filters?.offset,
    });
  }

  async findByReseller(resellerId: string, filters?: {
    status?: BookingStatus;
    clientId?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {
      OR: [
        { resellerId },
        { client: { resellerId } },
      ],
    };
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.clientId) {
      where.clientId = filters.clientId;
    }

    return prisma.booking.findMany({
      where,
      include: {
        client: true,
        site: true,
        assets: {
          include: { category: true },
        },
        job: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit,
      skip: filters?.offset,
    });
  }

  async findByCreatedBy(userId: string, tenantId: string, filters?: {
    status?: BookingStatus;
    limit?: number;
    offset?: number;
  }) {
    const where: any = { 
      createdBy: userId,
      tenantId: tenantId,
    };
    if (filters?.status) {
      where.status = filters.status;
    }

    return prisma.booking.findMany({
      where,
      include: {
        client: true,
        site: true,
        assets: {
          include: { category: true },
        },
        job: true,
      },
      orderBy: { createdAt: 'desc' },
      take: filters?.limit,
      skip: filters?.offset,
    });
  }
}

