// Vehicle Service

import { VehicleRepository } from '../repositories/vehicle.repository';
import { NotFoundError, ValidationError } from '../utils/errors';
import prisma from '../config/database';

const vehicleRepo = new VehicleRepository();

export class VehicleService {
  /**
   * Get all vehicles for a tenant
   */
  async getVehicles(tenantId: string) {
    return vehicleRepo.findByTenant(tenantId);
  }

  /**
   * Get vehicle by ID
   */
  async getVehicleById(id: string) {
    const vehicle = await vehicleRepo.findById(id);
    if (!vehicle) {
      throw new NotFoundError('Vehicle', id);
    }
    return vehicle;
  }

  /**
   * Get vehicle allocated to a driver
   */
  async getVehicleByDriver(driverId: string) {
    return vehicleRepo.findByDriver(driverId);
  }

  /**
   * Create a new vehicle (admin only)
   */
  async createVehicle(
    tenantId: string,
    data: {
      vehicleReg: string;
      vehicleType: 'van' | 'truck' | 'car';
      vehicleFuelType: 'petrol' | 'diesel' | 'electric';
      createdBy: string;
    }
  ) {
    // Validate vehicle registration
    if (!data.vehicleReg || !data.vehicleReg.trim()) {
      throw new ValidationError('Vehicle registration number is required');
    }

    const vehicleReg = data.vehicleReg.trim().toUpperCase();
    if (vehicleReg === 'TBD') {
      throw new ValidationError('Vehicle registration number cannot be a placeholder');
    }

    // Check if vehicle registration already exists in tenant
    const existingVehicle = await vehicleRepo.findByRegistration(tenantId, vehicleReg);
    if (existingVehicle) {
      throw new ValidationError(`Vehicle with registration ${vehicleReg} already exists`);
    }

    // Validate vehicle type
    const validVehicleTypes = ['van', 'truck', 'car'];
    if (!validVehicleTypes.includes(data.vehicleType)) {
      throw new ValidationError(`Invalid vehicle type. Must be one of: ${validVehicleTypes.join(', ')}`);
    }

    // Validate fuel type
    const validFuelTypes = ['petrol', 'diesel', 'electric'];
    if (!validFuelTypes.includes(data.vehicleFuelType)) {
      throw new ValidationError(`Invalid fuel type. Must be one of: ${validFuelTypes.join(', ')}`);
    }

    return vehicleRepo.create({
      tenantId,
      vehicleReg,
      vehicleType: data.vehicleType,
      vehicleFuelType: data.vehicleFuelType,
      createdBy: data.createdBy,
    });
  }

  /**
   * Update vehicle (admin only)
   */
  async updateVehicle(
    id: string,
    tenantId: string,
    data: {
      vehicleReg?: string;
      vehicleType?: 'van' | 'truck' | 'car';
      vehicleFuelType?: 'petrol' | 'diesel' | 'electric';
    }
  ) {
    const vehicle = await vehicleRepo.findById(id);
    if (!vehicle) {
      throw new NotFoundError('Vehicle', id);
    }

    if (vehicle.tenantId !== tenantId) {
      throw new ValidationError('Vehicle does not belong to your tenant');
    }

    // If updating registration, check for duplicates
    if (data.vehicleReg) {
      const vehicleReg = data.vehicleReg.trim().toUpperCase();
      if (vehicleReg === 'TBD') {
        throw new ValidationError('Vehicle registration number cannot be a placeholder');
      }

      const existingVehicle = await vehicleRepo.findByRegistration(tenantId, vehicleReg);
      if (existingVehicle && existingVehicle.id !== id) {
        throw new ValidationError(`Vehicle with registration ${vehicleReg} already exists`);
      }
    }

    // Validate vehicle type if provided
    if (data.vehicleType) {
      const validVehicleTypes = ['van', 'truck', 'car'];
      if (!validVehicleTypes.includes(data.vehicleType)) {
        throw new ValidationError(`Invalid vehicle type. Must be one of: ${validVehicleTypes.join(', ')}`);
      }
    }

    // Validate fuel type if provided
    if (data.vehicleFuelType) {
      const validFuelTypes = ['petrol', 'diesel', 'electric'];
      if (!validFuelTypes.includes(data.vehicleFuelType)) {
        throw new ValidationError(`Invalid fuel type. Must be one of: ${validFuelTypes.join(', ')}`);
      }
    }

    return vehicleRepo.update(id, data);
  }

  /**
   * Add driver to vehicle (admin only)
   * Supports many-to-many: multiple drivers can be assigned to a vehicle
   */
  async addDriverToVehicle(
    vehicleId: string,
    driverId: string,
    tenantId: string
  ) {
    const vehicle = await vehicleRepo.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle', vehicleId);
    }

    if (vehicle.tenantId !== tenantId) {
      throw new ValidationError('Vehicle does not belong to your tenant');
    }

    // Verify driver exists and belongs to tenant
    const driver = await prisma.user.findUnique({
      where: { id: driverId },
    });

    if (!driver) {
      throw new NotFoundError('Driver', driverId);
    }

    if (driver.role !== 'driver') {
      throw new ValidationError('User must be a driver');
    }

    if (driver.tenantId !== tenantId) {
      throw new ValidationError('Driver does not belong to your tenant');
    }

    // Check if driver is already assigned to this vehicle
    const isAlreadyAssigned = vehicle.drivers?.some(vd => vd.driverId === driverId);
    if (isAlreadyAssigned) {
      throw new ValidationError('Driver is already assigned to this vehicle');
    }

    // Add driver to vehicle
    await vehicleRepo.addDriverToVehicle(vehicleId, driverId);

    // Send notification
    const { notifyVehicleAllocation } = await import('../utils/notifications');
    await notifyVehicleAllocation(
      vehicleId,
      vehicle.vehicleReg,
      driverId,
      tenantId
    );

    return vehicleRepo.findById(vehicleId);
  }

  /**
   * Remove driver from vehicle (admin only)
   */
  async removeDriverFromVehicle(
    vehicleId: string,
    driverId: string,
    tenantId: string
  ) {
    const vehicle = await vehicleRepo.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle', vehicleId);
    }

    if (vehicle.tenantId !== tenantId) {
      throw new ValidationError('Vehicle does not belong to your tenant');
    }

    // Check if driver is assigned to this vehicle
    const isAssigned = vehicle.drivers?.some(vd => vd.driverId === driverId);
    if (!isAssigned) {
      throw new ValidationError('Driver is not assigned to this vehicle');
    }

    // Check if this driver-vehicle combination is assigned to active jobs
    // Jobs use the driver's first vehicle, so we need to check if this vehicle is the first one
    const { JobService } = await import('./job.service');
    const jobService = new JobService();
    const hasActiveJobs = await jobService.hasActiveJobs(driverId);
    
    if (hasActiveJobs) {
      // Get the VehicleDriver records to check assignment order
      const vehicleDriverRecords = await prisma.vehicleDriver.findMany({
        where: { driverId },
        orderBy: { createdAt: 'asc' }, // First assigned = first in list
      });
      
      // Check if this vehicle is the first one assigned (the one used by jobs)
      const isFirstVehicle = vehicleDriverRecords.length > 0 && vehicleDriverRecords[0].vehicleId === vehicleId;
      
      if (isFirstVehicle) {
        throw new ValidationError(
          'Cannot remove driver from vehicle. This vehicle is assigned to active jobs. Please re-assign or complete the jobs first, or unassign the driver from those jobs.'
        );
      }
      // If it's not the first vehicle, allow removal even if driver has active jobs
    }

    // Remove driver from vehicle
    await vehicleRepo.removeDriverFromVehicle(vehicleId, driverId);

    // Send notification
    const { notifyVehicleUnallocation } = await import('../utils/notifications');
    await notifyVehicleUnallocation(
      vehicleId,
      vehicle.vehicleReg,
      driverId,
      tenantId
    );

    return vehicleRepo.findById(vehicleId);
  }

  /**
   * Allocate vehicle to driver (admin only)
   * Legacy method for backward compatibility - now adds driver instead of replacing
   * If driverId is null, removes all drivers from the vehicle
   */
  async allocateVehicleToDriver(
    vehicleId: string,
    driverId: string | null,
    tenantId: string
  ) {
    if (driverId === null) {
      // Remove all drivers from vehicle
      const vehicle = await vehicleRepo.findById(vehicleId);
      if (!vehicle) {
        throw new NotFoundError('Vehicle', vehicleId);
      }

      if (vehicle.tenantId !== tenantId) {
        throw new ValidationError('Vehicle does not belong to your tenant');
      }

      // Check if any assigned drivers have active jobs
      const { JobService } = await import('./job.service');
      const jobService = new JobService();
      
      if (vehicle.drivers && vehicle.drivers.length > 0) {
        for (const vehicleDriver of vehicle.drivers) {
          const hasActiveJobs = await jobService.hasActiveJobs(vehicleDriver.driverId);
          if (hasActiveJobs) {
            throw new ValidationError(
              `Cannot unallocate vehicle. Driver ${vehicleDriver.driver.name} has active jobs assigned. Please re-assign or complete the jobs first.`
            );
          }
        }
      }

      // Store driver IDs for notifications
      const driverIds = vehicle.drivers?.map(vd => vd.driverId) || [];

      // Remove all drivers
      const updatedVehicle = await vehicleRepo.allocateToDriver(vehicleId, null);

      // Send notifications
      const { notifyVehicleUnallocation } = await import('../utils/notifications');
      for (const id of driverIds) {
        await notifyVehicleUnallocation(
          vehicleId,
          vehicle.vehicleReg,
          id,
          tenantId
        );
      }

      return updatedVehicle;
    } else {
      // Add driver to vehicle (using the new method)
      return this.addDriverToVehicle(vehicleId, driverId, tenantId);
    }
  }

  /**
   * Delete vehicle (admin only)
   */
  async deleteVehicle(id: string, tenantId: string) {
    const vehicle = await vehicleRepo.findById(id);
    if (!vehicle) {
      throw new NotFoundError('Vehicle', id);
    }

    if (vehicle.tenantId !== tenantId) {
      throw new ValidationError('Vehicle does not belong to your tenant');
    }

    // Check if vehicle is allocated to any drivers
    if (vehicle.drivers && vehicle.drivers.length > 0) {
      throw new ValidationError('Cannot delete vehicle that is allocated to drivers. Please unallocate all drivers first.');
    }

    return vehicleRepo.delete(id);
  }
}
