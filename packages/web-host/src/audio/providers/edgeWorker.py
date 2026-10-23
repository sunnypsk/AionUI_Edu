"""Host-owned JSON stdin worker using the pinned Edge TTS client."""

import asyncio
import json
from pathlib import Path
import sys

import edge_tts


async def main():
    request = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    communicate = edge_tts.Communicate(
        request['text'], request['voice'], rate=request['rate'],
        volume=request['volume'], pitch=request['pitch'],
        boundary=request['boundary'], connect_timeout=10, receive_timeout=60,
    )
    segments = []
    audio_bytes = 0
    with Path(request['output']).open('xb') as output:
        async for chunk in communicate.stream():
            if chunk['type'] == 'audio':
                output.write(chunk['data'])
                audio_bytes += len(chunk['data'])
            elif chunk['type'] in ('SentenceBoundary', 'WordBoundary'):
                segments.append({
                    'text': chunk['text'],
                    'startSecond': chunk['offset'] / 10_000_000,
                    'endSecond': (chunk['offset'] + chunk['duration']) / 10_000_000,
                })
    if audio_bytes < 1000:
        raise RuntimeError('AUDIO_NO_SPEECH')
    with Path(request['metadata']).open('x', encoding='utf-8') as output:
        json.dump(segments, output, ensure_ascii=False)
    print(json.dumps({'bytes': audio_bytes, 'segments': len(segments)}))


if __name__ == '__main__':
    asyncio.run(main())
