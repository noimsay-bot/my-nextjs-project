import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { MailTokenType, Prisma, Role, User, UserStatus } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "../mail/mail.service";
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RegisterDto,
  ResetPasswordDto,
} from "./dto/auth.dto";

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  private hashPassword(password: string) {
    return bcrypt.hash(password, 12);
  }

  private comparePassword(password: string, passwordHash: string) {
    return bcrypt.compare(password, passwordHash);
  }

  private hashOpaqueToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async writeAuditLog(input: {
    actorId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    metadata?: Prisma.InputJsonValue;
  }) {
    await this.prisma.auditLog.create({ data: input });
  }

  private async createMailToken(userId: string, type: MailTokenType) {
    const rawToken = randomBytes(32).toString("hex");
    const tokenHash = this.hashOpaqueToken(rawToken);
    const expiresInHours = type === MailTokenType.EMAIL_VERIFICATION ? 24 : 2;

    await this.prisma.mailToken.create({
      data: {
        userId,
        type,
        tokenHash,
        expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
      },
    });

    return rawToken;
  }

  private async sendVerificationEmail(user: Pick<User, "id" | "email" | "name">) {
    const token = await this.createMailToken(user.id, MailTokenType.EMAIL_VERIFICATION);
    const url = `${this.configService.getOrThrow<string>("APP_ORIGIN")}/login?mode=verify&token=${token}`;

    await this.mailService.sendMail({
      to: user.email,
      subject: "[JTBC Portal] 이메일 인증",
      text: `${user.name}님,\n아래 링크에서 이메일 인증을 완료해 주세요.\n${url}`,
      html: `<p>${user.name}님,</p><p>아래 링크에서 이메일 인증을 완료해 주세요.</p><p><a href="${url}">${url}</a></p>`,
    });
  }

  private async sendPasswordResetEmail(user: Pick<User, "id" | "email" | "name" | "loginId">) {
    const token = await this.createMailToken(user.id, MailTokenType.PASSWORD_RESET);
    const url = `${this.configService.getOrThrow<string>("APP_ORIGIN")}/login?mode=reset&token=${token}`;

    await this.mailService.sendMail({
      to: user.email,
      subject: "[JTBC Portal] 비밀번호 재설정",
      text: `${user.name}님,\n비밀번호를 재설정하려면 아래 링크를 열어 주세요.\n${url}`,
      html: `<p>${user.name}님,</p><p>비밀번호를 재설정하려면 아래 링크를 열어 주세요.</p><p><a href="${url}">${url}</a></p>`,
    });
  }

  private async buildAuthResponse(user: User, requestMeta: RequestMeta) {
    const sessionId = randomBytes(16).toString("hex");
    const accessExpiresIn = this.configService.getOrThrow<string>("JWT_ACCESS_EXPIRES_IN") as never;
    const refreshExpiresIn = this.configService.getOrThrow<string>("JWT_REFRESH_EXPIRES_IN") as never;

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        loginId: user.loginId,
        role: user.role,
        tokenType: "access",
      },
      {
        secret: this.configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
        expiresIn: accessExpiresIn,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        loginId: user.loginId,
        role: user.role,
        sessionId,
        tokenType: "refresh",
      },
      {
        secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
        expiresIn: refreshExpiresIn,
      },
    );

    const decodedRefresh = this.jwtService.decode(refreshToken) as { exp?: number } | null;
    if (!decodedRefresh?.exp) {
      throw new UnauthorizedException("리프레시 토큰을 발급할 수 없습니다.");
    }

    await this.prisma.refreshToken.create({
      data: {
        id: sessionId,
        userId: user.id,
        tokenHash: this.hashOpaqueToken(refreshToken),
        expiresAt: new Date(decodedRefresh.exp * 1000),
        userAgent: requestMeta.userAgent,
        ipAddress: requestMeta.ipAddress,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.configService.getOrThrow<string>("JWT_ACCESS_EXPIRES_IN"),
      user: this.toSessionUser(user),
    };
  }

  private toSessionUser(user: User) {
    return {
      id: user.id,
      loginId: user.loginId,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      emailVerified: Boolean(user.emailVerifiedAt),
      mustChangePassword: user.mustChangePassword,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ loginId: dto.loginId.toLowerCase() }, { email: dto.email.toLowerCase() }],
      },
    });
    if (existing) {
      throw new BadRequestException("이미 사용 중인 아이디 또는 이메일입니다.");
    }

    const user = await this.prisma.user.create({
      data: {
        loginId: dto.loginId.toLowerCase(),
        name: dto.name.trim(),
        email: dto.email.toLowerCase(),
        phone: dto.phone?.trim() || null,
        passwordHash: await this.hashPassword(dto.password),
        role: dto.role && dto.role !== Role.ADMIN ? dto.role : Role.USER,
        status: UserStatus.PENDING,
      },
    });

    await this.sendVerificationEmail(user);
    await this.writeAuditLog({
      actorId: user.id,
      action: "auth.register",
      targetType: "User",
      targetId: user.id,
      metadata: { loginId: user.loginId, role: user.role },
    });

    return {
      message: "회원가입이 완료되었습니다. 이메일 인증 후 로그인할 수 있습니다.",
      user: this.toSessionUser(user),
    };
  }

  async verifyEmail(token: string) {
    const hashed = this.hashOpaqueToken(token);
    const mailToken = await this.prisma.mailToken.findFirst({
      where: {
        tokenHash: hashed,
        type: MailTokenType.EMAIL_VERIFICATION,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!mailToken) {
      throw new BadRequestException("유효하지 않거나 만료된 인증 토큰입니다.");
    }

    const user = await this.prisma.user.update({
      where: { id: mailToken.userId },
      data: {
        emailVerifiedAt: new Date(),
        status: UserStatus.ACTIVE,
      },
    });

    await this.prisma.mailToken.update({
      where: { id: mailToken.id },
      data: { usedAt: new Date() },
    });

    await this.writeAuditLog({
      actorId: user.id,
      action: "auth.verify-email",
      targetType: "User",
      targetId: user.id,
    });

    return {
      message: "이메일 인증이 완료되었습니다.",
      user: this.toSessionUser(user),
    };
  }

  async login(dto: LoginDto, requestMeta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { loginId: dto.loginId.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException("등록된 아이디가 없습니다.");
    }
    if (user.status === UserStatus.DISABLED) {
      throw new ForbiddenException("비활성화된 계정입니다.");
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException("이메일 인증이 필요합니다.");
    }

    const matches = await this.comparePassword(dto.password, user.passwordHash);
    if (!matches) {
      throw new UnauthorizedException("비밀번호가 올바르지 않습니다.");
    }

    await this.writeAuditLog({
      actorId: user.id,
      action: "auth.login",
      targetType: "User",
      targetId: user.id,
      metadata: requestMeta as Prisma.InputJsonValue,
    });

    return this.buildAuthResponse(user, requestMeta);
  }

  async refresh(refreshToken: string, requestMeta: RequestMeta) {
    const payload = await this.jwtService.verifyAsync<{
      sub: string;
      sessionId: string;
      tokenType: "refresh";
    }>(refreshToken, {
      secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
    });

    const session = await this.prisma.refreshToken.findUnique({
      where: { id: payload.sessionId },
      include: { user: true },
    });

    if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException("유효하지 않은 리프레시 토큰입니다.");
    }

    if (session.tokenHash !== this.hashOpaqueToken(refreshToken)) {
      throw new UnauthorizedException("리프레시 토큰이 일치하지 않습니다.");
    }

    await this.prisma.refreshToken.update({
      where: { id: payload.sessionId },
      data: { revokedAt: new Date() },
    });

    return this.buildAuthResponse(session.user, requestMeta);
  }

  async logout(dto: LogoutDto) {
    const payload = await this.jwtService.verifyAsync<{
      sessionId: string;
      tokenType: "refresh";
    }>(dto.refreshToken, {
      secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
    });

    await this.prisma.refreshToken.updateMany({
      where: {
        id: payload.sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return { message: "로그아웃되었습니다." };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { loginId: dto.loginId.toLowerCase() },
    });

    if (user) {
      await this.sendPasswordResetEmail(user);
      await this.writeAuditLog({
        actorId: user.id,
        action: "auth.forgot-password",
        targetType: "User",
        targetId: user.id,
      });
    }

    return {
      message: "계정이 존재하면 비밀번호 재설정 이메일을 발송했습니다.",
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const hashed = this.hashOpaqueToken(dto.token);
    const token = await this.prisma.mailToken.findFirst({
      where: {
        tokenHash: hashed,
        type: MailTokenType.PASSWORD_RESET,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!token) {
      throw new BadRequestException("유효하지 않거나 만료된 재설정 토큰입니다.");
    }

    const passwordHash = await this.hashPassword(dto.password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
        },
      }),
      this.prisma.mailToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.writeAuditLog({
      actorId: token.userId,
      action: "auth.reset-password",
      targetType: "User",
      targetId: token.userId,
    });

    return { message: "비밀번호가 재설정되었습니다." };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("사용자를 찾을 수 없습니다.");
    }

    const matches = await this.comparePassword(dto.currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException("현재 비밀번호가 올바르지 않습니다.");
    }

    const passwordHash = await this.hashPassword(dto.newPassword);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
      },
    });

    await this.writeAuditLog({
      actorId: userId,
      action: "auth.change-password",
      targetType: "User",
      targetId: userId,
    });

    return {
      message: "비밀번호가 변경되었습니다.",
      user: this.toSessionUser(updated),
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("사용자를 찾을 수 없습니다.");
    }
    return this.toSessionUser(user);
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("사용자를 찾을 수 없습니다.");
    }
    if (user.emailVerifiedAt) {
      throw new BadRequestException("이미 이메일 인증이 완료되었습니다.");
    }

    await this.sendVerificationEmail(user);
    return { message: "인증 메일을 다시 발송했습니다." };
  }
}
