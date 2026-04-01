const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const CONFIG = {
  DEEP_RESEARCH_URL: process.env.DEEP_RESEARCH_URL || 'http://localhost:3020',
  OBSIDIAN_API_URL: process.env.OBSIDIAN_API_URL || 'http://127.0.0.1:27123',
  OBSIDIAN_API_KEY: process.env.OBSIDIAN_API_KEY || '',
  OBSIDIAN_PATH: process.env.OBSIDIAN_PATH || '01_投资研究/AI深度报告',
  PORT: process.env.PORT || 3021,
  // 外部Tavily代理URL（proxy转发请求到此地址）
  TAVILY_PROXY_URL: process.env.TAVILY_PROXY_URL || 'https://api.tavily.com',
  // 默认Tavily API Key（当请求中没有提供时使用）
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || '',
};

let currentReport = '';
let currentTitle = '';
let isResearchComplete = false;

// 拦截来自 deep-research 的 Tavily 请求（硬编码 URL）
// deep-research 镜像在构建时硬编码了 https://api.tavily.com
app.use(async (req, res, next) => {
  // 检查请求是否发往 api.tavily.com（通过 Host header 或 X-Forwarded-Host）
  const host = req.headers['host'] || '';
  const forwardedHost = req.headers['x-forwarded-host'] || '';

  if (host.includes('api.tavily.com') || forwardedHost.includes('api.tavily.com')) {
    // 这是发往 api.tavily.com 的请求，需要拦截
    const path = req.url.startsWith('/') ? req.url.slice(1) : 'search';
    const targetUrl = `${CONFIG.TAVILY_PROXY_URL}/${path}`;

    // 从请求中获取 API key
    let apiKey = '';
    if (req.headers['authorization']) {
      apiKey = req.headers['authorization'].replace('Bearer ', '');
    }
    // 如果请求中没有提供API key，使用默认的API key
    if (!apiKey && CONFIG.TAVILY_API_KEY) {
      apiKey = CONFIG.TAVILY_API_KEY;
    }

    const authHeader = apiKey ? `Bearer ${apiKey}` : '';

    console.log(`[Tavily Intercept] ${req.method} ${targetUrl}`);
    console.log(`[Tavily Intercept] Original URL: https://api.tavily.com/${path}`);
    console.log(`[Tavily Intercept] API Key: ${apiKey ? 'xxx...' : 'none'}`);

    try {
      const response = await axios({
        method: req.method,
        url: targetUrl,
        data: req.body,
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        timeout: 30000,
        validateStatus: () => true,
      });

      console.log(`[Tavily Intercept] Response status: ${response.status}`);
      if (response.status >= 400) {
        console.error(
          '[Tavily Intercept] Response error:',
          JSON.stringify(response.data).slice(0, 200),
        );
      }

      res.status(response.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(response.data);
      return; // 不再调用 next()
    } catch (error) {
      console.error('[Tavily Intercept] Error:', error.message);
      res.status(500).json({ error: error.message });
      return; // 不再调用 next()
    }
  }

  // 不是发往 api.tavily.com 的请求，继续处理
  next();
});

// 处理来自Web UI的Tavily搜索请求 - 自动添加Bearer前缀
app.all('/api/search/tavily/*', async (req, res) => {
  const path = req.params[0] || 'search';
  const targetUrl = `${CONFIG.TAVILY_PROXY_URL}/${path}`;

  // 获取Authorization header并确保有Bearer前缀
  let authHeader = req.headers['authorization'] || '';
  if (authHeader && !authHeader.startsWith('Bearer ')) {
    authHeader = `Bearer ${authHeader}`;
  }

  console.log(`[Tavily Proxy] ${req.method} ${targetUrl}`);
  console.log(
    `[Tavily Proxy] Authorization: ${authHeader ? 'Bearer xxx...' : 'none'}`,
  );

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    res.status(response.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(response.data);
  } catch (error) {
    console.error('[Tavily Proxy] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 处理来自 deep-research 容器的内部 Tavily 请求（SSE 流使用）
app.post('/tavily-internal/:path(*)', async (req, res) => {
  const path = req.params.path || 'search';
  const targetUrl = `${CONFIG.TAVILY_PROXY_URL}/${path}`;

  // 从请求body中获取 api_key
  let apiKey = '';
  if (req.body && req.body.api_key) {
    apiKey = req.body.api_key;
  }
  // 如果body中没有，使用默认的API key
  if (!apiKey && CONFIG.TAVILY_API_KEY) {
    apiKey = CONFIG.TAVILY_API_KEY;
  }

  const authHeader = apiKey ? `Bearer ${apiKey}` : '';

  console.log(`[Tavily Internal] ${req.method} ${targetUrl}`);
  console.log(`[Tavily Internal] Body:`, JSON.stringify(req.body).slice(0, 200));
  console.log(`[Tavily Internal] API Key: ${apiKey ? 'xxx...' : 'none'}`);

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    console.log(`[Tavily Internal] Response status: ${response.status}`);
    if (response.status >= 400) {
      console.error(
        '[Tavily Internal] Response error:',
        JSON.stringify(response.data).slice(0, 200),
      );
    }

    res.status(response.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(response.data);
  } catch (error) {
    console.error('[Tavily Internal] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sse', async (req, res) => {
  const {
    query,
    provider,
    thinkingModel,
    taskModel,
    searchProvider,
    language,
    maxResult,
    enableCitationImage,
    enableReferences,
    enableFileFormatResource,
    promptOverrides,
  } = req.query;

  currentReport = '';
  currentTitle = '';
  isResearchComplete = false;

  console.log('[SSE Proxy] Starting SSE stream for query:', query);
  console.log('[SSE Proxy] Headers:', JSON.stringify(req.headers));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const params = new URLSearchParams();
    if (query) params.append('query', query);
    if (provider) params.append('provider', provider);
    if (thinkingModel) params.append('thinkingModel', thinkingModel);
    if (taskModel) params.append('taskModel', taskModel);
    if (searchProvider) params.append('searchProvider', searchProvider);
    if (language) params.append('language', language);
    if (maxResult) params.append('maxResult', maxResult);
    if (enableCitationImage !== undefined)
      params.append('enableCitationImage', enableCitationImage);
    if (enableReferences !== undefined)
      params.append('enableReferences', enableReferences);
    if (enableFileFormatResource !== undefined)
      params.append('enableFileFormatResource', enableFileFormatResource);
    if (promptOverrides) params.append('promptOverrides', promptOverrides);

    const targetUrl = `${CONFIG.DEEP_RESEARCH_URL}/api/sse/live?${params.toString()}`;
    console.log('[SSE Proxy] Target URL:', targetUrl);

    // 转发Authorization header
    const headers = {
      Accept: 'text/event-stream',
    };
    let authHeader = req.headers['authorization'] || '';
    if (!authHeader) {
      const accessPassword = process.env.ACCESS_PASSWORD || 'a+123456';
      authHeader = `Bearer ${accessPassword}`;
      console.log('[SSE Proxy] Using Bearer auth fallback');
    }
    headers['Authorization'] = authHeader;
    // 添加Host header
    headers['Host'] = 'deep-research:3000';
    if (req.headers['x-api-key']) {
      headers['x-api-key'] = req.headers['x-api-key'];
    }
    // 添加Origin和Referer以模拟浏览器请求
    if (req.headers['origin']) {
      headers['Origin'] = req.headers['origin'];
    }
    if (req.headers['referer']) {
      headers['Referer'] = req.headers['referer'];
    }

    const response = await axios({
      method: 'get',
      url: targetUrl,
      responseType: 'stream',
      timeout: 0,
      headers: headers,
    });

    let buffer = '';
    response.data.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          res.write(`data: ${data}\n\n`);
        }
      }
    });

    response.data.on('end', () => res.end());
    response.data.on('error', err => {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

function extractTitleFromQuery(query) {
  if (!query) return `Research_${Date.now()}`;
  let title = query.replace(/[^\w\u4e00-\u9fa5\s]/g, '').trim();
  title = title.substring(0, 100).replace(/\s+/g, '_');
  return title || `Research_${Date.now()}`;
}

app.post('/api/save-to-obsidian', express.json(), async (req, res) => {
  const { title, content } = req.body;

  if (!title || !content) {
    return res.status(400).json({ error: 'Missing title or content' });
  }

  try {
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${timestamp}_${extractTitleFromQuery(title)}.md`;
    const obsidianPath = `${CONFIG.OBSIDIAN_PATH}/${filename}`;

    const response = await axios({
      method: 'put',
      url: `${CONFIG.OBSIDIAN_API_URL}/vault/${encodeURI(obsidianPath)}`,
      headers: {
        Authorization: `Bearer ${CONFIG.OBSIDIAN_API_KEY}`,
        'Content-Type': 'text/markdown',
      },
      data: content,
      validateStatus: () => true,
    });

    if (response.status >= 200 && response.status < 300) {
      res.json({ success: true, path: obsidianPath });
    } else {
      res.status(response.status).json({ error: response.data });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    deepResearch: CONFIG.DEEP_RESEARCH_URL,
    obsidian: CONFIG.OBSIDIAN_API_URL,
    tavilyProxy: CONFIG.TAVILY_PROXY_URL,
    tavilyInternal: 'http://host.docker.internal:3021/tavily-internal',
  });
});

// 拦截来自 deep-research 的 Tavily 请求（硬编码 URL）
// deep-research 镜像在构建时硬编码了 https://api.tavily.com
app.all('/api.tavily.com/*', async (req, res) => {
  const path = req.params[0] || 'search';
  const targetUrl = `${CONFIG.TAVILY_PROXY_URL}/${path}`;

  // 从请求中获取 API key
  let apiKey = '';
  if (req.headers['authorization']) {
    apiKey = req.headers['authorization'].replace('Bearer ', '');
  }
  // 如果请求中没有提供API key，使用默认的API key
  if (!apiKey && CONFIG.TAVILY_API_KEY) {
    apiKey = CONFIG.TAVILY_API_KEY;
  }

  const authHeader = apiKey ? `Bearer ${apiKey}` : '';

  console.log(`[Tavily Intercept] ${req.method} ${targetUrl}`);
  console.log(`[Tavily Intercept] Original URL: https://api.tavily.com/${path}`);
  console.log(`[Tavily Intercept] API Key: ${apiKey ? 'xxx...' : 'none'}`);

  try {
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    console.log(`[Tavily Intercept] Response status: ${response.status}`);
    if (response.status >= 400) {
      console.error(
        '[Tavily Intercept] Response error:',
        JSON.stringify(response.data).slice(0, 200),
      );
    }

    res.status(response.status);
    res.setHeader('Content-Type', 'application/json');
    res.send(response.data);
  } catch (error) {
    console.error('[Tavily Intercept] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// 通用代理 - 转发其他请求到deep-research
app.use('/', async (req, res, next) => {
  // 跳过已处理的路径
  if (
    req.path.startsWith('/api/search/tavily') ||
    req.path.startsWith('/api/sse') ||
    req.path.startsWith('/api/save-to-obsidian') ||
    req.path.startsWith('/health') ||
    req.path.startsWith('/api.tavily.com') ||
    req.path.startsWith('/tavily-internal')
  ) {
    return next();
  }

  try {
    const targetUrl = `${CONFIG.DEEP_RESEARCH_URL}${req.url}`;
    const response = await axios({
      method: req.method,
      url: targetUrl,
      data: req.body,
      headers: { ...req.headers, host: new URL(CONFIG.DEEP_RESEARCH_URL).host },
      validateStatus: () => true,
      timeout: 30000,
    });
    res.status(response.status);
    for (const [key, value] of Object.entries(response.headers)) {
      if (key !== 'transfer-encoding') res.setHeader(key, value);
    }
    res.send(response.data);
  } catch (error) {
    next(error);
  }
});

const PORT = CONFIG.PORT;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`SSE Proxy running on http://0.0.0.0:${PORT}`);
  console.log(`Deep Research URL: ${CONFIG.DEEP_RESEARCH_URL}`);
  console.log(`Obsidian Path: ${CONFIG.OBSIDIAN_PATH}`);
  console.log(`Tavily Proxy URL: ${CONFIG.TAVILY_PROXY_URL}`);
  console.log(
    `Internal Tavily Path: http://host.docker.internal:3021/tavily-internal`,
  );
});
