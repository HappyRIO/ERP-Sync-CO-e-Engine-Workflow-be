import prisma from '../config/database';
import { UserRole, UserStatus } from '../types';

export class UserRepository {
  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      include: { tenant: true },
    });
  }

  async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      include: { tenant: true },
    });
  }

  async create(data: {
    email: string;
    name: string;
    password: string;
    role: UserRole;
    status?: UserStatus;
    tenantId: string;
    avatar?: string;
  }) {
    return prisma.user.create({
      data: data as any, // Cast to any to allow 'declined' status
      include: { tenant: true },
    });
  }

  async update(id: string, data: {
    name?: string;
    password?: string;
    status?: UserStatus;
    avatar?: string;
  }) {
    return prisma.user.update({
      where: { id },
      data: data as any, // Cast to any to allow 'declined' status
      include: { tenant: true },
    });
  }

  async findByTenant(tenantId: string) {
    return prisma.user.findMany({
      where: { 
        tenantId,
        isSuperAdmin: false, // Exclude super admins
      },
      include: { tenant: true },
    });
  }

  async findByRole(role: UserRole) {
    return prisma.user.findMany({
      where: { 
        role, 
        status: 'active',
        isSuperAdmin: false, // Exclude super admins
      },
      include: { tenant: true },
    });
  }
}

