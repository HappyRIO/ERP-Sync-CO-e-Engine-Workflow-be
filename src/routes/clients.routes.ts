import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import prisma from '../config/database';
import { AuthenticatedRequest, ApiResponse } from '../types';

const router = Router();

router.use(authenticate);

// Get clients (admin sees all, reseller sees their clients)
router.get(
  '/',
  authorize('admin', 'reseller'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      // Build where clause based on role
      const where: any = {};
      
      if (req.user.role === 'admin') {
        // Admins see all clients across all tenants (no tenantId filter)
        // No additional filtering needed - empty where clause means all clients
      } else if (req.user.role === 'reseller') {
        // Resellers only see clients they invited (filtered by resellerId)
        // Also filter by tenantId for resellers (they work within their tenant)
        where.tenantId = req.user.tenantId;
        where.resellerId = req.user.userId;
      }
      
      // Note: We don't filter by status here because status can come from either
      // Client.status or User.status. We'll filter after fetching user status.

      // Search query filter
      if (req.query.searchQuery) {
        where.OR = [
          { name: { contains: req.query.searchQuery as string, mode: 'insensitive' } },
          { email: { contains: req.query.searchQuery as string, mode: 'insensitive' } },
          { organisationName: { contains: req.query.searchQuery as string, mode: 'insensitive' } },
        ];
      }

      // Parse pagination parameters with defaults
      const page = req.query.page ? Math.max(1, parseInt(req.query.page as string)) : 1;
      const limit = req.query.limit ? Math.min(100, Math.max(1, parseInt(req.query.limit as string))) : 20; // Default 20, max 100

      // Get all clients matching base filters (without status filter, we'll filter after)
      const allClients = await prisma.client.findMany({
        where,
        select: {
          id: true,
          name: true,
          organisationName: true,
          tenantId: true,
          email: true,
          phone: true,
          resellerId: true,
          resellerName: true,
          status: true,
          createdAt: true,
          tenant: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: {
              bookings: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      });

      // Fetch user status for all clients (linked by email)
      // Use case-insensitive email matching to handle any case differences
      const clientEmails = allClients.map(c => c.email).filter((email): email is string => !!email);
      
      if (clientEmails.length === 0) {
        // No clients with emails, skip user lookup
        const transformedClients = allClients.map(client => ({
          id: client.id,
          name: client.name,
          organisationName: client.organisationName || undefined,
          tenantId: client.tenantId,
          tenantName: client.tenant?.name || '',
          email: client.email || '',
          contactName: client.name,
          contactPhone: client.phone || '',
          resellerId: client.resellerId,
          resellerName: client.resellerName,
          status: client.status,
          createdAt: client.createdAt.toISOString(),
          totalBookings: client._count.bookings,
          totalJobs: 0,
          totalValue: 0,
        }));
        
        // Apply status filter and pagination
        let filteredClients = transformedClients;
        if (req.query.status) {
          filteredClients = filteredClients.filter(c => c.status === req.query.status);
        }
        const total = filteredClients.length;
        const offset = (page - 1) * limit;
        filteredClients = filteredClients.slice(offset, offset + limit);
        
        return res.json({
          success: true,
          data: filteredClients,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        } as ApiResponse);
      }
      
      const clientEmailsLower = clientEmails.map(e => e.toLowerCase());
      
      // Fetch all client users - for admin, fetch from all tenants; for reseller, only their tenant
      // This ensures we find users even if they're in different tenants (shouldn't happen, but be safe)
      const tenantIds = req.user.role === 'admin' 
        ? undefined // Admin: fetch from all tenants
        : [...new Set(allClients.map(c => c.tenantId))]; // Reseller: only their tenant
      
      const userWhere: any = {
        role: 'client',
        isSuperAdmin: false, // Exclude super admins
      };
      if (tenantIds) {
        userWhere.tenantId = { in: tenantIds };
      }
      
      const users = await prisma.user.findMany({
        where: userWhere,
        select: {
          email: true,
          status: true,
          id: true,
          tenantId: true,
        },
      });

      // Create a map of email to user status (case-insensitive lookup)
      // Use lowercase email as key for case-insensitive matching
      // Match users whose email (lowercase) matches one of the client emails
      const userStatusMap = new Map(
        users
          .filter(u => u.email && clientEmailsLower.includes(u.email.toLowerCase()))
          .map(u => [u.email!.toLowerCase(), { status: u.status, userId: u.id, originalEmail: u.email! }])
      );

      // Transform clients and calculate display status
      let transformedClients = allClients.map(client => {
        // Use case-insensitive email lookup
        const userInfo = client.email ? userStatusMap.get(client.email.toLowerCase()) : null;
        
        // User status ALWAYS takes precedence - use user.status if user exists, otherwise use client.status
        // This ensures that when a client user is declined/deactivated in /users page, it reflects in /clients page
        // Important: 'declined' status from User table MUST override Client.status
        // If userInfo exists, we MUST use userInfo.status, even if it's 'declined', 'inactive', etc.
        const displayStatus = userInfo ? userInfo.status : client.status;
        
        // Debug: Log if we have a client with email but no user found (potential issue)
        if (client.email && !userInfo && req.user?.role === 'admin') {
          // Only log in development/debug mode - this helps identify email matching issues
          // In production, we'll just use client.status as fallback
        }
        
        return {
          id: client.id,
          name: client.name,
          organisationName: client.organisationName || undefined,
          tenantId: client.tenantId,
          tenantName: client.tenant?.name || '',
          email: client.email || '',
          contactName: client.name, // Use name as contact name
          contactPhone: client.phone || '',
          resellerId: client.resellerId,
          resellerName: client.resellerName,
          status: displayStatus as any, // Use user status (includes 'declined') - cast to any to allow UserStatus values
          userStatus: userInfo?.status, // Include user status separately for reference
          userId: userInfo?.userId, // Include userId for approval
          createdAt: client.createdAt.toISOString(),
          totalBookings: client._count.bookings,
          totalJobs: 0, // TODO: Calculate from jobs linked to bookings
          totalValue: 0, // TODO: Calculate from bookings/jobs
        };
      });

      // Filter by status if provided (now using display status)
      if (req.query.status) {
        const statusFilter = req.query.status as string;
        transformedClients = transformedClients.filter(client => client.status === statusFilter);
      }

      // Calculate total after filtering
      const total = transformedClients.length;

      // Apply pagination after filtering
      const offset = (page - 1) * limit;
      transformedClients = transformedClients.slice(offset, offset + limit);

      return res.json({
        success: true,
        data: transformedClients,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

// Get client by ID
router.get(
  '/:id',
  authorize('admin', 'reseller'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const client = await prisma.client.findUnique({
        where: { id: req.params.id },
        include: {
          tenant: true,
          bookings: {
            orderBy: { createdAt: 'desc' },
          },
          sites: true,
          _count: {
            select: {
              bookings: true,
            },
          },
        },
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          error: 'Client not found',
        } as ApiResponse);
      }

      // Check access
      // Admins can access any client (no restrictions)
      // Resellers can only access clients they invited (must be in their tenant and have their resellerId)
      if (req.user.role === 'reseller') {
        if (client.tenantId !== req.user.tenantId) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: Client not in your tenant',
          } as ApiResponse);
        }
        if (client.resellerId !== req.user.userId) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: You can only access clients you have invited',
          } as ApiResponse);
        }
      }

      // Fetch user status if client has an email (to match user status with client status)
      // Use case-insensitive email matching
      let displayStatus: string = client.status;
      let userId: string | undefined;
      if (client.email) {
        const user = await prisma.user.findFirst({
          where: {
            email: { equals: client.email, mode: 'insensitive' },
            role: 'client',
          },
          select: {
            id: true,
            status: true,
          },
        });
        if (user) {
          // User status takes precedence - use user.status if user exists, otherwise use client.status
          // Important: 'declined' status from User table should override Client.status
          displayStatus = user.status as string; // Cast to string to allow UserStatus values like 'declined'
          userId = user.id;
        }
      }

      // Transform client to match frontend interface
      const transformedClient = {
        id: client.id,
        name: client.name,
        organisationName: client.organisationName || undefined,
        tenantId: client.tenantId,
        tenantName: client.tenant?.name || '',
        email: client.email || '',
        contactName: client.name,
        contactPhone: client.phone || '',
        resellerId: client.resellerId,
        resellerName: client.resellerName,
        status: displayStatus as any, // Use user status (includes 'declined') - cast to allow UserStatus values
        userId: userId, // Include userId for reference
        createdAt: client.createdAt.toISOString(),
        totalBookings: client._count.bookings,
        totalJobs: 0, // TODO: Calculate from jobs
        totalValue: 0, // TODO: Calculate from bookings/jobs
      };

      return res.json({
        success: true,
        data: transformedClient,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

// Get client profile by user (for client role - they can view their own profile)
router.get(
  '/profile/me',
  authorize('client'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      // Find client by user email
      const client = await prisma.client.findFirst({
        where: {
          email: req.user.email,
          tenantId: req.user.tenantId,
        },
        include: {
          tenant: true,
        },
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          error: 'Client profile not found',
        } as ApiResponse);
      }

      return res.json({
        success: true,
        data: {
          id: client.id,
          name: client.name,
          email: client.email || '',
          phone: client.phone || '',
          organisationName: client.organisationName || '',
          registrationNumber: client.registrationNumber || '',
          address: client.address || '',
          hasProfile: !!(client.email && client.phone && client.organisationName && client.registrationNumber && client.address),
        },
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

// Update client profile (for client role - they can update their own profile)
router.patch(
  '/profile/me',
  authorize('client'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { name, email, phone, organisationName, registrationNumber, address } = req.body;

      // Validate required fields
      if (!name || !email || !phone || !organisationName || !registrationNumber || !address) {
        return res.status(400).json({
          success: false,
          error: 'Name, email, phone, organisation name, registration number, and address are required',
        } as ApiResponse);
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format',
        } as ApiResponse);
      }

      // Check if email is already in use by another user (if email is being changed)
      if (email.trim() !== req.user.email) {
        const existingUser = await prisma.user.findUnique({
          where: { email: email.trim() },
        });
        if (existingUser && existingUser.id !== req.user.userId) {
          return res.status(400).json({
            success: false,
            error: 'This email address is already registered',
          } as ApiResponse);
        }
      }

      // Find client by user email
      const client = await prisma.client.findFirst({
        where: {
          email: req.user.email,
          tenantId: req.user.tenantId,
        },
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          error: 'Client profile not found',
        } as ApiResponse);
      }

      // Update user name and email (both should be synchronized)
      const updatedUser = await prisma.user.update({
        where: { id: req.user.userId },
        data: { 
          name: name.trim(),
          email: email.trim(),
        },
        select: { name: true, email: true },
      });

      // Update client profile
      const updatedClient = await prisma.client.update({
        where: { id: client.id },
        data: {
          email,
          phone,
          organisationName,
          registrationNumber,
          address,
        },
        include: {
          tenant: true,
        },
      });

      return res.json({
        success: true,
        data: {
          id: updatedClient.id,
          name: updatedUser.name, // Return updated user name
          email: updatedClient.email || '',
          phone: updatedClient.phone || '',
          organisationName: updatedClient.organisationName || '',
          registrationNumber: updatedClient.registrationNumber || '',
          address: updatedClient.address || '',
          hasProfile: !!(updatedClient.email && updatedClient.phone && updatedClient.organisationName && updatedClient.registrationNumber && updatedClient.address),
        },
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

// Update client status (admin can update all, reseller can update their invited clients)
router.patch(
  '/:id/status',
  authorize('admin', 'reseller'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { status } = req.body;

      // Validate status
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status. Must be one of: active, inactive',
        } as ApiResponse);
      }

      // Check if client exists
      // Admins can access any client, resellers can only access clients in their tenant
      const whereClause: any = { id };
      
      if (req.user.role === 'reseller') {
        // Resellers can only access clients in their tenant
        whereClause.tenantId = req.user.tenantId;
      }
      // Admins can access any client (no tenantId filter)
      
      const client = await prisma.client.findFirst({
        where: whereClause,
      });

      if (!client) {
        return res.status(404).json({
          success: false,
          error: `Client with ID "${id}" was not found.`,
        } as ApiResponse);
      }

      // Resellers can only update clients they invited
      if (req.user.role === 'reseller' && client.resellerId !== req.user.userId) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You can only manage clients you have invited',
        } as ApiResponse);
      }

      // Update client status
      const updatedClient = await prisma.client.update({
        where: { id },
        data: { status },
        include: {
          tenant: true,
          bookings: {
            take: 5,
            orderBy: { createdAt: 'desc' },
          },
          _count: {
            select: {
              bookings: true,
            },
          },
        },
      });

      // Transform client to match frontend interface
      const transformedClient = {
        id: updatedClient.id,
        name: updatedClient.name,
        organisationName: updatedClient.organisationName || undefined,
        tenantId: updatedClient.tenantId,
        tenantName: updatedClient.tenant?.name || '',
        email: updatedClient.email || '',
        contactName: updatedClient.name,
        contactPhone: updatedClient.phone || '',
        resellerId: updatedClient.resellerId,
        resellerName: updatedClient.resellerName,
        status: updatedClient.status,
        createdAt: updatedClient.createdAt.toISOString(),
        totalBookings: updatedClient._count.bookings,
        totalJobs: 0, // TODO: Calculate from jobs
        totalValue: 0, // TODO: Calculate from bookings/jobs
      };

      return res.json({
        success: true,
        data: transformedClient,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;

