import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { VehicleController } from '../controllers/vehicle.controller';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validator';

const router = Router();
const vehicleController = new VehicleController();

router.use(authenticate);

// Get all vehicles (admin only)
router.get(
  '/',
  authorize('admin'),
  (req, res, next) => vehicleController.list(req, res, next)
);

// Get vehicle by ID (admin only)
router.get(
  '/:id',
  authorize('admin'),
  validate([
    param('id').isUUID().withMessage('Invalid vehicle ID'),
  ]),
  (req, res, next) => vehicleController.getById(req, res, next)
);

// Get vehicle by driver ID (admin and driver - driver can only view their own)
router.get(
  '/driver/:driverId',
  authorize('admin', 'driver'),
  validate([
    param('driverId').isUUID().withMessage('Invalid driver ID'),
  ]),
  (req, res, next) => vehicleController.getByDriver(req, res, next)
);

// Create vehicle (admin only)
router.post(
  '/',
  authorize('admin'),
  validate([
    body('vehicleReg').notEmpty().withMessage('Vehicle registration is required'),
    body('vehicleType').isIn(['van', 'truck', 'car']).withMessage('Vehicle type must be van, truck, or car'),
    body('vehicleFuelType').isIn(['petrol', 'diesel', 'electric']).withMessage('Fuel type must be petrol, diesel, or electric'),
  ]),
  (req, res, next) => vehicleController.create(req, res, next)
);

// Update vehicle (admin only)
router.patch(
  '/:id',
  authorize('admin'),
  validate([
    param('id').isUUID().withMessage('Invalid vehicle ID'),
    body('vehicleReg').optional().notEmpty().withMessage('Vehicle registration cannot be empty'),
    body('vehicleType').optional().isIn(['van', 'truck', 'car']).withMessage('Vehicle type must be van, truck, or car'),
    body('vehicleFuelType').optional().isIn(['petrol', 'diesel', 'electric']).withMessage('Fuel type must be petrol, diesel, or electric'),
  ]),
  (req, res, next) => vehicleController.update(req, res, next)
);

// Allocate vehicle to driver (admin only)
router.post(
  '/:id/allocate',
  authorize('admin'),
  validate([
    param('id').isUUID().withMessage('Invalid vehicle ID'),
    body('driverId')
      .custom((value) => {
        // If value is null, undefined, or empty, it's valid (for unallocation)
        if (value === null || value === undefined || value === '') {
          return true;
        }
        // If provided, must be a valid UUID
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (typeof value === 'string' && uuidRegex.test(value)) {
          return true;
        }
        throw new Error('Driver ID must be a valid UUID or null');
      })
      .optional({ nullable: true, checkFalsy: true }),
  ]),
  (req, res, next) => vehicleController.allocate(req, res, next)
);

// Delete vehicle (admin only)
router.delete(
  '/:id',
  authorize('admin'),
  validate([
    param('id').isUUID().withMessage('Invalid vehicle ID'),
  ]),
  (req, res, next) => vehicleController.delete(req, res, next)
);

export default router;
