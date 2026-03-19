import prisma from '../config/database';
import { InventoryStatus } from '@prisma/client';

export class InventoryRepository {
  async findById(id: string) {
    return prisma.clientInventory.findUnique({
      where: { id },
      include: {
        tenant: true,
      },
    });
  }

  async findByAllocatedClient(clientId: string) {
    return prisma.clientInventory.findMany({
      where: { allocatedTo: clientId },
      include: {
        tenant: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBySerial(tenantId: string, serialNumber: string) {
    return prisma.clientInventory.findFirst({
      where: {
        tenantId,
        serialNumber,
      },
      include: {
        tenant: true,
      },
    });
  }

  async findAvailable(allocatedTo: string | null, tenantId: string, category?: string, conditionCode?: string) {
    const where: any = {
      tenantId,
      status: 'available',
    };

    // If allocatedTo is provided, filter by it; otherwise don't filter by allocatedTo (shows all available)
    if (allocatedTo !== null && allocatedTo !== undefined) {
      where.allocatedTo = allocatedTo;
    }
    // If allocatedTo is null/undefined, don't add it to where clause (shows all available inventory)

    if (category) {
      where.category = category;
    }

    if (conditionCode) {
      where.conditionCode = conditionCode;
    }

    return prisma.clientInventory.findMany({
      where,
      include: {
        tenant: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find inventory items that are mover_allocated to a client (for mover booking device allocation).
   */
  /**
   * Mover device pool for allocation. When sourceBookingId is set, only rows added for that booking are returned.
   */
  async findMoverAllocated(
    clientId: string,
    tenantId: string,
    category?: string,
    conditionCode?: string,
    sourceBookingId?: string
  ) {
    const where: any = {
      tenantId,
      status: 'mover_allocated',
      allocatedTo: clientId,
    };
    if (sourceBookingId) {
      where.moverSourceBookingId = sourceBookingId;
    }
    if (category) where.category = category;
    if (conditionCode) where.conditionCode = conditionCode;
    return prisma.clientInventory.findMany({
      where,
      include: { tenant: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(allocatedTo: string | null | undefined, tenantId: string, category?: string, conditionCode?: string, status?: string) {
    const where: any = {
      tenantId,
    };

    // If allocatedTo is provided, filter by it
    // If allocatedTo is null, show only unallocated (allocatedTo IS NULL)
    // If allocatedTo is undefined, don't filter by allocatedTo (show all)
    if (allocatedTo !== undefined) {
      if (allocatedTo !== null) {
        where.allocatedTo = allocatedTo;
      } else {
        where.allocatedTo = null;
      }
    }
    // If allocatedTo is undefined, don't add it to where clause (shows all)

    if (category) {
      where.category = category;
    }

    if (conditionCode) {
      where.conditionCode = conditionCode;
    }

    if (status) {
      where.status = status;
    }

    return prisma.clientInventory.findMany({
      where,
      include: {
        tenant: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByErpInventoryId(erpInventoryId: string) {
    return prisma.clientInventory.findFirst({
      where: { erpInventoryId },
      include: {
        tenant: true,
      },
    });
  }

  async create(data: {
    tenantId: string;
    category: string;
    deviceType?: string | null;
    make: string;
    model: string;
    serialNumber: string;
    imei?: string;
    conditionCode: string;
    erpInventoryId?: string;
    status?: InventoryStatus;
    allocatedTo?: string | null;
  }) {
    // Ensure deviceType is explicitly null (not undefined) if not provided
    const normalizedData = {
      ...data,
      deviceType: data.deviceType === undefined ? null : data.deviceType,
    };
    
    return prisma.clientInventory.create({
      data: normalizedData,
      include: {
        tenant: true,
      },
    });
  }

  async createMany(items: Array<{
    tenantId: string;
    category: string;
    deviceType?: string | null;
    make: string;
    model: string;
    serialNumber: string;
    imei?: string;
    conditionCode: string;
    erpInventoryId?: string;
    status?: InventoryStatus;
    allocatedTo?: string | null;
  }>) {
    // Ensure deviceType is explicitly null (not undefined) for non-laptop/desktop categories
    const normalizedItems = items.map(item => ({
      ...item,
      deviceType: item.deviceType === undefined ? null : item.deviceType,
    }));
    
    return prisma.clientInventory.createMany({
      data: normalizedItems,
      skipDuplicates: true, // Skip if serial number already exists (based on tenantId_serialNumber unique constraint)
    });
  }

  async update(id: string, data: {
    category?: string;
    deviceType?: string | null;
    make?: string;
    model?: string;
    imei?: string;
    conditionCode?: string;
    erpInventoryId?: string;
    status?: InventoryStatus;
    allocatedTo?: string | null;
    lastSyncedAt?: Date;
  }) {
    return prisma.clientInventory.update({
      where: { id },
      data,
      include: {
        tenant: true,
      },
    });
  }

  async updateBySerial(tenantId: string, serialNumber: string, data: {
    category?: string;
    deviceType?: string | null;
    make?: string;
    model?: string;
    imei?: string;
    conditionCode?: string;
    erpInventoryId?: string;
    status?: InventoryStatus;
    allocatedTo?: string | null;
    lastSyncedAt?: Date;
  }) {
    const item = await this.findBySerial(tenantId, serialNumber);
    if (!item) {
      throw new Error(`Inventory item not found: ${serialNumber} in tenant ${tenantId}`);
    }
    return prisma.clientInventory.update({
      where: { id: item.id },
      data,
      include: {
        tenant: true,
      },
    });
  }

  async delete(id: string) {
    return prisma.clientInventory.delete({
      where: { id },
    });
  }

  async count(allocatedTo: string | null, status?: InventoryStatus) {
    const where: any = { allocatedTo };
    if (status) {
      where.status = status;
    }
    return prisma.clientInventory.count({ where });
  }
}
