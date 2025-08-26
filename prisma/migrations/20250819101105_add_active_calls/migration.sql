-- CreateTable
CREATE TABLE "public"."MessageHidden" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageHidden_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CallRecord" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT,
    "callerId" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "participants" TEXT[],

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ActiveCall" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "callerId" TEXT NOT NULL,
    "callType" TEXT NOT NULL,
    "callerName" TEXT NOT NULL,
    "callerAvatar" TEXT,
    "conversationName" TEXT,
    "isGroupCall" BOOLEAN NOT NULL DEFAULT false,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "participants" TEXT[],
    "calleeParticipants" TEXT[],
    "startTime" BIGINT NOT NULL,
    "connectedTime" BIGINT,
    "traceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageHidden_messageId_userId_key" ON "public"."MessageHidden"("messageId", "userId");

-- CreateIndex
CREATE INDEX "CallRecord_conversationId_idx" ON "public"."CallRecord"("conversationId");

-- CreateIndex
CREATE INDEX "CallRecord_callerId_idx" ON "public"."CallRecord"("callerId");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveCall_callId_key" ON "public"."ActiveCall"("callId");

-- CreateIndex
CREATE INDEX "ActiveCall_callId_idx" ON "public"."ActiveCall"("callId");

-- CreateIndex
CREATE INDEX "ActiveCall_conversationId_idx" ON "public"."ActiveCall"("conversationId");

-- CreateIndex
CREATE INDEX "ActiveCall_callerId_idx" ON "public"."ActiveCall"("callerId");

-- CreateIndex
CREATE INDEX "ActiveCall_expiresAt_idx" ON "public"."ActiveCall"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."MessageHidden" ADD CONSTRAINT "MessageHidden_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "public"."Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MessageHidden" ADD CONSTRAINT "MessageHidden_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CallRecord" ADD CONSTRAINT "CallRecord_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CallRecord" ADD CONSTRAINT "CallRecord_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActiveCall" ADD CONSTRAINT "ActiveCall_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ActiveCall" ADD CONSTRAINT "ActiveCall_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
