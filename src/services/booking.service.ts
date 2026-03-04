// Booking Service

import { BookingRepository } from '../repositories/booking.repository';
import { JobRepository } from '../repositories/job.repository';
import { CO2Service } from './co2.service';
import { BuybackService } from './buyback.service';
import { mockERPService } from './mock-erp.service';
import { isValidBookingTransition, isValidJobTransition } from '../middleware/workflow';
import { ValidationError, NotFoundError } from '../utils/errors';
import { BookingStatus, JobStatus } from '../types';
import { calculateTravelEmissions } from '../utils/co2';
import { config } from '../config/env';
import prisma from '../config/database';

const bookingRepo = new BookingRepository();
const co2Service = new CO2Service();
const buybackService = new BuybackService();

export class BookingService {
  /**
   * Create a new booking
   */
  async createBooking(data: {
    clientId: string;
    clientName: string;
    tenantId: string;
    siteId?: string;
    siteName: string;
    address: string;
    postcode: string;
    lat?: number;
    lng?: number;
    scheduledDate: Date;
    assets: Array<{ categoryId: string; quantity: number }>;
    charityPercent?: number;
    preferredVehicleType?: string;
    resellerId?: string;
    resellerName?: string;
    createdBy: string;
  }) {
    // Calculate CO2e
    const co2Result = await co2Service.calculateBookingCO2e({
      assets: data.assets,
      collectionLat: data.lat,
      collectionLng: data.lng,
      vehicleType: data.preferredVehicleType as any,
      tenantId: data.tenantId,
    });

    // Calculate buyback estimate separately
    const estimatedBuyback = await buybackService.calculateBuybackEstimate({
      assets: data.assets,
    });

    // Ensure Client record exists (for foreign key constraint)
    // If clientId is provided, verify it exists and belongs to the tenant
    // Otherwise, find or create client for tenantId
    let actualClientId: string;
    
    if (data.clientId) {
      // Verify client exists and belongs to the tenant
      const existingClient = await prisma.client.findFirst({
        where: { 
          id: data.clientId,
          tenantId: data.tenantId, // Ensure it belongs to the same tenant
        },
      });
      
      if (existingClient) {
        // If resellerId is provided and client doesn't have one, update it
        // If client already has a different resellerId, that's handled by the controller
        if (data.resellerId && !existingClient.resellerId) {
          await prisma.client.update({
            where: { id: existingClient.id },
            data: {
              resellerId: data.resellerId,
              resellerName: data.resellerName,
            },
          });
        }
        actualClientId = existingClient.id;
      } else {
        // Client doesn't exist or doesn't belong to tenant, create new one
        const newClient = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || 'Client',
            status: 'active',
            resellerId: data.resellerId,
            resellerName: data.resellerName,
          },
        });
        actualClientId = newClient.id;
      }
    } else {
      // No clientId provided - this is typically a client user creating a booking.
      // We MUST link the booking to a Client record that belongs specifically to this user,
      // not just \"any\" client in the tenant, otherwise bookings from different client users
      // (e.g. Alex vs Carlos) can appear under the wrong client name.

      // Look up the user to get their email and name
      const user = await prisma.user.findUnique({
        where: { id: data.createdBy },
        select: { email: true, name: true },
      });

      let client = null;

      if (user?.email) {
        // Try to find an existing Client record for this user's email within the tenant
        client = await prisma.client.findFirst({
          where: {
            tenantId: data.tenantId,
            email: user.email,
          },
        });
      }

      if (!client) {
        // No client record exists for this user/email - create one
        client = await prisma.client.create({
          data: {
            tenantId: data.tenantId,
            name: data.clientName || user?.name || 'Client',
            email: user?.email,
            status: 'active',
            resellerId: data.resellerId,
            resellerName: data.resellerName,
          },
        });
      } else if (data.resellerId && !client.resellerId) {
        // If resellerId is provided and client doesn't have one, update it
        client = await prisma.client.update({
          where: { id: client.id },
          data: {
            resellerId: data.resellerId,
            resellerName: data.resellerName,
          },
        });
      }

      actualClientId = client.id;
    }

    // Generate booking number
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000);
    const bookingNumber = `BK-${year}-${String(random).padStart(5, '0')}`;

    // Create booking
    const booking = await bookingRepo.create({
      bookingNumber,
      clientId: actualClientId,
      tenantId: data.tenantId,
      siteId: data.siteId,
      siteName: data.siteName,
      siteAddress: data.address,
      postcode: data.postcode,
      lat: data.lat,
      lng: data.lng,
      scheduledDate: data.scheduledDate,
      status: 'pending',
      charityPercent: data.charityPercent || 0,
      estimatedCO2e: co2Result.reuseSavings,
      estimatedBuyback,
      preferredVehicleType: data.preferredVehicleType,
      roundTripDistanceKm: co2Result.distanceKm,
      roundTripDistanceMiles: co2Result.distanceMiles,
      // Link booking to reseller if provided. If not provided here, the Client record
      // (linked via clientId) may still carry resellerId/resellerName, which we'll use
      // for notifications and reporting.
      resellerId: data.resellerId,
      resellerName: data.resellerName,
      createdBy: data.createdBy,
    });

    // Create booking assets
    for (const asset of data.assets) {
      const category = await prisma.assetCategory.findUnique({
        where: { id: asset.categoryId },
      });

      await prisma.bookingAsset.create({
        data: {
          bookingId: booking.id,
          categoryId: asset.categoryId,
          categoryName: category?.name || asset.categoryId,
          quantity: asset.quantity,
        },
      });
    }

    // Add status history
    await bookingRepo.addStatusHistory(booking.id, {
      status: 'pending',
      changedBy: data.createdBy,
    });

    // Resolve the actual client user (invited client) if one exists, based on the Client record's email.
    // This ensures notifications go to the end client, even when a reseller created the booking.
    const clientUser = booking.client?.email
      ? await prisma.user.findFirst({
          where: {
            tenantId: data.tenantId,
            email: booking.client.email,
            role: 'client',
          },
        })
      : null;
    const clientUserId = clientUser?.id || data.createdBy;

    // Notify client of booking creation (pending approval)
    const { createNotification } = await import('../utils/notifications');
    await createNotification(
      clientUserId,
      data.tenantId,
      'info',
      'Booking submitted',
      `Your booking ${booking.bookingNumber} has been submitted and is pending admin approval`,
      `/bookings/${booking.id}`,
      booking.id,
      'booking'
    );

    // If booking is linked to a reseller (and the reseller is not the creator),
    // notify the reseller that a new booking has been submitted for their client.
    // Derive reseller userId from either booking.resellerId or the linked client.resellerId
    const resellerUserId = booking.resellerId || booking.client?.resellerId;
    if (resellerUserId && resellerUserId !== data.createdBy) {
      await createNotification(
        resellerUserId,
        data.tenantId,
        'info',
        'Client booking submitted',
        `A new booking ${booking.bookingNumber} has been submitted for your client`,
        `/bookings/${booking.id}`,
        booking.id,
        'booking'
      );
    }

    // Notify admins of new booking requiring approval
    // Admins should see all bookings across all tenants, so notify all admins
    const adminUsers = await prisma.user.findMany({
      where: {
        role: 'admin',
        status: 'active',
        isSuperAdmin: false, // Exclude super admins from notifications
        // Remove tenantId filter - admins see all bookings across all tenants
      },
      select: { id: true, email: true, name: true },
    });
    if (adminUsers.length > 0) {
      const { notifyPendingApproval } = await import('../utils/notifications');
      await notifyPendingApproval(
        booking.id,
        booking.bookingNumber,
        adminUsers.map(u => u.id),
        data.tenantId
      );

      // Send email notifications to all admins about new booking
      try {
        const { emailService } = await import('../utils/email');
        const { logger } = await import('../utils/logger');
        
        // Check if email service is configured
        if (!emailService.isConfigured()) {
          logger.warn('Email service not configured, skipping booking created emails', {
            bookingId: booking.id,
            bookingNumber: booking.bookingNumber,
          });
        } else {
          const tenant = await prisma.tenant.findUnique({
            where: { id: data.tenantId },
            select: { name: true },
          });

          // Get the client's organisation name (company name) from the booking's client record
          const clientRecord = await prisma.client.findUnique({
            where: { id: booking.clientId },
            select: { organisationName: true, name: true },
          });
          
          // Use organisationName if available, otherwise fall back to client name, then data.clientName
          const clientCompanyName = clientRecord?.organisationName || clientRecord?.name || data.clientName;

          // Format site name with postcode: "Site Name (Postcode)"
          const siteNameWithPostcode = data.postcode 
            ? `${data.siteName} (${data.postcode})`
            : data.siteName;


          // Send email to each admin
          const emailPromises = adminUsers
            .filter(admin => admin.email) // Only send to admins with email
            .map(admin =>
              emailService.sendBookingCreatedEmail({
                toEmail: admin.email!,
                bookingNumber: booking.bookingNumber,
                clientName: clientCompanyName,
                siteName: siteNameWithPostcode,
                scheduledDate: data.scheduledDate.toISOString(),
                tenantName: tenant?.name || 'ITAD Platform',
              }).catch((error) => {
                // Log individual email failures but don't fail the whole operation
                logger.warn('Failed to send booking created email to admin', {
                  adminId: admin.id,
                  adminEmail: admin.email,
                  bookingId: booking.id,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
              })
            );

          // Send all emails in parallel (don't wait for all to complete)
          Promise.all(emailPromises).catch((error) => {
            logger.warn('Some booking created emails failed to send', {
              bookingId: booking.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
        }
      } catch (error) {
        // Log error but don't fail booking creation
        const { logger } = await import('../utils/logger');
        logger.warn('Failed to send booking created emails', {
          bookingId: booking.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
      // Notifications sent successfully
    } else {
      // No admin users found to notify
    }

    // Call Mock ERP to get job number
    if (config.erp.mockEnabled) {
      try {
        const erpResponse = await mockERPService.createJob({
          clientName: data.clientName,
          siteName: data.siteName,
          siteAddress: data.address,
          scheduledDate: data.scheduledDate.toISOString(),
          assets: data.assets.map(a => ({
            categoryName: a.categoryId, // Will be replaced with actual name
            quantity: a.quantity,
          })),
        });

        await bookingRepo.update(booking.id, {
          erpJobNumber: erpResponse.jobNumber,
        });
      } catch (error) {
        const { logError } = await import('../utils/logger');
        logError('Failed to create ERP job', error, { bookingId: booking.id });
        // Continue without ERP job number
      }
    }

    return this.getBookingById(booking.id);
  }

  /**
   * Get booking by ID
   */
  async getBookingById(id: string) {
    const booking = await bookingRepo.findById(id);
    if (!booking) {
      throw new NotFoundError('Booking', id);
    }
    return booking;
  }

  /**
   * Get bookings with filters
   */
  async getBookings(filters: {
    tenantId: string;
    userId: string;
    userRole: string;
    clientId?: string;
    resellerId?: string;
    status?: BookingStatus;
    limit?: number;
    offset?: number;
  }) {
    // Role-based filtering
    if (filters.userRole === 'admin') {
      // Admins should see all bookings across all tenants (no tenantId filter)
      const where: any = {};
      if (filters.status) {
        where.status = filters.status;
      }
      if (filters.clientId) {
        where.clientId = filters.clientId;
      }

      const limit = filters.limit || 20;
      const offset = filters.offset || 0;

      const [data, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          select: {
            id: true,
            bookingNumber: true,
            clientId: true,
            tenantId: true,
            siteId: true,
            siteName: true,
            siteAddress: true,
            postcode: true,
            lat: true,
            lng: true,
            scheduledDate: true,
            status: true,
            charityPercent: true,
            estimatedCO2e: true,
            estimatedBuyback: true,
            preferredVehicleType: true,
            roundTripDistanceKm: true,
            roundTripDistanceMiles: true,
            erpJobNumber: true,
            jobId: true,
            resellerId: true,
            resellerName: true,
            createdBy: true,
            scheduledBy: true,
            driverId: true,
            driverName: true,
            createdAt: true,
            updatedAt: true,
            scheduledAt: true,
            collectedAt: true,
            sanitisedAt: true,
            gradedAt: true,
            completedAt: true,
            client: {
              select: {
                id: true,
                name: true,
                organisationName: true,
                email: true,
                phone: true,
              },
            },
            site: {
              select: {
                id: true,
                name: true,
                address: true,
                postcode: true,
                lat: true,
                lng: true,
              },
            },
            assets: {
              select: {
                id: true,
                categoryId: true,
                categoryName: true,
                quantity: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                    co2ePerUnit: true,
                    avgWeight: true,
                    avgBuybackValue: true,
                  },
                },
              },
            },
            job: {
              select: {
                id: true,
                erpJobNumber: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.booking.count({ where }),
      ]);

      return {
        data,
        pagination: {
          page: Math.floor(offset / limit) + 1,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } else if (filters.userRole === 'client') {
      // Clients should only see bookings they created with their own user account.
      // Do not merge across multiple client records via email, to avoid showing
      // bookings from other client users (e.g., other people under same reseller).
      const limit = filters.limit || 20;
      const offset = filters.offset || 0;

      const where = {
        tenantId: filters.tenantId,
        createdBy: filters.userId,
        ...(filters.status ? { status: filters.status } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.booking.findMany({
          where,
          select: {
            id: true,
            bookingNumber: true,
            clientId: true,
            tenantId: true,
            siteId: true,
            siteName: true,
            siteAddress: true,
            postcode: true,
            lat: true,
            lng: true,
            scheduledDate: true,
            status: true,
            charityPercent: true,
            estimatedCO2e: true,
            estimatedBuyback: true,
            preferredVehicleType: true,
            roundTripDistanceKm: true,
            roundTripDistanceMiles: true,
            erpJobNumber: true,
            jobId: true,
            resellerId: true,
            resellerName: true,
            createdBy: true,
            scheduledBy: true,
            driverId: true,
            driverName: true,
            createdAt: true,
            updatedAt: true,
            scheduledAt: true,
            collectedAt: true,
            sanitisedAt: true,
            gradedAt: true,
            completedAt: true,
            client: {
              select: {
                id: true,
                name: true,
                organisationName: true,
                email: true,
                phone: true,
              },
            },
            site: {
              select: {
                id: true,
                name: true,
                address: true,
                postcode: true,
                lat: true,
                lng: true,
              },
            },
            assets: {
              select: {
                id: true,
                categoryId: true,
                categoryName: true,
                quantity: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                    co2ePerUnit: true,
                    avgWeight: true,
                    avgBuybackValue: true,
                  },
                },
              },
            },
            job: {
              select: {
                id: true,
                erpJobNumber: true,
                status: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.booking.count({ where }),
      ]);

      return {
        data,
        pagination: {
          page: Math.floor(offset / limit) + 1,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } else if (filters.userRole === 'reseller') {
      const limit = filters.limit || 20;
      const offset = filters.offset || 0;
      
      const bookings = await bookingRepo.findByReseller(filters.userId, {
        status: filters.status,
        limit,
        offset,
      });
      
      // Count total for reseller
      const resellerBookings = await bookingRepo.findByReseller(filters.userId, {
        status: filters.status,
      });
      const total = resellerBookings.length;

      return {
        data: bookings,
        pagination: {
          page: Math.floor(offset / limit) + 1,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }

    return {
      data: [],
      pagination: {
        page: 1,
        limit: filters.limit || 20,
        total: 0,
        totalPages: 0,
      },
    };
  }

  /**
   * Assign driver to booking (admin only)
   * Only allows driver assignment when booking status is "created" (after approval/generation)
   * Once a driver is assigned, the booking moves to "scheduled" status and driver cannot be changed
   */
  async assignDriver(bookingId: string, driverId: string, scheduledBy: string, vehicleId?: string) {
    const booking = await this.getBookingById(bookingId);

    // Only allow driver assignment when booking is in "created" status (Generated/Approved)
    // This ensures drivers can only be assigned to newly approved bookings, not to bookings that are already scheduled
    if (booking.status !== 'created') {
      throw new ValidationError(
        `Cannot assign driver to booking in "${booking.status}" status. Only bookings in "created" (Generated) status can have drivers assigned.`
      );
    }

    // Get driver info (including profile)
    const driver = await prisma.user.findUnique({
      where: { id: driverId },
      include: {
        driverProfile: true,
      },
    });

    if (!driver || driver.role !== 'driver') {
      throw new NotFoundError('Driver', driverId);
    }

    // Business rule: driver must have a completed profile before assignment
    if (!driver.driverProfile) {
      throw new ValidationError(
        'Cannot assign this driver because their vehicle profile is incomplete. Please ask the driver to complete their profile in Settings.'
      );
    }

    // Update booking status to 'scheduled' without triggering status change notification
    // (We'll send a specific "Driver assigned" notification instead)
    await bookingRepo.update(booking.id, {
      status: 'scheduled',
      driverId: driverId,
      driverName: driver.name,
      scheduledBy: scheduledBy,
      scheduledAt: new Date(),
    });

    // Add status history
    await bookingRepo.addStatusHistory(booking.id, {
      status: 'scheduled',
      changedBy: scheduledBy,
      notes: `Driver ${driver.name} assigned`,
    });

    // Notify client/reseller of driver assignment (this replaces "Booking scheduled" notification)
    const { notifyDriverAssignment } = await import('../utils/notifications');
    // Notify booking creator (client or reseller creating the booking)
    await notifyDriverAssignment(
      booking.id,
      booking.bookingNumber,
      driver.name,
      booking.createdBy,
      booking.tenantId
    );
    // If there is a separate reseller linked to this booking, notify them as well
    if (booking.resellerId && booking.resellerId !== booking.createdBy) {
      await notifyDriverAssignment(
        booking.id,
        booking.bookingNumber,
        driver.name,
        booking.resellerId,
        booking.tenantId
      );
    }

    // Create or update job
    const { JobService } = await import('./job.service');
    const { logger } = await import('../utils/logger');
    const jobService = new JobService();
    if (!booking.jobId) {
      // Create job if it doesn't exist (this will send notification to driver)
      await jobService.createJobFromBooking(booking.id, driverId, vehicleId);
    } else {
      // Update existing job to 'routed' and assign driver
      const jobRepo = new JobRepository();
      const job = await jobRepo.findById(booking.jobId);
      if (job) {
        // Get vehicle information for travel emissions calculation
        const driverWithVehicles = await prisma.user.findUnique({
          where: { id: driverId },
          include: {
            vehicleDrivers: {
              include: {
                vehicle: true,
              },
            },
          },
        });

        let selectedVehicle = null;
        if (vehicleId && driverWithVehicles) {
          const vehicleDriver = driverWithVehicles.vehicleDrivers?.find(vd => vd.vehicleId === vehicleId);
          selectedVehicle = vehicleDriver?.vehicle;
        } else if (driverWithVehicles) {
          selectedVehicle = driverWithVehicles.vehicleDrivers?.[0]?.vehicle;
        }

        const vehicleFuelType = selectedVehicle?.vehicleFuelType || booking.preferredVehicleType || 'van';
        const roundTripDistanceKm = (booking.roundTripDistanceKm && booking.roundTripDistanceKm > 0) 
          ? booking.roundTripDistanceKm 
          : 0;
        const travelEmissions = calculateTravelEmissions(roundTripDistanceKm, vehicleFuelType);

        if (isValidJobTransition(job.status, 'routed')) {
          await jobRepo.update(job.id, {
            status: 'routed',
            driverId: driverId,
            travelEmissions: travelEmissions,
          });
          await jobRepo.addStatusHistory(job.id, {
            status: 'routed',
            changedBy: scheduledBy,
            notes: `Driver ${driver.name} assigned - job moved to routed status`,
          });
          // Notify driver of job status change (routed) - this replaces notifyJobAssignment
          logger.info('Job status changed to routed, sending notification to driver', {
            jobId: job.id,
            jobNumber: job.erpJobNumber,
            driverId,
            tenantId: booking.tenantId,
          });
          const { notifyJobStatusChange } = await import('../utils/notifications');
          await notifyJobStatusChange(
            job.id,
            job.erpJobNumber,
            'routed',
            driverId,
            booking.tenantId,
            'driver'
          );
        } else {
          // If transition is not valid, just assign the driver and update travel emissions
          await jobRepo.update(job.id, {
            driverId: driverId,
            travelEmissions: travelEmissions,
          });
          // Notify driver of job assignment (status didn't change, so use assignment notification)
          const { notifyJobAssignment } = await import('../utils/notifications');
          await notifyJobAssignment(
            job.id,
            job.erpJobNumber,
            driverId,
            booking.tenantId
          );
        }
      } else {
        logger.warn('Job not found for booking', {
          bookingId: booking.id,
          jobId: booking.jobId,
        });
      }
    }

    return this.getBookingById(booking.id);
  }

  /**
   * Check if a Job ID (erpJobNumber) is unique
   * Returns true if unique, false if duplicate exists
   * Optimized: Runs both queries in parallel for faster response
   */
  async isJobIdUnique(erpJobNumber: string, excludeBookingId?: string): Promise<boolean> {
    const trimmedJobNumber = erpJobNumber.trim();
    
    if (!trimmedJobNumber) {
      return false;
    }

    // Run both queries in parallel for faster response
    const whereClause: any = { erpJobNumber: trimmedJobNumber };
    if (excludeBookingId) {
      whereClause.id = { not: excludeBookingId };
    }

    const [existingJob, existingBooking] = await Promise.all([
      prisma.job.findUnique({
        where: { erpJobNumber: trimmedJobNumber },
        select: { id: true },
      }),
      prisma.booking.findFirst({
        where: whereClause,
        select: { id: true },
      }),
    ]);

    // Return false if either exists
    return !existingJob && !existingBooking;
  }

  /**
   * Approve a pending booking (change from pending to created)
   */
  async approveBooking(bookingId: string, approvedBy: string, erpJobNumber: string, notes?: string) {
    const booking = await this.getBookingById(bookingId);

    if (booking.status !== 'pending') {
      throw new ValidationError(
        `Cannot approve booking in "${booking.status}" status. Only "pending" bookings can be approved.`
      );
    }

    // Validate that the Job ID is unique
    const isUnique = await this.isJobIdUnique(erpJobNumber, bookingId);
    if (!isUnique) {
      throw new ValidationError(
        `Job ID "${erpJobNumber.trim()}" already exists. Please enter a unique Job ID.`
      );
    }

    // Update booking with ERP Job Number before approving
    await prisma.booking.update({
      where: { id: bookingId },
      data: { erpJobNumber: erpJobNumber.trim() },
    });

    const updatedBooking = await this.updateStatus(bookingId, 'created', approvedBy, notes || 'Booking approved by admin');

    // Create job with status 'booked' when booking is approved (if job doesn't exist)
    // Use updatedBooking.erpJobNumber (which was just set) instead of booking.erpJobNumber
    if (!updatedBooking.jobId && updatedBooking.erpJobNumber) {
      const jobRepo = new JobRepository();
      const existingJob = await jobRepo.findByBookingId(updatedBooking.id);
      
      if (!existingJob) {
        // Calculate travel emissions from booking's round trip distance and preferred vehicle fuel type
        // Use updatedBooking's preferredVehicleType (fuel type: petrol/diesel/electric) if available
        // Default vehicle type is "Van" (0.24 kg/km), but if fuel type is specified, use that fuel type's emission factor
        // If no fuel type specified, default to Van's emission factor
        const vehicleFuelType = updatedBooking.preferredVehicleType || 'van'; // Default to 'van' (0.24 kg/km) if not specified
        // Use 0 if distance is not available (instead of defaulting to 80km)
        // This allows proper error handling when distance calculation failed
        const roundTripDistanceKm = (updatedBooking.roundTripDistanceKm && updatedBooking.roundTripDistanceKm > 0)
          ? updatedBooking.roundTripDistanceKm
          : 0;
        const travelEmissions = calculateTravelEmissions(roundTripDistanceKm, vehicleFuelType);

        // Create job with status 'booked'
        // Use updatedBooking.erpJobNumber which contains the manually entered Job ID
        const job = await jobRepo.create({
          erpJobNumber: updatedBooking.erpJobNumber,
          bookingId: updatedBooking.id,
          tenantId: updatedBooking.tenantId,
          clientName: updatedBooking.client.name,
          siteName: updatedBooking.siteName,
          siteAddress: updatedBooking.siteAddress,
          status: 'booked',
          scheduledDate: updatedBooking.scheduledDate,
          co2eSaved: updatedBooking.estimatedCO2e,
          travelEmissions: travelEmissions, // Calculate from booking's round trip distance and preferred vehicle type
          buybackValue: updatedBooking.estimatedBuyback,
          charityPercent: updatedBooking.charityPercent,
        });

        // Create job assets from booking assets
        for (const bookingAsset of updatedBooking.assets) {
          await prisma.jobAsset.create({
            data: {
              jobId: job.id,
              categoryId: bookingAsset.categoryId,
              categoryName: bookingAsset.categoryName,
              quantity: bookingAsset.quantity,
            },
          });
        }

        // Add status history
        await jobRepo.addStatusHistory(job.id, {
          status: 'booked',
          changedBy: approvedBy,
          notes: 'Job created when booking was approved',
        });

        // Link job to booking
        await bookingRepo.update(updatedBooking.id, {
          jobId: job.id,
        });
      }
    }

    return updatedBooking;
  }

  /**
   * Update booking status
   */
  async updateStatus(
    bookingId: string,
    newStatus: BookingStatus,
    changedBy: string,
    notes?: string
  ) {
    const booking = await this.getBookingById(bookingId);

    if (!isValidBookingTransition(booking.status, newStatus)) {
      throw new ValidationError(
        `Invalid status transition from "${booking.status}" to "${newStatus}"`
      );
    }

    // Update booking with appropriate timestamp
    const updateData: any = { status: newStatus };
    if (newStatus === 'scheduled' && !booking.scheduledAt) {
      updateData.scheduledAt = new Date();
    } else if (newStatus === 'collected' && !booking.collectedAt) {
      updateData.collectedAt = new Date();
    } else if (newStatus === 'sanitised' && !booking.sanitisedAt) {
      updateData.sanitisedAt = new Date();
    } else if (newStatus === 'graded' && !booking.gradedAt) {
      updateData.gradedAt = new Date();
    } else if (newStatus === 'completed' && !booking.completedAt) {
      updateData.completedAt = new Date();
    }

    await bookingRepo.update(booking.id, updateData);

    // Add status history
    await bookingRepo.addStatusHistory(booking.id, {
      status: newStatus,
      changedBy,
      notes,
    });

    // Resolve the actual client user (invited client) if one exists, based on the Client record's email.
    const clientUserForStatus = booking.client?.email
      ? await prisma.user.findFirst({
          where: {
            tenantId: booking.tenantId,
            email: booking.client.email,
            role: 'client',
          },
        })
      : null;
    const clientStatusUserId = clientUserForStatus?.id || booking.createdBy;

    // Notify client/reseller of booking status change
    // Note: We don't notify here if the status change is triggered by job status change
    // (to avoid duplicate notifications). Only notify for admin-initiated booking status changes.
    // For job-initiated changes, notification is handled in job.service.ts
    // Also, don't notify for 'scheduled' status when driver is assigned (handled separately in assignDriver)
    // Don't notify for 'completed' status - it will be handled by job.service.ts when job status is updated
    // Don't notify for 'sanitised' and 'graded' status here - they will be handled by job.service.ts when job status is updated
    if (newStatus !== 'scheduled' && newStatus !== 'completed' && newStatus !== 'sanitised' && newStatus !== 'graded') {
      const { notifyBookingStatusChange } = await import('../utils/notifications');
      // Notify the booking creator (client or reseller)
      await notifyBookingStatusChange(
        booking.id,
        booking.bookingNumber,
        newStatus,
        clientStatusUserId,
        booking.tenantId
      );

      // Additionally, for important status changes, notify the reseller linked to this booking
      // Important for reseller: booking approved ('created') and booking cancelled ('cancelled')
      const resellerUserId = booking.resellerId || booking.client?.resellerId;
      if (resellerUserId && resellerUserId !== clientStatusUserId && (newStatus === 'created' || newStatus === 'cancelled')) {
        await notifyBookingStatusChange(
          booking.id,
          booking.bookingNumber,
          newStatus,
          resellerUserId,
          booking.tenantId
        );
      }
    }

    // Notify driver if booking has a driver assigned and status change is admin-initiated
    if (booking.driverId && newStatus === 'scheduled') {
      const { notifyJobStatusChange } = await import('../utils/notifications');
      const jobRepo = new JobRepository();
      const job = booking.jobId 
        ? await jobRepo.findById(booking.jobId)
        : await jobRepo.findByBookingId(booking.id);
      
      if (job) {
        // Map booking status 'scheduled' to job status 'routed' for notification
        await notifyJobStatusChange(
          job.id,
          job.erpJobNumber,
          'routed',
          booking.driverId,
          booking.tenantId,
          'driver'
        );
      }
    }

    // If booking is graded, notify admins for final approval
    if (newStatus === 'graded') {
      const adminUsers = await prisma.user.findMany({
        where: {
          tenantId: booking.tenantId,
          role: 'admin',
          status: 'active',
          isSuperAdmin: false, // Exclude super admins from notifications
        },
        select: { id: true },
      });
      if (adminUsers.length > 0) {
        const { notifyGradedForApproval } = await import('../utils/notifications');
        await notifyGradedForApproval(
          booking.id,
          booking.bookingNumber,
          adminUsers.map(u => u.id),
          booking.tenantId
        );
      }
    }

    // Sync job status when booking status changes
    // Find job by bookingId (jobId might not be set yet)
    const jobRepo = new JobRepository();
    const job = booking.jobId 
      ? await jobRepo.findById(booking.jobId)
      : await jobRepo.findByBookingId(booking.id);
    
    if (job) {
        // Map booking status to job status
        let targetJobStatus: JobStatus | null = null;

        // Map booking statuses to job statuses
        if (newStatus === 'created') {
          // Booking created means job should be 'booked'
          targetJobStatus = 'booked';
        } else if (newStatus === 'scheduled') {
          // Booking scheduled means job is routed (driver assigned)
          targetJobStatus = 'routed';
        } else if (newStatus === 'collected') {
          // Booking collected - job should be "collected" or "warehouse"
          // If job is already at warehouse or beyond, keep it; otherwise set to collected
          if (['warehouse', 'sanitised', 'graded', 'completed'].includes(job.status)) {
            // Don't update - job is already ahead
            targetJobStatus = null;
          } else {
            targetJobStatus = 'collected';
          }
        } else if (newStatus === 'sanitised') {
          targetJobStatus = 'sanitised';
        } else if (newStatus === 'graded') {
          targetJobStatus = 'graded';
        } else if (newStatus === 'completed') {
          targetJobStatus = 'completed';
        } else if (newStatus === 'cancelled') {
          targetJobStatus = 'cancelled';
        }

        // Update job status if it's different and the transition is valid
        // Use JobService.updateStatus to ensure notifications are sent
        if (targetJobStatus && job.status !== targetJobStatus) {
          if (isValidJobTransition(job.status, targetJobStatus)) {
            const { JobService } = await import('./job.service');
            const jobService = new JobService();
            await jobService.updateStatus(
              job.id,
              targetJobStatus,
              changedBy,
              `Updated from booking status: ${newStatus}`
            );
          }
        }
      }

    return this.getBookingById(booking.id);
  }
}
