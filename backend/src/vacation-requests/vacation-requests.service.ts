import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Role, VacationRequestStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateVacationRequestDto } from "./dto/vacation-request.dto";

@Injectable()
export class VacationRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateVacationRequestDto) {
    return this.prisma.vacationRequest.create({
      data: {
        requesterId: userId,
        type: dto.type,
        year: dto.year,
        month: dto.month,
        requestedDates: dto.requestedDates,
        rawDates: dto.rawDates,
      },
    });
  }

  async mine(userId: string) {
    return this.prisma.vacationRequest.findMany({
      where: { requesterId: userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async listAll(role: Role, userId: string) {
    if (role === Role.USER || role === Role.REVIEWER || role === Role.TEAM_LEAD) {
      return this.mine(userId);
    }

    return this.prisma.vacationRequest.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        requester: { select: { id: true, loginId: true, name: true, role: true } },
      },
    });
  }

  async updateStatus(requestId: string, status: VacationRequestStatus, role: Role) {
    if (role !== Role.ADMIN && role !== Role.DESK) {
      throw new ForbiddenException("휴가 상태 변경 권한이 없습니다.");
    }

    try {
      return await this.prisma.vacationRequest.update({
        where: { id: requestId },
        data: { status },
      });
    } catch {
      throw new NotFoundException("휴가 요청을 찾을 수 없습니다.");
    }
  }
}
