// Notification helper utilities
import { NotificationService } from '../services/notification.service';
import { NotificationType } from '@prisma/client';

const notificationService = new NotificationService();

/**
 * Create a notification for a user
 */
export async function createNotification(
  userId: string,
  tenantId: string,
  type: NotificationType,
  title: string,
  message: string,
  url?: string,
  relatedId?: string,
  relatedType?: string
) {
  try {
    await notificationService.createNotification({
      userId,
      tenantId,
      type,
      title,
      message,
      url,
      relatedId,
      relatedType,
    });
  } catch (error) {
    // Log error but don't throw - notifications are non-critical
    const { logger } = await import('./logger');
    logger.error('Failed to create notification', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Create notifications for multiple users
 */
export async function createNotificationsForUsers(
  userIds: string[],
  tenantId: string,
  type: NotificationType,
  title: string,
  message: string,
  url?: string,
  relatedId?: string,
  relatedType?: string
) {
  if (userIds.length === 0) return;

  try {
    await notificationService.createNotificationsForUsers(
      userIds,
      tenantId,
      type,
      title,
      message,
      url,
      relatedId,
      relatedType
    );
  } catch (error) {
    // Log error but don't throw - notifications are non-critical
    const { logger } = await import('./logger');
    logger.error('Failed to create notifications for users', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Normalize job status for comparison (handle both en_route and en-route)
 */
function normalizeJobStatus(status: string): string {
  if (status === 'en-route' || status === 'en_route') return 'en_route';
  return status;
}

/**
 * Check if a job status is beyond driver's editable range
 */
function isNonEditableStatus(status: string): boolean {
  const normalized = normalizeJobStatus(status);
  return ['warehouse', 'sanitised', 'graded', 'completed'].includes(normalized);
}

/**
 * Create notification for job status change
 */
export async function notifyJobStatusChange(
  jobId: string,
  jobNumber: string,
  status: string,
  userId: string,
  tenantId: string,
  userRole: string
) {
  // Normalize status for comparison (handle both en-route and en_route)
  const normalizedStatus = normalizeJobStatus(status);
  
  const statusMessages: Record<string, { title: string; message: string; type: NotificationType }> = {
    'routed': {
      title: 'Job assigned',
      message: `Job ${jobNumber} has been assigned to you`,
      type: 'info',
    },
    'en_route': {
      title: 'Job in progress',
      message: `Job ${jobNumber} is now en route`,
      type: 'info',
    },
    'arrived': {
      title: 'Arrived at site',
      message: `You have arrived at the collection site for job ${jobNumber}`,
      type: 'info',
    },
    'collected': {
      title: 'Job collected',
      message: `Job ${jobNumber} has been collected`,
      type: 'success',
    },
    'warehouse': {
      title: 'Job delivered',
      message: `Job ${jobNumber} has been delivered to warehouse`,
      type: 'success',
    },
    'sanitised': {
      title: 'Job sanitised',
      message: `Job ${jobNumber} has been sanitised`,
      type: 'info',
    },
    'graded': {
      title: 'Job graded',
      message: `Job ${jobNumber} has been graded`,
      type: 'info',
    },
    'completed': {
      title: 'Job completed',
      message: `Job ${jobNumber} has been completed`,
      type: 'success',
    },
  };

  const statusInfo = statusMessages[normalizedStatus];
  if (!statusInfo) return;

  // For drivers, use /jobs/${jobId} if status is beyond editable range (warehouse, sanitised, graded, completed)
  // Otherwise use /driver/jobs/${jobId} for editable statuses
  const url = userRole === 'driver' 
    ? (isNonEditableStatus(normalizedStatus) ? `/jobs/${jobId}` : `/driver/jobs/${jobId}`)
    : `/jobs/${jobId}`;

  await createNotification(
    userId,
    tenantId,
    statusInfo.type,
    statusInfo.title,
    statusInfo.message,
    url,
    jobId,
    'job'
  );
}

/**
 * Create notification for booking status change
 */
export async function notifyBookingStatusChange(
  bookingId: string,
  bookingNumber: string,
  status: string,
  userId: string,
  tenantId: string
) {
  const statusMessages: Record<string, { title: string; message: string; type: NotificationType }> = {
    'created': {
      title: 'Booking approved',
      message: `Booking ${bookingNumber} has been approved and is now active`,
      type: 'success',
    },
    'scheduled': {
      title: 'Booking scheduled',
      message: `Booking ${bookingNumber} has been scheduled`,
      type: 'info',
    },
    'collected': {
      title: 'Assets collected',
      message: `Assets from booking ${bookingNumber} have been collected by the driver`,
      type: 'success',
    },
    'sanitised': {
      title: 'Booking sanitised',
      message: `Booking ${bookingNumber} has been sanitised`,
      type: 'info',
    },
    'graded': {
      title: 'Booking graded',
      message: `Booking ${bookingNumber} has been graded`,
      type: 'info',
    },
    'completed': {
      title: 'Booking completed',
      message: `Booking ${bookingNumber} has been completed`,
      type: 'success',
    },
    'cancelled': {
      title: 'Booking cancelled',
      message: `Booking ${bookingNumber} has been cancelled`,
      type: 'warning',
    },
  };

  const statusInfo = statusMessages[status];
  if (!statusInfo) return;

  await createNotification(
    userId,
    tenantId,
    statusInfo.type,
    statusInfo.title,
    statusInfo.message,
    `/bookings/${bookingId}`,
    bookingId,
    'booking'
  );
}

/**
 * Create notification for driver en route (client)
 */
export async function notifyDriverEnRoute(
  bookingId: string,
  bookingNumber: string,
  userId: string,
  tenantId: string
) {
  await createNotification(
    userId,
    tenantId,
    'info',
    'Driver en route',
    `The driver for booking ${bookingNumber} is now en route to your location`,
    `/bookings/${bookingId}`,
    bookingId,
    'booking'
  );
}

/**
 * Create notification for driver arrived (client)
 */
export async function notifyDriverArrived(
  bookingId: string,
  bookingNumber: string,
  userId: string,
  tenantId: string
) {
  await createNotification(
    userId,
    tenantId,
    'info',
    'Driver arrived',
    `The driver for booking ${bookingNumber} has arrived at your location`,
    `/bookings/${bookingId}`,
    bookingId,
    'booking'
  );
}

/**
 * Create notification for driver assignment (client/reseller)
 */
export async function notifyDriverAssignment(
  bookingId: string,
  bookingNumber: string,
  driverName: string,
  userId: string,
  tenantId: string
) {
  await createNotification(
    userId,
    tenantId,
    'info',
    'Driver assigned',
    `Driver ${driverName} has been assigned to your booking ${bookingNumber}`,
    `/bookings/${bookingId}`,
    bookingId,
    'booking'
  );
}

/**
 * Create notification for assets delivered to warehouse (client)
 */
export async function notifyAssetsDeliveredToWarehouse(
  bookingId: string,
  bookingNumber: string,
  userId: string,
  tenantId: string
) {
  await createNotification(
    userId,
    tenantId,
    'success',
    'Assets delivered to warehouse',
    `Assets from booking ${bookingNumber} have been delivered to the warehouse`,
    `/bookings/${bookingId}`,
    bookingId,
    'booking'
  );
}

/**
 * Create notification for new job assignment (driver)
 */
export async function notifyJobAssignment(
  jobId: string,
  jobNumber: string,
  driverId: string,
  tenantId: string
) {
  await createNotification(
    driverId,
    tenantId,
    'info',
    'New job assigned',
    `A new collection job ${jobNumber} has been assigned to you`,
    `/driver/jobs/${jobId}`,
    jobId,
    'job'
  );
}

/**
 * Create notification for vehicle allocation (driver)
 */
export async function notifyVehicleAllocation(
  vehicleId: string,
  vehicleReg: string,
  driverId: string,
  tenantId: string
) {
  await createNotification(
    driverId,
    tenantId,
    'info',
    'Vehicle allocated',
    `Vehicle ${vehicleReg} has been allocated to you`,
    `/settings`,
    vehicleId,
    'vehicle'
  );
}

/**
 * Create notification for vehicle unallocation (driver)
 */
export async function notifyVehicleUnallocation(
  vehicleId: string,
  vehicleReg: string,
  driverId: string,
  tenantId: string
) {
  await createNotification(
    driverId,
    tenantId,
    'warning',
    'Vehicle unallocated',
    `Vehicle ${vehicleReg} has been unallocated from you`,
    `/settings`,
    vehicleId,
    'vehicle'
  );
}

/**
 * Create notification for vehicle reallocation (driver who lost the vehicle)
 */
export async function notifyVehicleReallocation(
  vehicleId: string,
  vehicleReg: string,
  oldDriverId: string,
  tenantId: string
) {
  await createNotification(
    oldDriverId,
    tenantId,
    'warning',
    'Vehicle reallocated',
    `Vehicle ${vehicleReg} has been reallocated to another driver`,
    `/settings`,
    vehicleId,
    'vehicle'
  );
}

/**
 * Create notification for job unassignment (driver)
 */
export async function notifyJobUnassignment(
  jobId: string,
  jobNumber: string,
  driverId: string,
  tenantId: string
) {
  await createNotification(
    driverId,
    tenantId,
    'warning',
    'Job unassigned',
    `You have been unassigned from job ${jobNumber}`,
    `/jobs/${jobId}`,
    jobId,
    'job'
  );
}

/**
 * Create notification for pending approval (admin)
 */
export async function notifyPendingApproval(
  bookingId: string,
  bookingNumber: string,
  adminUserIds: string[],
  tenantId: string
) {
  await createNotificationsForUsers(
    adminUserIds,
    tenantId,
    'warning',
    'Pending approval',
    `Booking ${bookingNumber} requires your approval`,
    `/admin/booking-approval/${bookingId}`,
    bookingId,
    'booking'
  );
}

/**
 * Create notification for graded booking ready for approval (admin)
 */
export async function notifyGradedForApproval(
  bookingId: string,
  bookingNumber: string,
  adminUserIds: string[],
  tenantId: string
) {
  await createNotificationsForUsers(
    adminUserIds,
    tenantId,
    'info',
    'Ready for approval',
    `Booking ${bookingNumber} has been graded and is ready for final approval`,
    `/admin/approval/${bookingId}`,
    bookingId,
    'booking'
  );
}

/**
 * Create notification for pending user approval (admin)
 * Notifies admins when a client/reseller signs up without invitation and needs approval
 * - Clients are routed to /clients page
 * - Resellers are routed to /users page
 */
export async function notifyPendingUserApproval(
  userId: string,
  userEmail: string,
  userName: string,
  userRole: string,
  adminUserIds: string[],
  tenantId: string
) {
  const roleLabel = userRole === 'client' ? 'Client' : userRole === 'reseller' ? 'Reseller' : userRole;
  
  // Route all pending user approvals to /users page (where approve/decline functionality is centralized)
  const notificationUrl = `/users?status=pending${userRole !== 'all' ? `&role=${userRole}` : ''}`;
  
  await createNotificationsForUsers(
    adminUserIds,
    tenantId,
    'warning',
    'New user pending approval',
    `${roleLabel} ${userName} (${userEmail}) has signed up and is waiting for approval`,
    notificationUrl,
    userId,
    'user'
  );
}
