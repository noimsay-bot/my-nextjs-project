import * as bcrypt from "bcrypt";
import { PrismaClient, Role, UserStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const loginId = process.env.SEED_ADMIN_LOGIN_ID ?? "admin";
  const name = process.env.SEED_ADMIN_NAME ?? "관리자";
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { loginId },
    update: {
      name,
      email,
      passwordHash,
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      mustChangePassword: false,
    },
    create: {
      loginId,
      name,
      email,
      passwordHash,
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      mustChangePassword: false,
    },
  });

  console.log(`Seeded admin user: ${loginId} / ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
