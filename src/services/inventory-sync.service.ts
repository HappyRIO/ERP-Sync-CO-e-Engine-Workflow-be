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
   * Parse deviceType to extract category and deviceType (Windows/Apple)
   */
  private parseDeviceType(deviceType: string): { category: string; deviceType: string | null } {
    // Handle combined format like "laptop_windows", "desktop_apple"
    if (deviceType.includes('_')) {
      const parts = deviceType.split('_');
      const baseCategory = parts[0];
      const osType = parts[parts.length - 1];
      
      // Map base category
      const categoryMap: Record<string, string> = {
        mobile_phone: 'mobile',
        laptop: 'laptop',
        desktop: 'desktop',
        tablet: 'tablet',
        server: 'server',
        storage: 'storage',
        networking: 'networking',
        voip: 'VOIP',
        weee_waste: 'WEEE Waste',
      };
      
      const category = categoryMap[baseCategory] || baseCategory;
      
      // Extract OS type for laptop/desktop
      if (category === 'laptop' || category === 'desktop') {
        const deviceTypeValue = osType === 'windows' ? 'Windows' : osType === 'apple' ? 'Apple' : null;
        return { category, deviceType: deviceTypeValue };
      }
      
      return { category, deviceType: null };
    }
    
    // Handle simple format
    const categoryMap: Record<string, string> = {
      mobile_phone: 'mobile',
      laptop: 'laptop',
      desktop: 'desktop',
      tablet: 'tablet',
      server: 'server',
      storage: 'storage',
      networking: 'networking',
      voip: 'VOIP',
      weee_waste: 'WEEE Waste',
    };
    
    const category = categoryMap[deviceType] || deviceType;
    return { category, deviceType: null };
  }

  /**
   * Sync client inventory from ReuseOS ERP to local database
   * If clientId is null, syncs all clients for the tenant
   */
  async syncClientInventory(clientId: string | null, tenantId: string) {
    let clients: Array<{ id: string; tenantId: string }> = [];
    
    if (clientId) {
      // Sync specific client
      const client = await prisma.client.findUnique({
        where: { id: clientId },
        include: { tenant: true },
      });

      if (!client) {
        throw new NotFoundError('Client', clientId);
      }
      
      if (client.tenantId !== tenantId) {
        throw new ValidationError('Client does not belong to the tenant');
      }
      
      clients = [{ id: client.id, tenantId: client.tenantId }];
    } else {
      // Sync all clients for the tenant
      const allClients = await prisma.client.findMany({
        where: { tenantId },
        select: { id: true, tenantId: true },
      });
      
      if (allClients.length === 0) {
        return {
          synced: 0,
          created: 0,
          updated: 0,
          errors: [],
        };
      }
      
      clients = allClients;
    }

    let totalSynced = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    const allErrors: string[] = [];

    // Sync each client
    for (const client of clients) {
      // Get inventory from ReuseOS ERP
      const erpInventory = await mockERPService.getInventory(client.id);

      if (erpInventory.length === 0) {
        continue;
      }

      // Sync each item
      for (const item of erpInventory) {
        try {
          const existing = await inventoryRepo.findBySerial(client.tenantId, item.serialNumber);

          // Parse deviceType from ERP to extract category and deviceType
          const { category, deviceType } = this.parseDeviceType(item.deviceType);

          if (existing) {
            // Update existing item
            await inventoryRepo.updateBySerial(client.tenantId, item.serialNumber, {
              category,
              deviceType,
              make: item.make,
              model: item.model,
              imei: item.imei,
              conditionCode: item.conditionCode,
              erpInventoryId: item.erpInventoryId,
              lastSyncedAt: new Date(),
              // Don't update status if item is allocated
              ...(existing.status === 'available' && { status: item.status as InventoryStatus }),
            });
            totalUpdated++;
          } else {
            // Create new item - if status is allocated, set allocatedTo to client.id
            const status = item.status as InventoryStatus || 'available';
            await inventoryRepo.create({
              tenantId: client.tenantId,
              category,
              deviceType,
              make: item.make,
              model: item.model,
              serialNumber: item.serialNumber,
              imei: item.imei,
              conditionCode: item.conditionCode,
              erpInventoryId: item.erpInventoryId,
              status,
              allocatedTo: status === 'allocated' ? client.id : null,
              lastSyncedAt: new Date(),
            } as any); // Type assertion: lastSyncedAt exists in schema but Prisma client needs regeneration
            totalCreated++;
          }
          totalSynced++;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          allErrors.push(`Failed to sync ${item.serialNumber} for client ${client.id}: ${errorMsg}`);
        }
      }
    }

    return {
      synced: totalSynced,
      created: totalCreated,
      updated: totalUpdated,
      errors: allErrors,
    };
  }

  /**
   * Get available inventory for allocation
   */
  async getAvailableInventory(allocatedTo: string | null, tenantId: string, category?: string, conditionCode?: string) {
    return inventoryRepo.findAvailable(allocatedTo, tenantId, category, conditionCode);
  }

  /**
   * Get all inventory (for listing - admin can see all, not just available)
   */
  async getAllInventory(allocatedTo: string | null | undefined, tenantId: string, category?: string, conditionCode?: string, status?: string) {
    return inventoryRepo.findAll(allocatedTo, tenantId, category, conditionCode, status);
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

    if (!booking.clientId) {
      throw new ValidationError('Booking must have a client to allocate inventory');
    }

    // Find inventory item
    const inventoryItem = await inventoryRepo.findBySerial(booking.tenantId, serialNumber);

    if (!inventoryItem) {
      throw new NotFoundError('Inventory item', serialNumber);
    }

    if (inventoryItem.status !== 'available') {
      throw new ValidationError(`Inventory item ${serialNumber} is not available (status: ${inventoryItem.status})`);
    }

    // Update inventory status - allocatedTo stores the clientId
    await inventoryRepo.update(inventoryItem.id, {
      status: 'allocated',
      allocatedTo: booking.clientId,
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
    const inventoryItem = await inventoryRepo.findBySerial(booking.tenantId, serialNumber);

    if (!inventoryItem) {
      throw new NotFoundError('Inventory item', serialNumber);
    }

    // Update inventory status - clear allocatedTo when returning
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
    allocatedTo: string | null,
    items: Array<{
      category: string;
      deviceType?: string | null;
      make: string;
      model: string;
      serialNumber: string;
      imei?: string;
      conditionCode: string;
      status?: string;
    }>,
    tenantId: string
  ) {
    const inventoryItems = items.map(item => {
      const status = (item.status as InventoryStatus) || 'available';
      
      return {
        tenantId,
        category: item.category,
        deviceType: item.deviceType === undefined ? null : item.deviceType,
        make: item.make,
        model: item.model,
        serialNumber: item.serialNumber,
        imei: item.imei,
        conditionCode: item.conditionCode,
        status,
        // If status is allocated and allocatedTo is provided, use it; otherwise null
        allocatedTo: (status === 'allocated' && allocatedTo) ? allocatedTo : null,
      };
    });

    const result = await inventoryRepo.createMany(inventoryItems);

    return {
      created: result.count,
      total: items.length,
    };
  }
}
