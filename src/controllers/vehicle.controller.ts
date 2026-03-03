import { Response, NextFunction } from 'express';
import { VehicleService } from '../services/vehicle.service';
import { AuthenticatedRequest, ApiResponse } from '../types';

const vehicleService = new VehicleService();

export class VehicleController {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const vehicles = await vehicleService.getVehicles(req.user.tenantId);

      return res.json({
        success: true,
        data: vehicles,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const vehicle = await vehicleService.getVehicleById(id);

      // Verify vehicle belongs to tenant
      if (vehicle.tenantId !== req.user.tenantId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Vehicle does not belong to your tenant',
        } as ApiResponse);
      }

      return res.json({
        success: true,
        data: vehicle,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async getByDriver(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { driverId } = req.params;

      // Drivers can only view their own vehicle, admins can view any driver's vehicle
      if (req.user.role === 'driver' && driverId !== req.user.userId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Drivers can only view their own vehicle',
        } as ApiResponse);
      }

      const vehicle = await vehicleService.getVehicleByDriver(driverId);

      return res.json({
        success: true,
        data: vehicle,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { vehicleReg, vehicleType, vehicleFuelType } = req.body;

      const vehicle = await vehicleService.createVehicle(req.user.tenantId, {
        vehicleReg,
        vehicleType,
        vehicleFuelType,
        createdBy: req.user.userId,
      });

      return res.status(201).json({
        success: true,
        data: vehicle,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { vehicleReg, vehicleType, vehicleFuelType } = req.body;

      const vehicle = await vehicleService.updateVehicle(id, req.user.tenantId, {
        vehicleReg,
        vehicleType,
        vehicleFuelType,
      });

      return res.json({
        success: true,
        data: vehicle,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async allocate(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { driverId } = req.body; // Can be null, undefined, or empty string to unallocate

      // Convert undefined or empty string to null for unallocation
      const finalDriverId = driverId === undefined || driverId === '' ? null : driverId;

      const vehicle = await vehicleService.allocateVehicleToDriver(
        id,
        finalDriverId,
        req.user.tenantId
      );

      return res.json({
        success: true,
        data: vehicle,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async delete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      await vehicleService.deleteVehicle(id, req.user.tenantId);

      return res.json({
        success: true,
        message: 'Vehicle deleted successfully',
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
}
