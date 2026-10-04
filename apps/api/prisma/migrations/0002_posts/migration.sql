-- Noticeboard & study materials pushed by teachers.

CREATE TYPE "PostKind" AS ENUM ('NOTICE', 'MATERIAL');
CREATE TABLE "Post" ("id" TEXT NOT NULL, "courseId" TEXT NOT NULL, "authorId" TEXT NOT NULL, "kind" "PostKind" NOT NULL DEFAULT 'NOTICE', "title" TEXT NOT NULL, "body" TEXT NOT NULL, "url" TEXT, "pinned" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Post_pkey" PRIMARY KEY ("id"));
CREATE INDEX "Post_courseId_pinned_createdAt_idx" ON "Post"("courseId", "pinned", "createdAt");
ALTER TABLE "Post" ADD CONSTRAINT "Post_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
