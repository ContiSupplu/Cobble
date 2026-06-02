// ============================================================================
// Cobble QuickServers - Plugin Routes
// ============================================================================
// Proxies requests to the Modrinth API for plugin search/versions and
// handles plugin installation/uninstallation on servers via Pterodactyl.
//
// Modrinth API docs: https://docs.modrinth.com/
// ============================================================================

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { getPterodactylService } from '../services/pterodactyl';
import {
  ApiResponse,
  ModrinthProject,
  ModrinthVersion,
  InstallPluginRequest,
} from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/plugins/search
// ---------------------------------------------------------------------------
// Search for plugins on Modrinth (proxied to avoid CORS issues).
// Query params: ?query=essentials&facets=server_side:required&limit=20&offset=0
// ---------------------------------------------------------------------------
router.get('/search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, limit = '20', offset = '0', gameVersion, loader } = req.query as {
      query?: string;
      limit?: string;
      offset?: string;
      gameVersion?: string;
      loader?: string;
    };

    if (!query) {
      res.status(400).json({
        success: false,
        error: 'Search query is required',
      } satisfies ApiResponse);
      return;
    }

    // TODO: Proxy to Modrinth API
    // const modrinthUrl = new URL('https://api.modrinth.com/v2/search');
    // modrinthUrl.searchParams.set('query', query);
    // modrinthUrl.searchParams.set('limit', limit);
    // modrinthUrl.searchParams.set('offset', offset);
    // modrinthUrl.searchParams.set('facets', JSON.stringify([
    //   ['project_type:mod'],
    //   ['server_side:required', 'server_side:optional'],
    //   ...(gameVersion ? [['versions:' + gameVersion]] : []),
    //   ...(loader ? [['categories:' + loader]] : []),
    // ]));
    //
    // const response = await fetch(modrinthUrl.toString(), {
    //   headers: { 'User-Agent': 'CobbleQuickServers/1.0.0 (contact@cobble.gg)' },
    // });
    // const data = await response.json();

    console.log(`[Plugins] Searching Modrinth: "${query}" (limit=${limit}, offset=${offset})`);

    // Placeholder response
    const placeholderResults: ModrinthProject[] = [
      {
        slug: 'essentialsx',
        title: 'EssentialsX',
        description: 'The essential plugin suite for Minecraft servers.',
        categories: ['utility', 'economy'],
        clientSide: 'unsupported',
        serverSide: 'required',
        projectType: 'mod',
        downloads: 1500000,
        iconUrl: 'https://cdn.modrinth.com/placeholder-icon.png',
        projectId: 'placeholder-id-1',
        author: 'EssentialsX Team',
        versions: ['1.20.4', '1.20.2', '1.19.4'],
        follows: 25000,
        dateCreated: '2020-01-01T00:00:00Z',
        dateModified: new Date().toISOString(),
      },
    ];

    res.status(200).json({
      success: true,
      data: {
        hits: placeholderResults,
        offset: parseInt(offset),
        limit: parseInt(limit),
        totalHits: 1,
      },
    } satisfies ApiResponse);
  } catch (error) {
    console.error('[Plugins] Search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search plugins',
    } satisfies ApiResponse);
  }
});

// ---------------------------------------------------------------------------
// GET /api/plugins/:projectId/versions
// ---------------------------------------------------------------------------
// Get available versions for a Modrinth project.
// Query params: ?gameVersion=1.20.4&loader=paper
// ---------------------------------------------------------------------------
router.get(
  '/:projectId/versions',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const { gameVersion, loader } = req.query as {
        gameVersion?: string;
        loader?: string;
      };

      // TODO: Proxy to Modrinth API
      // const modrinthUrl = new URL(`https://api.modrinth.com/v2/project/${projectId}/version`);
      // if (gameVersion) modrinthUrl.searchParams.set('game_versions', JSON.stringify([gameVersion]));
      // if (loader) modrinthUrl.searchParams.set('loaders', JSON.stringify([loader]));
      //
      // const response = await fetch(modrinthUrl.toString(), {
      //   headers: { 'User-Agent': 'CobbleQuickServers/1.0.0 (contact@cobble.gg)' },
      // });
      // const versions = await response.json();

      console.log(
        `[Plugins] Getting versions for ${projectId} (gameVersion=${gameVersion}, loader=${loader})`
      );

      // Placeholder response
      const placeholderVersions: ModrinthVersion[] = [
        {
          id: 'version-placeholder-1',
          projectId,
          name: 'v2.20.1',
          versionNumber: '2.20.1',
          changelog: 'Bug fixes and improvements',
          gameVersions: ['1.20.4', '1.20.2'],
          loaders: ['paper', 'spigot'],
          datePublished: new Date().toISOString(),
          downloads: 50000,
          files: [
            {
              hashes: {
                sha1: 'placeholder-sha1',
                sha512: 'placeholder-sha512',
              },
              url: 'https://cdn.modrinth.com/placeholder-download.jar',
              filename: 'plugin-2.20.1.jar',
              primary: true,
              size: 1024 * 512, // 512 KB
            },
          ],
        },
      ];

      res.status(200).json({
        success: true,
        data: placeholderVersions,
      } satisfies ApiResponse<ModrinthVersion[]>);
    } catch (error) {
      console.error('[Plugins] Get versions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get plugin versions',
      } satisfies ApiResponse);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/plugins/install
// ---------------------------------------------------------------------------
// Download a plugin from Modrinth and install it on the server.
// Requires: Bearer token
// Body: { serverId, projectId, versionId, filename }
// ---------------------------------------------------------------------------
router.post(
  '/install',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { serverId, projectId, versionId, filename } =
        req.body as InstallPluginRequest;

      // Validate required fields
      if (!serverId || !projectId || !versionId || !filename) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields: serverId, projectId, versionId, filename',
        } satisfies ApiResponse);
        return;
      }

      // TODO: Verify user owns the server
      // TODO: Check plugin count against tier limits

      // TODO: Download plugin from Modrinth
      // const versionUrl = `https://api.modrinth.com/v2/version/${versionId}`;
      // const versionResponse = await fetch(versionUrl);
      // const versionData = await versionResponse.json();
      // const primaryFile = versionData.files.find((f: any) => f.primary);
      // const pluginBuffer = await fetch(primaryFile.url).then(r => r.buffer());

      // TODO: Upload plugin to server via Pterodactyl
      // const ptero = getPterodactylService();
      // const serverIdentifier = await getServerIdentifier(serverId); // from DB
      // await ptero.uploadFile(serverIdentifier, `/plugins/${filename}`, pluginBuffer);

      console.log(
        `[Plugins] Installing plugin ${projectId} (version: ${versionId}) on server ${serverId}`
      );

      res.status(200).json({
        success: true,
        data: {
          serverId,
          projectId,
          versionId,
          filename,
          installedAt: new Date().toISOString(),
        },
        message: `Plugin ${filename} installed successfully`,
      } satisfies ApiResponse);
    } catch (error) {
      console.error('[Plugins] Install error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to install plugin',
      } satisfies ApiResponse);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/plugins/:serverId/:pluginName
// ---------------------------------------------------------------------------
// Uninstall (delete) a plugin from a server.
// Requires: Bearer token
// ---------------------------------------------------------------------------
router.delete(
  '/:serverId/:pluginName',
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { serverId, pluginName } = req.params;

      // TODO: Verify user owns the server
      // TODO: Delete the plugin file from the server via Pterodactyl
      // const ptero = getPterodactylService();
      // const serverIdentifier = await getServerIdentifier(serverId); // from DB
      // await ptero.deleteFiles(serverIdentifier, '/plugins', [pluginName]);

      // TODO: Update the installed plugins list in the database

      console.log(`[Plugins] Uninstalling ${pluginName} from server ${serverId}`);

      res.status(200).json({
        success: true,
        message: `Plugin ${pluginName} uninstalled from server ${serverId}`,
      } satisfies ApiResponse);
    } catch (error) {
      console.error('[Plugins] Uninstall error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to uninstall plugin',
      } satisfies ApiResponse);
    }
  }
);

export default router;
