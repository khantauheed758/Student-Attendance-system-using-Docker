-- Profile photos are stored inline as data URLs: there is no object storage to
-- run, and the image lives with the user row so it survives container restarts.
ALTER TABLE "User" ADD COLUMN "avatar" TEXT;
