import { Response, NextFunction } from 'express';
import { InventorySyncService } from '../services/inventory-sync.service';
import { AuthenticatedRequest, ApiResponse } from '../types';
import { ValidationError } from '../utils/errors';
import prisma from '../config/database';

const inventoryService = new InventorySyncService();

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

      const { clientId, deviceType, conditionCode, status } = req.query;

      // For clients, only show their own inventory
      // For admins/resellers, can filter by clientId
      const targetClientId = req.user.role === 'client' 
        ? req.user.userId // Client users see their own inventory
        : (clientId as string | undefined);

      if (!targetClientId && req.user.role !== 'admin') {
        return res.status(400).json({
          success: false,
          error: 'clientId is required',
        } as ApiResponse);
      }

      // Get client ID from user if client role
      let actualClientId: string;
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
        actualClientId = client.id;
      } else {
        actualClientId = targetClientId!;
      }

      const inventory = await inventoryService.getAvailableInventory(
        actualClientId,
        deviceType as string | undefined,
        conditionCode as string | undefined
      );

      // Filter by status if provided
      const filteredInventory = status
        ? inventory.filter(item => item.status === status)
        : inventory;

      return res.json({
        success: true,
        data: filteredInventory,
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
        if (!item.deviceType || !item.make || !item.model || !item.serialNumber || !item.conditionCode) {
          return res.status(400).json({
            success: false,
            error: 'Each item must have deviceType, make, model, serialNumber, and conditionCode',
          } as ApiResponse);
        }
      }

      // Get client ID
      let clientId: string;
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
        clientId = client.id;
      } else {
        const { clientId: providedClientId } = req.body;
        if (!providedClientId) {
          return res.status(400).json({
            success: false,
            error: 'clientId is required',
          } as ApiResponse);
        }
        clientId = providedClientId;
      }

      const result = await inventoryService.bulkCreateInventory(clientId, items);

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
      let actualClientId: string;
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
        if (!clientId) {
          return res.status(400).json({
            success: false,
            error: 'clientId is required',
          } as ApiResponse);
        }
        actualClientId = clientId;
      }

      const result = await inventoryService.syncClientInventory(actualClientId);

      return res.json({
        success: true,
        data: result,
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

      const { clientId, deviceType, conditionCode } = req.query;

      if (!clientId) {
        return res.status(400).json({
          success: false,
          error: 'clientId is required',
        } as ApiResponse);
      }

      const inventory = await inventoryService.getAvailableInventory(
        clientId as string,
        deviceType as string | undefined,
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

      const { InventoryRepository } = await import('../repositories/inventory.repository');
      const repo = new (InventoryRepository as any)();

      const inventory = await repo.findById(id);
      if (!inventory) {
        return res.status(404).json({
          success: false,
          error: 'Inventory item not found',
        } as ApiResponse);
      }

      // Check permissions - clients can only update their own inventory
      if (req.user.role === 'client') {
        const client = await prisma.client.findFirst({
          where: {
            tenantId: req.user.tenantId,
            email: req.user.email,
          },
        });
        if (!client || client.id !== inventory.clientId) {
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
