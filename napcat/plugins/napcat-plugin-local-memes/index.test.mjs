import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildImageSegment,
  listMemeFiles,
  parseMemeCommand,
  resolveMemeDirectory,
  sanitizeConfig
} from './index.mjs';

test('parseMemeCommand extracts keyword from compact and spaced meme commands by default', () => {
  assert.deepEqual(parseMemeCommand('meme西格莉卡'), { keyword: '西格莉卡' });
  assert.deepEqual(parseMemeCommand('meme 西格莉卡'), { keyword: '西格莉卡' });
  assert.equal(parseMemeCommand('gif西格莉卡'), null);
});

test('resolveMemeDirectory rejects empty and path traversal keywords', () => {
  const root = '/app/memes';
  assert.equal(resolveMemeDirectory(root, ''), null);
  assert.equal(resolveMemeDirectory(root, '../secret'), null);
  assert.equal(resolveMemeDirectory(root, 'foo/bar'), null);
  assert.equal(resolveMemeDirectory(root, 'foo\\bar'), null);
  assert.equal(resolveMemeDirectory(root, '西格莉卡'), path.join(root, '西格莉卡'));
});

test('listMemeFiles returns sorted supported image files only', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-memes-'));
  const dir = path.join(tmp, '西格莉卡');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '10.gif'), 'gif');
  fs.writeFileSync(path.join(dir, '2.png'), 'png');
  fs.writeFileSync(path.join(dir, 'note.txt'), 'txt');
  fs.mkdirSync(path.join(dir, 'nested.gif'));

  assert.deepEqual(
    listMemeFiles(tmp, '西格莉卡', ['.gif', '.png']).map((file) => path.basename(file)),
    ['2.png', '10.gif']
  );
});

test('buildImageSegment uses a local file URL for NapCat image messages', () => {
  const filePath = '/app/memes/西格莉卡/a b.gif';
  assert.deepEqual(buildImageSegment(filePath), {
    type: 'image',
    data: { file: pathToFileURL(filePath).href }
  });
});

test('sanitizeConfig keeps safe defaults and normalizes extensions', () => {
  const config = sanitizeConfig({
    enabled: false,
    commandPrefix: ' meme ',
    memeRoot: ' /custom/memes ',
    sendIntervalMs: -1,
    maxSendCount: 5,
    allowedExtensions: '.gif, png, .TXT'
  });

  assert.equal(config.enabled, false);
  assert.equal(config.commandPrefix, 'meme');
  assert.equal(config.memeRoot, '/custom/memes');
  assert.equal(config.sendIntervalMs, 0);
  assert.equal(config.maxSendCount, 5);
  assert.deepEqual(config.allowedExtensions, ['.gif', '.png', '.txt']);
});
