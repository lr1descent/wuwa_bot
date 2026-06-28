import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  buildForwardMessageNode,
  buildForwardSendCall,
  buildImageSegment,
  listMemeFiles,
  parseMemeCommand,
  plugin_init,
  plugin_onmessage,
  plugin_set_config,
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

test('buildForwardMessageNode wraps an image segment in a forward node', () => {
  const filePath = '/app/memes/西格莉卡/a b.gif';

  assert.deepEqual(buildForwardMessageNode(filePath), {
    type: 'node',
    data: {
      user_id: '10000',
      nickname: '本地表情包',
      content: [buildImageSegment(filePath)]
    }
  });
});

test('buildForwardSendCall uses dedicated forward actions for group and private chats', () => {
  const messages = [buildForwardMessageNode('/app/memes/西格莉卡/a.gif')];

  assert.deepEqual(buildForwardSendCall({ message_type: 'group', group_id: 123 }, messages), {
    action: 'send_group_forward_msg',
    params: {
      group_id: '123',
      messages
    }
  });

  assert.deepEqual(buildForwardSendCall({ message_type: 'private', user_id: 456 }, messages), {
    action: 'send_private_forward_msg',
    params: {
      user_id: '456',
      messages
    }
  });
});

test('plugin sends meme files as one merged forward message', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-memes-'));
  const dir = path.join(tmp, '西格莉卡');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '1.gif'), 'gif');
  fs.writeFileSync(path.join(dir, '2.gif'), 'gif');

  const calls = [];
  const ctx = {
    adapterName: 'test',
    configPath: path.join(tmp, 'config.json'),
    pluginManager: { config: {} },
    actions: {
      call: async (action, params, adapter, config) => {
        calls.push({ action, params, adapter, config });
      }
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {}
    }
  };

  await plugin_init(ctx);
  await plugin_set_config(ctx, {
    memeRoot: tmp,
    maxSendCount: 10
  });
  await plugin_onmessage(ctx, {
    message_type: 'group',
    group_id: 123,
    user_id: 456,
    self_id: 789,
    raw_message: 'meme西格莉卡'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'send_group_forward_msg');
  assert.equal(calls[0].params.group_id, '123');
  assert.equal(calls[0].params.messages.length, 2);
  assert.deepEqual(calls[0].params.messages.map((message) => message.type), ['node', 'node']);
});

test('sanitizeConfig keeps safe defaults and normalizes extensions', () => {
  const config = sanitizeConfig({
    enabled: false,
    commandPrefix: ' meme ',
    memeRoot: ' /custom/memes ',
    maxSendCount: 5,
    allowedExtensions: '.gif, png, .TXT',
    forwardUserId: ' 12345 ',
    forwardNickname: ' 表情仓库 '
  });

  assert.equal(config.enabled, false);
  assert.equal(config.commandPrefix, 'meme');
  assert.equal(config.memeRoot, '/custom/memes');
  assert.equal(config.maxSendCount, 5);
  assert.deepEqual(config.allowedExtensions, ['.gif', '.png', '.txt']);
  assert.equal(config.forwardUserId, '12345');
  assert.equal(config.forwardNickname, '表情仓库');
});
