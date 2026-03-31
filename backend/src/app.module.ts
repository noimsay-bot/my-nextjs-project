import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env.schema";
import { PrismaModule } from "./prisma/prisma.module";
import { MailModule } from "./mail/mail.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { AdminModule } from "./admin/admin.module";
import { SubmissionsModule } from "./submissions/submissions.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { VacationRequestsModule } from "./vacation-requests/vacation-requests.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
      validate: validateEnv,
    }),
    PrismaModule,
    MailModule,
    AuthModule,
    UsersModule,
    AdminModule,
    SubmissionsModule,
    ReviewsModule,
    VacationRequestsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
