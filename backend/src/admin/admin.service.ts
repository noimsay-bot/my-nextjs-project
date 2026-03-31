import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Role, UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [totalUsers, activeUsers, pendingUsers, disabledUsers, adminUsers] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
      this.prisma.user.count({ where: { status: UserStatus.PENDING } }),
      this.prisma.user.count({ where: { status: UserStatus.DISABLED } }),
      this.prisma.user.count({ where: { role: Role.ADMIN } }),
    ]);

    return {
      totalUsers,
      activeUsers,
      pendingUsers,
      disabledUsers,
      adminUsers,
    };
  }

  async listUsers() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        loginId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        mustChangePassword: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateUserRole(userId: string, role: Role) {
    if (role === Role.ADMIN) {
      const adminCount = await this.prisma.user.count({ where: { role: Role.ADMIN } });
      if (adminCount < 1) {
        throw new BadRequestException("관리자 수를 확인할 수 없습니다.");
      }
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { role },
      });
    } catch {
      throw new NotFoundException("사용자를 찾을 수 없습니다.");
    }
  }

  async updateUserStatus(userId: string, status: UserStatus) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { status },
      });
    } catch {
      throw new NotFoundException("사용자를 찾을 수 없습니다.");
    }
  }
}
