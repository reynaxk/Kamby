-- CreateTable
CREATE TABLE "live_rooms" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "title" VARCHAR(60) NOT NULL,
    "token_key" VARCHAR(140),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "ended_reason" VARCHAR(10),
    "peak_viewers" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "live_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_reports" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "live_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_rooms_ended_at_started_at_idx" ON "live_rooms"("ended_at", "started_at");

-- CreateIndex
CREATE INDEX "live_rooms_host_id_started_at_idx" ON "live_rooms"("host_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "live_reports_room_id_reporter_id_key" ON "live_reports"("room_id", "reporter_id");

-- AddForeignKey
ALTER TABLE "live_reports" ADD CONSTRAINT "live_reports_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "live_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

