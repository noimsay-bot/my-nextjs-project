import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Role } from "@prisma/client";
import { IsArray, IsEmail, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
  @ApiProperty({ example: "honggildong" })
  @Matches(/^[a-z][a-z0-9._-]{3,19}$/)
  loginId!: string;

  @ApiProperty({ example: "홍길동" })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name!: string;

  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: "ChangeMe123!" })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({ example: "010-1111-2222" })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ enum: Role, default: Role.USER })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}

export class LoginDto {
  @ApiProperty({ example: "honggildong" })
  @IsString()
  loginId!: string;

  @ApiProperty({ example: "ChangeMe123!" })
  @IsString()
  password!: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class VerifyEmailDto {
  @ApiProperty()
  @IsString()
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: "honggildong" })
  @IsString()
  loginId!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty({ example: "NewPassword123!" })
  @IsString()
  @MinLength(8)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: "CurrentPassword123!" })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ example: "NextPassword123!" })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class LogoutDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class AuthTokensResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty()
  expiresIn!: string;
}

export class CurrentSessionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  loginId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: Role })
  role!: Role;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional()
  phone?: string | null;

  @ApiProperty()
  emailVerified!: boolean;

  @ApiProperty()
  mustChangePassword!: boolean;
}
