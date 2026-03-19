import { Response, NextFunction } from 'express';
import { InventorySyncService } from '../services/inventory-sync.service';
import { AuthenticatedRequest, ApiResponse } from '../types';
import prisma from '../config/database';

const inventoryService = new InventorySyncService();

const ALLOWED_INVENTORY_STATUSES = ['available', 'allocated', 'delivered', 'mover_allocated'] as const;

export class InventoryController {
  /**
   * GET /api/inventory
   * List client inventory (filtered by clientId for non-admin users)
   */
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { allocatedTo, category, conditionCode, status } = req.query;

      // For clients, only show their allocated inventory
      // For admins/resellers, can filter by allocatedTo (undefined = all, null = unallocated only, string = specific client)
      let targetAllocatedTo: string | null | undefined = undefined;
      if (req.user.role === 'client') {
        // Find client record for this user
        const client = await prisma.client.findFirst({
          where: {
            tenantId: req.user.tenantId,
            email: req.user.email,
          },
        });
        if (!client) {
          return res.status(404).json({
            success: false,
            error: 'Client record not found',
          } as ApiResponse);
        }
        targetAllocatedTo = client.id;
      } else {
        // For admin/reseller, allocatedTo query param handling:
        // - not provided (undefined) = show all inventory
        // - "__unallocated__" or null = show only unallocated
        // - clientId string = show only that client's inventory
        if (allocatedTo === undefined || allocatedTo === '') {
          targetAllocatedTo = undefined; // Show all
        } else if (allocatedTo === '__unallocated__' || allocatedTo === null) {
          targetAllocatedTo = null; // Show only unallocated
        } else {
          targetAllocatedTo = allocatedTo as string; // Show specific client
        }
      }

      const inventory = await inventoryService.getAllInventory(
        targetAllocatedTo,
        req.user.tenantId,
        category as string | undefined,
        conditionCode as string | undefined,
        status as string | undefined
      );

      return res.json({
        success: true,
        data: inventory,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/inventory/upload
   * Bulk upload inventory (CSV/JSON)
   */
  async upload(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { items } = req.body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'items array is required and must not be empty',
        } as ApiResponse);
      }

      // Validate items
      for (const item of items) {
        if (!item.category || !item.make || !item.model || !item.serialNumber || !item.conditionCode) {
          return res.status(400).json({
            success: false,
            error: 'Each item must have category, make, model, serialNumber, and conditionCode. deviceType and imei are optional.',
          } as ApiResponse);
        }
      }

      // Get allocatedTo (clientId) - this will be stored in allocatedTo field if status is allocated
      let allocatedTo: string | null = null;
      if (req.user.role === 'client') {
        const client = await prisma.client.findFirst({
          where: {
            tenantId: req.user.tenantId,
            email: req.user.email,
          },
        });
        if (!client) {
          return res.status(404).json({
            success: false,
            error: 'Client record not found',
          } as ApiResponse);
        }
        allocatedTo = client.id;
      } else {
        // For admin/reseller, allocatedTo is optional (from request body)
        const { clientId: providedClientId } = req.body;
        allocatedTo = providedClientId || null;
      }

      const { sourceBookingId } = req.body as { sourceBookingId?: string };
      const result = await inventoryService.bulkCreateInventory(
        allocatedTo,
        items,
        req.user.tenantId,
        typeof sourceBookingId === 'string' && sourceBookingId ? sourceBookingId : null
      );

      return res.status(201).json({
        success: true,
        data: result,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * POST /api/inventory/sync
   * Trigger ReuseOS sync for client inventory
   */
  async sync(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { clientId } = req.body;

      // Get client ID
      let actualClientId: string | null = null;
      if (req.user.role === 'client') {
        const client = await prisma.client.findFirst({
          where: {
            tenantId: req.user.tenantId,
            email: req.user.email,
          },
        });
        if (!client) {
          return res.status(404).json({
            success: false,
            error: 'Client record not found',
          } as ApiResponse);
        }
        actualClientId = client.id;
      } else {
        // For admin/reseller, clientId is optional (null means sync all clients for tenant)
        actualClientId = clientId || null;
      }

      const result = await inventoryService.syncClientInventory(actualClientId, req.user.tenantId);

      return res.json({
        success: true,
        data: result,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/inventory/mover-allocated
   * Get mover-allocated inventory for a client (for mover booking device allocation).
   * Query: clientId (required), bookingId (recommended for mover — scopes pool per booking), category?, conditionCode?
   */
  async getMoverAllocated(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { clientId, bookingId, category, conditionCode } = req.query;
      if (!clientId || typeof clientId !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'clientId is required',
        } as ApiResponse);
      }

      const sourceBookingId = typeof bookingId === 'string' && bookingId ? bookingId : undefined;

      const inventory = await inventoryService.getMoverAllocatedInventory(
        clientId,
        req.user.tenantId,
        category as string | undefined,
        conditionCode as string | undefined,
        sourceBookingId
      );

      return res.json({
        success: true,
        data: inventory,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * GET /api/inventory/available
   * Get available inventory for allocation
   */
  async getAvailable(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { allocatedTo, category, conditionCode } = req.query;

      if (!allocatedTo) {
        return res.status(400).json({
          success: false,
          error: 'allocatedTo (clientId) is required',
        } as ApiResponse);
      }

      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const inventory = await inventoryService.getAvailableInventory(
        allocatedTo as string,
        req.user.tenantId,
        category as string | undefined,
        conditionCode as string | undefined
      );

      return res.json({
        success: true,
        data: inventory,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * PATCH /api/inventory/:id
   * Update inventory item
   */
  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { make, model, imei, conditionCode, status } = req.body;

      if (status !== undefined && !ALLOWED_INVENTORY_STATUSES.includes(status as any)) {
        return res.status(400).json({
          success: false,
          error: `Status must be one of: ${ALLOWED_INVENTORY_STATUSES.join(', ')}`,
        } as ApiResponse);
      }

      const { InventoryRepository } = await import('../repositories/inventory.repository');
      const repo = new (InventoryRepository as any)();

      const inventory = await repo.findById(id);
      if (!inventory) {
        return res.status(404).json({
          success: false,
          error: 'Inventory item not found',
        } as ApiResponse);
      }

      // Check permissions - clients can only update their own allocated inventory
      if (req.user.role === 'client') {
        const client = await prisma.client.findFirst({
          where: {
            tenantId: req.user.tenantId,
            email: req.user.email,
          },
        });
        if (!client || client.id !== (inventory as any).allocatedTo) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden',
          } as ApiResponse);
        }
      }

      const updated = await repo.update(id, {
        make,
        model,
        imei,
        conditionCode,
        status,
      });

      return res.json({
        success: true,
        data: updated,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
}
