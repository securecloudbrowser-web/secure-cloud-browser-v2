-- Secure Cloud Browser — database schema for Supabase (PostgreSQL)
-- Mirrors prisma/schema.prisma exactly (Prisma default names/types),
-- so the Prisma client works against these tables without migrations.
-- Run once in the Supabase SQL Editor.

-- Enums
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "BrowserSessionStatus" AS ENUM ('STARTING', 'RUNNING', 'STOPPED', 'ERROR');
CREATE TYPE "SharePermission" AS ENUM ('VIEW_ONLY', 'INTERACTIVE');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_LOCKED', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'SESSION_REVOKED', 'SHARE_CREATED', 'SHARE_REVOKED', 'PROFILE_DELETED');

-- User
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "emailVerifiedAt" TIMESTAMP(3),
    "totpSecretEncrypted" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");

-- UserSession
CREATE TABLE "UserSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- BrowserProfile
CREATE TABLE "BrowserProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "userAgent" TEXT,
    "viewportWidth" INTEGER NOT NULL DEFAULT 1366,
    "viewportHeight" INTEGER NOT NULL DEFAULT 768,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrowserProfile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BrowserProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BrowserProfile_storageKey_key" ON "BrowserProfile"("storageKey");
CREATE INDEX "BrowserProfile_ownerId_idx" ON "BrowserProfile"("ownerId");

-- BrowserSession
CREATE TABLE "BrowserSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profileId" UUID NOT NULL,
    "startedById" UUID NOT NULL,
    "status" "BrowserSessionStatus" NOT NULL DEFAULT 'STARTING',
    "containerRef" TEXT,
    "streamTokenHash" TEXT,
    "streamTokenExpiresAt" TIMESTAMP(3),
    "streamTokenUsedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrowserSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BrowserSession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BrowserSession_streamTokenHash_key" ON "BrowserSession"("streamTokenHash");
CREATE INDEX "BrowserSession_profileId_idx" ON "BrowserSession"("profileId");
CREATE INDEX "BrowserSession_startedById_idx" ON "BrowserSession"("startedById");
CREATE INDEX "BrowserSession_status_idx" ON "BrowserSession"("status");

-- ProfileShare
CREATE TABLE "ProfileShare" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profileId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "recipientId" UUID,
    "tokenHash" TEXT,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW_ONLY',
    "allowDownloads" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "ProfileShare_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProfileShare_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProfileShare_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProfileShare_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProfileShare_profileId_recipientId_key" ON "ProfileShare"("profileId", "recipientId");
CREATE INDEX "ProfileShare_recipientId_idx" ON "ProfileShare"("recipientId");
CREATE INDEX "ProfileShare_profileId_idx" ON "ProfileShare"("profileId");
CREATE UNIQUE INDEX "ProfileShare_tokenHash_key" ON "ProfileShare"("tokenHash");

-- Invitation
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profileId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "recipientId" UUID,
    "invitedEmail" TEXT NOT NULL,
    "tokenHash" TEXT,
    "permission" "SharePermission" NOT NULL DEFAULT 'VIEW_ONLY',
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invitation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invitation_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_invitedEmail_idx" ON "Invitation"("invitedEmail");
CREATE INDEX "Invitation_profileId_idx" ON "Invitation"("profileId");

-- AccessPermission
CREATE TABLE "AccessPermission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "profileId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "permission" "SharePermission" NOT NULL,
    "sourceShareId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "AccessPermission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccessPermission_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AccessPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AccessPermission_profileId_userId_key" ON "AccessPermission"("profileId", "userId");
CREATE INDEX "AccessPermission_userId_idx" ON "AccessPermission"("userId");

-- AuditLog (append-only by design)
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" UUID,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- PasswordResetToken
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- EmailVerificationToken
CREATE TABLE "EmailVerificationToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- SecurityEvents
CREATE TABLE "SecurityEvents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "type" "SecurityEventType" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityEvents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SecurityEvents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SecurityEvents_userId_idx" ON "SecurityEvents"("userId");
CREATE INDEX "SecurityEvents_type_idx" ON "SecurityEvents"("type");
CREATE INDEX "SecurityEvents_createdAt_idx" ON "SecurityEvents"("createdAt");
