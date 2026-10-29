CREATE TYPE "TenantStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "ModuleKey" AS ENUM ('POS', 'KDS', 'MENU', 'TABLES', 'INVENTORY', 'PURCHASING', 'ACCOUNTING', 'HR', 'DELIVERY', 'CRM', 'MARKETING', 'REPORTS', 'OPERATIONS', 'AI');
CREATE TYPE "UsagePeriod" AS ENUM ('DAILY', 'MONTHLY');
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'SUPPORT', 'BILLING', 'AUDITOR');

ALTER TABLE "restaurants"
  ADD COLUMN "status" "TenantStatus" NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspensionReason" TEXT;

CREATE TABLE "subscription_plans" (
  "id" TEXT PRIMARY KEY,
  "code" TEXT NOT NULL UNIQUE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "monthlyPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "annualPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "maxUsers" INTEGER,
  "maxBranches" INTEGER,
  "maxStorageMb" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "platform_users" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "role" "PlatformRole" NOT NULL DEFAULT 'SUPPORT',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "twoFactorSecret" TEXT,
  "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
  "lastLoginAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "plan_modules" (
  "planId" TEXT NOT NULL,
  "moduleKey" "ModuleKey" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "limits" JSONB,
  PRIMARY KEY ("planId", "moduleKey"),
  CONSTRAINT "plan_modules_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id") ON DELETE CASCADE
);

CREATE TABLE "subscriptions" (
  "id" TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "trialEndsAt" TIMESTAMP(3),
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "externalCustomerId" TEXT,
  "externalSubscriptionId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscriptions_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE,
  CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "subscription_plans"("id")
);
CREATE INDEX "subscriptions_restaurantId_status_idx" ON "subscriptions"("restaurantId", "status");

CREATE TABLE "tenant_modules" (
  "restaurantId" TEXT NOT NULL,
  "moduleKey" "ModuleKey" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "source" TEXT NOT NULL DEFAULT 'PLAN',
  "limits" JSONB,
  "expiresAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("restaurantId", "moduleKey"),
  CONSTRAINT "tenant_modules_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE
);

CREATE TABLE "feature_flags" (
  "id" TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config" JSONB,
  "expiresAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "feature_flags_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE,
  CONSTRAINT "feature_flags_restaurantId_key_key" UNIQUE ("restaurantId", "key")
);

CREATE TABLE "departments" (
  "id" TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "branchId" TEXT,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "moduleKey" "ModuleKey",
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "departments_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE,
  CONSTRAINT "departments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE,
  CONSTRAINT "departments_restaurantId_code_key" UNIQUE ("restaurantId", "code")
);
CREATE INDEX "departments_branchId_idx" ON "departments"("branchId");

ALTER TABLE "roles" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "roles" ADD CONSTRAINT "roles_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL;
CREATE INDEX "roles_departmentId_idx" ON "roles"("departmentId");

CREATE TABLE "user_departments" (
  "userId" TEXT NOT NULL,
  "departmentId" TEXT NOT NULL,
  "isAdmin" BOOLEAN NOT NULL DEFAULT false,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  PRIMARY KEY ("userId", "departmentId"),
  CONSTRAINT "user_departments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE
);

CREATE TABLE "user_permission_overrides" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "roleId" TEXT,
  "permissionId" TEXT NOT NULL,
  "allowed" BOOLEAN NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_permission_overrides_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_permission_overrides_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE,
  CONSTRAINT "user_permission_overrides_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE,
  CONSTRAINT "user_permission_overrides_userId_permissionId_key" UNIQUE ("userId", "permissionId")
);
CREATE INDEX "user_permission_overrides_roleId_idx" ON "user_permission_overrides"("roleId");

CREATE TABLE "usage_counters" (
  "id" TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "period" "UsagePeriod" NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "value" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_counters_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE,
  CONSTRAINT "usage_counters_restaurantId_metric_period_periodStart_key" UNIQUE ("restaurantId", "metric", "period", "periodStart")
);

CREATE TABLE "api_quotas" (
  "id" TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "dailyLimit" INTEGER,
  "monthlyLimit" INTEGER,
  "tokenLimit" BIGINT,
  "hardStop" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "api_quotas_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE,
  CONSTRAINT "api_quotas_restaurantId_provider_key" UNIQUE ("restaurantId", "provider")
);

CREATE TABLE "ai_usage_logs" (
  "id" TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "userId" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "feature" TEXT NOT NULL,
  "requestId" TEXT UNIQUE,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCost" DECIMAL(14,6) NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_logs_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "restaurants"("id") ON DELETE CASCADE,
  CONSTRAINT "ai_usage_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "ai_usage_logs_restaurantId_createdAt_idx" ON "ai_usage_logs"("restaurantId", "createdAt");
