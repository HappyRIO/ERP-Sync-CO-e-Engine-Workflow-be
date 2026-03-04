import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import prisma from '../config/database';
import { AuthenticatedRequest, ApiResponse } from '../types';

const router = Router();

router.use(authenticate);

// Get users (admin sees all users across all tenants)
router.get(
  '/',
  authorize('admin'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      // Build where clause - admins see all users (no tenantId filter)
      // Exclude super admin accounts from listings
      const where: any = {
        isSuperAdmin: false, // Always exclude super admins from user listings
      };
      
      // Filter by role if provided
      if (req.query.role) {
        where.role = req.query.role;
      }
      
      // Filter by status if provided
      if (req.query.status) {
        where.status = req.query.status;
      }
      
      // Filter by tenantId if provided
      if (req.query.tenantId) {
        where.tenantId = req.query.tenantId;
      }
      
      if (req.query.isActive !== undefined) {
        const isActive = req.query.isActive === 'true';
        where.status = isActive ? 'active' : { not: 'active' };
      }

      const users = await prisma.user.findMany({
        where,
        include: {
          tenant: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Transform users to match frontend ExtendedUser interface
      const transformedUsers = users.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        tenantId: user.tenantId,
        tenantName: user.tenant?.name || '',
        avatar: user.avatar || undefined,
        createdAt: user.createdAt.toISOString(),
        isActive: user.status === 'active', // For backwards compatibility
        lastLogin: undefined, // TODO: Track last login if needed
        invitedBy: undefined, // TODO: Get from Invite table if needed
      }));

      return res.json({
        success: true,
        data: transformedUsers,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

// Get user by ID
router.get(
  '/:id',
  authorize('admin'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const user = await prisma.user.findUnique({
        where: { id: req.params.id },
        include: {
          tenant: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        } as ApiResponse);
      }

      // Hide super admin accounts from being viewed
      if (user.isSuperAdmin) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
        } as ApiResponse);
      }

      // Transform user to match frontend ExtendedUser interface
      const transformedUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        tenantId: user.tenantId,
        tenantName: user.tenant?.name || '',
        avatar: user.avatar || undefined,
        createdAt: user.createdAt.toISOString(),
        isActive: user.status === 'active',
        lastLogin: undefined,
        invitedBy: undefined,
      };

      return res.json({
        success: true,
        data: transformedUser,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

// Update user status (activate/deactivate)
router.patch(
  '/:id/status',
  authorize('admin'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;
      const { status, isActive } = req.body;

      // Check if user exists first
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          tenant: true,
        },
      });

      // Prevent modifying super admin accounts
      if (user?.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify super admin account',
        } as ApiResponse);
      }

      if (!user) {
        return res.status(404).json({
          success: false,
          error: `User with ID "${id}" was not found.`,
        } as ApiResponse);
      }

      // Support both 'status' (string) and 'isActive' (boolean) for backward compatibility
      let newStatus: 'pending' | 'active' | 'inactive' | 'declined';
      
      if (status) {
        // If status is provided directly, validate and use it
        if (!['pending', 'active', 'inactive', 'declined'].includes(status)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid status. Must be one of: pending, active, inactive, declined',
          } as ApiResponse);
        }
        newStatus = status;
      } else if (typeof isActive === 'boolean') {
        // Legacy support: convert isActive boolean to status
        if (isActive) {
          newStatus = 'active';
        } else {
          // For deactivation: if pending, keep pending; otherwise set to inactive
          newStatus = user.status === 'pending' ? 'pending' : 'inactive';
        }
      } else {
        return res.status(400).json({
          success: false,
          error: 'Either "status" (pending|active|inactive) or "isActive" (boolean) must be provided',
        } as ApiResponse);
      }

      // Prevent admin from deactivating themselves
      if (id === req.user.userId && newStatus !== 'active') {
        return res.status(403).json({
          success: false,
          error: 'You cannot deactivate your own account',
        } as ApiResponse);
      }

      // Update user status
      const updatedUser = await prisma.user.update({
        where: { id },
        data: { status: newStatus as any }, // Cast to any to allow 'declined' status
        include: {
          tenant: true,
        },
      }) as any; // Cast result to any to access tenant property

      // Fetch tenant name
      const tenantName = updatedUser.tenant?.name || (await prisma.tenant.findUnique({
        where: { id: updatedUser.tenantId },
        select: { name: true },
      }))?.name || '';

      // Transform user to match frontend ExtendedUser interface
      const transformedUser = {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        status: updatedUser.status,
        tenantId: updatedUser.tenantId,
        tenantName,
        avatar: updatedUser.avatar || undefined,
        createdAt: updatedUser.createdAt.toISOString(),
        isActive: updatedUser.status === 'active',
        lastLogin: undefined,
        invitedBy: undefined,
      };

      return res.json({
        success: true,
        data: transformedUser,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

// Approve user (change from pending to active)
router.patch(
  '/:id/approve',
  authorize('admin'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          tenant: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: `User with ID "${id}" was not found.`,
        } as ApiResponse);
      }

      // Prevent modifying super admin accounts
      if (user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify super admin account',
        } as ApiResponse);
      }

      // Only approve if status is pending or declined
      // Declined users can be approved (treated as a new signup approval)
      const currentStatus = user.status as string;
      if (currentStatus !== 'pending' && currentStatus !== 'declined') {
        return res.status(400).json({
          success: false,
          error: `User cannot be approved. Current status: ${currentStatus || 'unknown'}. Only pending or declined users can be approved.`,
        } as ApiResponse);
      }

      // Update user status to active
      const updatedUser = await prisma.user.update({
        where: { id },
        data: { status: 'active' as any },
        include: {
          tenant: true,
        },
      }) as any; // Cast result to any to access tenant property

      // Fetch tenant name
      const tenantName = updatedUser.tenant?.name || (await prisma.tenant.findUnique({
        where: { id: updatedUser.tenantId },
        select: { name: true },
      }))?.name || '';

      // Transform user to match frontend ExtendedUser interface
      const transformedUser = {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        status: updatedUser.status,
        tenantId: updatedUser.tenantId,
        tenantName,
        avatar: updatedUser.avatar || undefined,
        createdAt: updatedUser.createdAt.toISOString(),
        isActive: updatedUser.status === 'active',
        lastLogin: undefined,
        invitedBy: undefined,
      };

      return res.json({
        success: true,
        data: transformedUser,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

// Decline user (change from pending to inactive)
router.patch(
  '/:id/decline',
  authorize('admin'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized',
        } as ApiResponse);
      }

      const { id } = req.params;

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          tenant: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          error: `User with ID "${id}" was not found.`,
        } as ApiResponse);
      }

      // Prevent modifying super admin accounts
      if (user.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Cannot modify super admin account',
        } as ApiResponse);
      }

      // Only decline if status is pending
      if (user.status !== 'pending') {
        return res.status(400).json({
          success: false,
          error: `User is not in pending status. Current status: ${user.status || 'unknown'}`,
        } as ApiResponse);
      }

      // Update user status to declined (rejected signup request)
      const updatedUser = await prisma.user.update({
        where: { id },
        data: { status: 'declined' as any }, // Cast to any to allow 'declined' status
        include: {
          tenant: true,
        },
      }) as any; // Cast result to any to access tenant property

      // Fetch tenant name
      const tenantName = updatedUser.tenant?.name || (await prisma.tenant.findUnique({
        where: { id: updatedUser.tenantId },
        select: { name: true },
      }))?.name || '';

      // Transform user to match frontend ExtendedUser interface
      const transformedUser = {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        status: updatedUser.status,
        tenantId: updatedUser.tenantId,
        tenantName,
        avatar: updatedUser.avatar || undefined,
        createdAt: updatedUser.createdAt.toISOString(),
        isActive: updatedUser.status === 'active',
        lastLogin: undefined,
        invitedBy: undefined,
      };

      return res.json({
        success: true,
        data: transformedUser,
      } as ApiResponse);
    } catch (error) {
      return next(error);
    }
  }
);

export default router;

