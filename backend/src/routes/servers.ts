// ============================================================================
// Cobble QuickServers - Server Management Routes
// ============================================================================
// Full CRUD routes for Minecraft server lifecycle management.
// Connects to the Pterodactyl service for power, console, files, and backups.
// ============================================================================

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../middleware/auth';
import { getPterodactylService } from '../services/pterodactyl';
import {
  ApiResponse,
  QuickServer,
  CreateServerConfig,
  ServerSettings,
  ServerResources,
  Backup,
  PteroFile,
  TierLimits,
} from '../types';

const router = Router();

// All server routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Tier configuration — resource limits per tier
// ---------------------------------------------------------------------------
const TIER_LIMITS: Record<string, TierLimits> = {
  free: {
    tier: 'free',
    ram: 1024,
    cpu: 100,
    storage: 5120,
    maxPlayers: 10,
    maxPlugins: 5,
    maxBackups: 1,
    customDomain: false,
    duration: 72,
    price: 0,
  },
  pro: {
    tier: 'pro',
    ram: 4096,
    cpu: 200,
    storage: 20480,
    maxPlayers: 50,
    maxPlugins: 25,
    maxBackups: 5,
    customDomain: false,
    duration: 0,
    price: 999,
  },
  pro_plus: {
    tier: 'pro_plus',
    ram: 8192,
    cpu: 300,
    storage: 51200,
    maxPlayers: 100,
    maxPlugins: 50,
    maxBackups: 10,
    customDomain: true,
    duration: 0,
    price: 1999,
  },
  pro_max: {
    tier: 'pro_max',
    ram: 16384,
    cpu: 400,
    storage: 102400,
    maxPlayers: 200,
    maxPlugins: 100,
    maxBackups: 25,
    customDomain: true,
    duration: 0,
    price: 3999,
  },
};

// ============================================================================
// CRUD — Server Lifecycle
// ============================================================================

// ---------------------------------------------------------------------------
// GET /api/servers
// ---------------------------------------------------------------------------
// List all servers owned by the authenticated user.
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;

    // TODO: Connect to database to fetch user's servers
    // TODO: Enrich with live status from Pterodactyl

    console.log(`[Servers] Listing servers for user ${user.userId}`);

    // Placeholder — return an empty list
    const servers: QuickServer[] = [];

    res.status(200).json({
      success: true,
      data: servers,
    } satisfies ApiResponse<QuickServer[]>);
  } catch (error) {
    console.error('[Servers] List error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list servers',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers
// ---------------------------------------------------------------------------
// Create a new Minecraft server.
// Body: { name, tier, software, version, motd?, icon? }
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const config = req.body as CreateServerConfig;

    // Validate required fields
    if (!config.name || !config.tier || !config.software || !config.version) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: name, tier, software, version',
      } satisfies ApiResponse);
      return;
    }

    // Validate tier
    const limits = TIER_LIMITS[config.tier];
    if (!limits) {
      res.status(400).json({
        success: false,
        error: `Invalid tier: ${config.tier}`,
      } satisfies ApiResponse);
      return;
    }

    // TODO: Check user's server count limit
    // TODO: For paid tiers, verify payment was completed

    console.log(
      `[Servers] Creating server "${config.name}" (${config.tier}/${config.software}) for user ${user.userId}`
    );

    // TODO: Connect to Pterodactyl API to create the server
    // const ptero = getPterodactylService();
    // const pteroServer = await ptero.createServer({
    //   name: config.name,
    //   user: pteroUserId,
    //   egg: getEggId(config.software),
    //   dockerImage: getDockerImage(config.software, config.version),
    //   startup: getStartupCommand(config.software),
    //   environment: { MINECRAFT_VERSION: config.version, SERVER_JARFILE: 'server.jar' },
    //   limits: { memory: limits.ram, swap: 0, disk: limits.storage, io: 500, cpu: limits.cpu },
    //   featureLimits: { databases: 0, allocations: 1, backups: limits.maxBackups },
    //   allocation: { default: allocatedPort },
    // });

    // TODO: Store server record in database

    const serverId = uuidv4();
    const now = new Date().toISOString();
    const expiresAt = limits.duration > 0
      ? new Date(Date.now() + limits.duration * 60 * 60 * 1000).toISOString()
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    const server: QuickServer = {
      id: serverId,
      userId: user.userId,
      name: config.name,
      tier: config.tier,
      status: 'creating',
      software: config.software,
      version: config.version,
      ip: '0.0.0.0',
      port: 25565,
      domain: `${serverId.substring(0, 8)}.${process.env.DEFAULT_DOMAIN || 'loomquickserverhosting.us'}`,
      ram: limits.ram,
      cpu: limits.cpu,
      storage: limits.storage,
      maxPlayers: limits.maxPlayers,
      playerCount: 0,
      pteroServerId: 0,       // TODO: Set from Pterodactyl response
      pteroIdentifier: '',    // TODO: Set from Pterodactyl response
      createdAt: now,
      expiresAt,
      motd: config.motd || `A ${config.software} Minecraft Server`,
      plugins: [],
      backups: [],
    };

    res.status(201).json({
      success: true,
      data: server,
      message: 'Server is being created',
    } satisfies ApiResponse<QuickServer>);
  } catch (error) {
    console.error('[Servers] Create error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create server',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/:id
// ---------------------------------------------------------------------------
// Get detailed information about a specific server.
// ---------------------------------------------------------------------------
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // TODO: Fetch server from database
    // TODO: Verify user owns this server
    // TODO: Enrich with live status from Pterodactyl

    console.log(`[Servers] Getting server ${id} for user ${user.userId}`);

    // Placeholder — return a mock server
    const server: QuickServer = {
      id,
      userId: user.userId,
      name: 'My Server',
      tier: 'pro',
      status: 'running',
      software: 'paper',
      version: '1.20.4',
      ip: '192.168.1.1',
      port: 25565,
      domain: `${id.substring(0, 8)}.${process.env.DEFAULT_DOMAIN || 'loomquickserverhosting.us'}`,
      ram: 4096,
      cpu: 200,
      storage: 20480,
      maxPlayers: 50,
      playerCount: 3,
      pteroServerId: 1,
      pteroIdentifier: 'abc123',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      motd: 'A Paper Minecraft Server',
      plugins: [],
      backups: [],
    };

    res.status(200).json({
      success: true,
      data: server,
    } satisfies ApiResponse<QuickServer>);
  } catch (error) {
    console.error('[Servers] Get error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get server details',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/servers/:id
// ---------------------------------------------------------------------------
// Delete a server permanently.
// ---------------------------------------------------------------------------
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user!;

    // TODO: Fetch server from database and verify ownership
    // TODO: Cancel any active Stripe subscription
    // TODO: Delete server from Pterodactyl
    // const ptero = getPterodactylService();
    // await ptero.deleteServer(pteroServerId);
    // TODO: Delete server record from database

    console.log(`[Servers] Deleting server ${id} for user ${user.userId}`);

    res.status(200).json({
      success: true,
      message: 'Server deleted successfully',
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete server',
    } satisfies ApiResponse);
  }
});

// ============================================================================
// Power Management
// ============================================================================

// ---------------------------------------------------------------------------
// POST /api/servers/:id/start
// ---------------------------------------------------------------------------
router.post('/:id/start', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // TODO: Fetch server from database and verify ownership
    // TODO: Check if server is expired
    // const ptero = getPterodactylService();
    // await ptero.startServer(pteroIdentifier);
    // TODO: Update server status in database

    console.log(`[Servers] Starting server ${id}`);

    res.status(200).json({
      success: true,
      message: 'Server is starting',
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Start error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start server',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/stop
// ---------------------------------------------------------------------------
router.post('/:id/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // TODO: Fetch server from database and verify ownership
    // const ptero = getPterodactylService();
    // await ptero.stopServer(pteroIdentifier);
    // TODO: Update server status in database

    console.log(`[Servers] Stopping server ${id}`);

    res.status(200).json({
      success: true,
      message: 'Server is stopping',
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Stop error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop server',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/restart
// ---------------------------------------------------------------------------
router.post('/:id/restart', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // TODO: Fetch server from database and verify ownership
    // const ptero = getPterodactylService();
    // await ptero.restartServer(pteroIdentifier);
    // TODO: Update server status in database

    console.log(`[Servers] Restarting server ${id}`);

    res.status(200).json({
      success: true,
      message: 'Server is restarting',
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Restart error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to restart server',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/command
// ---------------------------------------------------------------------------
// Send a command to the server console.
// Body: { command }
// ---------------------------------------------------------------------------
router.post('/:id/command', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { command } = req.body as { command: string };

    if (!command) {
      res.status(400).json({
        success: false,
        error: 'Command is required',
      } satisfies ApiResponse);
      return;
    }

    // TODO: Fetch server from database and verify ownership
    // const ptero = getPterodactylService();
    // await ptero.sendCommand(pteroIdentifier, command);

    console.log(`[Servers] Sending command to ${id}: ${command}`);

    res.status(200).json({
      success: true,
      message: 'Command sent',
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Command error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send command',
    } satisfies ApiResponse);
  }
});

// ============================================================================
// Resource Stats
// ============================================================================

// ---------------------------------------------------------------------------
// GET /api/servers/:id/stats
// ---------------------------------------------------------------------------
// Get current resource usage (CPU, RAM, disk, network).
// ---------------------------------------------------------------------------
router.get('/:id/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // TODO: Fetch server from database and verify ownership
    // const ptero = getPterodactylService();
    // const resources = await ptero.getResources(pteroIdentifier);

    console.log(`[Servers] Getting stats for ${id}`);

    // Placeholder response
    const stats: ServerResources = {
      currentState: 'running',
      isSuspended: false,
      resources: {
        memoryBytes: 1024 * 1024 * 512,     // 512 MB
        cpuAbsolute: 15.2,
        diskBytes: 1024 * 1024 * 1024 * 2,   // 2 GB
        networkRxBytes: 1024 * 1024 * 100,
        networkTxBytes: 1024 * 1024 * 50,
        uptime: 7200000,                     // 2 hours
      },
    };

    res.status(200).json({
      success: true,
      data: stats,
    } satisfies ApiResponse<ServerResources>);
  } catch (error) {
    console.error('[Servers] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get server stats',
    } satisfies ApiResponse);
  }
});

// ============================================================================
// Server Settings
// ============================================================================

// ---------------------------------------------------------------------------
// GET /api/servers/:id/settings
// ---------------------------------------------------------------------------
// Get the server's configurable settings.
// ---------------------------------------------------------------------------
router.get('/:id/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // TODO: Fetch settings from database / server.properties file

    console.log(`[Servers] Getting settings for ${id}`);

    // Placeholder response
    const settings: ServerSettings = {
      motd: 'A Minecraft Server',
      maxPlayers: 50,
      difficulty: 'normal',
      gamemode: 'survival',
      pvp: true,
      hardcore: false,
      commandBlocks: false,
      whitelist: false,
      whitelistedPlayers: [],
      ops: [],
      customProperties: {},
    };

    res.status(200).json({
      success: true,
      data: settings,
    } satisfies ApiResponse<ServerSettings>);
  } catch (error) {
    console.error('[Servers] Get settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get server settings',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/servers/:id/settings
// ---------------------------------------------------------------------------
// Update server settings.
// Body: Partial<ServerSettings>
// ---------------------------------------------------------------------------
router.put('/:id/settings', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updates = req.body as Partial<ServerSettings>;

    // TODO: Validate settings against tier limits
    // TODO: Update server.properties file via Pterodactyl
    // TODO: Persist changes to database
    // TODO: Restart server if needed for changes to take effect

    console.log(`[Servers] Updating settings for ${id}:`, Object.keys(updates));

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully. Server may need a restart.',
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Update settings error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update server settings',
    } satisfies ApiResponse);
  }
});

// ============================================================================
// Backups
// ============================================================================

// ---------------------------------------------------------------------------
// POST /api/servers/:id/backups
// ---------------------------------------------------------------------------
// Create a new backup of the server.
// ---------------------------------------------------------------------------
router.post('/:id/backups', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // TODO: Check backup count against tier limits
    // TODO: Fetch server from database and verify ownership
    // const ptero = getPterodactylService();
    // const backup = await ptero.createBackup(pteroIdentifier);
    // TODO: Store backup record in database

    console.log(`[Servers] Creating backup for ${id}`);

    const backup: Backup = {
      id: uuidv4(),
      serverId: id,
      name: `Backup ${new Date().toLocaleDateString()}`,
      size: 0,
      createdAt: new Date().toISOString(),
      status: 'creating',
    };

    res.status(201).json({
      success: true,
      data: backup,
      message: 'Backup is being created',
    } satisfies ApiResponse<Backup>);
  } catch (error) {
    console.error('[Servers] Create backup error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create backup',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/:id/backups
// ---------------------------------------------------------------------------
// List all backups for a server.
// ---------------------------------------------------------------------------
router.get('/:id/backups', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // TODO: Fetch backups from database
    // TODO: Optionally sync with Pterodactyl backup list

    console.log(`[Servers] Listing backups for ${id}`);

    const backups: Backup[] = [];

    res.status(200).json({
      success: true,
      data: backups,
    } satisfies ApiResponse<Backup[]>);
  } catch (error) {
    console.error('[Servers] List backups error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list backups',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/backups/:bid/restore
// ---------------------------------------------------------------------------
// Restore a backup to the server.
// ---------------------------------------------------------------------------
router.post(
  '/:id/backups/:bid/restore',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, bid } = req.params;

      // TODO: Verify user owns this server and backup exists
      // const ptero = getPterodactylService();
      // await ptero.restoreBackup(pteroIdentifier, backupUuid);

      console.log(`[Servers] Restoring backup ${bid} on server ${id}`);

      res.status(200).json({
        success: true,
        message: 'Backup restoration started',
      } satisfies ApiResponse);
    } catch (error) {
      console.error('[Servers] Restore backup error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to restore backup',
      } satisfies ApiResponse);
    }
  }
);

// ============================================================================
// File Management
// ============================================================================

// ---------------------------------------------------------------------------
// GET /api/servers/:id/files
// ---------------------------------------------------------------------------
// List files in a directory on the server.
// Query: ?path=/
// ---------------------------------------------------------------------------
router.get('/:id/files', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { path: dirPath = '/' } = req.query as { path?: string };

    // TODO: Fetch server from database and verify ownership
    // const ptero = getPterodactylService();
    // const files = await ptero.listFiles(pteroIdentifier, dirPath);

    console.log(`[Servers] Listing files for ${id} at ${dirPath}`);

    // Placeholder response
    const files: PteroFile[] = [
      {
        name: 'server.properties',
        mode: '0644',
        modeBits: '644',
        size: 1234,
        isFile: true,
        isSymlink: false,
        mimetype: 'text/plain',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      },
      {
        name: 'plugins',
        mode: '0755',
        modeBits: '755',
        size: 0,
        isFile: false,
        isSymlink: false,
        mimetype: 'inode/directory',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      },
      {
        name: 'world',
        mode: '0755',
        modeBits: '755',
        size: 0,
        isFile: false,
        isSymlink: false,
        mimetype: 'inode/directory',
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString(),
      },
    ];

    res.status(200).json({
      success: true,
      data: files,
    } satisfies ApiResponse<PteroFile[]>);
  } catch (error) {
    console.error('[Servers] List files error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list files',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// POST /api/servers/:id/files/upload
// ---------------------------------------------------------------------------
// Upload a file to the server.
// Body: multipart/form-data with { path, file }
// ---------------------------------------------------------------------------
router.post('/:id/files/upload', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // TODO: Parse multipart file upload (use multer middleware)
    // TODO: Fetch server from database and verify ownership
    // TODO: Check file size against tier storage limits
    // const ptero = getPterodactylService();
    // await ptero.uploadFile(pteroIdentifier, filePath, fileBuffer);

    console.log(`[Servers] Uploading file to ${id}`);

    res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Upload file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload file',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/servers/:id/files
// ---------------------------------------------------------------------------
// Delete a file from the server.
// Query: ?path=/plugins/old-plugin.jar
// ---------------------------------------------------------------------------
router.delete('/:id/files', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { path: filePath } = req.query as { path?: string };

    if (!filePath) {
      res.status(400).json({
        success: false,
        error: 'File path is required (query param: path)',
      } satisfies ApiResponse);
      return;
    }

    // TODO: Fetch server from database and verify ownership
    // const ptero = getPterodactylService();
    // const root = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    // const fileName = filePath.split('/').pop()!;
    // await ptero.deleteFiles(pteroIdentifier, root, [fileName]);

    console.log(`[Servers] Deleting file from ${id}: ${filePath}`);

    res.status(200).json({
      success: true,
      message: `File ${filePath} deleted`,
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Delete file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete file',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// GET /api/servers/:id/files/download
// ---------------------------------------------------------------------------
// Get a signed download URL for a file.
// Query: ?path=/server.properties
// ---------------------------------------------------------------------------
router.get('/:id/files/download', async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { path: filePath } = req.query as { path?: string };

    if (!filePath) {
      res.status(400).json({
        success: false,
        error: 'File path is required (query param: path)',
      } satisfies ApiResponse);
      return;
    }

    // TODO: Fetch server from database and verify ownership
    // const ptero = getPterodactylService();
    // const downloadUrl = await ptero.downloadFile(pteroIdentifier, filePath);

    console.log(`[Servers] Getting download URL for ${id}: ${filePath}`);

    res.status(200).json({
      success: true,
      data: {
        url: `https://placeholder-download.example.com/${id}${filePath}`,
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Servers] Download file error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get download URL',
    } satisfies ApiResponse);
  }
});

export default router;
