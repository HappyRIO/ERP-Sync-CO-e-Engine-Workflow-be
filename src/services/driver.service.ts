// Driver Service

import { DriverRepository } from '../repositories/driver.repository';
import { NotFoundError, ValidationError } from '../utils/errors';
import prisma from '../config/database';

const driverRepo = new DriverRepository();

export class DriverService {
  /**
   * Get all drivers for a tenant
   */
  async getDrivers(tenantId: string) {
    return driverRepo.findByTenant(tenantId);
  }

  /**
   * Get driver by ID
   */
  async getDriverById(id: string) {
    const driver = await driverRepo.findById(id);
    if (!driver) {
      throw new NotFoundError('Driver', id);
    }
    return driver;
  }

  /**
   * Create or update driver profile
   * If userId is provided, use it. Otherwise, find or create user by email.
   */
  async createOrUpdateProfile(
    tenantId: string,
    data: {
      userId?: string;
      name?: string;
      email?: string;
      phone?: string;
      invitedBy?: string; // Admin user ID who is creating this profile
    }
  ) {
    let userId: string;

    if (data.userId) {
      // Use provided userId
      userId = data.userId;
    } else if (data.email) {
      // Find or create user by email
      if (!data.name) {
        throw new ValidationError('Name is required when creating a new driver');
      }

      let user = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (user) {
        // User exists - verify it's a driver
        if (user.role !== 'driver') {
          throw new ValidationError(`User with email ${data.email} exists but is not a driver`);
        }
        if (user.tenantId !== tenantId) {
          throw new ValidationError(`User with email ${data.email} belongs to a different tenant`);
        }
        // Update name if provided and different
        if (data.name && user.name !== data.name) {
          await prisma.user.update({
            where: { id: user.id },
            data: { name: data.name },
          });
        }
        userId = user.id;
      } else {
        // For new drivers, check if there's a pending invitation
        // If not, we'll create one automatically (for admin convenience)
        let pendingInvite: any = await prisma.invite.findFirst({
          where: {
            email: data.email,
            role: 'driver',
            tenantId: tenantId,
            acceptedAt: null,
            expiresAt: { gt: new Date() },
          },
        });

        // If no pending invitation exists, create one automatically
        // This allows admins to add driver profiles directly
        if (!pendingInvite) {
          // Get tenant info for invitation
          const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { name: true },
          });

          if (!tenant) {
            throw new ValidationError('Tenant not found');
          }

          // Get the admin user who is creating this profile
          // Use the provided invitedBy (admin creating the profile) or find the first admin
          let inviterId = data.invitedBy;
          if (!inviterId) {
            const adminUser = await prisma.user.findFirst({
              where: {
                tenantId: tenantId,
                role: 'admin',
              },
              select: { id: true },
            });
            if (!adminUser) {
              throw new ValidationError('No admin user found in tenant to create invitation');
            }
            inviterId = adminUser.id;
          }

          if (!inviterId) {
            throw new ValidationError('No inviter found to create driver invitation');
          }

          // Import invite service to create invitation
          const { InviteService } = await import('./invite.service');
          const inviteService = new InviteService();

          // Create invitation automatically
          pendingInvite = await inviteService.createInvite({
            email: data.email,
            role: 'driver',
            invitedBy: inviterId,
            tenantId: tenantId,
            tenantName: tenant.name,
          });
        }

        // Create new driver user with temporary password
        // Driver will need to accept the invitation to set their own password
        // Status should be 'pending' until they accept the invitation
        const { hashPassword } = await import('../utils/password');
        const tempPassword = await hashPassword(`Temp${Date.now()}${Math.random()}`);
        
        user = await prisma.user.create({
          data: {
            email: data.email,
            name: data.name,
            password: tempPassword,
            role: 'driver',
            status: 'pending', // Pending until invitation is accepted
            tenantId: tenantId,
          },
        });
        userId = user.id;
      }
    } else {
      throw new ValidationError('Either userId or email must be provided');
    }

    // Verify user exists and is a driver
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    if (user.role !== 'driver') {
      throw new ValidationError('User must have driver role to create driver profile');
    }

    return driverRepo.createProfile(userId, {
      phone: data.phone,
    });
  }

  /**
   * Update driver profile
   */
  async updateProfile(
    userId: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
    }
  ) {
    const profile = await prisma.driverProfile.findUnique({
      where: { userId },
    });

    // If profile does not exist yet, create it instead of failing
    if (!profile) {
      if (!data.name || !data.email || !data.phone) {
        throw new ValidationError(
          'To create your driver profile, please provide name, email, and phone number.'
        );
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email.trim())) {
        throw new ValidationError('Invalid email format');
      }

      // Update user name and email
      await prisma.user.update({
        where: { id: userId },
        data: {
          name: data.name.trim(),
          email: data.email.trim(),
        },
      });

      return driverRepo.createProfile(userId, {
        phone: data.phone,
      });
    }

    // Validate required fields on update
    if (data.name !== undefined && !data.name.trim()) {
      throw new ValidationError('Name is required');
    }
    if (data.phone !== undefined && !data.phone.trim()) {
      throw new ValidationError('Phone number is required');
    }

    // Update user name and email if provided
    const userUpdateData: { name?: string; email?: string } = {};
    if (data.name) {
      userUpdateData.name = data.name.trim();
    }
    if (data.email) {
      userUpdateData.email = data.email.trim();
    }
    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: userUpdateData,
      });
    }

    return driverRepo.updateProfile(userId, {
      phone: data.phone,
    });
  }

  /**
   * Delete driver profile and user account
   */
  async deleteProfile(userId: string) {
    // Check if driver exists
    const driver = await prisma.user.findUnique({
      where: { id: userId, role: 'driver' },
      include: { driverProfile: true },
    });

    if (!driver) {
      throw new NotFoundError('Driver', userId);
    }

    // Check if driver has any jobs assigned
    const jobsCount = await prisma.job.count({
      where: { driverId: userId },
    });

    if (jobsCount > 0) {
      // Set driverId to null for all jobs (schema has ON DELETE SET NULL, but we'll do it explicitly)
      await prisma.job.updateMany({
        where: { driverId: userId },
        data: { driverId: null },
      });
    }

    // Check if driver has uploaded evidence
    // Evidence must be preserved for audit purposes - set uploadedBy to null instead of deleting
    const evidenceCount = await prisma.evidence.count({
      where: { uploadedBy: userId },
    });

    if (evidenceCount > 0) {
      // Preserve evidence by setting uploadedBy to null (evidence is immutable and important for audit)
      await prisma.evidence.updateMany({
        where: { uploadedBy: userId },
        data: { uploadedBy: null },
      });
    }

    // Check if driver has uploaded documents
    // Documents must be preserved for audit purposes - set uploadedBy to null instead of deleting
    const documentCount = await prisma.document.count({
      where: { uploadedBy: userId },
    });

    if (documentCount > 0) {
      // Preserve documents by setting uploadedBy to null (documents are important for audit)
      // Note: This requires the schema to allow null for uploadedBy field
      await prisma.document.updateMany({
        where: { uploadedBy: userId },
        data: { uploadedBy: null as any },
      });
    }

    // Delete driver profile if it exists
    if (driver.driverProfile) {
      await driverRepo.deleteProfile(userId);
    }

    // Delete any pending invitations for this driver
    await prisma.invite.deleteMany({
      where: {
        email: driver.email,
        role: 'driver',
        acceptedAt: null,
      },
    });

    await prisma.user.delete({
      where: { id: userId },
    });

    return { success: true };
  }
}

