/**
 * Provision a TEACHER account.
 *
 * Teacher accounts are deliberately not creatable through public signup, so
 * this script is the supported way to create one. It requires shell access to
 * the running stack, which keeps teacher provisioning an administrative act.
 *
 * Usage (arguments, in order):
 *   npx tsx prisma/create-teacher.ts "Aarav Mehta" aarav@university.edu "a-long-password"
 *
 * Or via environment variables:
 *   TEACHER_NAME, TEACHER_EMAIL, TEACHER_PASSWORD
 *
 * Inside Docker:
 *   docker compose run --rm api npx tsx prisma/create-teacher.ts \
 *     "Aarav Mehta" aarav@university.edu "a-long-password"
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const name = (process.argv[2] ?? process.env.TEACHER_NAME ?? "").trim();
  const email = (process.argv[3] ?? process.env.TEACHER_EMAIL ?? "")
    .trim()
    .toLowerCase();
  const password = process.argv[4] ?? process.env.TEACHER_PASSWORD ?? "";

  if (!name)
    throw new Error(
      "Missing teacher name. Pass it as the first argument or set TEACHER_NAME.",
    );
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new Error(
      "Missing or invalid teacher email. Pass it as the second argument or set TEACHER_EMAIL.",
    );
  if (password.length < 12)
    throw new Error("Teacher password must be at least 12 characters.");

  const hashed = await bcrypt.hash(password, 12);
  const existing = await db.user.findUnique({ where: { email } });

  if (existing) {
    await db.user.update({
      where: { email },
      data: { name, role: Role.TEACHER, password: hashed },
    });
    console.log(
      `Updated ${email}: role set to ${Role.TEACHER} and password reset.`,
    );
    return;
  }

  await db.user.create({
    data: { name, email, password: hashed, role: Role.TEACHER },
  });
  console.log(`Created ${Role.TEACHER} account ${email} (${name}).`);
}

main()
  .catch((e) => {
    console.error(`Failed: ${e?.message ?? e}`);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
