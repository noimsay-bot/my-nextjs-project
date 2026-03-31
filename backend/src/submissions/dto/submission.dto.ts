import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsDateString, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class SubmissionCardDto {
  @ApiProperty({ example: "일반리포트" })
  @IsString()
  reportType!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  link!: string;

  @ApiProperty({ example: "2026-03-31", required: false })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty()
  @IsString()
  comment!: string;
}

export class UpsertSubmissionDto {
  @ApiProperty({ type: [SubmissionCardDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmissionCardDto)
  cards!: SubmissionCardDto[];
}
