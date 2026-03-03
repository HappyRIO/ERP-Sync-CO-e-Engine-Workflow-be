import { Router } from 'express';
import { JobController } from '../controllers/job.controller';
import { authenticate, authorize } from '../middleware/auth';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validator';

const router = Router();
const jobController = new JobController();

// All routes require authentication
router.use(authenticate);

// List jobs
router.get(
  '/',
  authorize('admin', 'client', 'reseller', 'driver'),
  jobController.list.bind(jobController)
);

// Get job by ID
router.get(
  '/:id',
  authorize('admin', 'client', 'reseller', 'driver'),
  jobController.getById.bind(jobController)
);

// Update job status (driver, admin)
router.patch(
  '/:id/status',
  authorize('admin', 'driver'),
  jobController.updateStatus.bind(jobController)
);

// Update job evidence (driver)
router.patch(
  '/:id/evidence',
  authorize('admin', 'driver'),
  jobController.updateEvidence.bind(jobController)
);

// Update driver journey fields (driver only, for routed status)
router.patch(
  '/:id/journey-fields',
  authorize('admin', 'driver'),
  jobController.updateJourneyFields.bind(jobController)
);

// Re-assign driver to job (admin only)
router.post(
  '/:id/reassign-driver',
  authorize('admin'),
  validate([
    param('id').isUUID().withMessage('Invalid job ID'),
    body('driverId')
      .optional()
      .custom((value) => {
        // Allow null, undefined, or empty string for unassignment
        if (value === null || value === undefined || value === '') {
          return true;
        }
        // If a value is provided, it must be a valid UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(value);
      })
      .withMessage('Driver ID must be a valid UUID or empty for unassignment'),
  ]),
  jobController.reassignDriver.bind(jobController)
);

export default router;
