// Inventory Sync Service
// Handles synchronization with ReuseOS ERP and local inventory management

import { InventoryRepository } from '../repositories/inventory.repository';
import { mockERPService, ERPInventoryItem } from './mock-erp.service';
import { ValidationError, NotFoundError } from '../utils/errors';
import prisma from '../config/database';
import { InventoryStatus } from '@prisma/client';

const inventoryRepo = new InventoryRepository();

export class InventorySyncService {
  /**
   * Sync client inventory from ReuseOS ERP to local database
   */
  async syncClientInventory(clientId: string) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      include: { tenant: true },
    });

    if (!client) {
      throw new NotFoundError('Client', clientId);
    }

    // Get inventory from ReuseOS ERP
    const erpInventory = await mockERPService.getInventory(clientId);

    if (erpInventory.length === 0) {
      // No inventory in ERP, return empty result
      return {
        synced: 0,
        created: 0,
        updated: 0,
        errors: [],
      };
    }

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    // Sync each item
    for (const item of erpInventory) {
      try {
        const existing = await inventoryRepo.findBySerial(clientId, item.serialNumber);

        if (existing) {
          // Update existing item
          await inventoryRepo.updateBySerial(clientId, item.serialNumber, {
            deviceType: item.deviceType,
            make: item.make,
            model: item.model,
            imei: item.imei,
            conditionCode: item.conditionCode,
            erpInventoryId: item.erpInventoryId,
            lastSyncedAt: new Date(),
            // Don't update status if item is allocated
            ...(existing.status === 'available' && { status: item.status as InventoryStatus }),
          });
          updated++;
        } else {
          // Create new item
          await inventoryRepo.create({
            clientId,
            tenantId: client.tenantId,
            deviceType: item.deviceType,
            make: item.make,
            model: item.model,
            serialNumber: item.serialNumber,
            imei: item.imei,
            conditionCode: item.conditionCode,
            erpInventoryId: item.erpInventoryId,
            status: item.status as InventoryStatus || 'available',
            lastSyncedAt: new Date(),
          });
          created++;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to sync ${item.serialNumber}: ${errorMsg}`);
      }
    }

    return {
      synced: erpInventory.length,
      created,
      updated,
      errors,
    };
  }

  /**
   * Get available inventory for allocation
   */
  async getAvailableInventory(clientId: string, deviceType?: string, conditionCode?: string) {
    return inventoryRepo.findAvailable(clientId, deviceType, conditionCode);
  }

  /**
   * Allocate serial number to a booking
   */
  async allocateSerial(bookingId: string, serialNumber: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true },
    });

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    // Find inventory item
    const inventoryItem = await inventoryRepo.findBySerial(booking.clientId, serialNumber);

    if (!inventoryItem) {
      throw new NotFoundError('Inventory item', serialNumber);
    }

    if (inventoryItem.status !== 'available') {
      throw new ValidationError(`Inventory item ${serialNumber} is not available (status: ${inventoryItem.status})`);
    }

    // Update inventory status
    await inventoryRepo.update(inventoryItem.id, {
      status: 'allocated',
      allocatedTo: bookingId,
    });

    // Allocate in ReuseOS ERP (if booking has ERP order number)
    if (booking.erpJobNumber) {
      try {
        await mockERPService.allocateInventory({
          orderNumber: booking.erpJobNumber,
          serialNumbers: [serialNumber],
          clientId: booking.clientId,
        });
      } catch (error) {
        // Log error but don't fail - local allocation succeeded
        const { logger } = await import('../utils/logger');
        logger.warn('Failed to allocate inventory in ReuseOS ERP', {
          bookingId,
          serialNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return inventoryItem;
  }

  /**
   * Return serial number to inventory (when device is returned)
   */
  async returnSerial(bookingId: string, serialNumber: string, conditionCode?: string) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true },
    });

    if (!booking) {
      throw new NotFoundError('Booking', bookingId);
    }

    // Find inventory item
    const inventoryItem = await inventoryRepo.findBySerial(booking.clientId, serialNumber);

    if (!inventoryItem) {
      throw new NotFoundError('Inventory item', serialNumber);
    }

    // Update inventory status
    await inventoryRepo.update(inventoryItem.id, {
      status: 'available',
      allocatedTo: null,
      ...(conditionCode && { conditionCode }),
      lastSyncedAt: new Date(),
    });

    return inventoryItem;
  }

  /**
   * Bulk create inventory items (for manual upload)
   */
  async bulkCreateInventory(
    clientId: string,
    items: Array<{
      deviceType: string;
      make: string;
      model: string;
      serialNumber: string;
      imei?: string;
      conditionCode: string;
    }>
  ) {
    const client = await prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundError('Client', clientId);
    }

    const inventoryItems = items.map(item => ({
      clientId,
      tenantId: client.tenantId,
      deviceType: item.deviceType,
      make: item.make,
      model: item.model,
      serialNumber: item.serialNumber,
      imei: item.imei,
      conditionCode: item.conditionCode,
      status: 'available' as InventoryStatus,
    }));

    const result = await inventoryRepo.createMany(inventoryItems);

    return {
      created: result.count,
      total: items.length,
    };
  }
}
