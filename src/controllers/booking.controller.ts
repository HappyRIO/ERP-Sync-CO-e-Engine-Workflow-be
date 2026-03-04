import { Response, NextFunction } from 'express';
import { BookingService } from '../services/booking.service';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { transformBookingForAPI, transformBookingsForAPI } from '../utils/booking-transform';
import prisma from '../config/database';

const bookingService = new BookingService();

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
}
