import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller';
import { authenticate, authorize, requireAdmin } from '../middleware/auth';

const router = Router();
const bookingController = new BookingController();

// All routes require authentication
router.use(authenticate);

// Create booking (admin, client, reseller)
router.post(
  '/',
  authorize('admin', 'client', 'reseller'),
  bookingController.create.bind(bookingController)
);

// List bookings
router.get(
  '/',
  authorize('admin', 'client', 'reseller'),
  bookingController.list.bind(bookingController)
);

// Check if Job ID is unique (admin only) - must be before /:id route
router.get(
  '/:id/check-job-id',
  requireAdmin,
  bookingController.checkJobIdUnique.bind(bookingController)
);

// Get booking by ID
router.get(
  '/:id',
  authorize('admin', 'client', 'reseller'),
  bookingController.getById.bind(bookingController)
);

// Assign driver (admin only)
router.post(
  '/:id/assign-driver',
  requireAdmin,
  bookingController.assignDriver.bind(bookingController)
);

// Approve booking (admin only) - changes from pending to created
router.post(
  '/:id/approve',
  requireAdmin,
  bookingController.approve.bind(bookingController)
);

// Complete booking (admin only) - changes from graded to completed (final approval)
router.post(
  '/:id/complete',
  requireAdmin,
  bookingController.complete.bind(bookingController)
);

// Update booking status (admin only)
router.patch(
  '/:id/status',
  requireAdmin,
  bookingController.updateStatus.bind(bookingController)
);

// JML Booking endpoints
// Create new starter booking
router.post(
  '/jml/new-starter',
  authorize('admin', 'client', 'reseller'),
  bookingController.createNewStarter.bind(bookingController)
);

// Create leaver booking
router.post(
  '/jml/leaver',
  authorize('admin', 'client', 'reseller'),
  bookingController.createLeaver.bind(bookingController)
);

// Create breakfix booking
router.post(
  '/jml/breakfix',
  authorize('admin', 'client', 'reseller'),
  bookingController.createBreakfix.bind(bookingController)
);

// Create mover booking
router.post(
  '/jml/mover',
  authorize('admin', 'client', 'reseller'),
  bookingController.createMover.bind(bookingController)
);

// Allocate device (admin only)
router.patch(
  '/:id/allocate-device',
  requireAdmin,
  bookingController.allocateDevice.bind(bookingController)
);

// Mover: allocate all devices linked to booking (admin only)
router.post(
  '/:id/allocate-mover-all',
  requireAdmin,
  bookingController.allocateMoverAll.bind(bookingController)
);

// Mover @ inventory: commit selected devices in one step (admin only)
router.post(
  '/:id/mover-commit-devices',
  requireAdmin,
  bookingController.commitMoverDevices.bind(bookingController)
);

// Update courier tracking (admin only)
router.patch(
  '/:id/courier-tracking',
  requireAdmin,
  bookingController.updateCourierTracking.bind(bookingController)
);

// Mark as delivered (admin only)
router.patch(
  '/:id/mark-delivered',
  requireAdmin,
  bookingController.markDelivered.bind(bookingController)
);

// Mark as collected (admin only)
router.patch(
  '/:id/mark-collected',
  requireAdmin,
  bookingController.markCollected.bind(bookingController)
);

export default router;
