import { Response, NextFunction } from 'express';
import { BookingService } from '../services/booking.service';
import { JMLBookingService } from '../services/jml-booking.service';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { transformBookingForAPI, transformBookingsForAPI } from '../utils/booking-transform';
import prisma from '../config/database';

const bookingService = new BookingService();
const jmlBookingService = new JMLBookingService();

export class BookingController {
  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const {
        clientId,
        clientName,
        siteId,
        siteName,
        address,
        postcode,
        lat,
        lng,
        scheduledDate,
        assets,
        charityPercent,
        preferredVehicleType,
        resellerId,
        resellerName,
      } = req.body;

      // For client role, don't pass clientId (service will find/create Client)
      // For admin/reseller, use provided clientId
      const bookingClientId = req.user.role === 'client' ? undefined : (clientId || undefined);
      // Get client name from request or use a default
      const bookingClientName = clientName || 'Client';

      // For resellers, automatically set resellerId and resellerName from their user info
      let actualResellerId = resellerId;
      let actualResellerName = resellerName;
      
      if (req.user.role === 'reseller') {
        actualResellerId = req.user.userId;
        // Get reseller name from user if not provided
        if (!actualResellerName) {
          const resellerUser = await prisma.user.findUnique({
            where: { id: req.user.userId },
            select: { name: true },
          });
          actualResellerName = resellerUser?.name || 'Reseller';
        }
        
        // If clientId is provided, verify the client belongs to this reseller
        if (bookingClientId) {
          const client = await prisma.client.findFirst({
            where: {
              id: bookingClientId,
              tenantId: req.user.tenantId,
            },
          });
          
          if (!client) {
            return res.status(404).json({
              success: false,
              error: 'Client not found',
            } as ApiResponse);
          }
          
          // Resellers can only create bookings for clients they invited
          if (client.resellerId !== req.user.userId) {
            return res.status(403).json({
              success: false,
              error: 'Forbidden: You can only create bookings for clients you have invited',
            } as ApiResponse);
          }
        }
      }

      const booking = await bookingService.createBooking({
        clientId: bookingClientId,
        clientName: bookingClientName,
        tenantId: req.user.tenantId,
        siteId,
        siteName,
        address,
        postcode,
        lat,
        lng,
        scheduledDate: new Date(scheduledDate),
        assets,
        charityPercent,
        preferredVehicleType,
        resellerId: actualResellerId,
        resellerName: actualResellerName,
        createdBy: req.user.userId,
      });

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.status(201).json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const booking = await bookingService.getBookingById(id);
      const transformedBooking = transformBookingForAPI(booking as any);
      return res.json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      // Parse pagination parameters with defaults
      const page = req.query.page ? Math.max(1, parseInt(req.query.page as string)) : 1;
      const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(req.query.limit as string))) : 20; // Default 20, max 100
      const offset = (page - 1) * limit;

      const result = await bookingService.getBookings({
        tenantId: req.user.tenantId,
        userId: req.user.userId,
        userRole: req.user.role,
        clientId: req.query.clientId as string,
        resellerId: req.query.resellerId as string,
        status: req.query.status as any,
        limit,
        offset,
      });

      const transformedBookings = transformBookingsForAPI(result.data as any[]);
      return res.json({
        success: true,
        data: transformedBookings,
        pagination: result.pagination,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async assignDriver(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { driverId, vehicleId } = req.body;

      const booking = await bookingService.assignDriver(id, driverId, req.user.userId, vehicleId);

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async approve(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { erpJobNumber, notes } = req.body;

      if (!erpJobNumber || !erpJobNumber.trim()) {
        return res.status(400).json({
          success: false,
          error: 'Job ID (erpJobNumber) is required',
        } as ApiResponse);
      }

      const booking = await bookingService.approveBooking(id, req.user.userId, erpJobNumber.trim(), notes);

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.json({
        success: true,
        data: transformedBooking,
        message: 'Booking approved successfully',
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async complete(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { notes } = req.body;

      // Complete booking (changes from graded to completed)
      const booking = await bookingService.updateStatus(
        id,
        'completed',
        req.user.userId,
        notes || 'Booking completed and approved'
      );

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.json({
        success: true,
        data: transformedBooking,
        message: 'Booking completed successfully',
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async updateStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { status, notes } = req.body;

      const booking = await bookingService.updateStatus(
        id,
        status,
        req.user.userId,
        notes
      );

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  async checkJobIdUnique(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { erpJobNumber } = req.query;
      const { id: bookingId } = req.params; // Optional booking ID to exclude from check

      if (!erpJobNumber || typeof erpJobNumber !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Job ID (erpJobNumber) is required',
        } as ApiResponse);
      }

      const isUnique = await bookingService.isJobIdUnique(erpJobNumber, bookingId);

      return res.json({
        success: true,
        data: { isUnique, erpJobNumber: erpJobNumber.trim() },
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/bookings/jml/new-starter
   * Create new starter booking
   */
  async createNewStarter(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const {
        clientId,
        clientName,
        employeeName,
        email,
        address,
        postcode,
        phone,
        startDate,
        deviceType,
        siteName,
        devices,
        lat,
        lng,
      } = req.body;

      // For client role, don't pass clientId (service will find/create Client)
      // For admin/reseller, use provided clientId
      const bookingClientId = req.user.role === 'client' ? undefined : (clientId || undefined);
      const bookingClientName = clientName || 'Client';

      const booking = await jmlBookingService.createNewStarterBooking({
        clientId: bookingClientId,
        clientName: bookingClientName,
        tenantId: req.user.tenantId,
        employeeName,
        email,
        address,
        postcode,
        phone,
        startDate: new Date(startDate),
        deviceType,
        siteName,
        devices: devices || [],
        lat,
        lng,
        createdBy: req.user.userId,
      });

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.status(201).json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/bookings/jml/leaver
   * Create leaver booking
   */
  async createLeaver(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const {
        clientId,
        clientName,
        leaverName,
        address,
        postcode,
        personalEmail,
        phone,
        leavingDate,
        siteName,
        devices,
        lat,
        lng,
        charityPercent,
        preferredVehicleType,
        assets,
      } = req.body;

      // For client role, don't pass clientId (service will find/create Client)
      // For admin/reseller, use provided clientId
      const bookingClientId = req.user.role === 'client' ? undefined : (clientId || undefined);
      const bookingClientName = clientName || 'Client';

      const booking = await jmlBookingService.createLeaverBooking({
        clientId: bookingClientId,
        clientName: bookingClientName,
        tenantId: req.user.tenantId,
        leaverName,
        address,
        postcode,
        personalEmail,
        phone,
        leavingDate: new Date(leavingDate),
        siteName,
        devices: devices || [],
        lat,
        lng,
        charityPercent,
        preferredVehicleType,
        assets,
        createdBy: req.user.userId,
      });

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.status(201).json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/bookings/jml/breakfix
   * Create breakfix booking
   */
  async createBreakfix(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const {
        clientId,
        clientName,
        employeeName,
        email,
        address,
        postcode,
        phone,
        siteName,
        devices,
        brokenDevices,
        deviceType,
        lat,
        lng,
      } = req.body;

      if (!brokenDevices || !Array.isArray(brokenDevices) || brokenDevices.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'brokenDevices array is required and must not be empty',
        } as ApiResponse);
      }

      // Replacement devices (what admin allocates from inventory)
      // If not provided yet (older clients), fall back to brokenDevices to avoid hard failures.
      const replacementDevices =
        devices && Array.isArray(devices) && devices.length > 0 ? devices : brokenDevices;

      // For client role, don't pass clientId (service will find/create Client)
      // For admin/reseller, use provided clientId
      const bookingClientId = req.user.role === 'client' ? undefined : (clientId || undefined);
      const bookingClientName = clientName || 'Client';

      const booking = await jmlBookingService.createBreakfixBooking({
        clientId: bookingClientId,
        clientName: bookingClientName,
        tenantId: req.user.tenantId,
        employeeName,
        email,
        address,
        postcode,
        phone,
        siteName,
        devices: replacementDevices,
        brokenDevices,
        deviceType,
        lat,
        lng,
        createdBy: req.user.userId,
      });

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.status(201).json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/bookings/jml/mover
   * Create mover booking
   */
  async createMover(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const {
        clientId,
        clientName,
        employeeName,
        email,
        address,
        postcode,
        phone,
        siteName,
        scheduledDate,
        currentAddress,
        currentPostcode,
        currentSiteName,
        currentDevices,
        deviceType,
        currentLat,
        currentLng,
        lat,
        lng,
      } = req.body;

      if (!currentDevices || !Array.isArray(currentDevices) || currentDevices.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'currentDevices array is required and must not be empty',
        } as ApiResponse);
      }

      // For client role, don't pass clientId (service will find/create Client)
      // For admin/reseller, use provided clientId
      const bookingClientId = req.user.role === 'client' ? undefined : (clientId || undefined);
      const bookingClientName = clientName || 'Client';

      const booking = await jmlBookingService.createMoverBooking({
        clientId: bookingClientId,
        clientName: bookingClientName,
        tenantId: req.user.tenantId,
        employeeName,
        email,
        address,
        postcode,
        phone,
        siteName,
        scheduledDate: scheduledDate ? new Date(scheduledDate) : new Date(),
        currentAddress,
        currentPostcode,
        currentSiteName,
        currentDevices,
        deviceType,
        currentLat,
        currentLng,
        lat,
        lng,
        createdBy: req.user.userId,
      });

      const transformedBooking = transformBookingForAPI(booking as any);
      return res.status(201).json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/bookings/:id/allocate-device
   * Allocate device(s) to a JML booking
   * Supports both single device allocation (serialNumber) and bulk allocation (category, make, model, deviceType, quantity)
   */
  async allocateDevice(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { serialNumber, category, make, model, deviceType, quantity } = req.body;

      // Check if using new bulk allocation method
      if (category && make && model && quantity) {
        if (!quantity || quantity < 1) {
          return res.status(400).json({
            success: false,
            error: 'quantity must be at least 1',
          } as ApiResponse);
        }

        const result = await jmlBookingService.allocateDevicesByCriteria(
          id,
          category,
          make,
          model,
          deviceType || null,
          quantity,
          req.user.userId
        );

        const transformedBooking = transformBookingForAPI(result.booking as any);

        return res.json({
          success: true,
          data: {
            booking: transformedBooking,
            allocatedSerialNumbers: result.allocatedSerialNumbers,
            quantity: result.quantity,
          },
        } as ApiResponse);
      }

      // Legacy single device allocation by serialNumber
      if (!serialNumber) {
        return res.status(400).json({
          success: false,
          error: 'Either serialNumber or (category, make, model, quantity) is required',
        } as ApiResponse);
      }

      const booking = await jmlBookingService.allocateDevice(id, serialNumber, req.user.userId);
      const transformedBooking = transformBookingForAPI(booking as any);

      return res.json({
        success: true,
        data: {
          booking: transformedBooking,
          allocatedSerialNumbers: [serialNumber],
          quantity: 1,
        },
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/bookings/:id/allocate-mover-all
   * Mover: allocate all mover_allocated inventory rows linked to this booking (auto, no quantity rules)
   */
  async allocateMoverAll(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const advanceBookingStatus =
        req.body && typeof req.body === 'object' && 'advanceBookingStatus' in req.body
          ? req.body.advanceBookingStatus !== false
          : true;
      const result = await jmlBookingService.allocateAllMoverDevicesForBooking(id, req.user.userId, {
        advanceBookingStatus,
      });
      const transformedBooking = transformBookingForAPI(result.booking as any);

      return res.json({
        success: true,
        data: {
          booking: transformedBooking,
          allocatedSerialNumbers: result.allocatedSerialNumbers,
          quantity: result.quantity,
          allMoverDevicesLinked: result.allMoverDevicesLinked,
          linkedSerialNumbers: result.linkedSerialNumbers,
        },
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/bookings/:id/mover-commit-devices
   * Mover @ inventory: commit selected serials in one step (admin only)
   */
  async commitMoverDevices(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const serialNumbers = Array.isArray(req.body?.serialNumbers) ? req.body.serialNumbers : null;
      if (!serialNumbers || serialNumbers.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'serialNumbers array is required',
        } as ApiResponse);
      }

      const result = await jmlBookingService.commitMoverSelectedDevices(
        id,
        serialNumbers.map((s: unknown) => String(s)),
        req.user.userId
      );
      const transformedBooking = transformBookingForAPI(result.booking as any);

      return res.json({
        success: true,
        data: {
          booking: transformedBooking,
          allocatedSerialNumbers: result.allocatedSerialNumbers,
          quantity: result.quantity,
        },
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/bookings/:id/courier-tracking
   * Update courier tracking number (admin only)
   */
  async updateCourierTracking(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { trackingNumber, courierService } = req.body;

      if (!trackingNumber) {
        return res.status(400).json({
          success: false,
          error: 'trackingNumber is required',
        } as ApiResponse);
      }

      if (!courierService) {
        return res.status(400).json({
          success: false,
          error: 'courierService is required',
        } as ApiResponse);
      }

      const booking = await jmlBookingService.updateCourierTracking(id, trackingNumber, courierService, req.user.userId);
      const transformedBooking = transformBookingForAPI(booking as any);

      return res.json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/bookings/:id/mark-delivered
   * Mark booking as delivered (admin only)
   */
  async markDelivered(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const booking = await jmlBookingService.markDelivered(id, req.user.userId);
      const transformedBooking = transformBookingForAPI(booking as any);

      return res.json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/bookings/:id/mark-collected
   * Mark booking as collected and log items (admin only)
   */
  async markCollected(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'items array is required and must not be empty',
        } as ApiResponse);
      }

      // Validate items
      for (const item of items) {
        if (!item.make || !item.model || !item.serialNumber) {
          return res.status(400).json({
            success: false,
            error: 'Each item must have make, model, and serialNumber',
          } as ApiResponse);
        }
      }

      const booking = await jmlBookingService.markCollected(id, items, req.user.userId);
      const transformedBooking = transformBookingForAPI(booking as any);

      return res.json({
        success: true,
        data: transformedBooking,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
}
