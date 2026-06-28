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
  buildMemeListMessage,
  formatFileSize,
  listMemeFiles,
  listMemePacks,
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
  assert.deepEqual(parseMemeCommand('meme        西格莉卡'), { keyword: '西格莉卡' });
  assert.equal(parseMemeCommand('gif西格莉卡'), null);
  assert.equal(parseMemeCommand('memes西格莉卡'), null);
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

test('listMemePacks returns first-level meme pack names with image counts and total sizes', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-memes-'));
  const xglk = path.join(tmp, '西格莉卡');
  const jx = path.join(tmp, '今汐');
  fs.mkdirSync(xglk);
  fs.mkdirSync(jx);
  fs.writeFileSync(path.join(xglk, '1.gif'), Buffer.alloc(1024));
  fs.writeFileSync(path.join(xglk, '2.png'), Buffer.alloc(2048));
  fs.writeFileSync(path.join(xglk, 'note.txt'), 'txt');
  fs.writeFileSync(path.join(jx, '1.jpg'), Buffer.alloc(1536));
  fs.writeFileSync(path.join(tmp, 'top-level.gif'), 'gif');

  assert.deepEqual(listMemePacks(tmp, ['.gif', '.png', '.jpg']), [
    { name: '今汐', count: 1, totalBytes: 1536 },
    { name: '西格莉卡', count: 2, totalBytes: 3072 }
  ]);
});

test('buildMemeListMessage formats meme pack counts and sizes', () => {
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(buildMemeListMessage([
    { name: '今汐', count: 1, totalBytes: 1536 },
    { name: '西格莉卡', count: 2, totalBytes: 3072 }
  ]), [
    '当前表情包：',
    '- 今汐：1 张，1.5 KB',
    '- 西格莉卡：2 张，3 KB'
  ].join('\n'));
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

test('plugin sends small meme packs as one merged forward message even when they contain many files', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-memes-'));
  const dir = path.join(tmp, '西格莉卡');
  fs.mkdirSync(dir);
  for (let index = 1; index <= 12; index++) {
    fs.writeFileSync(path.join(dir, `${index}.gif`), 'gif');
  }

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
    maxSendCount: 12,
    forwardBatchSize: 5,
    forwardBatchMaxKb: 64,
    forwardBatchIntervalMs: 0
  });
  await plugin_onmessage(ctx, {
    message_type: 'group',
    group_id: 123,
    user_id: 456,
    self_id: 789,
    raw_message: 'meme西格莉卡'
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].action, 'send_msg');
  assert.equal(calls[0].params.message, '开始推送');
  assert.equal(calls[1].action, 'send_group_forward_msg');
  assert.equal(calls[1].params.group_id, '123');
  assert.equal(calls[1].params.messages.length, 13);
  assert.equal(calls[1].params.messages[0].data.content[0].data.text, '推送进度 12/12');
  assert.deepEqual(calls[1].params.messages.map((message) => message.type), Array(13).fill('node'));
  assert.equal(calls[2].action, 'send_msg');
  assert.equal(calls[2].params.message, '推送结束');
});

test('plugin splits large meme packs by cumulative file size', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-memes-'));
  const dir = path.join(tmp, '西格莉卡');
  fs.mkdirSync(dir);
  for (let index = 1; index <= 6; index++) {
    fs.writeFileSync(path.join(dir, `${index}.gif`), Buffer.alloc(4 * 1024));
  }

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
    maxSendCount: 6,
    forwardBatchSize: 99,
    forwardBatchMaxKb: 10,
    forwardBatchIntervalMs: 0
  });
  await plugin_onmessage(ctx, {
    message_type: 'group',
    group_id: 123,
    user_id: 456,
    self_id: 789,
    raw_message: 'meme西格莉卡'
  });

  assert.equal(calls.length, 5);
  assert.deepEqual(calls.map((call) => call.action), [
    'send_msg',
    'send_group_forward_msg',
    'send_group_forward_msg',
    'send_group_forward_msg',
    'send_msg'
  ]);
  assert.deepEqual(calls.slice(1, 4).map((call) => call.params.messages.length), [3, 3, 3]);
  assert.deepEqual(calls.slice(1, 4).map((call) => call.params.messages[0].data.content[0].data.text), [
    '推送进度 2/6',
    '推送进度 4/6',
    '推送进度 6/6'
  ]);
});

test('plugin sends start and end notices and adds progress nodes to every forward batch', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-memes-'));
  const dir = path.join(tmp, '西格莉卡');
  fs.mkdirSync(dir);
  for (let index = 1; index <= 5; index++) {
    fs.writeFileSync(path.join(dir, `${index}.gif`), Buffer.alloc(4 * 1024));
  }

  const calls = [];
  const infoLogs = [];
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
      info: (message) => infoLogs.push(String(message)),
      warn: () => {},
      error: () => {}
    }
  };

  await plugin_init(ctx);
  await plugin_set_config(ctx, {
    memeRoot: tmp,
    maxSendCount: 0,
    forwardBatchMaxKb: 10,
    forwardBatchIntervalMs: 0
  });
  await plugin_onmessage(ctx, {
    message_type: 'private',
    user_id: 456,
    self_id: 789,
    raw_message: 'meme西格莉卡'
  });

  assert.equal(calls.length, 5);
  assert.equal(calls[0].action, 'send_msg');
  assert.equal(calls[0].params.message, '开始推送');
  assert.deepEqual(calls.slice(1, 4).map((call) => call.action), [
    'send_private_forward_msg',
    'send_private_forward_msg',
    'send_private_forward_msg'
  ]);
  assert.equal(calls[4].action, 'send_msg');
  assert.equal(calls[4].params.message, '推送结束');

  assert.deepEqual(calls.slice(1, 4).map((call) => {
    const progressNode = call.params.messages[0];
    return progressNode.data.content[0].data.text;
  }), [
    '推送进度 2/5',
    '推送进度 4/5',
    '推送进度 5/5'
  ]);

  assert.ok(infoLogs.some((message) => message.includes('推送进度 2/5')));
  assert.ok(infoLogs.some((message) => message.includes('推送进度 4/5')));
  assert.ok(infoLogs.some((message) => message.includes('推送进度 5/5')));
});

test('plugin treats maxSendCount zero as sending all meme files', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-memes-'));
  const dir = path.join(tmp, '西格莉卡');
  fs.mkdirSync(dir);
  for (let index = 1; index <= 6; index++) {
    fs.writeFileSync(path.join(dir, `${index}.gif`), 'gif');
  }

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
    maxSendCount: 0,
    forwardBatchMaxKb: 64,
    forwardBatchIntervalMs: 0
  });
  await plugin_onmessage(ctx, {
    message_type: 'group',
    group_id: 123,
    user_id: 456,
    self_id: 789,
    raw_message: 'meme西格莉卡'
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].action, 'send_msg');
  assert.equal(calls[0].params.message, '开始推送');
  assert.equal(calls[1].action, 'send_group_forward_msg');
  assert.equal(calls[1].params.messages.length, 7);
  assert.equal(calls[1].params.messages[0].data.content[0].data.text, '推送进度 6/6');
  assert.equal(calls[2].action, 'send_msg');
  assert.equal(calls[2].params.message, '推送结束');
});

test('plugin sends meme list as text with pack counts and sizes', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'local-memes-'));
  const xglk = path.join(tmp, '西格莉卡');
  const jx = path.join(tmp, '今汐');
  fs.mkdirSync(xglk);
  fs.mkdirSync(jx);
  fs.writeFileSync(path.join(xglk, '1.gif'), Buffer.alloc(1024));
  fs.writeFileSync(path.join(jx, '1.jpg'), Buffer.alloc(1536));

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
    forwardBatchIntervalMs: 0
  });
  await plugin_onmessage(ctx, {
    message_type: 'private',
    user_id: 456,
    self_id: 789,
    raw_message: 'meme      list'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'send_msg');
  assert.equal(calls[0].params.user_id, '456');
  assert.equal(calls[0].params.message, [
    '当前表情包：',
    '- 今汐：1 张，1.5 KB',
    '- 西格莉卡：1 张，1 KB'
  ].join('\n'));
});

test('sanitizeConfig keeps safe defaults and normalizes extensions', () => {
  const config = sanitizeConfig({
    enabled: false,
    commandPrefix: ' meme ',
    memeRoot: ' /custom/memes ',
    maxSendCount: 0,
    forwardBatchSize: 4,
    forwardBatchMaxKb: 16,
    forwardBatchIntervalMs: -1,
    allowedExtensions: '.gif, png, .TXT',
    forwardUserId: ' 12345 ',
    forwardNickname: ' 表情仓库 '
  });

  assert.equal(config.enabled, false);
  assert.equal(config.commandPrefix, 'meme');
  assert.equal(config.memeRoot, '/custom/memes');
  assert.equal(config.maxSendCount, 0);
  assert.equal(config.forwardBatchMaxKb, 16);
  assert.equal(config.forwardBatchIntervalMs, 0);
  assert.deepEqual(config.allowedExtensions, ['.gif', '.png', '.txt']);
  assert.equal(config.forwardUserId, '12345');
  assert.equal(config.forwardNickname, '表情仓库');
});

test('sanitizeConfig defaults to full send and a conservative forward batch size', () => {
  const config = sanitizeConfig({});

  assert.equal(config.maxSendCount, 0);
  assert.equal(config.forwardBatchMaxKb, 12288);
});
