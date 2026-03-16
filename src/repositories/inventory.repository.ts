import prisma from '../config/database';
import { InventoryStatus } from '@prisma/client';

export class InventoryRepository {
  async findById(id: string) {
    return prisma.clientInventory.findUnique({
      where: { id },
      include: {
        client: true,
        tenant: true,
      },
    });
  }

  async findByClient(clientId: string) {
    return prisma.clientInventory.findMany({
      where: { clientId },
      include: {
        client: true,
        tenant: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBySerial(clientId: string, serialNumber: string) {
    return prisma.clientInventory.findUnique({
      where: {
        clientId_serialNumber: {
          clientId,
          serialNumber,
        },
      },
      include: {
        client: true,
        tenant: true,
      },
    });
  }

  async findAvailable(clientId: string, deviceType?: string, conditionCode?: string) {
    const where: any = {
      clientId,
      status: 'available',
    };

    if (deviceType) {
      where.deviceType = deviceType;
    }

    if (conditionCode) {
      where.conditionCode = conditionCode;
    }

    return prisma.clientInventory.findMany({
      where,
      include: {
        client: true,
        tenant: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByErpInventoryId(erpInventoryId: string) {
    return prisma.clientInventory.findFirst({
      where: { erpInventoryId },
      include: {
        client: true,
        tenant: true,
      },
    });
  }

  async create(data: {
    clientId: string;
    tenantId: string;
    deviceType: string;
    make: string;
    model: string;
    serialNumber: string;
    imei?: string;
    conditionCode: string;
    erpInventoryId?: string;
    status?: InventoryStatus;
  }) {
    return prisma.clientInventory.create({
      data,
      include: {
        client: true,
        tenant: true,
      },
    });
  }

  async createMany(items: Array<{
    clientId: string;
    tenantId: string;
    deviceType: string;
    make: string;
    model: string;
    serialNumber: string;
    imei?: string;
    conditionCode: string;
    erpInventoryId?: string;
    status?: InventoryStatus;
  }>) {
    return prisma.clientInventory.createMany({
      data: items,
      skipDuplicates: true, // Skip if serial number already exists
    });
  }

  async update(id: string, data: {
    deviceType?: string;
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
        client: true,
        tenant: true,
      },
    });
  }

  async updateBySerial(clientId: string, serialNumber: string, data: {
    deviceType?: string;
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
      where: {
        clientId_serialNumber: {
          clientId,
          serialNumber,
        },
      },
      data,
      include: {
        client: true,
        tenant: true,
      },
    });
  }

  async delete(id: string) {
    return prisma.clientInventory.delete({
      where: { id },
    });
  }

  async count(clientId: string, status?: InventoryStatus) {
    const where: any = { clientId };
    if (status) {
      where.status = status;
    }
    return prisma.clientInventory.count({ where });
  }
}
