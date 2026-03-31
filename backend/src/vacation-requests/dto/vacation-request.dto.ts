import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsInt, IsString, Max, Min } from "class-validator";
import { VacationRequestStatus } from "@prisma/client";

export class CreateVacationRequestDto {
  @ApiProperty({ example: "연차" })
  @IsString()
  type!: string;

  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  year!: number;

  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiProperty({ type: [String], example: ["2026-03-11", "2026-03-12"] })
  @IsArray()
  @IsString({ each: true })
  requestedDates!: string[];

  @ApiProperty({ example: "11,12" })
  @IsString()
  rawDates!: string;
}

export class UpdateVacationRequestStatusDto {
  @ApiProperty({ enum: VacationRequestStatus })
  status!: VacationRequestStatus;
}
