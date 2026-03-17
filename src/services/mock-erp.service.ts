// Mock ERP Integration Service
// This simulates ERP API calls until real ERP is ready

export interface ERPJobRequest {
  clientName: string;
  siteName: string;
  siteAddress: string;
  scheduledDate: string;
  assets: Array<{
    categoryName: string;
    quantity: number;
  }>;
}

export interface ERPJobResponse {
  jobNumber: string;
  status: string;
  createdAt: string;
}

export interface ERPGradingResult {
  assets: Array<{
    categoryName: string;
    quantity: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'Recycled';
    resaleValue: number;
  }>;
  totalValue: number;
}

export interface ERPSanitisationResult {
  assets: Array<{
    categoryName: string;
    quantity: number;
    sanitised: boolean;
    wipeMethod: string;
    certificateUrl?: string;
  }>;
}

export interface ERPInventoryItem {
  erpInventoryId: string;
  deviceType: string; // laptop, mobile_phone
  make: string;
  model: string;
  serialNumber: string;
  imei?: string;
  conditionCode: string; // IBMA, IBMB, etc.
  status: string;
}

export interface ERPInventorySyncResponse {
  items: ERPInventoryItem[];
  syncedAt: string;
}

export interface ERPAllocationRequest {
  orderNumber: string;
  serialNumbers: string[];
  clientId: string;
}

export interface ERPIncomingOrderRequest {
  clientId: string;
  items: Array<{
    deviceType: string;
    make: string;
    model: string;
    serialNumber: string;
    imei?: string;
    conditionCode?: string;
  }>;
}

export interface ERPOrderResponse {
  orderNumber: string;
  status: string;
  createdAt: string;
}

export interface ERPConditionCodesResponse {
  clientId: string;
  conditionCodes: Array<{
    code: string;
    description: string;
    grade: string; // A, B, C, D
  }>;
}

class MockERPService {
  /**
   * Create a job in ERP and get job number
   */
  async createJob(_request: ERPJobRequest): Promise<ERPJobResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Generate mock job number
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 100000);
    const jobNumber = `ERP-${year}-${String(random).padStart(5, '0')}`;

    return {
      jobNumber,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Sync inventory to ERP (for job completion)
   */
  async syncInventoryToERP(_jobNumber: string, _assets: Array<{
    categoryName: string;
    quantity: number;
    serialNumbers?: string[];
  }>): Promise<void> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // In real implementation, this would POST to ERP API
  }

  /**
   * Get grading results from ERP
   */
  async getGradingResults(_jobNumber: string): Promise<ERPGradingResult> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 400));

    // Mock grading results
    // In real implementation, this would GET from ERP API
    return {
      assets: [
        {
          categoryName: 'Laptop',
          quantity: 10,
          grade: 'A',
          resaleValue: 150,
        },
        {
          categoryName: 'Desktop',
          quantity: 5,
          grade: 'B',
          resaleValue: 80,
        },
      ],
      totalValue: 1900, // 10 * 150 + 5 * 80
    };
  }

  /**
   * Get sanitisation results from ERP
   */
  async getSanitisationResults(_jobNumber: string): Promise<ERPSanitisationResult> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 400));

    // Mock sanitisation results
    return {
      assets: [
        {
          categoryName: 'Laptop',
          quantity: 10,
          sanitised: true,
          wipeMethod: 'Blancco',
          certificateUrl: 'https://blancco.example.com/cert/12345',
        },
        {
          categoryName: 'Desktop',
          quantity: 5,
          sanitised: true,
          wipeMethod: 'Physical Destruction',
        },
      ],
    };
  }

  /**
   * Get final buyback value from ERP
   */
  async getFinalBuybackValue(_jobNumber: string): Promise<number> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Mock final value (would come from ERP)
    return 1850; // Slightly different from grading estimate
  }

  /**
   * Get invoice reference from ERP
   */
  async getInvoiceReference(_jobNumber: string): Promise<{
    invoiceNumber: string;
    invoiceUrl: string;
  }> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));

    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 10000);
    const invoiceNumber = `INV-${year}-${String(random).padStart(5, '0')}`;

    return {
      invoiceNumber,
      invoiceUrl: `https://erp.example.com/invoices/${invoiceNumber}`,
    };
  }

  /**
   * Sync client inventory from ReuseOS ERP
   */
  async syncInventory(clientId: string): Promise<ERPInventorySyncResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 500));

    // Mock inventory items - in real implementation, this would GET from ReuseOS API
    // For now, return empty array - actual sync will be handled by inventory service
    return {
      items: [],
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Get inventory from ReuseOS ERP for a client
   */
  async getInventory(clientId: string): Promise<ERPInventoryItem[]> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 400));

    // Mock inventory - in real implementation, this would GET from ReuseOS API
    return [];
  }

  /**
   * Allocate inventory items in ReuseOS ERP
   * Called when device is allocated to a booking
   */
  async allocateInventory(request: ERPAllocationRequest): Promise<void> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // In real implementation, this would POST to ReuseOS API to mark items as allocated
    // POST /api/inventory/allocate
    // Body: { orderNumber, serialNumbers, clientId }
  }

  /**
   * Create incoming inventory order in ReuseOS ERP
   * Called when leaver items are collected and received at warehouse
   */
  async createIncomingOrder(request: ERPIncomingOrderRequest): Promise<ERPOrderResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 400));

    // Generate mock order number (same format as ITAD workflow)
    const year = new Date().getFullYear();
    const random = Math.floor(Math.random() * 100000);
    const orderNumber = `INCOMING-${year}-${String(random).padStart(5, '0')}`;

    return {
      orderNumber,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Get condition codes for a client from ReuseOS ERP
   * Condition codes are client-specific (e.g., IBMA, IBMB for IBM client)
   */
  async getConditionCodes(clientId: string, clientName: string): Promise<ERPConditionCodesResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 300));

    // Generate condition codes based on client name prefix
    // Example: IBM -> IBMA, IBMB, IBMC, IBMD
    // Example: ASOS -> ASOA, ASOB, ASOC, ASOD
    const prefix = clientName.substring(0, 3).toUpperCase();
    const conditionCodes = [
      { code: `${prefix}A`, description: 'Grade A', grade: 'A' },
      { code: `${prefix}B`, description: 'Grade B', grade: 'B' },
      { code: `${prefix}C`, description: 'Grade C', grade: 'C' },
      { code: `${prefix}D`, description: 'Grade D', grade: 'D' },
    ];

    return {
      clientId,
      conditionCodes,
    };
  }
}

export const mockERPService = new MockERPService();
