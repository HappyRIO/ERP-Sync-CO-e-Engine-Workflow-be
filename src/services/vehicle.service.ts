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
   * Allocate vehicle to driver (admin only)
   */
  async allocateVehicleToDriver(
    vehicleId: string,
    driverId: string | null,
    tenantId: string
  ) {
    const vehicle = await vehicleRepo.findById(vehicleId);
    if (!vehicle) {
      throw new NotFoundError('Vehicle', vehicleId);
    }

    if (vehicle.tenantId !== tenantId) {
      throw new ValidationError('Vehicle does not belong to your tenant');
    }

    // If allocating to a driver, verify driver exists and belongs to tenant
    if (driverId) {
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

      // Check if driver has active jobs - if so, prevent vehicle allocation changes
      const { JobService } = await import('./job.service');
      const jobService = new JobService();
      const hasActiveJobs = await jobService.hasActiveJobs(driverId);
      
      if (hasActiveJobs) {
        throw new ValidationError(
          'Cannot change vehicle allocation. Driver has active jobs assigned. Please re-assign or complete the jobs first.'
        );
      }

      // If the vehicle is currently allocated to a different driver, check if that driver has active jobs
      if (vehicle.driverId && vehicle.driverId !== driverId) {
        // Check if the current driver (being unallocated from) has active jobs
        const currentDriverHasActiveJobs = await jobService.hasActiveJobs(vehicle.driverId);
        if (currentDriverHasActiveJobs) {
          throw new ValidationError(
            'Cannot reallocate vehicle. Current driver has active jobs assigned. Please re-assign or complete the jobs first.'
          );
        }
      }

      // Check if driver already has a vehicle allocated (switching vehicles)
      const existingVehicle = await vehicleRepo.findByDriver(driverId);
      if (existingVehicle && existingVehicle.id !== vehicleId) {
        // Automatically unallocate the old vehicle when switching to a new one
        // Note: We don't need to check for active jobs here because we already checked driverId above
        await vehicleRepo.allocateToDriver(existingVehicle.id, null);
        
        // Notify driver about losing their old vehicle
        const { notifyVehicleUnallocation } = await import('../utils/notifications');
        await notifyVehicleUnallocation(
          existingVehicle.id,
          existingVehicle.vehicleReg,
          driverId,
          tenantId
        );
      }
    } else {
      // Unallocating vehicle - check if current driver has active jobs
      if (vehicle.driverId) {
        const { JobService } = await import('./job.service');
        const jobService = new JobService();
        const hasActiveJobs = await jobService.hasActiveJobs(vehicle.driverId);
        
        if (hasActiveJobs) {
          throw new ValidationError(
            'Cannot unallocate vehicle. Driver has active jobs assigned. Please re-assign or complete the jobs first.'
          );
        }
      }
    }

    // Store previous driver ID for notification purposes
    const previousDriverId = vehicle.driverId;
    
    // Perform the allocation
    const updatedVehicle = await vehicleRepo.allocateToDriver(vehicleId, driverId);

    // Send notifications based on the allocation change
    const { notifyVehicleAllocation, notifyVehicleUnallocation, notifyVehicleReallocation } = await import('../utils/notifications');
    
    if (driverId) {
      // Allocating to a driver
      if (previousDriverId && previousDriverId !== driverId) {
        // Reallocation: vehicle was moved from one driver to another
        // Notify the old driver
        await notifyVehicleReallocation(
          vehicleId,
          vehicle.vehicleReg,
          previousDriverId,
          tenantId
        );
        // Notify the new driver
        await notifyVehicleAllocation(
          vehicleId,
          vehicle.vehicleReg,
          driverId,
          tenantId
        );
      } else if (!previousDriverId) {
        // New allocation: vehicle was unallocated, now allocated to a driver
        await notifyVehicleAllocation(
          vehicleId,
          vehicle.vehicleReg,
          driverId,
          tenantId
        );
      }
      // If previousDriverId === driverId, no change, no notification needed
    } else if (previousDriverId) {
      // Unallocation: vehicle was allocated, now unallocated
      await notifyVehicleUnallocation(
        vehicleId,
        vehicle.vehicleReg,
        previousDriverId,
        tenantId
      );
    }

    return updatedVehicle;
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

    // Check if vehicle is allocated to a driver
    if (vehicle.driverId) {
      throw new ValidationError('Cannot delete vehicle that is allocated to a driver. Please unallocate it first.');
    }

    return vehicleRepo.delete(id);
  }
}
