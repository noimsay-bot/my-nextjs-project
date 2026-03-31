import { Module } from "@nestjs/common";
import { VacationRequestsController } from "./vacation-requests.controller";
import { VacationRequestsService } from "./vacation-requests.service";

@Module({
  controllers: [VacationRequestsController],
  providers: [VacationRequestsService],
})
export class VacationRequestsModule {}
