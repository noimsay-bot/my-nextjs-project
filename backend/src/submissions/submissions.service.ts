import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertSubmissionDto } from "./dto/submission.dto";

@Injectable()
export class SubmissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMySubmission(userId: string) {
    return this.prisma.submission.findUnique({
      where: { ownerId: userId },
      include: {
        owner: {
          select: { id: true, loginId: true, name: true, role: true },
        },
        cards: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });
  }

  async upsertMySubmission(userId: string, dto: UpsertSubmissionDto) {
    if (dto.cards.length === 0 || dto.cards.length > 3) {
      throw new BadRequestException("리포트 카드는 1개 이상 3개 이하로 제출해야 합니다.");
    }

    const existing = await this.prisma.submission.findUnique({
      where: { ownerId: userId },
      select: { id: true },
    });

    if (!existing) {
      return this.prisma.submission.create({
        data: {
          ownerId: userId,
          cards: {
            create: dto.cards.map((card, index) => ({
              reportType: card.reportType,
              title: card.title,
              link: card.link,
              date: card.date ? new Date(card.date) : null,
              comment: card.comment,
              sortOrder: index,
            })),
          },
        },
        include: { cards: { orderBy: { sortOrder: "asc" } } },
      });
    }

    await this.prisma.submissionCard.deleteMany({ where: { submissionId: existing.id } });

    return this.prisma.submission.update({
      where: { ownerId: userId },
      data: {
        cards: {
          create: dto.cards.map((card, index) => ({
            reportType: card.reportType,
            title: card.title,
            link: card.link,
            date: card.date ? new Date(card.date) : null,
            comment: card.comment,
            sortOrder: index,
          })),
        },
      },
      include: { cards: { orderBy: { sortOrder: "asc" } } },
    });
  }

  async listVisibleSubmissions(role: Role, userId: string) {
    if (role === Role.USER) {
      const mine = await this.getMySubmission(userId);
      return mine ? [mine] : [];
    }

    return this.prisma.submission.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        owner: { select: { id: true, loginId: true, name: true, role: true } },
        cards: { orderBy: { sortOrder: "asc" } },
      },
    });
  }

  async getSubmissionById(submissionId: string, role: Role, userId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        owner: { select: { id: true, loginId: true, name: true, role: true } },
        cards: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!submission) {
      throw new NotFoundException("제출 정보를 찾을 수 없습니다.");
    }

    if (role === Role.USER && submission.ownerId !== userId) {
      throw new ForbiddenException("다른 사용자의 제출 정보에는 접근할 수 없습니다.");
    }

    return submission;
  }
}
