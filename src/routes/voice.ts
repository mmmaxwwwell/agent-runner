import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../lib/config.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('voice');

type RouteHandler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => void | Promise<void>;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readRawBody(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Parse a multipart/form-data body and extract the named file field.
 * Returns the file data buffer, or null if the field is not found.
 */
function extractMultipartFile(body: Buffer, boundary: string, fieldName: string): Buffer | null {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const crlfCrlf = Buffer.from('\r\n\r\n');

  // Find all boundary positions
  let searchFrom = 0;
  const parts: { start: number; end: number }[] = [];

  while (true) {
    const bStart = body.indexOf(boundaryBuf, searchFrom);
    if (bStart === -1) break;
    if (parts.length > 0) {
      // The previous part ends just before this boundary (minus trailing \r\n)
      parts[parts.length - 1]!.end = bStart - 2; // skip \r\n before boundary
    }
    const headerStart = bStart + boundaryBuf.length;
    // Check if this is the closing boundary (--)
    if (body[headerStart] === 0x2d && body[headerStart + 1] === 0x2d) break;
    // Skip \r\n after boundary marker
    const contentStart = headerStart + 2; // skip \r\n
    parts.push({ start: contentStart, end: body.length });
    searchFrom = contentStart;
  }

  for (const part of parts) {
    const partData = body.subarray(part.start, part.end);
    const headerEnd = partData.indexOf(crlfCrlf);
    if (headerEnd === -1) continue;

    const headers = partData.subarray(0, headerEnd).toString('utf-8');
    if (headers.includes(`name="${fieldName}"`)) {
      return partData.subarray(headerEnd + 4); // skip \r\n\r\n
    }
  }

  return null;
}

export function mountVoiceRoutes(apiRoutes: Map<string, RouteHandler>, cfg: Config): void {
  // POST /api/voice/transcribe — proxy audio to Google Speech-to-Text API
  apiRoutes.set('POST /api/voice/transcribe', async (req, res) => {
    const contentType = req.headers['content-type'] ?? '';

    // Extract audio data from request
    let audioData: Buffer | null = null;

    if (contentType.includes('multipart/form-data')) {
      const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
      if (!boundaryMatch) {
        sendJson(res, 400, { error: 'Invalid multipart boundary' });
        return;
      }
      const body = await readRawBody(req);
      audioData = extractMultipartFile(body, boundaryMatch[1]!, 'audio');
    } else {
      // Not multipart — no audio provided
      // Consume the body to avoid connection issues
      await readRawBody(req);
    }

    if (!audioData || audioData.length === 0) {
      sendJson(res, 400, { error: 'No audio provided' });
      return;
    }

    // Check if Google STT API key is configured
    if (!cfg.googleSttApiKey) {
      sendJson(res, 503, { error: 'Google Speech-to-Text API key not configured' });
      return;
    }

    // Proxy to Google Speech-to-Text API
    const base64Audio = audioData.toString('base64');
    const googleUrl = `https://speech.googleapis.com/v1/speech:recognize?key=${cfg.googleSttApiKey}`;

    try {
      log.debug({ audioSize: audioData.length }, 'Proxying audio to Google Speech-to-Text');

      const googleRes = await globalThis.fetch(googleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: {
            encoding: 'WEBM_OPUS',
            sampleRateHertz: 48000,
            languageCode: 'en-US',
          },
          audio: {
            content: base64Audio,
          },
        }),
      });

      if (!googleRes.ok) {
        const errText = await googleRes.text();
        log.error({ status: googleRes.status, error: errText }, 'Google STT API error');
        sendJson(res, 502, { error: 'Google Speech-to-Text API error' });
        return;
      }

      const result = await googleRes.json() as {
        results?: Array<{
          alternatives?: Array<{ transcript?: string }>;
        }>;
      };

      // Extract transcribed text from Google's response
      const transcript = result.results
        ?.map(r => r.alternatives?.[0]?.transcript ?? '')
        .join(' ')
        .trim() ?? '';

      sendJson(res, 200, { text: transcript });
    } catch (err) {
      log.error({ err }, 'Failed to call Google Speech-to-Text API');
      sendJson(res, 502, { error: 'Google Speech-to-Text API error' });
    }
  });
}
