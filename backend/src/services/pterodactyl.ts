// ============================================================================
// Cobble QuickServers - Pterodactyl API Service
// ============================================================================
// Wraps both the Application API (admin) and Client API (user-scoped)
// provided by Pterodactyl Panel. Each method documents the upstream endpoint
// and returns typed data.
//
// Pterodactyl API docs: https://dashflo.net/docs/api/pterodactyl/v1/
// ============================================================================

import {
  PteroServer,
  PteroCreateServerConfig,
  ServerResources,
  WebSocketCredentials,
  PteroFile,
  PteroBackup,
} from '../types';

/**
 * Service class for interacting with the Pterodactyl Panel API.
 *
 * Two APIs are used:
 * - **Application API** (`/api/application/...`) – admin-level operations
 *   like creating/deleting servers. Requires an Application API key.
 * - **Client API** (`/api/client/...`) – user-level operations like
 *   start/stop, console, files. Requires a Client API key.
 */
export class PterodactylService {
  private panelUrl: string;
  private apiKey: string;      // Application API key (admin)
  private clientKey: string;   // Client API key (user)

  constructor(panelUrl: string, apiKey: string, clientKey: string) {
    // Strip trailing slash for consistency
    this.panelUrl = panelUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.clientKey = clientKey;
  }

  // =========================================================================
  // Helper – HTTP requests
  // =========================================================================

  /**
   * Makes an authenticated request to the Application API.
   * @internal
   */
  private async appRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    // TODO: Implement HTTP request to Pterodactyl Application API
    // Endpoint: ${this.panelUrl}/api/application${path}
    // Headers:
    //   Authorization: Bearer ${this.apiKey}
    //   Content-Type: application/json
    //   Accept: application/json

    console.log(`[Pterodactyl] APP ${method} ${path}`, body ? JSON.stringify(body) : '');
    throw new Error(`Pterodactyl Application API not yet connected: ${method} ${path}`);
  }

  /**
   * Makes an authenticated request to the Client API.
   * @internal
   */
  private async clientRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    // TODO: Implement HTTP request to Pterodactyl Client API
    // Endpoint: ${this.panelUrl}/api/client${path}
    // Headers:
    //   Authorization: Bearer ${this.clientKey}
    //   Content-Type: application/json
    //   Accept: application/json

    console.log(`[Pterodactyl] CLIENT ${method} ${path}`, body ? JSON.stringify(body) : '');
    throw new Error(`Pterodactyl Client API not yet connected: ${method} ${path}`);
  }

  // =========================================================================
  // Application API – Admin Operations
  // =========================================================================

  /**
   * Create a new server on the panel.
   *
   * Pterodactyl endpoint: POST /api/application/servers
   * Docs: https://dashflo.net/docs/api/pterodactyl/v1/#req_3e01ab21a5a74b4aaef1f7e5ef498095
   */
  async createServer(config: PteroCreateServerConfig): Promise<PteroServer> {
    // TODO: Connect to Pterodactyl API
    // return this.appRequest<PteroServer>('POST', '/servers', config);

    console.log('[Pterodactyl] Creating server:', config.name);

    // Placeholder response
    return {
      id: Math.floor(Math.random() * 10000),
      externalId: null,
      uuid: crypto.randomUUID(),
      identifier: 'abc123',
      name: config.name,
      description: '',
      status: null,
      suspended: false,
      limits: {
        memory: config.limits.memory,
        swap: config.limits.swap,
        disk: config.limits.disk,
        io: config.limits.io,
        cpu: config.limits.cpu,
        threads: null,
      },
      featureLimits: config.featureLimits,
      user: config.user,
      node: 1,
      allocation: config.allocation.default,
      nest: 1,
      egg: config.egg,
      container: {
        startupCommand: config.startup,
        image: config.dockerImage,
        environment: config.environment,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Delete a server from the panel.
   *
   * Pterodactyl endpoint: DELETE /api/application/servers/{id}
   * Docs: https://dashflo.net/docs/api/pterodactyl/v1/#req_8a3d1e88b48b4129a5e235c351e11a96
   */
  async deleteServer(pteroId: number): Promise<void> {
    // TODO: Connect to Pterodactyl API
    // return this.appRequest<void>('DELETE', `/servers/${pteroId}`);

    console.log(`[Pterodactyl] Deleting server ${pteroId}`);
  }

  /**
   * List all servers on the panel.
   *
   * Pterodactyl endpoint: GET /api/application/servers
   * Docs: https://dashflo.net/docs/api/pterodactyl/v1/#req_4ad4e0c8db934df59e1b23f0b8faa498
   */
  async listServers(): Promise<PteroServer[]> {
    // TODO: Connect to Pterodactyl API
    // const response = await this.appRequest<{ data: PteroServer[] }>('GET', '/servers');
    // return response.data;

    console.log('[Pterodactyl] Listing all servers');
    return [];
  }

  // =========================================================================
  // Client API – Power Management
  // =========================================================================

  /**
   * Start a server.
   *
   * Pterodactyl endpoint: POST /api/client/servers/{identifier}/power
   * Body: { "signal": "start" }
   */
  async startServer(identifier: string): Promise<void> {
    // TODO: Connect to Pterodactyl API
    // return this.clientRequest<void>('POST', `/servers/${identifier}/power`, { signal: 'start' });

    console.log(`[Pterodactyl] Starting server ${identifier}`);
  }

  /**
   * Stop a server.
   *
   * Pterodactyl endpoint: POST /api/client/servers/{identifier}/power
   * Body: { "signal": "stop" }
   */
  async stopServer(identifier: string): Promise<void> {
    // TODO: Connect to Pterodactyl API
    // return this.clientRequest<void>('POST', `/servers/${identifier}/power`, { signal: 'stop' });

    console.log(`[Pterodactyl] Stopping server ${identifier}`);
  }

  /**
   * Restart a server.
   *
   * Pterodactyl endpoint: POST /api/client/servers/{identifier}/power
   * Body: { "signal": "restart" }
   */
  async restartServer(identifier: string): Promise<void> {
    // TODO: Connect to Pterodactyl API
    // return this.clientRequest<void>('POST', `/servers/${identifier}/power`, { signal: 'restart' });

    console.log(`[Pterodactyl] Restarting server ${identifier}`);
  }

  // =========================================================================
  // Client API – Console
  // =========================================================================

  /**
   * Send a command to the server console.
   *
   * Pterodactyl endpoint: POST /api/client/servers/{identifier}/command
   * Body: { "command": "say Hello" }
   */
  async sendCommand(identifier: string, command: string): Promise<void> {
    // TODO: Connect to Pterodactyl API
    // return this.clientRequest<void>('POST', `/servers/${identifier}/command`, { command });

    console.log(`[Pterodactyl] Sending command to ${identifier}: ${command}`);
  }

  /**
   * Get current resource usage (CPU, RAM, disk, network).
   *
   * Pterodactyl endpoint: GET /api/client/servers/{identifier}/resources
   */
  async getResources(identifier: string): Promise<ServerResources> {
    // TODO: Connect to Pterodactyl API
    // return this.clientRequest<ServerResources>('GET', `/servers/${identifier}/resources`);

    console.log(`[Pterodactyl] Getting resources for ${identifier}`);

    // Placeholder response
    return {
      currentState: 'running',
      isSuspended: false,
      resources: {
        memoryBytes: 512 * 1024 * 1024,   // 512 MB
        cpuAbsolute: 12.5,
        diskBytes: 1024 * 1024 * 1024,      // 1 GB
        networkRxBytes: 1024 * 1024 * 50,
        networkTxBytes: 1024 * 1024 * 25,
        uptime: 3600000,                    // 1 hour in ms
      },
    };
  }

  /**
   * Get WebSocket credentials for console streaming.
   *
   * Pterodactyl endpoint: GET /api/client/servers/{identifier}/websocket
   */
  async getConsoleWebSocket(identifier: string): Promise<WebSocketCredentials> {
    // TODO: Connect to Pterodactyl API
    // return this.clientRequest<WebSocketCredentials>('GET', `/servers/${identifier}/websocket`);

    console.log(`[Pterodactyl] Getting WebSocket credentials for ${identifier}`);

    // Placeholder response
    return {
      token: 'placeholder-ws-token',
      socket: `wss://${this.panelUrl.replace(/^https?:\/\//, '')}/api/client/servers/${identifier}/ws`,
    };
  }

  // =========================================================================
  // Client API – File Management
  // =========================================================================

  /**
   * List files in a directory.
   *
   * Pterodactyl endpoint: GET /api/client/servers/{identifier}/files/list?directory={directory}
   */
  async listFiles(identifier: string, directory: string): Promise<PteroFile[]> {
    // TODO: Connect to Pterodactyl API
    // const encoded = encodeURIComponent(directory);
    // const response = await this.clientRequest<{ data: PteroFile[] }>(
    //   'GET',
    //   `/servers/${identifier}/files/list?directory=${encoded}`
    // );
    // return response.data;

    console.log(`[Pterodactyl] Listing files for ${identifier} at ${directory}`);

    // Placeholder – return an empty directory listing
    return [];
  }

  /**
   * Upload a file to the server.
   *
   * Pterodactyl endpoint: POST /api/client/servers/{identifier}/files/write?file={path}
   * Content-Type: application/octet-stream
   */
  async uploadFile(identifier: string, path: string, content: Buffer): Promise<void> {
    // TODO: Connect to Pterodactyl API
    // Use multipart form upload or raw binary POST
    // const encoded = encodeURIComponent(path);
    // await this.clientRequest('POST', `/servers/${identifier}/files/write?file=${encoded}`, content);

    console.log(`[Pterodactyl] Uploading file to ${identifier}: ${path} (${content.length} bytes)`);
  }

  /**
   * Delete one or more files from the server.
   *
   * Pterodactyl endpoint: POST /api/client/servers/{identifier}/files/delete
   * Body: { "root": "/", "files": ["file1.txt"] }
   */
  async deleteFiles(identifier: string, root: string, files: string[]): Promise<void> {
    // TODO: Connect to Pterodactyl API
    // await this.clientRequest('POST', `/servers/${identifier}/files/delete`, { root, files });

    console.log(`[Pterodactyl] Deleting files from ${identifier}: ${files.join(', ')}`);
  }

  /**
   * Get a signed download URL for a file.
   *
   * Pterodactyl endpoint: GET /api/client/servers/{identifier}/files/download?file={path}
   * Returns a signed URL string.
   */
  async downloadFile(identifier: string, path: string): Promise<string> {
    // TODO: Connect to Pterodactyl API
    // const encoded = encodeURIComponent(path);
    // const response = await this.clientRequest<{ url: string }>(
    //   'GET',
    //   `/servers/${identifier}/files/download?file=${encoded}`
    // );
    // return response.url;

    console.log(`[Pterodactyl] Getting download URL for ${identifier}: ${path}`);
    return `https://placeholder-download-url.example.com/${identifier}/${path}`;
  }

  // =========================================================================
  // Client API – Backups
  // =========================================================================

  /**
   * Create a new backup.
   *
   * Pterodactyl endpoint: POST /api/client/servers/{identifier}/backups
   */
  async createBackup(identifier: string): Promise<PteroBackup> {
    // TODO: Connect to Pterodactyl API
    // return this.clientRequest<PteroBackup>('POST', `/servers/${identifier}/backups`);

    console.log(`[Pterodactyl] Creating backup for ${identifier}`);

    return {
      uuid: crypto.randomUUID(),
      name: `Backup ${new Date().toISOString()}`,
      ignoredFiles: [],
      bytes: 0,
      checksum: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      isSuccessful: false,
      isLocked: false,
    };
  }

  /**
   * List all backups for a server.
   *
   * Pterodactyl endpoint: GET /api/client/servers/{identifier}/backups
   */
  async listBackups(identifier: string): Promise<PteroBackup[]> {
    // TODO: Connect to Pterodactyl API
    // const response = await this.clientRequest<{ data: PteroBackup[] }>(
    //   'GET',
    //   `/servers/${identifier}/backups`
    // );
    // return response.data;

    console.log(`[Pterodactyl] Listing backups for ${identifier}`);
    return [];
  }

  /**
   * Restore a backup.
   *
   * Pterodactyl endpoint: POST /api/client/servers/{identifier}/backups/{backupId}/restore
   */
  async restoreBackup(identifier: string, backupId: string): Promise<void> {
    // TODO: Connect to Pterodactyl API
    // await this.clientRequest('POST', `/servers/${identifier}/backups/${backupId}/restore`);

    console.log(`[Pterodactyl] Restoring backup ${backupId} for ${identifier}`);
  }
}

// ---------------------------------------------------------------------------
// Singleton export (lazily initialized from environment)
// ---------------------------------------------------------------------------

let _instance: PterodactylService | null = null;

/**
 * Get the shared PterodactylService instance.
 * Reads config from environment variables on first call.
 */
export function getPterodactylService(): PterodactylService {
  if (!_instance) {
    const panelUrl = process.env.PTERODACTYL_URL;
    const apiKey = process.env.PTERODACTYL_API_KEY;
    const clientKey = process.env.PTERODACTYL_CLIENT_KEY;

    if (!panelUrl || !apiKey || !clientKey) {
      throw new Error(
        'Missing Pterodactyl environment variables. ' +
        'Ensure PTERODACTYL_URL, PTERODACTYL_API_KEY, and PTERODACTYL_CLIENT_KEY are set.'
      );
    }

    _instance = new PterodactylService(panelUrl, apiKey, clientKey);
  }

  return _instance;
}
