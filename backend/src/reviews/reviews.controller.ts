import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface";
import { UpsertReviewDto } from "./dto/review.dto";
import { ReviewsService } from "./reviews.service";

@ApiTags("reviews")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("reviews")
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get("submissions/:submissionId")
  submission(
    @CurrentUser() user: AuthenticatedUser,
    @Param("submissionId") submissionId: string,
  ) {
    return this.reviewsService.getReviewableSubmission(submissionId, user.role, user.sub);
  }

  @Put("cards/:cardId")
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param("cardId") cardId: string,
    @Body() dto: UpsertReviewDto,
  ) {
    return this.reviewsService.upsertReview(cardId, user.sub, user.role, dto);
  }
}
