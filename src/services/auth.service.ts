import { UserRepository } from '../repositories/user.repository';
import { TenantRepository } from '../repositories/tenant.repository';
import { hashPassword, comparePassword, validatePasswordStrength } from '../utils/password';
import { generateToken } from '../utils/jwt';
import { ValidationError, NotFoundError, UnauthorizedError } from '../utils/errors';
import { UserRole } from '../types';
import prisma from '../config/database';
import { sanitizeString } from '../utils/sanitize';
// UUID generation not needed for Prisma (auto-generated)

const userRepo = new UserRepository();
const tenantRepo = new TenantRepository();

export class AuthService {
  async login(email: string, password: string) {
    const user = await userRepo.findByEmail(email);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await comparePassword(password, user.password);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Block login for inactive, declined, or pending users
    if (user.status !== 'active') {
      const userStatus = user.status as string;
      if (userStatus === 'declined') {
        throw new UnauthorizedError('Your signup request has been declined. Please contact support.');
      }
      if (user.status === 'pending') {
        throw new UnauthorizedError('Your account is pending approval. Please wait for admin approval.');
      }
      throw new UnauthorizedError('Account is not active. Please contact support.');
    }

    // Check if 2FA is required (admin users, except admin@reuse.com and super admins)
    const requiresTwoFactor = user.role === 'admin' && 
                               user.email.toLowerCase() !== 'admin@reuse.com' &&
                               !user.isSuperAdmin; // Super admins bypass 2FA

    if (requiresTwoFactor) {
      // Send 2FA verification code
      const { TwoFactorService } = await import('./two-factor.service');
      const twoFactorService = new TwoFactorService();
      
      await twoFactorService.sendVerificationCode(
        user.id,
        user.email,
        user.name,
        user.tenant.name
      );

      // Return response indicating 2FA is required
      return {
        requiresTwoFactor: true,
        userId: user.id,
        email: user.email,
        message: 'A verification code has been sent to your email address. Please enter it to complete login.',
      };
    }

    // No 2FA required - proceed with normal login
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
      tenantId: user.tenantId,
    });

    return {
      requiresTwoFactor: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        tenantId: user.tenantId,
        tenantName: user.tenant.name,
        avatar: user.avatar,
        createdAt: user.createdAt.toISOString(),
      },
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        logo: user.tenant.logo,
        favicon: user.tenant.favicon,
        primaryColor: user.tenant.primaryColor,
        accentColor: user.tenant.accentColor,
        theme: user.tenant.theme,
        createdAt: user.tenant.createdAt.toISOString(),
      },
      token,
    };
  }

  /**
   * Resend 2FA verification code
   */
  async resendTwoFactorCode(userId: string) {
    const user = await userRepo.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    // Check if user is admin (2FA only applies to admins)
    if (user.role !== 'admin') {
      throw new UnauthorizedError('Two-factor authentication is only required for administrators');
    }

    // Resend verification code
    const { TwoFactorService } = await import('./two-factor.service');
    const twoFactorService = new TwoFactorService();
    
    const result = await twoFactorService.resendVerificationCode(
      user.id,
      user.email,
      user.name,
      user.tenant.name
    );

    return result;
  }

  /**
   * Verify 2FA code and complete login
   */
  async verifyTwoFactor(userId: string, code: string) {
    const user = await userRepo.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    // Verify the code
    const { TwoFactorService } = await import('./two-factor.service');
    const twoFactorService = new TwoFactorService();
    
    const isValid = await twoFactorService.verifyCode(userId, code);
    if (!isValid) {
      throw new UnauthorizedError('Invalid or expired verification code');
    }

    // Generate token and return user data
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
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
        avatar: user.avatar,
        createdAt: user.createdAt.toISOString(),
      },
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        logo: user.tenant.logo,
        favicon: user.tenant.favicon,
        primaryColor: user.tenant.primaryColor,
        accentColor: user.tenant.accentColor,
        theme: user.tenant.theme,
        createdAt: user.tenant.createdAt.toISOString(),
      },
      token,
    };
  }

  async signup(data: {
    email: string;
    password: string;
    name: string;
    companyName: string;
    role?: 'client' | 'reseller';
  }) {
    // Sanitize user inputs to prevent XSS
    const sanitizedName = sanitizeString(data.name);
    const sanitizedCompanyName = sanitizeString(data.companyName);

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      throw new ValidationError('Invalid email format');
    }

    // Validate password strength (same requirements as change password)
    validatePasswordStrength(data.password);

    // Check if user already exists
    const existingUser = await userRepo.findByEmail(data.email);
    if (existingUser) {
      throw new ValidationError('An account with this email already exists');
    }

    // Drivers cannot sign up directly - they must be invited
    // @ts-expect-error - Runtime check for invalid role value
    if (data.role === 'driver') {
      throw new ValidationError('Drivers must be invited by an administrator. Please use the invitation link to join.');
    }

    // Generate slug from company name
    const slug = data.companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    
    // Check if slug already exists
    const existingTenant = await tenantRepo.findBySlug(slug);
    if (existingTenant) {
      throw new ValidationError('A company with this name already exists. Please use a different company name.');
    }

    // Create tenant
    const tenant = await tenantRepo.create({
      name: sanitizedCompanyName,
      slug: slug,
      primaryColor: '168, 70%, 35%',
      accentColor: '168, 60%, 45%',
      theme: 'auto',
    });

    // Hash password
    const hashedPassword = await hashPassword(data.password);

    // Create user with pending status - requires admin approval
    // Users start as 'pending' and require admin approval in all environments
    const userStatus = 'pending';
    
    const userRole = (data.role || 'client') as UserRole;

    const user = await userRepo.create({
      email: data.email,
      name: sanitizedName,
      password: hashedPassword,
      role: userRole,
      status: userStatus,
      tenantId: tenant.id,
    });

    // Notify all admin users about pending user approval
    try {
        // Get all admin users (admins are global across tenants)
        const adminUsers = await prisma.user.findMany({
          where: {
            role: 'admin',
            status: 'active',
            isSuperAdmin: false, // Exclude super admins from notifications
          },
          select: { id: true },
        });

        if (adminUsers.length > 0) {
          const { notifyPendingUserApproval } = await import('../utils/notifications');

          // Notify all admins about pending user approval
          await notifyPendingUserApproval(
            user.id,
            user.email,
            user.name,
            userRole,
            adminUsers.map(a => a.id),
            tenant.id
          );
        }
    } catch (error) {
      // Log error but don't fail signup if notification fails
      const { logger } = await import('../utils/logger');
      logger.error('Failed to notify admins of pending user signup', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: user.id,
      });
    }

    // If role is 'client', create a Client record with the organisationName from companyName
    if (userRole === 'client') {
      await prisma.client.create({
        data: {
          tenantId: tenant.id,
          name: sanitizedName,
          email: data.email,
          organisationName: sanitizedCompanyName, // Save companyName as organisationName
          status: 'active',
        },
      });
    }

    // If role is 'reseller', create an OrganisationProfile with organisationName from companyName
    if (userRole === 'reseller') {
      await prisma.organisationProfile.create({
        data: {
          userId: user.id,
          organisationName: sanitizedCompanyName,
          // These can be completed later in Settings → Organisation section
          registrationNumber: '',
          address: '',
          email: data.email,
          phone: '',
        },
      });
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role as UserRole,
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
        tenantName: tenant.name,
        avatar: user.avatar,
        createdAt: user.createdAt.toISOString(),
      },
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        logo: tenant.logo,
        favicon: tenant.favicon,
        primaryColor: tenant.primaryColor,
        accentColor: tenant.accentColor,
        theme: tenant.theme,
        createdAt: tenant.createdAt.toISOString(),
      },
      token,
    };
  }

  async getCurrentUser(userId: string) {
    const user = await userRepo.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
      avatar: user.avatar,
      createdAt: user.createdAt.toISOString(),
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    // Get user
    const user = await userRepo.findById(userId);
    if (!user) {
      throw new NotFoundError('User');
    }

    // Verify current password
    const isValid = await comparePassword(currentPassword, user.password);
    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Validate new password strength
    validatePasswordStrength(newPassword);

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update user password
    await userRepo.update(userId, {
      password: hashedPassword,
    });

    return { success: true };
  }
}
