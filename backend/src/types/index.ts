// ============================================================================
// Cobble QuickServers - Shared TypeScript Types
// ============================================================================
// These types mirror frontend types and add backend-specific types.
// Keep in sync with the frontend type definitions.
// ============================================================================

// ---------------------------------------------------------------------------
// Enums & Literal Types
// ---------------------------------------------------------------------------

/** Server pricing/feature tier */
export type ServerTier = 'free' | 'pro' | 'pro_plus' | 'pro_max';

/** Current operational status of a server */
export type ServerStatus =
  | 'creating'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'suspended'
  | 'expired';

/** Supported Minecraft server software */
export type ServerSoftware = 'vanilla' | 'paper' | 'fabric' | 'forge' | 'spigot';

// ---------------------------------------------------------------------------
// Core Domain Models
// ---------------------------------------------------------------------------

/** Represents a QuickServer instance owned by a user */
export interface QuickServer {
  id: string;
  userId: string;
  name: string;
  tier: ServerTier;
  status: ServerStatus;
  software: ServerSoftware;
  version: string;
  ip: string;
  port: number;
  domain?: string;

  // Resource allocation
  ram: number;       // MB
  cpu: number;       // Percentage (100 = 1 core)
  storage: number;   // MB
  maxPlayers: number;
  playerCount: number;

  // Pterodactyl mapping
  pteroServerId: number;
  pteroIdentifier: string;

  // Time tracking
  createdAt: string;
  expiresAt: string;
  lastStartedAt?: string;

  // Stripe mapping
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;

  // Server properties
  motd: string;
  icon?: string;
  plugins: InstalledPlugin[];
  backups: Backup[];
}

/** A backup snapshot of a server */
export interface Backup {
  id: string;
  serverId: string;
  name: string;
  size: number;         // bytes
  createdAt: string;
  completedAt?: string;
  status: 'creating' | 'completed' | 'failed';
  checksum?: string;
}

/** A plugin installed on a server */
export interface InstalledPlugin {
  name: string;
  version: string;
  modrinthId?: string;
  enabled: boolean;
  installedAt: string;
}

// ---------------------------------------------------------------------------
// Server Creation / Configuration
// ---------------------------------------------------------------------------

/** Config payload to create a new server */
export interface CreateServerConfig {
  name: string;
  tier: ServerTier;
  software: ServerSoftware;
  version: string;
  motd?: string;
  icon?: string;
}

/** Tier-based resource limits */
export interface TierLimits {
  tier: ServerTier;
  ram: number;        // MB
  cpu: number;        // Percentage
  storage: number;    // MB
  maxPlayers: number;
  maxPlugins: number;
  maxBackups: number;
  customDomain: boolean;
  duration: number;   // hours (0 = unlimited for subscriptions)
  price: number;      // USD cents
}

/** Server settings that can be updated */
export interface ServerSettings {
  motd: string;
  maxPlayers: number;
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard';
  gamemode: 'survival' | 'creative' | 'adventure' | 'spectator';
  pvp: boolean;
  hardcore: boolean;
  commandBlocks: boolean;
  whitelist: boolean;
  whitelistedPlayers: string[];
  ops: string[];
  icon?: string;
  customProperties: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Authentication / Users
// ---------------------------------------------------------------------------

/** JWT payload stored in the token */
export interface UserPayload {
  userId: string;
  email: string;
  username: string;
  iat?: number;
  exp?: number;
}

/** User registration request body */
export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

/** User login request body */
export interface LoginRequest {
  email: string;
  password: string;
}

/** Auth response returned after login/register */
export interface AuthResponse {
  token: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    createdAt: string;
  };
}

// ---------------------------------------------------------------------------
// Pterodactyl API Types
// ---------------------------------------------------------------------------

/** Pterodactyl server object (Application API) */
export interface PteroServer {
  id: number;
  externalId: string | null;
  uuid: string;
  identifier: string;
  name: string;
  description: string;
  status: string | null;
  suspended: boolean;
  limits: {
    memory: number;
    swap: number;
    disk: number;
    io: number;
    cpu: number;
    threads: string | null;
  };
  featureLimits: {
    databases: number;
    allocations: number;
    backups: number;
  };
  user: number;
  node: number;
  allocation: number;
  nest: number;
  egg: number;
  container: {
    startupCommand: string;
    image: string;
    environment: Record<string, string>;
  };
  createdAt: string;
  updatedAt: string;
}

/** Real-time server resource usage */
export interface ServerResources {
  currentState: string;
  isSuspended: boolean;
  resources: {
    memoryBytes: number;
    cpuAbsolute: number;
    diskBytes: number;
    networkRxBytes: number;
    networkTxBytes: number;
    uptime: number;
  };
}

/** WebSocket credentials for console streaming */
export interface WebSocketCredentials {
  token: string;
  socket: string;
}

/** A file entry from Pterodactyl file manager */
export interface PteroFile {
  name: string;
  mode: string;
  modeBits: string;
  size: number;
  isFile: boolean;
  isSymlink: boolean;
  mimetype: string;
  createdAt: string;
  modifiedAt: string;
}

/** Pterodactyl backup object */
export interface PteroBackup {
  uuid: string;
  name: string;
  ignoredFiles: string[];
  bytes: number;
  checksum: string | null;
  createdAt: string;
  completedAt: string | null;
  isSuccessful: boolean;
  isLocked: boolean;
}

/** Config for creating a server via Pterodactyl Application API */
export interface PteroCreateServerConfig {
  name: string;
  user: number;
  egg: number;
  dockerImage: string;
  startup: string;
  environment: Record<string, string>;
  limits: {
    memory: number;
    swap: number;
    disk: number;
    io: number;
    cpu: number;
  };
  featureLimits: {
    databases: number;
    allocations: number;
    backups: number;
  };
  allocation: {
    default: number;
  };
}

// ---------------------------------------------------------------------------
// Stripe / Payment Types
// ---------------------------------------------------------------------------

/** Config to create a Stripe checkout session */
export interface CheckoutConfig {
  tier: ServerTier;
  userId: string;
  email: string;
  serverId?: string;       // If upgrading existing server
  successUrl: string;
  cancelUrl: string;
}

/** Result from verifying a Stripe checkout session */
export interface PaymentResult {
  success: boolean;
  tier: ServerTier;
  customerId: string;
  subscriptionId?: string;
  serverId?: string;
}

/** Parsed Stripe webhook event */
export interface WebhookEvent {
  type: string;
  customerId?: string;
  subscriptionId?: string;
  tier?: ServerTier;
  serverId?: string;
}

/** Stripe subscription object (simplified) */
export interface Subscription {
  id: string;
  customerId: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  priceId: string;
}

// ---------------------------------------------------------------------------
// API Response Wrappers
// ---------------------------------------------------------------------------

/** Standard API success response */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/** Paginated list response */
export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Plugin / Modrinth Types
// ---------------------------------------------------------------------------

/** Modrinth project search result */
export interface ModrinthProject {
  slug: string;
  title: string;
  description: string;
  categories: string[];
  clientSide: string;
  serverSide: string;
  projectType: string;
  downloads: number;
  iconUrl?: string;
  projectId: string;
  author: string;
  versions: string[];
  follows: number;
  dateCreated: string;
  dateModified: string;
}

/** Modrinth version details */
export interface ModrinthVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  changelog?: string;
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  downloads: number;
  files: ModrinthFile[];
}

/** A downloadable file from Modrinth */
export interface ModrinthFile {
  hashes: {
    sha1: string;
    sha512: string;
  };
  url: string;
  filename: string;
  primary: boolean;
  size: number;
}

/** Request body to install a plugin */
export interface InstallPluginRequest {
  serverId: string;
  projectId: string;
  versionId: string;
  filename: string;
}

// ---------------------------------------------------------------------------
// Express Request Augmentation
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      /** Populated by the auth middleware after JWT verification */
      user?: UserPayload;
    }
  }
}
