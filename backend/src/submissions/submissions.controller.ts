import { Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface";
import { Body } from "@nestjs/common";
import { UpsertSubmissionDto } from "./dto/submission.dto";
import { SubmissionsService } from "./submissions.service";

@ApiTags("submissions")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("submissions")
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Get("me")
  mySubmission(@CurrentUser() user: AuthenticatedUser) {
    return this.submissionsService.getMySubmission(user.sub);
  }

  @Put("me")
  upsertMySubmission(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpsertSubmissionDto,
  ) {
    return this.submissionsService.upsertMySubmission(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.submissionsService.listVisibleSubmissions(user.role, user.sub);
  }

  @Get(":submissionId")
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("submissionId") submissionId: string,
  ) {
    return this.submissionsService.getSubmissionById(submissionId, user.role, user.sub);
  }
}
