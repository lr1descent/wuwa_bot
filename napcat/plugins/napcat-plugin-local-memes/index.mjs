import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_CONFIG = {
  enabled: true,
  commandPrefix: 'meme',
  memeRoot: '/app/memes',
  allowedExtensions: ['.gif', '.png', '.jpg', '.jpeg', '.webp'],
  maxSendCount: 50,
  sendIntervalMs: 500
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

function normalizeNonNegativeNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.floor(number));
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
    maxSendCount: normalizePositiveNumber(input.maxSendCount, DEFAULT_CONFIG.maxSendCount),
    sendIntervalMs: normalizeNonNegativeNumber(input.sendIntervalMs, DEFAULT_CONFIG.sendIntervalMs)
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
    ctx.NapCatConfig.html('<div style="padding: 12px; border-radius: 8px; background: rgba(0,0,0,0.05);"><b>本地表情包</b><br><span style="font-size: 12px;">发送 meme关键词，从本地目录逐张发送表情包。</span></div>'),
    ctx.NapCatConfig.boolean('enabled', '启用表情包指令', DEFAULT_CONFIG.enabled, '关闭后不处理 meme关键词 指令'),
    ctx.NapCatConfig.text('commandPrefix', '指令前缀', DEFAULT_CONFIG.commandPrefix, '例如 meme，对应 meme西格莉卡'),
    ctx.NapCatConfig.text('memeRoot', '容器内表情包目录', DEFAULT_CONFIG.memeRoot, 'Docker 默认挂载为 /app/memes'),
    ctx.NapCatConfig.text('allowedExtensions', '允许的扩展名', DEFAULT_CONFIG.allowedExtensions.join(','), '逗号分隔，例如 .gif,.png,.jpg,.jpeg,.webp'),
    ctx.NapCatConfig.number('maxSendCount', '单次最多发送数量', DEFAULT_CONFIG.maxSendCount, '防止一次发送过多图片'),
    ctx.NapCatConfig.number('sendIntervalMs', '发送间隔毫秒', DEFAULT_CONFIG.sendIntervalMs, '每张图片之间的等待时间')
  );
}

export function parseMemeCommand(rawMessage, commandPrefix = DEFAULT_CONFIG.commandPrefix) {
  if (typeof rawMessage !== 'string') return null;

  const message = rawMessage.trim();
  const prefix = String(commandPrefix || '').trim();
  if (!message || !prefix) return null;
  if (!message.toLowerCase().startsWith(prefix.toLowerCase())) return null;

  return {
    keyword: message.slice(prefix.length).trim()
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

export function buildImageSegment(filePath) {
  return {
    type: 'image',
    data: {
      file: pathToFileURL(filePath).href
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

async function sendMessage(ctx, event, message) {
  const params = buildSendParams(event, message);
  await ctx.actions.call('send_msg', params, ctx.adapterName, ctx.pluginManager.config);
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

  if (!parsed.keyword) {
    await sendMessage(ctx, event, `用法：${currentConfig.commandPrefix}西格莉卡`);
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

  const filesToSend = files.slice(0, currentConfig.maxSendCount);
  logger?.info(`发送本地表情包：${parsed.keyword}，数量 ${filesToSend.length}/${files.length}，目录 ${dir}`);

  for (const file of filesToSend) {
    try {
      await sendMessage(ctx, event, [buildImageSegment(file)]);
    } catch (error) {
      logger?.warn(`发送表情包失败：${file}`, error);
    }

    if (currentConfig.sendIntervalMs > 0) {
      await sleep(currentConfig.sendIntervalMs);
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
