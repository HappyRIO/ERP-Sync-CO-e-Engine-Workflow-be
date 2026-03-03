import { Response, NextFunction } from 'express';
import { DriverService } from '../services/driver.service';
import { VehicleService } from '../services/vehicle.service';
import { AuthenticatedRequest, ApiResponse } from '../types';

const driverService = new DriverService();
const vehicleService = new VehicleService();

export class DriverController {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const drivers = await driverService.getDrivers(req.user.tenantId);

      // Fetch all vehicles for the tenant to map to drivers
      const vehicles = await vehicleService.getVehicles(req.user.tenantId);

      // Transform drivers to include profile data and vehicle information
      const transformedDrivers = await Promise.all(
        drivers.map(async (driver) => {
          const vehicle = driver.vehicle || vehicles.find((v) => v.driverId === driver.id);
          return {
            id: driver.id,
            name: driver.name,
            email: driver.email,
            phone: driver.phone || driver.driverProfile?.phone || '',
            status: driver.status,
            vehicleId: vehicle?.id || null,
            vehicleReg: vehicle?.vehicleReg || null,
            vehicleType: vehicle?.vehicleType || null,
            vehicleFuelType: vehicle?.vehicleFuelType || null,
            hasVehicle: !!vehicle,
            hasProfile: !!driver.driverProfile,
          };
        })
      );

      return res.json({
        success: true,
        data: transformedDrivers,
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

      // Drivers can only view their own record, admins can view any driver in their tenant
      if (req.user.role === 'driver' && id !== req.user.userId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Drivers can only view their own profile',
        } as ApiResponse);
      }

      const driver = await driverService.getDriverById(id);

      // Get vehicle allocated to this driver
      const vehicle = driver.vehicle || (await vehicleService.getVehicleByDriver(id));

      return res.json({
        success: true,
        data: {
          id: driver.id,
          name: driver.name,
          email: driver.email,
          phone: driver.driverProfile?.phone || driver.phone || '',
          status: driver.status,
          vehicleId: vehicle?.id || null,
          vehicleReg: vehicle?.vehicleReg || null,
          vehicleType: vehicle?.vehicleType || null,
          vehicleFuelType: vehicle?.vehicleFuelType || null,
          hasVehicle: !!vehicle,
          hasProfile: !!driver.driverProfile,
        },
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async createProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { userId, name, email, phone } = req.body;

      // Only admin can create profiles for other users
      if (req.user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Only administrators can create driver profiles',
        } as ApiResponse);
      }

      // Admin can create profiles with name/email or userId
      // Pass the admin's user ID so invitation can be created with correct inviter
      const profile = await driverService.createOrUpdateProfile(req.user.tenantId, {
        userId,
        name,
        email,
        phone,
        invitedBy: req.user.userId, // Pass admin user ID for invitation creation
      });

      return res.status(201).json({
        success: true,
        data: profile,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { name, email, phone } = req.body;

      // Drivers can only update their own profile
      if (req.user.role === 'driver' && req.user.userId !== id) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Drivers can only update their own profile',
        } as ApiResponse);
      }
      // Admins can update any driver profile
      if (req.user.role !== 'admin' && req.user.userId !== id) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Only administrators can update other driver profiles',
        } as ApiResponse);
      }

      const profile = await driverService.updateProfile(id, {
        name,
        email,
        phone,
      });

      return res.json({
        success: true,
        data: profile,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async deleteProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      await driverService.deleteProfile(id);

      return res.json({
        success: true,
        message: 'Driver deleted successfully',
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
}
