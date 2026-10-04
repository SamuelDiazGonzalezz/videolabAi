import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { readStoryboardAsset, storyboardAssetPath } from '../../../../../lib/storyboards';

export const runtime = 'nodejs';

const CORS = { 'Access-Control-Allow-Origin': '*' };

// Los MP4 exportados pueden pesar cientos de MB: se sirven en streaming y con
// soporte de Range para que el reproductor pueda buscar sin descargar todo.
async function streamVideo(request: Request, file: string, filename: string) {
  const info = await stat(file).catch(() => null);
  if (!info) return new NextResponse('Not found', { status: 404 });
  const download = new URL(request.url).searchParams.get('download');
  const headers: Record<string, string> = {
    ...CORS,
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    ...(download ? { 'Content-Disposition': `attachment; filename="${download.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || filename}"` } : {}),
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) return new NextResponse(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${info.size}` } });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new NextResponse(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new NextResponse(body, { headers: { ...headers, 'Content-Length': String(info.size) } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; filename: string }> }) {
  const { id, filename } = await params;
  if (filename.endsWith('.mp4')) {
    const file = storyboardAssetPath(id, filename);
    return file ? streamVideo(request, file, filename) : new NextResponse('Not found', { status: 404 });
  }
  const asset = await readStoryboardAsset(id, filename);
  if (!asset) return new NextResponse('Not found', { status: 404 });
  const contentType = filename.endsWith('.mp3')
    ? 'audio/mpeg'
    : filename.endsWith('.json')
      ? 'application/json; charset=utf-8'
      : 'image/png';
  return new NextResponse(asset, {
    headers: {
      'Content-Type': contentType,
      // La narración se puede regenerar con otra voz: no se cachea como inmutable.
      'Cache-Control': filename.endsWith('.png') ? 'public, max-age=31536000, immutable' : 'no-store',
      ...CORS,
    },
  });
}
