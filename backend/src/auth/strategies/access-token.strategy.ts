import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Role } from "@prisma/client";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthenticatedUser } from "../../common/interfaces/authenticated-user.interface";

interface AccessTokenPayload {
  sub: string;
  loginId: string;
  role: Role;
  tokenType: "access";
}

@Injectable()
export class AccessTokenStrategy extends PassportStrategy(Strategy, "jwt-access") {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>("JWT_ACCESS_SECRET"),
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    return payload;
  }
}
