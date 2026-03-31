import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Role } from "@prisma/client";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";

interface RefreshTokenPayload {
  sub: string;
  loginId: string;
  role: Role;
  sessionId: string;
  tokenType: "refresh";
}

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, "jwt-refresh") {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
    });
  }

  validate(payload: RefreshTokenPayload): AuthenticatedUser {
    return {
      ...payload,
      sessionId: payload.sessionId,
      tokenType: "refresh",
    };
  }
}
