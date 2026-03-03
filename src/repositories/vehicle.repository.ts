import prisma from '../config/database';

export class VehicleRepository {
  async findById(id: string) {
    return prisma.vehicle.findUnique({
      where: { id },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async findByTenant(tenantId: string) {
    return prisma.vehicle.findMany({
      where: { tenantId },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByDriver(driverId: string) {
    return prisma.vehicle.findUnique({
      where: { driverId },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        },
      },
    });
  }

  async findByRegistration(tenantId: string, vehicleReg: string) {
    return prisma.vehicle.findFirst({
      where: {
        tenantId,
        vehicleReg: vehicleReg.toUpperCase(),
      },
    });
  }

  async create(data: {
    tenantId: string;
    vehicleReg: string;
    vehicleType: string;
    vehicleFuelType: string;
    createdBy: string;
  }) {
    return prisma.vehicle.create({
      data: {
        ...data,
        vehicleReg: data.vehicleReg.toUpperCase(),
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async update(id: string, data: {
    vehicleReg?: string;
    vehicleType?: string;
    vehicleFuelType?: string;
  }) {
    const updateData: any = { ...data };
    if (data.vehicleReg) {
      updateData.vehicleReg = data.vehicleReg.toUpperCase();
    }
    return prisma.vehicle.update({
      where: { id },
      data: updateData,
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async allocateToDriver(vehicleId: string, driverId: string | null) {
    return prisma.vehicle.update({
      where: { id: vehicleId },
      data: { driverId },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            status: true,
          },
        },
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async delete(id: string) {
    return prisma.vehicle.delete({
      where: { id },
    });
  }
}
