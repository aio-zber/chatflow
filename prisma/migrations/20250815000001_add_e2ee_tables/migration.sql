-- CreateTable for E2EE devices
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "registrationId" INTEGER NOT NULL,
    "identityKey" TEXT NOT NULL,
    "name" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable for signed prekeys
CREATE TABLE "signed_prekeys" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "keyId" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signed_prekeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable for one-time prekeys
CREATE TABLE "one_time_prekeys" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "keyId" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "one_time_prekeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable for encrypted messages (replaces plain message table for E2EE)
CREATE TABLE "encrypted_messages" (
    "id" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "conversationId" TEXT,
    "ciphertext" TEXT NOT NULL,
    "messageType" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "encrypted_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable for group sender keys
CREATE TABLE "group_sender_keys" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "senderDeviceId" TEXT NOT NULL,
    "distributionId" TEXT NOT NULL,
    "encryptedSenderKey" TEXT NOT NULL,
    "recipientDeviceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_sender_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable for encrypted attachments
CREATE TABLE "encrypted_attachments" (
    "id" TEXT NOT NULL,
    "uploaderDeviceId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "digestSha256" TEXT NOT NULL,
    "ciphertextUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encrypted_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable for device provisioning
CREATE TABLE "device_provisioning" (
    "id" TEXT NOT NULL,
    "provisioningId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedData" TEXT,
    "iv" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_provisioning_pkey" PRIMARY KEY ("id")
);

-- CreateTable for encrypted backups
CREATE TABLE "encrypted_backups" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kdfSalt" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "hmac" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encrypted_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_userId_registrationId_key" ON "devices"("userId", "registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "signed_prekeys_deviceId_keyId_key" ON "signed_prekeys"("deviceId", "keyId");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_prekeys_deviceId_keyId_key" ON "one_time_prekeys"("deviceId", "keyId");

-- CreateIndex
CREATE INDEX "encrypted_messages_recipientDeviceId_deliveredAt_idx" ON "encrypted_messages"("recipientDeviceId", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "group_sender_keys_groupId_senderDeviceId_recipientDeviceId_key" ON "group_sender_keys"("groupId", "senderDeviceId", "recipientDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "device_provisioning_provisioningId_key" ON "device_provisioning"("provisioningId");

-- CreateIndex
CREATE INDEX "encrypted_backups_userId_createdAt_idx" ON "encrypted_backups"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signed_prekeys" ADD CONSTRAINT "signed_prekeys_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_prekeys" ADD CONSTRAINT "one_time_prekeys_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_messages" ADD CONSTRAINT "encrypted_messages_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_messages" ADD CONSTRAINT "encrypted_messages_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_messages" ADD CONSTRAINT "encrypted_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_sender_keys" ADD CONSTRAINT "group_sender_keys_senderDeviceId_fkey" FOREIGN KEY ("senderDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_sender_keys" ADD CONSTRAINT "group_sender_keys_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_attachments" ADD CONSTRAINT "encrypted_attachments_uploaderDeviceId_fkey" FOREIGN KEY ("uploaderDeviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_provisioning" ADD CONSTRAINT "device_provisioning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_backups" ADD CONSTRAINT "encrypted_backups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encrypted_backups" ADD CONSTRAINT "encrypted_backups_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;