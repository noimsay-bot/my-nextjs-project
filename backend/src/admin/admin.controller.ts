import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Role, UserStatus } from "@prisma/client";
import { Roles } from "../common/decorators/roles.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { AdminService } from "./admin.service";

@ApiTags("admin")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("stats")
  stats() {
    return this.adminService.getStats();
  }

  @Get("users")
  users() {
    return this.adminService.listUsers();
  }

  @Patch("users/:userId/role")
  updateRole(@Param("userId") userId: string, @Body() body: { role: Role }) {
    return this.adminService.updateUserRole(userId, body.role);
  }

  @Patch("users/:userId/status")
  updateStatus(@Param("userId") userId: string, @Body() body: { status: UserStatus }) {
    return this.adminService.updateUserStatus(userId, body.status);
  }
}
