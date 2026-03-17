// Job Service

import { JobRepository } from '../repositories/job.repository';
import { BookingRepository } from '../repositories/booking.repository';
import { isValidJobTransition, isValidJobTransitionForType, isValidBookingTransitionForType } from '../middleware/workflow';
import { ValidationError, NotFoundError } from '../utils/errors';
import { JobStatus } from '../types';
import { BookingStatus } from '@prisma/client';
import { calculateTravelEmissions } from '../utils/co2';
import prisma from '../config/database';

const jobRepo = new JobRepository();
const bookingRepo = new BookingRepository();

export class JobService {
  /**
   * Create job from booking (when driver assigned)
   * If job already exists (created when booking was approved), update it to 'routed' and assign driver
   */
  async createJobFromBooking(bookingId: string, driverId: string, vehicleId?: string) {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    if (!booking.erpJobNumber) {
      throw new ValidationError('Booking must have ERP job number before creating job');
    }

    const driver = await prisma.user.findUnique({
      where: { id: driverId },
      include: { 
        vehicleDrivers: {
          include: {
            vehicle: true,
          },
        },
      },
    });

    if (!driver || driver.role !== 'driver') {
      throw new NotFoundError('Driver', driverId);
    }

    // Get the specific vehicle if provided, otherwise use the first vehicle assigned to the driver
    let selectedVehicle = null;
    if (vehicleId) {
      // Find the specific vehicle from the driver's vehicles
      const vehicleDriver = driver.vehicleDrivers?.find(vd => vd.vehicleId === vehicleId);
      selectedVehicle = vehicleDriver?.vehicle;
      
      if (!selectedVehicle) {
        throw new ValidationError(`Vehicle ${vehicleId} is not assigned to driver ${driverId}`);
      }
    } else {
      // Use the first vehicle if no specific vehicle is provided
      selectedVehicle = driver.vehicleDrivers?.[0]?.vehicle;
    }
    
    const vehicleFuelType = selectedVehicle?.vehicleFuelType || booking.preferredVehicleType || 'van';
    // Use 0 if distance is not available (instead of defaulting to 80km)
    // This allows proper error handling when distance calculation failed
    const roundTripDistanceKm = (booking.roundTripDistanceKm && booking.roundTripDistanceKm > 0) 
      ? booking.roundTripDistanceKm 
      : 0;
    const travelEmissions = calculateTravelEmissions(roundTripDistanceKm, vehicleFuelType);

    let job: any = await jobRepo.findByBookingId(booking.id);

    if (job) {
      // Job already exists - update it to 'routed', assign driver, and update travel emissions
      let statusChanged = false;
      if (isValidJobTransition(job.status, 'routed')) {
        await jobRepo.update(job.id, {
          status: 'routed',
          driverId: driverId,
          travelEmissions: travelEmissions, // Update travel emissions when driver is assigned
        });

        await jobRepo.addStatusHistory(job.id, {
          status: 'routed',
          changedBy: driverId,
          notes: 'Driver assigned - job moved to routed status',
        });
        statusChanged = true;
      } else {
        // If transition is not valid, just assign the driver and update travel emissions
        await jobRepo.update(job.id, {
          driverId: driverId,
          travelEmissions: travelEmissions, // Update travel emissions when driver is assigned
        });
      }
      
      // Notify driver - use status change notification if status changed, otherwise use assignment notification
      if (statusChanged) {
        const { logger } = await import('../utils/logger');
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
        // Status didn't change, so use assignment notification
        const { logger } = await import('../utils/logger');
        logger.info('Job status unchanged, sending assignment notification to driver', {
          jobId: job.id,
          jobNumber: job.erpJobNumber,
          driverId,
          tenantId: booking.tenantId,
          currentStatus: job.status,
        });
        const { notifyJobAssignment } = await import('../utils/notifications');
        await notifyJobAssignment(
          job.id,
          job.erpJobNumber,
          driverId,
          booking.tenantId
        );
      }
    } else {
      // Create new job with status 'routed'
      job = await jobRepo.create({
        erpJobNumber: booking.erpJobNumber!,
        bookingId: booking.id,
        tenantId: booking.tenantId,
        clientName: booking.client.name,
        siteName: booking.siteName,
        siteAddress: booking.siteAddress,
        status: 'routed', // Job starts as 'routed' when driver assigned
        scheduledDate: booking.scheduledDate,
        co2eSaved: booking.estimatedCO2e,
        travelEmissions: travelEmissions, // Calculate from booking's round trip distance and driver's vehicle type
        buybackValue: booking.estimatedBuyback,
        charityPercent: booking.charityPercent,
        driverId: driverId,
      });

      for (const bookingAsset of booking.assets) {
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
        status: 'routed',
        changedBy: driverId,
        notes: 'Job created from booking',
      });

      // Link job to booking
      await bookingRepo.update(booking.id, {
        jobId: job.id,
      });
      
      // Notify driver of job status change (routed) for newly created job
        const { logger } = await import('../utils/logger');
        logger.info('New job created, sending notification to driver', {
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
    }

    return this.getJobById(job.id);
  }

  /**
   * Get job by ID
   */
  async getJobById(id: string) {
    const job = await jobRepo.findById(id);
    if (!job) {
      throw new NotFoundError('Job', id);
    }
    return job;
  }

  /**
   * Get jobs with filters and pagination
   */
  async getJobs(filters: {
    tenantId: string;
    userId: string;
    userRole: string;
    status?: JobStatus;
    clientName?: string;
    clientId?: string;
    searchQuery?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = filters.limit || 20;
    const offset = filters.offset || 0;

    // Role-based filtering
    if (filters.userRole === 'admin') {
      // Admins should see all jobs across all tenants (no tenantId filter)
      const where: any = {};
      if (filters.status) {
        where.status = filters.status;
      }
      if (filters.clientName) {
        where.clientName = {
          contains: filters.clientName,
          mode: 'insensitive',
        };
      }
      if (filters.clientId) {
        where.booking = {
          clientId: filters.clientId,
        };
      }
      if (filters.searchQuery) {
        where.OR = [
          { clientName: { contains: filters.searchQuery, mode: 'insensitive' } },
          { erpJobNumber: { contains: filters.searchQuery, mode: 'insensitive' } },
          { siteName: { contains: filters.searchQuery, mode: 'insensitive' } },
          { siteAddress: { contains: filters.searchQuery, mode: 'insensitive' } },
        ];
      }

      const [data, total] = await Promise.all([
        prisma.job.findMany({
        where,
          select: {
            id: true,
            erpJobNumber: true,
            bookingId: true,
            tenantId: true,
            clientName: true,
            siteName: true,
            siteAddress: true,
            status: true,
            scheduledDate: true,
            completedDate: true,
            estimatedArrival: true,
            co2eSaved: true,
            travelEmissions: true,
            buybackValue: true,
            charityPercent: true,
            driverId: true,
            dial2Collection: true,
            securityRequirements: true,
            idRequired: true,
            loadingBayLocation: true,
            vehicleHeightRestrictions: true,
            doorLiftSize: true,
            roadWorksPublicEvents: true,
            manualHandlingRequirements: true,
            createdAt: true,
            updatedAt: true,
          booking: {
              select: {
                id: true,
                bookingNumber: true,
                bookingType: true,
                jmlSubType: true,
                client: {
                  select: {
                    id: true,
                    name: true,
                    organisationName: true,
                  },
                },
                site: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    postcode: true,
                  },
                },
                roundTripDistanceKm: true,
                roundTripDistanceMiles: true,
                statusHistory: {
                  select: {
                    id: true,
                    status: true,
                    notes: true,
                    createdAt: true,
                  },
                  orderBy: { createdAt: 'desc' },
                },
              },
          },
          assets: {
              select: {
                id: true,
                categoryId: true,
                categoryName: true,
                quantity: true,
                serialNumbers: true,
                grade: true,
                weight: true,
                sanitised: true,
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
          driver: {
              select: {
                id: true,
                name: true,
                email: true,
                driverProfile: {
                  select: {
                    phone: true,
                  },
                },
                vehicleDrivers: {
                  select: {
                    vehicle: {
                      select: {
                        vehicleReg: true,
                        vehicleType: true,
                        vehicleFuelType: true,
                      },
                    },
                  },
                },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.job.count({ where }),
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
    } else if (filters.userRole === 'driver') {
      const excludedStatuses = ['warehouse', 'sanitised', 'graded', 'completed'];
      const where: any = {
        driverId: filters.userId,
        booking: {
          bookingType: 'itad_collection', // Drivers only see ITAD collection jobs, not JML jobs
        },
      };
      
      // Check if requesting history jobs (warehouse+ statuses)
      // If status filter includes warehouse+ statuses, allow them (for history page)
      const isHistoryRequest = filters.status && excludedStatuses.includes(filters.status);
      
      if (isHistoryRequest) {
        // For history page: include warehouse+ statuses for ITAD collection jobs
        // Drivers only see ITAD collection jobs, so we only need ITAD statuses
        where.status = { in: excludedStatuses };
      } else if (filters.status && !excludedStatuses.includes(filters.status)) {
        // Specific active status filter
        where.status = filters.status;
      } else {
        // Default: exclude warehouse+ statuses for active jobs list
        where.status = {
          notIn: excludedStatuses,
        };
      }
      
      const [data, total] = await Promise.all([
        prisma.job.findMany({
          where,
          select: {
            id: true,
            erpJobNumber: true,
            bookingId: true,
            tenantId: true,
            clientName: true,
            siteName: true,
            siteAddress: true,
            status: true,
            scheduledDate: true,
            completedDate: true,
            estimatedArrival: true,
            co2eSaved: true,
            travelEmissions: true,
            buybackValue: true,
            charityPercent: true,
            createdAt: true,
            updatedAt: true,
            booking: {
              select: {
                id: true,
                bookingNumber: true,
                bookingType: true,
                jmlSubType: true,
                client: {
                  select: {
                    id: true,
                    name: true,
                    organisationName: true,
                  },
                },
                site: {
                  select: {
                    id: true,
                    name: true,
                    address: true,
                    postcode: true,
                  },
                },
                roundTripDistanceKm: true,
                roundTripDistanceMiles: true,
              },
            },
            assets: {
              select: {
                id: true,
                categoryId: true,
                categoryName: true,
                quantity: true,
                serialNumbers: true,
                grade: true,
                weight: true,
                sanitised: true,
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
            driver: {
              select: {
                id: true,
                name: true,
                email: true,
                driverProfile: {
                  select: {
                    phone: true,
                  },
                },
                vehicleDrivers: {
                  select: {
                    vehicle: {
                      select: {
                        vehicleReg: true,
                        vehicleType: true,
                        vehicleFuelType: true,
                      },
                    },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.job.count({ where }),
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
      // Clients see jobs for their bookings (bookings for their Client record(s) or bookings they created)
      // First, find the Client record(s) associated with this user (by email and tenantId)
      const user = await prisma.user.findUnique({
        where: { id: filters.userId },
        select: { email: true },
      });
      
      if (!user) {
        return [];
      }
      
      // Find all Client records with matching email and tenantId
      const clientRecords = await prisma.client.findMany({
        where: {
          email: user.email,
          tenantId: filters.tenantId,
        },
        select: { id: true },
      });
      
      const clientIds = clientRecords.map(c => c.id);
      
      // Get bookings for these Client records OR bookings they created themselves
      // Exclude pending bookings - they should not appear in jobs list
      const bookingWhere: any = {
        tenantId: filters.tenantId,
        status: { not: 'pending' }, // Exclude pending bookings
        OR: [
          { clientId: { in: clientIds } },
          { createdBy: filters.userId },
        ],
      };
      
      // Add clientId filter if provided
      if (filters.clientId) {
        bookingWhere.clientId = filters.clientId;
      }
      
      const bookings = await prisma.booking.findMany({
        where: bookingWhere,
        select: { id: true },
      });
      
      const bookingIds = bookings.map(b => b.id);
      
      if (bookingIds.length === 0) {
        return {
          data: [],
          pagination: {
            page: 1,
            limit,
            total: 0,
            totalPages: 0,
          },
        };
      }
      
      const where = {
          tenantId: filters.tenantId,
          bookingId: { in: bookingIds },
          ...(filters.status ? { status: filters.status } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.job.findMany({
          where,
          select: {
            id: true,
            erpJobNumber: true,
            bookingId: true,
            tenantId: true,
            clientName: true,
            siteName: true,
            siteAddress: true,
            status: true,
            scheduledDate: true,
            completedDate: true,
            estimatedArrival: true,
            co2eSaved: true,
            travelEmissions: true,
            buybackValue: true,
            charityPercent: true,
            driverId: true,
            dial2Collection: true,
            securityRequirements: true,
            idRequired: true,
            loadingBayLocation: true,
            vehicleHeightRestrictions: true,
            doorLiftSize: true,
            roadWorksPublicEvents: true,
            manualHandlingRequirements: true,
            createdAt: true,
            updatedAt: true,
          booking: {
              select: {
                id: true,
                bookingNumber: true,
                bookingType: true,
                jmlSubType: true,
                client: {
                  select: {
                    id: true,
                    name: true,
                    organisationName: true,
                  },
                },
                roundTripDistanceKm: true,
                roundTripDistanceMiles: true,
                statusHistory: {
                  select: {
                    id: true,
                    status: true,
                    notes: true,
                    createdAt: true,
                  },
                  orderBy: { createdAt: 'desc' },
                },
              },
          },
          assets: {
              select: {
                id: true,
                categoryId: true,
                categoryName: true,
                quantity: true,
                serialNumbers: true,
                grade: true,
                weight: true,
                sanitised: true,
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
          driver: {
              select: {
                id: true,
                name: true,
                email: true,
                driverProfile: {
                  select: {
                    phone: true,
                  },
                },
                vehicleDrivers: {
                  select: {
                    vehicle: {
                      select: {
                        vehicleReg: true,
                        vehicleType: true,
                        vehicleFuelType: true,
                      },
                    },
                  },
                },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.job.count({ where }),
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
      // Resellers see jobs for their clients' bookings
      const bookingFilters: any = {};
      if (filters.clientId) {
        bookingFilters.clientId = filters.clientId;
      }
      const bookings = await bookingRepo.findByReseller(filters.userId, bookingFilters);
      const bookingIds = bookings.map(b => b.id);
      
      if (bookingIds.length === 0) {
        return {
          data: [],
          pagination: {
            page: 1,
            limit,
            total: 0,
            totalPages: 0,
          },
        };
      }

      const where = {
          tenantId: filters.tenantId,
          bookingId: { in: bookingIds },
        ...(filters.status ? { status: filters.status } : {}),
      };

      const [data, total] = await Promise.all([
        prisma.job.findMany({
          where,
          select: {
            id: true,
            erpJobNumber: true,
            bookingId: true,
            tenantId: true,
            clientName: true,
            siteName: true,
            siteAddress: true,
            status: true,
            scheduledDate: true,
            completedDate: true,
            estimatedArrival: true,
            co2eSaved: true,
            travelEmissions: true,
            buybackValue: true,
            charityPercent: true,
            driverId: true,
            dial2Collection: true,
            securityRequirements: true,
            idRequired: true,
            loadingBayLocation: true,
            vehicleHeightRestrictions: true,
            doorLiftSize: true,
            roadWorksPublicEvents: true,
            manualHandlingRequirements: true,
            createdAt: true,
            updatedAt: true,
          booking: {
              select: {
                id: true,
                bookingNumber: true,
                bookingType: true,
                jmlSubType: true,
                client: {
                  select: {
                    id: true,
                    name: true,
                    organisationName: true,
                  },
                },
                roundTripDistanceKm: true,
                roundTripDistanceMiles: true,
                statusHistory: {
                  select: {
                    id: true,
                    status: true,
                    notes: true,
                    createdAt: true,
                  },
                  orderBy: { createdAt: 'desc' },
                },
              },
          },
          assets: {
              select: {
                id: true,
                categoryId: true,
                categoryName: true,
                quantity: true,
                serialNumbers: true,
                grade: true,
                weight: true,
                sanitised: true,
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
          driver: {
              select: {
                id: true,
                name: true,
                email: true,
                driverProfile: {
                  select: {
                    phone: true,
                  },
                },
                vehicleDrivers: {
                  select: {
                    vehicle: {
                      select: {
                        vehicleReg: true,
                        vehicleType: true,
                        vehicleFuelType: true,
                      },
                    },
                  },
                },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.job.count({ where }),
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
    }

    return {
      data: [],
      pagination: {
        page: 1,
        limit,
        total: 0,
        totalPages: 0,
      },
    };
  }

  /**
   * Update job status
   */
  async updateStatus(
    jobId: string,
    newStatus: JobStatus,
    changedBy: string,
    notes?: string
  ) {
    const job = await this.getJobById(jobId);

    // Get booking type for type-specific validation
    let bookingType: 'itad_collection' | 'jml' = 'itad_collection';
    let jmlSubType = null;
    
    if (job.bookingId) {
      const booking = await bookingRepo.findById(job.bookingId);
      if (booking) {
        bookingType = booking.bookingType || 'itad_collection';
        jmlSubType = booking.jmlSubType;
        
        // If bookingType is 'jml' but jmlSubType is missing, this is an error
        if (bookingType === 'jml' && !jmlSubType) {
          const { logger } = await import('../utils/logger');
          logger.error('JML booking missing jmlSubType for job', {
            jobId,
            bookingId: job.bookingId,
            bookingType: booking.bookingType,
            jmlSubType: booking.jmlSubType,
          });
          throw new ValidationError(
            'Associated JML booking is missing jmlSubType. Please update the booking to include the JML sub-type.'
          );
        }
        
        // Debug logging to verify booking type is being read correctly
        const { logger } = await import('../utils/logger');
        logger.info('Job status update validation', {
          jobId,
          currentStatus: job.status,
          newStatus,
          bookingId: job.bookingId,
          bookingType,
          jmlSubType,
          bookingTypeFromDB: booking.bookingType,
          jmlSubTypeFromDB: booking.jmlSubType,
        });
      }
    }

    // Always use type-specific validation
    const isValid = isValidJobTransitionForType(
      job.status, 
      newStatus, 
      bookingType, 
      jmlSubType
    );

    if (!isValid) {
      const bookingTypeLabel = bookingType === 'jml' && jmlSubType
        ? `${bookingType} (${jmlSubType})`
        : bookingType;
      const { logger } = await import('../utils/logger');
      logger.warn('Invalid job status transition', {
        jobId,
        from: job.status,
        to: newStatus,
        bookingType,
        jmlSubType,
      });
      throw new ValidationError(
        `Invalid status transition from "${job.status}" to "${newStatus}" for booking type "${bookingTypeLabel}"`
      );
    }

    // Update job
    const updateData: any = { status: newStatus };
    if (newStatus === 'completed' && !job.completedDate) {
      updateData.completedDate = new Date();
    }

    // Calculate and store ETA when driver starts (status changes to en_route)
    // Only calculate once when status FIRST changes to 'en_route' (don't recalculate if already set)
    if (newStatus === 'en_route' && job.status !== 'en_route') {
      // Only calculate if ETA is not already set
      if (!job.estimatedArrival) {
        const booking = job.bookingId ? await bookingRepo.findById(job.bookingId) : null;
        const roundTripDistanceKm = booking?.roundTripDistanceKm ?? null;
        const oneWayDistanceKm = roundTripDistanceKm ? roundTripDistanceKm / 2 : null;
        
        if (oneWayDistanceKm && oneWayDistanceKm > 0) {
          // Calculate ETA = current time + estimated travel time
          const averageSpeedKmh = 40;
          const travelTimeMinutes = (oneWayDistanceKm / averageSpeedKmh) * 60;
          const now = new Date();
          const estimatedArrival = new Date(now.getTime() + travelTimeMinutes * 60 * 1000);
          updateData.estimatedArrival = estimatedArrival;
        } else if (job.scheduledDate) {
          // Fall back to scheduled time if distance not available
          updateData.estimatedArrival = job.scheduledDate;
        }
      }
    }

    await jobRepo.update(job.id, updateData);

    // Add status history
    await jobRepo.addStatusHistory(job.id, {
      status: newStatus,
      changedBy,
      notes,
    });

    // Notify driver of job status change (if driver is assigned and status is relevant)
    // According to requirements: Driver notified for warehouse only (NOT completed)
    if (job.driverId && newStatus === 'warehouse') {
      const { notifyJobStatusChange } = await import('../utils/notifications');
      await notifyJobStatusChange(
        job.id,
        job.erpJobNumber,
        newStatus,
        job.driverId,
        job.tenantId,
        'driver'
      );
    }

    // Notify client/reseller of booking status change when job status changes
    // Notify for all status changes that affect the client (and reseller, for important events)
        if (job.bookingId) {
      const booking = await bookingRepo.findById(job.bookingId);
      if (booking) {
        const { 
          notifyBookingStatusChange, 
          notifyDriverEnRoute, 
          notifyDriverArrived 
        } = await import('../utils/notifications');

        // Derive reseller userId from either booking.resellerId or the linked client.resellerId
        const resellerUserId = booking.resellerId || booking.client?.resellerId;

        // Resolve the actual client user (invited client) if one exists, based on the Client record's email.
        const clientUser = booking.client?.email
          ? await prisma.user.findFirst({
              where: {
                tenantId: booking.tenantId,
                email: booking.client.email,
                role: 'client',
              },
            })
          : null;
        const clientUserId = clientUser?.id || booking.createdBy;
        
        // Map job status to booking status and notify client
        if (newStatus === 'en_route') {
          // Notify client that driver is en route (special notification)
          await notifyDriverEnRoute(
            booking.id,
            booking.bookingNumber,
            clientUserId,
            booking.tenantId
          );
        } else if (newStatus === 'arrived') {
          // Notify client that driver has arrived (special notification)
          await notifyDriverArrived(
            booking.id,
            booking.bookingNumber,
            clientUserId,
            booking.tenantId
          );
        } else if (['collected', 'warehouse', 'sanitised', 'graded', 'completed'].includes(newStatus)) {
          // Generate Chain of Custody document when status becomes 'warehouse' (after assets delivered to warehouse)
          // Only generate once when status changes to 'warehouse'
          if (newStatus === 'warehouse') {
            try {
              const { DocumentService } = await import('./document.service');
              const documentService = new DocumentService();
              const documentId = await documentService.generateChainOfCustody(job.id, changedBy);
              const { logger } = await import('../utils/logger');
              logger.info('Chain of Custody document generated', { jobId: job.id, documentId });
            } catch (error: any) {
              // If document already exists, that's fine - just log it
              if (error?.message?.includes('already exists') || error?.message?.includes('skipping')) {
                const { logger } = await import('../utils/logger');
                logger.debug('Chain of Custody document already exists, skipping generation', { jobId: job.id });
              } else {
                // Log other errors but don't fail the status update
                const { logError } = await import('../utils/logger');
                logError('Failed to generate Chain of Custody document', error, { jobId: job.id });
              }
            }
          }

          // Handle different statuses with appropriate notifications
          if (newStatus === 'collected') {
            // Map job status 'collected' to booking status 'collected'
            // Only notify if booking status is different to prevent duplicate "Booking collected" notifications
            if (booking.status !== 'collected') {
              await notifyBookingStatusChange(
                booking.id,
                booking.bookingNumber,
                'collected',
                booking.createdBy,
                booking.tenantId
              );
              // Reseller does NOT receive 'collected' per requirements
            }
          } else if (newStatus === 'warehouse') {
            // For warehouse status, send a special notification about assets being delivered
            const { notifyAssetsDeliveredToWarehouse } = await import('../utils/notifications');
            // Notify client
            await notifyAssetsDeliveredToWarehouse(
              booking.id,
              booking.bookingNumber,
              clientUserId,
              booking.tenantId
            );
            // Notify reseller (important milestone) if linked and different from creator
            if (resellerUserId && resellerUserId !== clientUserId) {
              await notifyAssetsDeliveredToWarehouse(
                booking.id,
                booking.bookingNumber,
                resellerUserId,
                booking.tenantId
              );
            }
          } else {
            // For sanitised, graded, completed - map job status to booking status
            const bookingStatus = newStatus;
            // Always notify for these milestones (even if booking status hasn't changed yet)
            await notifyBookingStatusChange(
              booking.id,
              booking.bookingNumber,
              bookingStatus,
              clientUserId,
              booking.tenantId
            );

            // Additionally notify reseller for important milestones
            // Reseller important: graded, completed
            if (
              resellerUserId &&
              resellerUserId !== clientUserId &&
              (newStatus === 'graded' || newStatus === 'completed')
            ) {
              await notifyBookingStatusChange(
                booking.id,
                booking.bookingNumber,
                bookingStatus,
                resellerUserId,
                booking.tenantId
              );
            }
          }
        }
      }
    }

    if (['warehouse', 'sanitised', 'completed'].includes(newStatus)) {
      // Admins are global across tenants (can see all jobs), so don't filter by tenantId
      const adminUsers = await prisma.user.findMany({
        where: {
          role: 'admin',
          status: 'active',
          isSuperAdmin: false, // Exclude super admins from notifications
        },
        select: { id: true },
      });

      const { logger } = await import('../utils/logger');
      if (adminUsers.length > 0) {
        const { notifyJobStatusChange } = await import('../utils/notifications');
        // Notify each admin
        for (const admin of adminUsers) {
          await notifyJobStatusChange(
            job.id,
            job.erpJobNumber,
            newStatus,
            admin.id,
            job.tenantId,
            'admin'
          );
        }
      } else {
        logger.warn('No admin users found to notify for job status change', {
          jobId: job.id,
          jobNumber: job.erpJobNumber,
          newStatus,
        });
      }
    }

    // Sync booking status when job status changes
    if (job.bookingId) {
      const booking = await bookingRepo.findById(job.bookingId);
      if (booking) {
        const bookingType = booking.bookingType || 'itad_collection';
        const jmlSubType = booking.jmlSubType;
        
        // Map job status to booking status based on booking type
        let targetBookingStatus: BookingStatus | null = null;

        if (newStatus === 'collected') {
          targetBookingStatus = 'collected' as BookingStatus;
        } else if (newStatus === 'warehouse') {
          // For ITAD, Leaver, Mover, and Breakfix: warehouse → warehouse
          if (bookingType === 'itad_collection' || 
              (bookingType === 'jml' && (jmlSubType === 'leaver' || jmlSubType === 'mover' || jmlSubType === 'breakfix'))) {
            targetBookingStatus = 'warehouse' as BookingStatus;
          }
        } else if (newStatus === 'sanitised') {
          targetBookingStatus = 'sanitised' as BookingStatus;
        } else if (newStatus === 'graded') {
          targetBookingStatus = 'graded' as BookingStatus;
        } else if (newStatus === 'inventory') {
          // Leaver, Mover, Breakfix: job inventory → booking inventory
          if (bookingType === 'jml' && (jmlSubType === 'leaver' || jmlSubType === 'mover' || jmlSubType === 'breakfix')) {
            targetBookingStatus = 'inventory' as BookingStatus;
          }
        } else if (newStatus === 'arrived') {
          // For ITAD jobs: arrived → collected (legacy mapping)
          // JML jobs use courier-based workflows and don't use 'arrived' status
        } else if (newStatus === 'completed') {
          targetBookingStatus = 'completed' as BookingStatus;
        } else if (newStatus === 'cancelled') {
          targetBookingStatus = 'cancelled' as BookingStatus;
        }

        // Update booking status if it's different and the transition is valid
        if (targetBookingStatus && booking.status !== targetBookingStatus) {
          if (isValidBookingTransitionForType(booking.status, targetBookingStatus, bookingType, jmlSubType)) {
            const updateData: any = { status: targetBookingStatus };
            
            // Set appropriate timestamps
            if (targetBookingStatus === 'collected' && !booking.collectedAt) {
              updateData.collectedAt = new Date();
            // Note: warehouseAt field doesn't exist in schema, so we don't set a timestamp for warehouse status
            // The warehouse status itself indicates when assets reached the warehouse
            } else if (targetBookingStatus === 'sanitised' && !booking.sanitisedAt) {
              updateData.sanitisedAt = new Date();
            } else if (targetBookingStatus === 'graded' && !booking.gradedAt) {
              updateData.gradedAt = new Date();
            } else if (targetBookingStatus === 'delivered' && !booking.deliveryDate) {
              updateData.deliveryDate = new Date();
            } else if (targetBookingStatus === 'completed' && !booking.completedAt) {
              updateData.completedAt = new Date();
            }

            await bookingRepo.update(booking.id, updateData);
            await bookingRepo.addStatusHistory(booking.id, {
              status: targetBookingStatus,
              changedBy,
              notes: `Updated from job status: ${newStatus}`,
            });
          }
        }
      }
    }

    if (!job) {
      throw new Error('Failed to create or find job');
    }

    return this.getJobById(job.id);
  }

  /**
   * Update job evidence (driver uploads)
   * Evidence is immutable once submitted - can only be created, not updated
   * Each status requires separate evidence submission
   */
  async updateEvidence(jobId: string, data: {
    photos?: string[];
    signature?: string;
    sealNumbers?: string[];
    notes?: string;
    status: JobStatus; // Status for which evidence is being submitted
    uploadedBy: string;
  }) {
    const job = await this.getJobById(jobId);

    // Check if evidence already exists for this status
    // Using findFirst until Prisma Client is regenerated with the new unique constraint
    const existingEvidence = await prisma.evidence.findFirst({
      where: { 
        jobId: job.id,
        status: data.status,
      },
    });

    if (existingEvidence) {
      // Evidence is immutable - cannot be updated once submitted
      throw new ValidationError(`Evidence has already been submitted for status "${data.status}" and cannot be modified. Evidence is immutable for audit purposes.`);
    }

    // Log evidence data before saving (debug level)
    const { logger } = await import('../utils/logger');
    logger.debug('Saving evidence', {
      jobId: job.id,
      status: data.status,
      photosCount: Array.isArray(data.photos) ? data.photos.length : 0,
      hasSignature: !!data.signature,
      sealNumbersCount: Array.isArray(data.sealNumbers) ? data.sealNumbers.length : 0,
      uploadedBy: data.uploadedBy,
    });

    // Validate that evidence data exists - prevent empty evidence records
    // Import sanitization utilities
    const { sanitizeString, sanitizeStringArray } = await import('../utils/sanitize');
    
    const photos = Array.isArray(data.photos) ? data.photos.filter((p: any) => p && typeof p === 'string' && p.trim().length > 0) : [];
    const signature = (data.signature && typeof data.signature === 'string' && data.signature.trim().length > 0) ? data.signature : null;
    const sealNumbers = sanitizeStringArray(data.sealNumbers); // Sanitize seal numbers to prevent XSS
    const notes = (data.notes && typeof data.notes === 'string' && data.notes.trim().length > 0) ? sanitizeString(data.notes) : null;

    // Require at least one photo OR a signature to create evidence record
    if (photos.length === 0 && !signature) {
      throw new ValidationError('Evidence must include at least one photo or a customer signature. Cannot create empty evidence records.');
    }

    // Compress images before uploading/saving
    const { compressBase64Image, PHOTO_COMPRESSION_OPTIONS, SIGNATURE_COMPRESSION_OPTIONS } = await import('../utils/image-compression');
    
    // Compress photos
    let compressedPhotos: string[] = [];
    try {
      compressedPhotos = await Promise.all(
        photos.map(async (photo) => {
          // Only compress if it's a base64 data URL (new upload)
          if (photo.startsWith('data:')) {
            return await compressBase64Image(photo, PHOTO_COMPRESSION_OPTIONS);
          }
          // If already S3 URL or other format, return as-is
          return photo;
        })
      );
    } catch (error) {
      logger.warn('Failed to compress some photos, using originals', { error });
      compressedPhotos = photos; // Fallback to originals
    }

    // Compress signature
    let compressedSignature: string | null = signature;
    if (signature && signature.startsWith('data:')) {
      try {
        compressedSignature = await compressBase64Image(signature, SIGNATURE_COMPRESSION_OPTIONS);
      } catch (error) {
        logger.warn('Failed to compress signature, using original', { error });
        // Keep original if compression fails
      }
    }

    // Upload photos and signature to S3 if enabled, otherwise keep as base64
    let uploadedPhotos: string[] = compressedPhotos;
    let uploadedSignature: string | null = compressedSignature;

    const { uploadToS3, isS3Enabled } = await import('../utils/s3-storage');
    if (isS3Enabled()) {
      try {
        // Helper function to check if a string is already an S3 URL/key (not base64)
        const isS3Url = (url: string): boolean => {
          return url.startsWith('evidence/') || 
                 url.startsWith('documents/') ||
                 (url.startsWith('https://') && url.includes('.s3.') && url.includes('amazonaws.com')) ||
                 (url.startsWith('http://') && url.includes('.s3.') && url.includes('amazonaws.com'));
        };

        // Upload photos to S3 (only if they're base64, skip if already S3 URLs)
        if (compressedPhotos.length > 0) {
          const photoUploads = await Promise.all(
            compressedPhotos.map(async (photo, index) => {
              // Skip upload if already an S3 URL/key
              if (isS3Url(photo)) {
                return photo;
              }

              // Only upload base64 data URLs
              if (!photo.startsWith('data:')) {
                // Not base64 and not S3 URL - might be local path, return as is
                return photo;
              }

              // Extract MIME type from base64 data URL
              const mimeMatch = photo.match(/data:([^;]+);base64,/);
              const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
              const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
              
              const uploadResult = await uploadToS3({
                file: photo,
                fileName: `${job.id}-photo-${index + 1}.${ext}`,
                folder: 'evidence/photos',
                contentType: mimeType,
                isBase64: true,
              });
              
              return uploadResult.url;
            })
          );
          uploadedPhotos = photoUploads;
        }

        // Upload signature to S3 (only if it's base64, skip if already S3 URL)
        if (compressedSignature) {
          // Skip upload if already an S3 URL/key
          if (!isS3Url(compressedSignature)) {
            // Only upload if it's a base64 data URL
            if (compressedSignature.startsWith('data:')) {
              const mimeMatch = compressedSignature.match(/data:([^;]+);base64,/);
              const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
              const ext = mimeType === 'image/png' ? 'png' : 'jpg';
              
              const signatureUpload = await uploadToS3({
                file: compressedSignature,
                fileName: `${job.id}-signature.${ext}`,
                folder: 'evidence/signatures',
                contentType: mimeType,
                isBase64: true,
              });
              
              uploadedSignature = signatureUpload.url;
            }
            // If not base64 and not S3 URL (e.g., local path), keep as is
          }
          // If already S3 URL, keep as is
        }
      } catch (error) {
        logger.error('Failed to upload evidence to S3, falling back to original storage', {
          error,
          jobId: job.id,
        });
        // Fallback to compressed values if S3 upload fails (still use compressed versions)
        uploadedPhotos = compressedPhotos;
        uploadedSignature = compressedSignature;
      }
    }

    // Create new evidence for this status (using cleaned/validated data)
    const createdEvidence = await prisma.evidence.create({
      data: {
        jobId: job.id,
        status: data.status,
        uploadedBy: data.uploadedBy,
        photos: uploadedPhotos,
        signature: uploadedSignature,
        sealNumbers: sealNumbers,
        notes: notes,
      },
    });

    // Log created evidence
    logger.info('Evidence created', {
      id: createdEvidence.id,
      jobId: createdEvidence.jobId,
      status: createdEvidence.status,
      photosCount: createdEvidence.photos.length,
      hasSignature: !!createdEvidence.signature,
      sealNumbersCount: createdEvidence.sealNumbers.length,
    });

    return this.getJobById(job.id);
  }

  /**
   * Update driver journey fields (for routed status)
   * These fields are entered by the driver before starting the journey
   * All fields are required
   */
  async updateJourneyFields(jobId: string, data: {
    dial2Collection?: string;
    securityRequirements?: string;
    idRequired?: string;
    loadingBayLocation?: string;
    vehicleHeightRestrictions?: string;
    doorLiftSize?: string;
    roadWorksPublicEvents?: string;
    manualHandlingRequirements?: string;
  }) {
    const job = await this.getJobById(jobId);

    // Only allow updating journey fields when job is in 'routed' status
    if (job.status !== 'routed') {
      throw new ValidationError(
        `Journey fields can only be updated when job is in 'routed' status. Current status: "${job.status}"`
      );
    }

    // Validate that all required fields are provided and not empty
    const requiredFields = [
      { name: 'dial2Collection', value: data.dial2Collection, label: 'DIAL 2 Collection' },
      { name: 'securityRequirements', value: data.securityRequirements, label: 'Security Requirements' },
      { name: 'idRequired', value: data.idRequired, label: 'ID Required' },
      { name: 'loadingBayLocation', value: data.loadingBayLocation, label: 'Loading Bay Location' },
      { name: 'vehicleHeightRestrictions', value: data.vehicleHeightRestrictions, label: 'Vehicle Height Restrictions' },
      { name: 'doorLiftSize', value: data.doorLiftSize, label: 'Door & Lift Size' },
      { name: 'roadWorksPublicEvents', value: data.roadWorksPublicEvents, label: 'Road Works / Public Events' },
      { name: 'manualHandlingRequirements', value: data.manualHandlingRequirements, label: 'Manual Handling Requirements' },
    ];

    const missingFields = requiredFields
      .filter(field => !field.value || (typeof field.value === 'string' && field.value.trim() === ''))
      .map(field => field.label);

    if (missingFields.length > 0) {
      throw new ValidationError(
        `All journey fields are required. Missing: ${missingFields.join(', ')}`
      );
    }

    // Import sanitization utilities
    const { sanitizeString } = await import('../utils/sanitize');

    // Update job with journey fields (sanitize and trim whitespace from all fields)
    await jobRepo.update(job.id, {
      dial2Collection: data.dial2Collection ? sanitizeString(data.dial2Collection.trim()) : undefined,
      securityRequirements: data.securityRequirements ? sanitizeString(data.securityRequirements.trim()) : undefined,
      idRequired: data.idRequired ? sanitizeString(data.idRequired.trim()) : undefined,
      loadingBayLocation: data.loadingBayLocation ? sanitizeString(data.loadingBayLocation.trim()) : undefined,
      vehicleHeightRestrictions: data.vehicleHeightRestrictions ? sanitizeString(data.vehicleHeightRestrictions.trim()) : undefined,
      doorLiftSize: data.doorLiftSize ? sanitizeString(data.doorLiftSize.trim()) : undefined,
      roadWorksPublicEvents: data.roadWorksPublicEvents ? sanitizeString(data.roadWorksPublicEvents.trim()) : undefined,
      manualHandlingRequirements: data.manualHandlingRequirements ? sanitizeString(data.manualHandlingRequirements.trim()) : undefined,
    });

    return this.getJobById(job.id);
  }

  /**
   * Re-assign driver to a job (admin only)
   * Only allowed if job status is 'routed' (not 'en_route' or later)
   */
  async reassignDriver(jobId: string, newDriverId: string, changedBy: string, vehicleId?: string) {
    const job = await jobRepo.findById(jobId);
    if (!job) {
      throw new NotFoundError('Job', jobId);
    }

    // Only allow re-assignment if job status is 'routed'
    if (job.status !== 'routed') {
      throw new ValidationError(
        `Cannot re-assign driver. Job status must be 'routed' to re-assign. Current status: ${job.status}`
      );
    }

    // Verify new driver exists and is a driver
    const newDriver = await prisma.user.findUnique({
      where: { id: newDriverId },
      include: { 
        vehicleDrivers: {
          include: {
            vehicle: true,
          },
        },
      },
    });

    if (!newDriver || newDriver.role !== 'driver') {
      throw new NotFoundError('Driver', newDriverId);
    }

    // Verify driver has at least one vehicle allocated
    if (!newDriver.vehicleDrivers || newDriver.vehicleDrivers.length === 0) {
      throw new ValidationError('Cannot assign driver without an allocated vehicle');
    }

    // Get the specific vehicle if provided, otherwise use the first vehicle assigned to the driver
    let selectedVehicle = null;
    if (vehicleId) {
      // Find the specific vehicle from the driver's vehicles
      const vehicleDriver = newDriver.vehicleDrivers.find(vd => vd.vehicleId === vehicleId);
      selectedVehicle = vehicleDriver?.vehicle;
      
      if (!selectedVehicle) {
        throw new ValidationError(`Vehicle ${vehicleId} is not assigned to driver ${newDriverId}`);
      }
    } else {
      // Use the first vehicle if no specific vehicle is provided
      selectedVehicle = newDriver.vehicleDrivers[0]?.vehicle;
    }

    // Recalculate travel emissions based on the selected vehicle
    const booking = job.booking;
    const vehicleFuelType = selectedVehicle?.vehicleFuelType || booking?.preferredVehicleType || 'diesel';
    const roundTripDistanceKm = booking?.roundTripDistanceKm && booking.roundTripDistanceKm > 0
      ? booking.roundTripDistanceKm
      : 0;
    const { calculateTravelEmissions } = await import('../utils/co2');
    const travelEmissions = calculateTravelEmissions(roundTripDistanceKm, vehicleFuelType);

    // Get old driver ID for notification
    const oldDriverId = job.driverId;

    // Update job with new driver and recalculated travel emissions
    await jobRepo.update(job.id, {
      driverId: newDriverId,
      travelEmissions: travelEmissions,
    });

    // Add status history
    await jobRepo.addStatusHistory(job.id, {
      status: job.status,
      changedBy: changedBy,
      notes: `Driver re-assigned from ${job.driver?.name || 'previous driver'} to ${newDriver.name}`,
    });

    // Notify new driver
    const { notifyJobStatusChange } = await import('../utils/notifications');
    await notifyJobStatusChange(
      job.id,
      job.erpJobNumber,
      job.status,
      newDriverId,
      job.tenantId,
      'driver'
    );

    // Notify old driver if different
    if (oldDriverId && oldDriverId !== newDriverId) {
      await notifyJobStatusChange(
        job.id,
        job.erpJobNumber,
        'cancelled', // Use cancelled status to indicate job was removed
        oldDriverId,
        job.tenantId,
        'driver'
      );
    }

    return this.getJobById(job.id);
  }

  /**
   * Unassign driver from a job (admin only)
   * Only allowed if job status is 'routed' (not 'en_route' or later)
   */
  async unassignDriver(jobId: string, changedBy: string) {
    const job = await jobRepo.findById(jobId);
    if (!job) {
      throw new NotFoundError('Job', jobId);
    }

    // Only allow un-assignment if job status is 'routed'
    if (job.status !== 'routed') {
      throw new ValidationError(
        `Cannot unassign driver. Job status must be 'routed' to unassign. Current status: ${job.status}`
      );
    }

    if (!job.driverId) {
      throw new ValidationError('Job does not have a driver assigned');
    }

    // Get old driver ID for notification
    const oldDriverId = job.driverId;

    // Determine target statuses when unassigning
    // If job was routed, move it back to booked
    const targetJobStatus: JobStatus | null = job.status === 'routed' ? 'booked' : null;

    // If booking exists and was scheduled, move it back to created
    const bookingId = job.bookingId;
    const currentBookingStatus = job.booking?.status as BookingStatus | undefined;
    const targetBookingStatus: BookingStatus | null =
      currentBookingStatus === 'scheduled' ? 'created' : null;

    // Update job to remove driver (and optionally revert status)
    await jobRepo.update(job.id, {
      driverId: null,
      ...(targetJobStatus ? { status: targetJobStatus } : {}),
    });

    // If there is a related booking, clear its driver and optionally revert status
    if (bookingId) {
      await bookingRepo.update(bookingId, {
        ...(targetBookingStatus ? { status: targetBookingStatus } : {}),
        // Clear driver linkage from booking so UI no longer shows assigned driver
        driverId: null as any,
        driverName: null as any,
        scheduledBy: null as any,
        scheduledAt: null as any,
      });

      // Record booking status history if status was reverted
      if (targetBookingStatus) {
        await bookingRepo.addStatusHistory(bookingId, {
          status: targetBookingStatus,
          changedBy,
          notes: 'Driver unassigned from job; booking returned to created status',
        });
      }
    }

    // Add status history
    await jobRepo.addStatusHistory(job.id, {
      status: targetJobStatus ?? job.status,
      changedBy: changedBy,
      notes: `Driver ${job.driver?.name || 'driver'} unassigned from job`,
    });

    // Notify old driver that they have been unassigned
    const { notifyJobUnassignment } = await import('../utils/notifications');
    await notifyJobUnassignment(
      job.id,
      job.erpJobNumber,
      oldDriverId,
      job.tenantId
    );

    return this.getJobById(job.id);
  }

  /**
   * Check if driver has any active jobs (status 'routed' or later, not 'completed' or 'cancelled')
   */
  async hasActiveJobs(driverId: string): Promise<boolean> {
    const activeJob = await prisma.job.findFirst({
      where: {
        driverId: driverId,
        status: {
          in: ['routed', 'en_route', 'arrived', 'collected', 'warehouse', 'sanitised', 'graded'],
        },
      },
      select: { id: true },
    });

    return !!activeJob;
  }
}
