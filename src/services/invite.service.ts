import prisma from '../config/database';
import { hashPassword, validatePasswordStrength } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { emailService } from '../utils/email';
import crypto from 'crypto';

interface CreateInviteData {
  email: string;
  role: 'client' | 'reseller' | 'driver';
  invitedBy: string;
  tenantId: string;
  tenantName: string;
}

interface AcceptInviteData {
  inviteToken: string;
  email: string;
  name: string;
  password: string;
}

interface ListInvitesData {
  invitedBy?: string; // Optional - if not provided, admin sees all
  tenantId?: string; // Optional - if not provided, admin sees all
  userRole?: string; // 'admin' or 'reseller'
  role?: string; // Filter by invite role: 'client' or 'reseller'
  status?: string; // 'pending', 'accepted', 'expired'
}

export class InviteService {
  /**
   * Generate a unique token for invitation
   */
  private generateInviteToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Create a new invitation
   */
  async createInvite(data: CreateInviteData) {
    const { email, role, invitedBy, tenantId, tenantName } = data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestError('This email address is already registered. Please use a different email address.');
    }

    const existingInvite = await prisma.invite.findFirst({
      where: {
        email,
        tenantId,
        acceptedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (existingInvite) {
      throw new BadRequestError('An active invite already exists for this email');
    }

    // Generate unique token
    let token: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    // Ensure token is unique
    while (!isUnique && attempts < maxAttempts) {
      token = this.generateInviteToken();
      const existing = await prisma.invite.findUnique({
        where: { token },
      });
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new Error('Failed to generate unique invite token');
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 14);

    const invite = await prisma.invite.create({
      data: {
        email,
        role,
        tenantId,
        tenantName,
        invitedBy,
        expiresAt,
        token: token!,
      },
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    // Send invitation email via EmailJS
    try {
      const isEmailConfigured = emailService.isConfigured();
      
      if (isEmailConfigured) {
        await emailService.sendInviteEmail({
          toEmail: email,
          inviteToken: token!,
          role,
          tenantName,
          inviterName: invite.inviter.name,
          expiresInDays: 14,
        });
      }
    } catch (error) {
      // Log error but don't fail invitation creation
      // The invitation is still valid even if email fails
      const { logger } = await import('../utils/logger');
      logger.error('Failed to send invitation email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        email,
      });
    }

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      tenantId: invite.tenantId,
      tenantName: invite.tenantName,
      invitedBy: invite.invitedBy,
      invitedAt: invite.invitedAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: invite.acceptedAt ? invite.acceptedAt.toISOString() : undefined,
      token: invite.token,
    };
  }

  /**
   * Get invitation by token
   */
  async getInviteByToken(token: string) {
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!invite) {
      throw new NotFoundError('Invitation not found');
    }

    if (new Date(invite.expiresAt) < new Date()) {
      throw new BadRequestError('This invitation has expired');
    }
    if (invite.acceptedAt) {
      throw new BadRequestError('This invitation has already been accepted');
    }

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      tenantId: invite.tenantId,
      tenantName: invite.tenantName,
      invitedBy: invite.invitedBy,
      invitedAt: invite.invitedAt.toISOString(),
      expiresAt: invite.expiresAt.toISOString(),
      acceptedAt: undefined, // Already checked above that it's null
      token: invite.token,
    };
  }

  /**
   * Accept invitation and create user account
   */
  async acceptInvite(data: AcceptInviteData) {
    const { inviteToken, email, name, password } = data;

    const invite = await prisma.invite.findUnique({
      where: { token: inviteToken },
    });

    if (!invite) {
      throw new NotFoundError('Invitation not found');
    }

    if (invite.email !== email) {
      throw new BadRequestError('Email does not match the invitation');
    }

    if (new Date(invite.expiresAt) < new Date()) {
      throw new BadRequestError('This invitation has expired');
    }
    if (invite.acceptedAt) {
      throw new BadRequestError('This invitation has already been accepted');
    }

    // Validate password strength (same requirements as signup and change password)
    validatePasswordStrength(password);

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Check if user already exists
    // This can happen if admin added driver profile before invitation was accepted
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    let user;
    if (existingUser) {
      // If user exists and is a driver with pending status, allow them to accept invitation
      if (existingUser.role === 'driver' && existingUser.status === 'pending' && invite.role === 'driver') {
        // Update user password and status to active
        user = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            password: hashedPassword,
            status: 'active', // Activate when invitation is accepted
          },
          include: {
            tenant: true,
          },
        });
      } else {
        throw new BadRequestError('A user with this email already exists');
      }
    } else {
      user = await prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
          role: invite.role,
          status: 'active', // Invited users are auto-approved
          tenantId: invite.tenantId,
        },
        include: {
          tenant: true,
        },
      });
    }

    const inviter = await prisma.user.findUnique({
      where: { id: invite.invitedBy },
      select: { id: true, role: true, name: true, email: true },
    });

    // If role is 'client', create a Client record
    if (invite.role === 'client') {
      await prisma.client.create({
        data: {
          tenantId: invite.tenantId,
          name: user.name,
          email: user.email,
          status: 'active', // Clients who accept invitations are active
          resellerId: inviter && inviter.role === 'reseller' ? inviter.id : null,
          resellerName: inviter && inviter.role === 'reseller' ? inviter.name : null,
        },
      });
    }

    // Mark invitation as accepted
    await prisma.invite.update({
      where: { id: invite.id },
      data: {
        acceptedAt: new Date(),
      },
    });

    // Send email notification to all admins and inviter about invitation acceptance
    // If inviter is an admin, they will receive only one email (no duplicates)
    try {
      const { emailService } = await import('../utils/email');
      const { logger } = await import('../utils/logger');
      
      // Get all active admin users
      const adminUsers = await prisma.user.findMany({
        where: {
          role: 'admin',
          status: 'active',
          isSuperAdmin: false, // Exclude super admins from notifications
        },
        select: { id: true, email: true, name: true },
      });

      // Create a Set of unique email recipients (admins + inviter, deduplicated)
      const recipientEmails = new Set<string>();
      const recipients: Array<{ email: string; name: string }> = [];

      // Add all admin emails
      adminUsers.forEach(admin => {
        if (admin.email) {
          recipientEmails.add(admin.email);
          recipients.push({ email: admin.email, name: admin.name });
        }
      });

      // Add inviter email if they exist and have an email (will be deduplicated if they're an admin)
      if (inviter && inviter.email) {
        if (!recipientEmails.has(inviter.email)) {
          recipientEmails.add(inviter.email);
          recipients.push({ email: inviter.email, name: inviter.name });
        }
      }

      // Send email to all unique recipients
      if (recipients.length > 0) {
        const emailPromises = recipients.map(recipient =>
          emailService.sendInvitationAcceptedEmail({
            toEmail: recipient.email,
            inviterName: inviter?.name || 'System',
            acceptedUserName: user.name,
            acceptedUserEmail: user.email,
            acceptedUserRole: invite.role as 'client' | 'reseller' | 'driver',
            tenantName: user.tenant.name,
          }).catch((error) => {
            // Log individual email failures but don't fail the whole operation
            logger.warn('Failed to send invitation accepted email to recipient', {
              recipientEmail: recipient.email,
              acceptedUserId: user.id,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          })
        );

        // Send all emails in parallel (don't wait for all to complete)
        Promise.all(emailPromises).catch((error) => {
          logger.warn('Some invitation accepted emails failed to send', {
            acceptedUserId: user.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      }
    } catch (error) {
      // Log error but don't fail invitation acceptance
      const { logger } = await import('../utils/logger');
      logger.warn('Failed to send invitation accepted emails', {
        inviterId: inviter?.id,
        acceptedUserId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
        avatar: user.avatar || undefined,
        createdAt: user.createdAt.toISOString(),
      },
      token,
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        logo: user.tenant.logo || undefined,
        favicon: user.tenant.favicon || undefined,
        primaryColor: user.tenant.primaryColor || undefined,
        accentColor: user.tenant.accentColor || undefined,
        theme: user.tenant.theme || 'auto',
        createdAt: user.tenant.createdAt.toISOString(),
      },
    };
  }

  /**
   * List invitations
   * - Admin: Can see all invitations (optionally filtered by role)
   * - Reseller: Can see only invitations they sent
   */
  async listInvites(data: ListInvitesData) {
    const { invitedBy, tenantId, userRole, role, status } = data;

    const where: any = {};

    // Role-based filtering
    if (userRole === 'admin') {
      // Admin can see all invitations
      // If role filter is provided, filter by invite role
      if (role) {
        where.role = role;
      }
      // Admin sees across all tenants (no tenantId filter)
    } else if (userRole === 'reseller') {
      // Reseller sees only invitations they sent
      if (invitedBy) {
        where.invitedBy = invitedBy;
      }
      if (tenantId) {
        where.tenantId = tenantId;
      }
      // Resellers can only invite clients, so filter by role='client'
      where.role = 'client';
    } else {
      // Fallback: filter by invitedBy if provided
      if (invitedBy) {
        where.invitedBy = invitedBy;
      }
      if (tenantId) {
        where.tenantId = tenantId;
      }
      if (role) {
        where.role = role;
      }
    }

    // Filter by status
    if (status === 'pending') {
      where.acceptedAt = null;
      where.expiresAt = { gt: new Date() };
    } else if (status === 'accepted') {
      where.acceptedAt = { not: null };
    } else if (status === 'expired') {
      where.acceptedAt = null;
      where.expiresAt = { lt: new Date() };
    }

    const invites = await prisma.invite.findMany({
      where,
      include: {
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        invitedAt: 'desc',
      },
    });

    return invites.map(invite => {
      const isExpired = new Date(invite.expiresAt) < new Date() && !invite.acceptedAt;
      const isAccepted = !!invite.acceptedAt;

      return {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        tenantId: invite.tenantId,
        tenantName: invite.tenantName,
        invitedBy: invite.invitedBy,
        invitedAt: invite.invitedAt.toISOString(),
        expiresAt: invite.expiresAt.toISOString(),
        acceptedAt: invite.acceptedAt ? invite.acceptedAt.toISOString() : undefined,
        token: invite.token,
        status: isAccepted ? 'accepted' : isExpired ? 'expired' : 'pending',
        inviter: invite.inviter,
      };
    });
  }

  /**
   * Cancel an invitation
   */
  async cancelInvite(inviteId: string, userId: string, tenantId: string) {
    // Find the invitation
    const invite = await prisma.invite.findUnique({
      where: { id: inviteId },
    });

    if (!invite) {
      throw new NotFoundError('Invitation not found');
    }

    // Verify the user has permission to cancel this invitation
    if (invite.invitedBy !== userId || invite.tenantId !== tenantId) {
      throw new BadRequestError('You can only cancel invitations you sent');
    }

    // Check if already accepted
    if (invite.acceptedAt) {
      throw new BadRequestError('Cannot cancel an accepted invitation');
    }

    await prisma.invite.delete({
      where: { id: inviteId },
    });
  }
}

