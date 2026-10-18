import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles } from '../src/smiles.ts';
import { sameStructure } from '../src/isomorphism.ts';
import { altTextFor, decodePayload, PAYLOAD_MARKER } from '../src/payload.ts';
import { HEXSKETCH_STYLE } from '../src/style.ts';

test('payload round-trips structure and style through alt text', async () => {
  const mol = parseSmiles('CC(C)Cc1ccc(C(C)C(=O)O)cc1');
  let i = 0;
  for (const a of mol.atoms()) { a.x = (i % 5) * 18.43; a.y = Math.floor(i++ / 5) * 18.43; }
  const alt = await altTextFor(mol, 'ibuprofen', HEXSKETCH_STYLE);
  assert.ok(alt.startsWith('ibuprofen\n\n' + PAYLOAD_MARKER));
  assert.ok(alt.length < 2000, `alt text ${alt.length} chars`);
  const back = await decodePayload(`<img alt="${alt}">`);
  assert.ok(back);
  assert.ok(sameStructure(mol, back.mol));
  assert.equal(back.style.lineWidth.toFixed(2), HEXSKETCH_STYLE.lineWidth.toFixed(2));
});

test('text without a payload, or a corrupted one, decodes to null', async () => {
  assert.equal(await decodePayload('just a picture'), null);
  assert.equal(await decodePayload(PAYLOAD_MARKER + 'not-really-deflate'), null);
});

test('the payload rides inside a PNG and comes back out', async () => {
  const { pngWithPayload, payloadFromPng, decodePayload, encodePayload } = await import('../src/payload.ts');
  const { parseSmiles } = await import('../src/smiles.ts');
  const { deflateSync, crc32 } = await import('node:zlib');
  // A 1x1 white PNG.
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
  assert.equal(payloadFromPng(new Uint8Array(png)), null);
  const text = 'aspirin\n\n' + await encodePayload(parseSmiles('CC(=O)Oc1ccccc1C(=O)O'));
  const withIt = pngWithPayload(new Uint8Array(png), text);
  assert.equal(payloadFromPng(withIt), text);
  // Still a valid PNG to zlib-based readers: chunk CRC matches.
  const b = Buffer.from(withIt), len = b.readUInt32BE(33);
  assert.equal(b.readUInt32BE(33 + 8 + len), crc32(b.subarray(37, 41 + len)) >>> 0);
  const back = await decodePayload(payloadFromPng(withIt)!);
  assert.equal(back?.mol.atomCount, 13);  // Pictures made before the rename to HexSketch still open: keyword and marker "DrawChem".
  const old = text.replace('HexSketch:1:', 'DrawChem:1:');
  assert.notEqual(old, text);
  const oldPng = Buffer.concat([png.subarray(0, 33), chunk('tEXt', Buffer.from(`DrawChem\0${old}`)), png.subarray(33)]);
  assert.equal((await decodePayload(payloadFromPng(new Uint8Array(oldPng))!))?.mol.atomCount, 13);
});
