import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthenticatedUser } from "../common/interfaces/authenticated-user.interface";
import {
  CreateVacationRequestDto,
  UpdateVacationRequestStatusDto,
} from "./dto/vacation-request.dto";
import { VacationRequestsService } from "./vacation-requests.service";

@ApiTags("vacation-requests")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("vacation-requests")
export class VacationRequestsController {
  constructor(private readonly vacationRequestsService: VacationRequestsService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVacationRequestDto,
  ) {
    return this.vacationRequestsService.create(user.sub, dto);
  }

  @Get("me")
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.vacationRequestsService.mine(user.sub);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.vacationRequestsService.listAll(user.role, user.sub);
  }

  @Patch(":requestId/status")
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param("requestId") requestId: string,
    @Body() dto: UpdateVacationRequestStatusDto,
  ) {
    return this.vacationRequestsService.updateStatus(requestId, dto.status, user.role);
  }
}
