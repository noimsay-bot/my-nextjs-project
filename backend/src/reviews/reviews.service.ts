import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertReviewDto } from "./dto/review.dto";
import { getAllowedCriterionIds, getBonusCriterionIds, reviewRubrics } from "./rubrics";

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async getReviewableSubmission(submissionId: string, role: Role, reviewerId: string) {
    if (role === Role.USER) {
      throw new ForbiddenException("일반 사용자는 평가 화면에 접근할 수 없습니다.");
    }

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        owner: { select: { id: true, loginId: true, name: true, role: true } },
        cards: {
          orderBy: { sortOrder: "asc" },
          include: {
            reviews: {
              where: { reviewerId },
            },
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException("제출 정보를 찾을 수 없습니다.");
    }

    return {
      ...submission,
      rubrics: Object.fromEntries(
        submission.cards.map((card: typeof submission.cards[number]) => [card.id, reviewRubrics[card.reportType] ?? []]),
      ),
    };
  }

  async upsertReview(cardId: string, reviewerId: string, role: Role, dto: UpsertReviewDto) {
    if (role === Role.USER) {
      throw new ForbiddenException("일반 사용자는 평가할 수 없습니다.");
    }

    const card = await this.prisma.submissionCard.findUnique({
      where: { id: cardId },
      include: {
        submission: {
          include: {
            owner: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!card) {
      throw new NotFoundException("리포트 카드를 찾을 수 없습니다.");
    }

    const allowedCriteria = new Set(getAllowedCriterionIds(card.reportType));
    const normalizedSelected = Array.from(new Set(dto.selectedCriteria)).filter((id) => allowedCriteria.has(id));

    if (normalizedSelected.length !== dto.selectedCriteria.length) {
      throw new BadRequestException("허용되지 않은 평가 기준이 포함되어 있습니다.");
    }

    const scoreLookup = new Map(
      (reviewRubrics[card.reportType] ?? []).flatMap((section) =>
        section.criteria.map((criterion) => [criterion.id, criterion.score] as const),
      ),
    );

    const baseScore = normalizedSelected.reduce((sum, criterionId) => sum + (scoreLookup.get(criterionId) ?? 0), 0);
    const selectedBonusIds = new Set(getBonusCriterionIds(card.reportType));
    const hasBonusSelection = normalizedSelected.some((criterionId) => selectedBonusIds.has(criterionId));

    if ((hasBonusSelection || dto.bonusScore > 0) && !dto.bonusComment?.trim()) {
      throw new BadRequestException("가점 항목을 선택한 경우 추가 가점의견이 필요합니다.");
    }

    const totalScore = baseScore + dto.bonusScore;

    return this.prisma.review.upsert({
      where: {
        cardId_reviewerId: {
          cardId,
          reviewerId,
        },
      },
      update: {
        selectedCriteria: normalizedSelected,
        bonusScore: dto.bonusScore,
        bonusComment: dto.bonusComment?.trim() || null,
        totalScore,
        isFinal: dto.isFinal,
        finalizedAt: dto.isFinal ? new Date() : null,
      },
      create: {
        cardId,
        reviewerId,
        selectedCriteria: normalizedSelected,
        bonusScore: dto.bonusScore,
        bonusComment: dto.bonusComment?.trim() || null,
        totalScore,
        isFinal: dto.isFinal,
        finalizedAt: dto.isFinal ? new Date() : null,
      },
    });
  }
}
