import * as net from 'net'
import * as dns from 'dns'

// ============================================================
// Minecraft Server List Ping (SLP)
// ============================================================
//
// Implements the Minecraft SLP protocol to ping servers and
// get their status (latency, MOTD, player count, version).
// Used by the launcher for pre-join ping checks and
// Dynamic Island network stats.
// ============================================================

export interface ServerPingResult {
  latency: number          // Round-trip time in ms
  motd: string             // Server message of the day (plain text)
  players: {
    online: number
    max: number
  }
  version: {
    name: string           // e.g. "1.21.1"
    protocol: number       // e.g. 767
  }
  favicon?: string         // Base64 PNG icon (data URI)
}

/** Encode a value as a VarInt (Minecraft protocol format) */
function encodeVarInt(value: number): Buffer {
  const bytes: number[] = []
  while (true) {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) {
      byte |= 0x80
      bytes.push(byte)
    } else {
      bytes.push(byte)
      break
    }
  }
  return Buffer.from(bytes)
}

/** Read a VarInt from a buffer at the given offset. Returns [value, bytesRead] */
function readVarInt(buffer: Buffer, offset: number): [number, number] {
  let value = 0
  let length = 0
  let byte: number

  do {
    if (offset + length >= buffer.length) return [-1, 0]
    byte = buffer[offset + length]
    value |= (byte & 0x7f) << (7 * length)
    length++
    if (length > 5) throw new Error('VarInt too big')
  } while ((byte & 0x80) !== 0)

  return [value, length]
}

/**
 * Resolve SRV record for a Minecraft server.
 * Many servers use _minecraft._tcp.example.com SRV records.
 */
async function resolveSRV(host: string): Promise<{ host: string; port: number } | null> {
  return new Promise((resolve) => {
    dns.resolveSrv(`_minecraft._tcp.${host}`, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        resolve(null)
      } else {
        resolve({ host: addresses[0].name, port: addresses[0].port })
      }
    })
  })
}

/**
 * Ping a Minecraft server using the Server List Ping protocol.
 * Returns server info and measured latency.
 *
 * @param host  Server hostname or IP
 * @param port  Server port (default 25565)
 * @param timeout  Connection timeout in ms (default 5000)
 */
export async function pingMinecraftServer(
  host: string,
  port: number = 25565,
  timeout: number = 5000
): Promise<ServerPingResult> {
  // Try SRV record resolution first
  const srv = await resolveSRV(host)
  const connectHost = srv?.host ?? host
  const connectPort = srv?.port ?? port

  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    const startTime = Date.now()
    let responseBuffer = Buffer.alloc(0)
    let resolved = false

    const cleanup = () => {
      if (!resolved) {
        resolved = true
        socket.destroy()
      }
    }

    socket.setTimeout(timeout)

    socket.connect(connectPort, connectHost, () => {
      // === Handshake Packet ===
      const protocolVersion = encodeVarInt(765) // 1.20.4 protocol
      const hostBuf = Buffer.from(host, 'utf8')
      const hostLen = encodeVarInt(hostBuf.length)
      const portBuf = Buffer.alloc(2)
      portBuf.writeUInt16BE(connectPort)
      const nextState = encodeVarInt(1) // Status

      const handshakeData = Buffer.concat([
        Buffer.from([0x00]), // Packet ID: Handshake
        protocolVersion,
        hostLen,
        hostBuf,
        portBuf,
        nextState,
      ])

      const handshakePacket = Buffer.concat([
        encodeVarInt(handshakeData.length),
        handshakeData,
      ])

      // === Status Request Packet ===
      const statusRequest = Buffer.from([0x01, 0x00]) // Length=1, PacketID=0x00

      socket.write(Buffer.concat([handshakePacket, statusRequest]))
    })

    socket.on('data', (data) => {
      responseBuffer = Buffer.concat([responseBuffer, data])

      // Try to parse the response
      try {
        let offset = 0

        // Read packet length
        const [packetLen, packetLenBytes] = readVarInt(responseBuffer, offset)
        if (packetLen === -1) return // Need more data
        offset += packetLenBytes

        // Check if we have the full packet
        if (responseBuffer.length < offset + packetLen) return // Need more data

        // Read packet ID
        const [packetId, packetIdBytes] = readVarInt(responseBuffer, offset)
        offset += packetIdBytes

        if (packetId !== 0x00) return // Not a Status Response

        // Read JSON string length
        const [jsonLen, jsonLenBytes] = readVarInt(responseBuffer, offset)
        offset += jsonLenBytes

        if (responseBuffer.length < offset + jsonLen) return // Need more data

        // Read JSON string
        const jsonStr = responseBuffer.subarray(offset, offset + jsonLen).toString('utf8')
        const json = JSON.parse(jsonStr)

        const latency = Date.now() - startTime

        // Extract MOTD (can be a string or a Chat Component object)
        let motd = ''
        if (typeof json.description === 'string') {
          motd = json.description
        } else if (json.description?.text) {
          motd = json.description.text
          // Append extra components if present
          if (json.description.extra) {
            motd += json.description.extra.map((e: any) => e.text || '').join('')
          }
        }

        // Strip Minecraft formatting codes (§x)
        motd = motd.replace(/§[0-9a-fk-or]/gi, '')

        cleanup()
        resolve({
          latency,
          motd: motd.trim(),
          players: {
            online: json.players?.online ?? 0,
            max: json.players?.max ?? 0,
          },
          version: {
            name: json.version?.name ?? 'Unknown',
            protocol: json.version?.protocol ?? 0,
          },
          favicon: json.favicon ?? undefined,
        })
      } catch {
        // Incomplete data, wait for more
      }
    })

    socket.on('timeout', () => {
      cleanup()
      reject(new Error(`Connection timed out after ${timeout}ms`))
    })

    socket.on('error', (err) => {
      cleanup()
      reject(err)
    })

    socket.on('close', () => {
      if (!resolved) {
        cleanup()
        reject(new Error('Connection closed before response'))
      }
    })
  })
}
