import prisma from '../config/database';
import { BookingStatus } from '@prisma/client';

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
    // JML fields
    bookingType?: 'itad_collection' | 'jml';
    jmlSubType?: 'new_starter' | 'leaver' | 'breakfix' | 'mover';
    employeeName?: string;
    employeeEmail?: string;
    employeePhone?: string;
    startDate?: Date;
    deviceType?: string;
    courierTracking?: string;
    deliveryDate?: Date;
  }) {
    // Explicitly map all fields to ensure bookingType and jmlSubType are included
    return prisma.booking.create({
      data: {
        bookingNumber: data.bookingNumber,
        clientId: data.clientId,
        tenantId: data.tenantId,
        siteId: data.siteId,
        siteName: data.siteName,
        siteAddress: data.siteAddress,
        postcode: data.postcode,
        lat: data.lat,
        lng: data.lng,
        scheduledDate: data.scheduledDate,
        status: data.status,
        charityPercent: data.charityPercent,
        estimatedCO2e: data.estimatedCO2e,
        estimatedBuyback: data.estimatedBuyback,
        preferredVehicleType: data.preferredVehicleType,
        roundTripDistanceKm: data.roundTripDistanceKm,
        roundTripDistanceMiles: data.roundTripDistanceMiles,
        erpJobNumber: data.erpJobNumber,
        resellerId: data.resellerId,
        resellerName: data.resellerName,
        createdBy: data.createdBy,
        // JML fields - explicitly set to ensure they're saved
        // Only default to 'itad_collection' if bookingType is not explicitly 'jml'
        bookingType: (data.bookingType === 'jml' ? 'jml' : (data.bookingType || 'itad_collection')) as 'itad_collection' | 'jml',
        jmlSubType: data.jmlSubType || null,
        employeeName: data.employeeName,
        employeeEmail: data.employeeEmail,
        employeePhone: data.employeePhone,
        startDate: data.startDate,
        deviceType: data.deviceType,
        courierTracking: data.courierTracking,
        deliveryDate: data.deliveryDate,
      },
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
    // JML fields
    employeeName?: string;
    employeeEmail?: string;
    employeePhone?: string;
    startDate?: Date;
    deviceType?: string;
    courierTracking?: string;
    deliveryDate?: Date;
  }) {
    // Build update data, ensuring status is properly typed as Prisma enum
    const updateData: any = {};
    
    // Copy all fields except status first
    const { status, ...restData } = data;
    Object.assign(updateData, restData);
    
    // Explicitly set status as Prisma enum if provided
    if (status !== undefined) {
      updateData.status = status as BookingStatus;
    }
    
    return prisma.booking.update({
      where: { id },
      data: updateData as any, // Cast to any to include JML fields that aren't in Prisma schema
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
        statusHistory: {
          orderBy: { createdAt: 'desc' },
        },
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

