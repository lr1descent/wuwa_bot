import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CONFIG = {
  enabled: true,
  commandPrefix: 'meme',
  memeRoot: '/app/memes',
  allowedExtensions: ['.gif', '.png', '.jpg', '.jpeg', '.webp'],
  maxSendCount: 0,
  forwardBatchMaxKb: 12288,
  forwardBatchIntervalMs: 1500,
  forwardUserId: '10000',
  forwardNickname: '本地表情包'
};

const collator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base'
});

let logger = null;
let currentConfig = { ...DEFAULT_CONFIG };
let plugin_config_ui = [];

function normalizeExtensions(value) {
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : DEFAULT_CONFIG.allowedExtensions;

  const extensions = rawItems
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.startsWith('.') ? item : `.${item}`)
    .filter((item) => /^\.[a-z0-9]+$/.test(item));

  return extensions.length > 0 ? [...new Set(extensions)] : DEFAULT_CONFIG.allowedExtensions;
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.floor(number));
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function normalizeNonNegativeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

export function sanitizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const commandPrefix = typeof input.commandPrefix === 'string' && input.commandPrefix.trim()
    ? input.commandPrefix.trim()
    : DEFAULT_CONFIG.commandPrefix;
  const memeRoot = typeof input.memeRoot === 'string' && input.memeRoot.trim()
    ? input.memeRoot.trim()
    : DEFAULT_CONFIG.memeRoot;

  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_CONFIG.enabled,
    commandPrefix,
    memeRoot,
    allowedExtensions: normalizeExtensions(input.allowedExtensions),
    maxSendCount: normalizeNonNegativeInteger(input.maxSendCount, DEFAULT_CONFIG.maxSendCount),
    forwardBatchMaxKb: normalizePositiveNumber(input.forwardBatchMaxKb, DEFAULT_CONFIG.forwardBatchMaxKb),
    forwardBatchIntervalMs: normalizeNonNegativeNumber(input.forwardBatchIntervalMs, DEFAULT_CONFIG.forwardBatchIntervalMs),
    forwardUserId: typeof input.forwardUserId === 'string' && input.forwardUserId.trim()
      ? input.forwardUserId.trim()
      : DEFAULT_CONFIG.forwardUserId,
    forwardNickname: typeof input.forwardNickname === 'string' && input.forwardNickname.trim()
      ? input.forwardNickname.trim()
      : DEFAULT_CONFIG.forwardNickname
  };
}

function loadConfig(ctx) {
  try {
    if (ctx.configPath && fs.existsSync(ctx.configPath)) {
      const raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8'));
      currentConfig = sanitizeConfig(raw);
      return;
    }
  } catch (error) {
    logger?.warn('读取本地表情包插件配置失败，使用默认配置', error);
  }

  currentConfig = sanitizeConfig(DEFAULT_CONFIG);
  saveConfig(ctx);
}

function saveConfig(ctx) {
  if (!ctx?.configPath) return;

  try {
    const configDir = path.dirname(ctx.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(ctx.configPath, JSON.stringify(currentConfig, null, 2), 'utf-8');
  } catch (error) {
    logger?.error('保存本地表情包插件配置失败', error);
  }
}

function buildConfigUi(ctx) {
  if (!ctx.NapCatConfig) return [];

  return ctx.NapCatConfig.combine(
    ctx.NapCatConfig.html('<div style="padding: 12px; border-radius: 8px; background: rgba(0,0,0,0.05);"><b>本地表情包</b><br><span style="font-size: 12px;">发送 meme关键词，从本地目录以合并转发发送表情包。</span></div>'),
    ctx.NapCatConfig.boolean('enabled', '启用表情包指令', DEFAULT_CONFIG.enabled, '关闭后不处理 meme关键词 指令'),
    ctx.NapCatConfig.text('commandPrefix', '指令前缀', DEFAULT_CONFIG.commandPrefix, '例如 meme，对应 meme西格莉卡'),
    ctx.NapCatConfig.text('memeRoot', '容器内表情包目录', DEFAULT_CONFIG.memeRoot, 'Docker 默认挂载为 /app/memes'),
    ctx.NapCatConfig.text('allowedExtensions', '允许的扩展名', DEFAULT_CONFIG.allowedExtensions.join(','), '逗号分隔，例如 .gif,.png,.jpg,.jpeg,.webp'),
    ctx.NapCatConfig.number('maxSendCount', '单次最多发送数量', DEFAULT_CONFIG.maxSendCount, '0 表示发送全部表情包'),
    ctx.NapCatConfig.number('forwardBatchMaxKb', '单批最大体积(KB)', DEFAULT_CONFIG.forwardBatchMaxKb, '超过该累计体积后自动拆成下一条合并转发'),
    ctx.NapCatConfig.number('forwardBatchIntervalMs', '批次间隔毫秒', DEFAULT_CONFIG.forwardBatchIntervalMs, '多条合并转发之间的等待时间'),
    ctx.NapCatConfig.text('forwardUserId', '合并转发显示 QQ', DEFAULT_CONFIG.forwardUserId, '合并转发节点里显示的 QQ 号'),
    ctx.NapCatConfig.text('forwardNickname', '合并转发显示昵称', DEFAULT_CONFIG.forwardNickname, '合并转发节点里显示的昵称')
  );
}

export function parseMemeCommand(rawMessage, commandPrefix = DEFAULT_CONFIG.commandPrefix) {
  if (typeof rawMessage !== 'string') return null;

  const message = rawMessage.trim();
  const prefix = String(commandPrefix || '').trim();
  if (!message || !prefix) return null;
  if (!message.toLowerCase().startsWith(prefix.toLowerCase())) return null;

  const rest = message.slice(prefix.length);
  if (/^[A-Za-z0-9_]/.test(rest)) return null;

  return {
    keyword: rest.trim()
  };
}

export function resolveMemeDirectory(memeRoot, keyword) {
  const cleanKeyword = String(keyword || '').trim();
  if (!cleanKeyword) return null;
  if (cleanKeyword.includes('\0')) return null;
  if (cleanKeyword.includes('/') || cleanKeyword.includes('\\')) return null;
  if (cleanKeyword.includes('..')) return null;

  const root = path.resolve(String(memeRoot || DEFAULT_CONFIG.memeRoot));
  const target = path.resolve(root, cleanKeyword);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) return null;

  return target;
}

export function listMemeFiles(memeRoot, keyword, allowedExtensions = DEFAULT_CONFIG.allowedExtensions) {
  const dir = resolveMemeDirectory(memeRoot, keyword);
  if (!dir) return [];
  if (!fs.existsSync(dir)) return [];

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) return [];

  const allowed = new Set(normalizeExtensions(allowedExtensions));
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => collator.compare(path.basename(a), path.basename(b)));
}

export function listMemePacks(memeRoot, allowedExtensions = DEFAULT_CONFIG.allowedExtensions) {
  const root = path.resolve(String(memeRoot || DEFAULT_CONFIG.memeRoot));
  if (!fs.existsSync(root)) return [];

  const stat = fs.statSync(root);
  if (!stat.isDirectory()) return [];

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const files = listMemeFiles(root, entry.name, allowedExtensions);
      return {
        name: entry.name,
        count: files.length,
        totalBytes: files.reduce((total, file) => total + getFileSize(file), 0)
      };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

export function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${units[unitIndex]}`;
}

export function buildMemeListMessage(packs) {
  if (!Array.isArray(packs) || packs.length === 0) {
    return '当前没有可用表情包';
  }

  return [
    '当前表情包：',
    ...packs.map((pack) => `- ${pack.name}：${pack.count} 张，${formatFileSize(pack.totalBytes)}`)
  ].join('\n');
}

export function buildImageSegment(filePath) {
  return {
    type: 'image',
    data: {
      file: pathToFileURL(filePath).href
    }
  };
}

export function buildForwardMessageNode(filePath, options = {}) {
  return {
    type: 'node',
    data: {
      user_id: String(options.userId || currentConfig.forwardUserId || DEFAULT_CONFIG.forwardUserId),
      nickname: String(options.nickname || currentConfig.forwardNickname || DEFAULT_CONFIG.forwardNickname),
      content: [buildImageSegment(filePath)]
    }
  };
}

function buildSendParams(event, message) {
  return {
    message,
    message_type: event.message_type,
    ...(event.message_type === 'group' && event.group_id ? { group_id: String(event.group_id) } : {}),
    ...(event.message_type === 'private' && event.user_id ? { user_id: String(event.user_id) } : {})
  };
}

export function buildForwardSendCall(event, messages) {
  if (event.message_type === 'group' && event.group_id) {
    return {
      action: 'send_group_forward_msg',
      params: {
        group_id: String(event.group_id),
        messages
      }
    };
  }

  if (event.message_type === 'private' && event.user_id) {
    return {
      action: 'send_private_forward_msg',
      params: {
        user_id: String(event.user_id),
        messages
      }
    };
  }

  return null;
}

async function sendMessage(ctx, event, message) {
  const params = buildSendParams(event, message);
  await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
}

async function sendForwardMessages(ctx, event, messages) {
  const call = buildForwardSendCall(event, messages);
  if (!call) return;

  await ctx.actions.call(call.action, call.params, ctx.adapterName, ctx.pluginManager.config);
}

function getFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function splitIntoBatchesBySize(files, maxBatchKb) {
  const maxBatchBytes = normalizePositiveNumber(maxBatchKb, DEFAULT_CONFIG.forwardBatchMaxKb) * 1024;
  const batches = [];
  let currentBatch = [];
  let currentBatchBytes = 0;

  for (const file of files) {
    const fileSize = getFileSize(file);
    if (currentBatch.length > 0 && currentBatchBytes + fileSize > maxBatchBytes) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchBytes = 0;
    }

    currentBatch.push(file);
    currentBatchBytes += fileSize;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleMemeCommand(ctx, event) {
  if (!currentConfig.enabled) return false;
  if (event.message_type !== 'group' && event.message_type !== 'private') return false;
  if (String(event.user_id || '') === String(event.self_id || '')) return false;

  const parsed = parseMemeCommand(event.raw_message || '', currentConfig.commandPrefix);
  if (!parsed) return false;

  if (parsed.keyword.toLowerCase() === 'list') {
    const packs = listMemePacks(currentConfig.memeRoot, currentConfig.allowedExtensions);
    await sendMessage(ctx, event, buildMemeListMessage(packs));
    return true;
  }

  if (!parsed.keyword) {
    await sendMessage(ctx, event, `用法：${currentConfig.commandPrefix}西格莉卡\n${currentConfig.commandPrefix} list`);
    return true;
  }

  const dir = resolveMemeDirectory(currentConfig.memeRoot, parsed.keyword);
  if (!dir) {
    await sendMessage(ctx, event, '表情包名称不能包含路径符号');
    return true;
  }

  const files = listMemeFiles(currentConfig.memeRoot, parsed.keyword, currentConfig.allowedExtensions);
  if (files.length === 0) {
    await sendMessage(ctx, event, `没有找到「${parsed.keyword}」的表情包`);
    return true;
  }

  const filesToSend = currentConfig.maxSendCount > 0
    ? files.slice(0, currentConfig.maxSendCount)
    : files;
  const fileBatches = splitIntoBatchesBySize(filesToSend, currentConfig.forwardBatchMaxKb);
  logger?.info(`发送本地表情包：${parsed.keyword}，数量 ${filesToSend.length}/${files.length}，批次 ${fileBatches.length}，目录 ${dir}`);

  for (const [batchIndex, fileBatch] of fileBatches.entries()) {
    const messages = fileBatch.map((file) => buildForwardMessageNode(file));
    try {
      await sendForwardMessages(ctx, event, messages);
    } catch (error) {
      logger?.warn(`发送合并转发表情包失败：${parsed.keyword}，批次 ${batchIndex + 1}/${fileBatches.length}`, error);
    }

    if (batchIndex < fileBatches.length - 1 && currentConfig.forwardBatchIntervalMs > 0) {
      await sleep(currentConfig.forwardBatchIntervalMs);
    }
  }

  return true;
}

const plugin_init = async (ctx) => {
  logger = ctx.logger;
  loadConfig(ctx);
  plugin_config_ui = buildConfigUi(ctx);
  logger?.info(`本地表情包插件已启动，目录：${currentConfig.memeRoot}`);
};

const plugin_onmessage = async (ctx, event) => {
  try {
    await handleMemeCommand(ctx, event);
  } catch (error) {
    logger?.error('处理本地表情包指令失败', error);
  }
};

const plugin_get_config = async () => {
  return currentConfig;
};

const plugin_set_config = async (ctx, config) => {
  currentConfig = sanitizeConfig(config);
  saveConfig(ctx);
};

const plugin_on_config_change = async (ctx, _ui, key, value) => {
  currentConfig = sanitizeConfig({
    ...currentConfig,
    [key]: value
  });
  saveConfig(ctx);
};

const plugin_cleanup = async () => {
  logger?.info('本地表情包插件已卸载');
  logger = null;
};

export {
  plugin_cleanup,
  plugin_config_ui,
  plugin_get_config,
  plugin_init,
  plugin_on_config_change,
  plugin_onmessage,
  plugin_set_config
};
