/** 24 kHz mono 16-bit WAV with an extra LIST chunk before `data`, like FFmpeg writes. */
export function wav(samples: number[]): Buffer {
  const list = Buffer.from('LIST\x04\x00\x00\x00INFO', 'latin1');
  const header = Buffer.alloc(36);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + list.length + 8 + samples.length * 2, 4);
  header.write('WAVEfmt ', 8, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  const data = Buffer.alloc(8 + samples.length * 2);
  data.write('data', 0, 'latin1');
  data.writeUInt32LE(samples.length * 2, 4);
  samples.forEach((sample, index) => data.writeInt16LE(sample, 8 + index * 2));
  return Buffer.concat([header, list, data]);
}
