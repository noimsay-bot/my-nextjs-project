import { Role } from "@prisma/client";

export interface AuthenticatedUser {
  sub: string;
  loginId: string;
  role: Role;
  sessionId?: string;
  tokenType: "access" | "refresh";
}
