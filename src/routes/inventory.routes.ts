import { Router } from 'express';
import { InventoryController } from '../controllers/inventory.controller';
import { authenticate } from '../middleware/auth';

const router = Router();
const inventoryController = new InventoryController();

// All routes require authentication
router.use(authenticate);

// GET /api/inventory - List inventory
router.get('/', (req, res, next) => inventoryController.list(req, res, next));

// POST /api/inventory/upload - Bulk upload
router.post('/upload', (req, res, next) => inventoryController.upload(req, res, next));

// POST /api/inventory/sync - Sync with ReuseOS
router.post('/sync', (req, res, next) => inventoryController.sync(req, res, next));

// GET /api/inventory/available - Get available inventory
router.get('/available', (req, res, next) => inventoryController.getAvailable(req, res, next));

// PATCH /api/inventory/:id - Update inventory item
router.patch('/:id', (req, res, next) => inventoryController.update(req, res, next));

export default router;
