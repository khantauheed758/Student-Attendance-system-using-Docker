-- Permanent Registration Number: optional (existing students can backfill it),
-- unique when present.
ALTER TABLE "User" ADD COLUMN "prn" TEXT;
CREATE UNIQUE INDEX "User_prn_key" ON "User"("prn");
