import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class UpsertReviewDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  selectedCriteria!: string[];

  @ApiProperty({ minimum: 0, maximum: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  bonusScore!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bonusComment?: string;

  @ApiProperty()
  @IsBoolean()
  isFinal!: boolean;
}
