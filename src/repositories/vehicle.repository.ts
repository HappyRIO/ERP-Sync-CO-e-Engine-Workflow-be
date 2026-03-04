import prisma from '../config/database';

export class VehicleRepository {
  async findById(id: string) {
    return prisma.vehicle.findUnique({
      where: { id },
      include: {
        drivers: {
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
        drivers: {
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
    const vehicleDrivers = await prisma.vehicleDriver.findMany({
      where: { driverId },
      include: {
        vehicle: {
          include: {
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return vehicleDrivers.map(vd => vd.vehicle);
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
        drivers: {
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
    if (driverId === null) {
      // Unallocate: remove all driver assignments for this vehicle
      await prisma.vehicleDriver.deleteMany({
        where: { vehicleId },
      });
    } else {
      // Allocate: create or update the relationship
      await prisma.vehicleDriver.upsert({
        where: {
          vehicleId_driverId: {
            vehicleId,
            driverId,
          },
        },
        create: {
          vehicleId,
          driverId,
        },
        update: {},
      });
    }
    
    return prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        drivers: {
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

  async addDriverToVehicle(vehicleId: string, driverId: string) {
    return prisma.vehicleDriver.create({
      data: {
        vehicleId,
        driverId,
      },
      include: {
        vehicle: {
          include: {
            drivers: {
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
            },
            creator: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
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

  async removeDriverFromVehicle(vehicleId: string, driverId: string) {
    await prisma.vehicleDriver.delete({
      where: {
        vehicleId_driverId: {
          vehicleId,
          driverId,
        },
      },
    });
    
    return prisma.vehicle.findUnique({
      where: { id: vehicleId },
      include: {
        drivers: {
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
