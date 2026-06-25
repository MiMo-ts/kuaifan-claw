const express = require('express');
const { Op } = require('sequelize');
const InviteCode = require('../models/InviteCode');
const User = require('../models/User');
const { generateInviteCode } = require('../utils/inviteCodeGenerator');

const router = express.Router();

// 支付系统地址
const PAYMENT_SYSTEM_URL = process.env.PAYMENT_SYSTEM_URL || 'http://8.148.152.185:7788';

// fetch 超时包装（支付系统 POST 可能较慢）
const FETCH_TIMEOUT_MS = 90_000; // 90秒
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// 获取支付配置（代理到支付系统）
// GET /api/pay/config
// ============================================================
router.get('/config', async (req, res) => {
  try {
    const response = await fetchWithTimeout(`${PAYMENT_SYSTEM_URL}/api/pay/config`);
    if (!response.ok) throw new Error(`支付系统返回错误: ${response.status}`);
    const data = await response.json();
    console.log('[Pay] 配置:', data);
    res.json(data);
  } catch (error) {
    console.error('[Pay] 获取配置失败:', error.message);
    res.status(502).json({ message: '获取支付配置失败' });
  }
});

// ============================================================
// 创建支付订单（代理到支付系统）
// POST /api/pay/create-order
// Body: { payChannel: 'ALIPAY' | 'WECHAT' }
// ============================================================
router.post('/create-order', async (req, res) => {
  try {
    const { payChannel = 'ALIPAY' } = req.body;

    console.log('[Pay] 创建订单, 方式:', payChannel);

    const response = await fetchWithTimeout(`${PAYMENT_SYSTEM_URL}/api/pay/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payChannel })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`${response.status} ${errText}`);
    }

    const data = await response.json();
    console.log('[Pay] 订单创建:', data.orderNo);
    // 直接返回支付系统响应（含 payUrl），不写本地表
    res.json(data);
  } catch (error) {
    console.error('[Pay] 创建订单失败:', error.message);
    res.status(502).json({ message: '创建支付订单失败: ' + error.message });
  }
});

// ============================================================
// 支付页面跳转（解决支付宝 Referer 校验）
// GET /api/pay/goto?url=<encoded alipay url>
// ============================================================
router.get('/goto', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('缺少 url 参数');
  // 通过本页面作为 referer 跳转到支付宝，避免直接打开支付宝 URL 被拦截
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>跳转支付...</title></head>
<body style="text-align:center;padding-top:60px;font-family:sans-serif;">
  <p>正在跳转到支付宝支付页面...</p>
  <p style="color:#999;font-size:12px;">如未自动跳转请<a href="${url}">点击这里</a></p>
  <script>window.location.replace('${url}');</script>
</body></html>`);
});

// ============================================================
// 支付宝同步返回 (GET)
// 支付完成后支付宝重定向浏览器到此
// ============================================================
router.get('/return/alipay', async (req, res) => {
  try {
    const { out_trade_no, trade_no } = req.query;

    console.log('[Pay] 支付宝返回:', { out_trade_no, trade_no });

    if (!out_trade_no) {
      return res.status(400).send(renderErrorPage('缺少订单号参数'));
    }

    // 向支付系统查询订单状态
    const paymentStatus = await queryPaymentStatus(out_trade_no);

    if (!paymentStatus) {
      return res.status(502).send(renderErrorPage('查询支付状态失败，请稍后重试'));
    }

    if (paymentStatus.payStatus !== 'SUCCESS') {
      return res.send(renderPendingPage(out_trade_no, paymentStatus.payStatus));
    }

    // 支付成功 → 生成/返回邀请码
    const result = await generateAndStoreInviteCode(
      out_trade_no, trade_no, paymentStatus
    );

    if (!result) {
      return res.status(500).send(renderErrorPage('生成邀请码失败'));
    }

    console.log('[Pay] 邀请码:', result.code, result.isNew ? '(新)' : '(已有)');
    res.send(renderSuccessPage(result.code, out_trade_no, !result.isNew));
  } catch (error) {
    console.error('[Pay] 返回处理错误:', error);
    res.status(500).send(renderErrorPage('服务器处理支付返回时出错'));
  }
});

// ============================================================
// 支付宝异步通知 (POST)
// ============================================================
router.post('/callback/alipay', async (req, res) => {
  try {
    const out_trade_no = req.body.out_trade_no;

    console.log('[Pay] 异步通知:', { out_trade_no, trade_no: req.body.trade_no });

    if (!out_trade_no) return res.send('fail');

    const paymentStatus = await queryPaymentStatus(out_trade_no);

    if (paymentStatus && paymentStatus.payStatus === 'SUCCESS') {
      const result = await generateAndStoreInviteCode(
        out_trade_no, req.body.trade_no, paymentStatus
      );
      if (result) {
        console.log('[Pay] 异步通知生成邀请码:', result.code, result.isNew ? '(新)' : '(重复)');
      }
    }

    res.send('success');
  } catch (error) {
    console.error('[Pay] 异步通知错误:', error);
    res.send('fail');
  }
});

// ============================================================
// 查询支付状态
// ============================================================
async function queryPaymentStatus(orderNo) {
  try {
    const url = `${PAYMENT_SYSTEM_URL}/api/pay/query?orderNo=${encodeURIComponent(orderNo)}`;
    console.log('[Pay] 查询状态:', url);

    const response = await fetch(url);
    if (!response.ok) {
      console.error('[Pay] 查询失败:', response.status);
      return null;
    }

    const data = await response.json();
    console.log('[Pay] 支付状态:', { orderNo, payStatus: data.payStatus });
    return data;
  } catch (error) {
    console.error('[Pay] 查询异常:', error.message);
    return null;
  }
}

// ============================================================
// 生成邀请码（只写 invitecodes 表）
// ============================================================
async function generateAndStoreInviteCode(outTradeNo, tradeNo, paymentStatus) {
  try {
    // 防止重放攻击：检查同一订单是否已生成过邀请码
    const existing = await InviteCode.findOne({
      where: {
        metadata: { [Op.like]: `%"out_trade_no":"${outTradeNo}"%` }
      }
    });
    if (existing) {
      console.log('[Pay] 订单已生成过邀请码，返回已有:', existing.code);
      return { code: existing.code, isNew: false };
    }

    // 查找管理员用户
    const adminUser = await User.findOne({ where: { role: 'admin' } });
    if (!adminUser) {
      console.error('[Pay] 无管理员用户');
      return null;
    }

    // 生成邀请码
    const code = generateInviteCode(10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);

    await InviteCode.create({
      code,
      createdBy: adminUser.id,
      createdByName: adminUser.username,
      expiresAt,
      maxDevices: 3,
      status: 'active',
      metadata: {
        source: 'payment',
        payment_method: paymentStatus?.payChannel || 'alipay',
        out_trade_no: outTradeNo,
        trade_no: tradeNo || paymentStatus?.transactionId || null,
        amount: paymentStatus?.currentPrice || 0
      }
    });

    console.log('[Pay] 邀请码已生成:', code);
    return { code, isNew: true };
  } catch (error) {
    console.error('[Pay] 生成邀请码失败:', error);
    return null;
  }
}

// ============================================================
// HTML 渲染
// ============================================================

function renderSuccessPage(inviteCode, outTradeNo, isExisting) {
  const sub = isExisting ? '您的邀请码（已生成）' : '请复制以下邀请码到快泛 Claw 客户端完成激活';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>支付成功 - 快泛 Claw</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .container{background:white;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:480px;width:100%;padding:40px 30px;text-align:center}
    .icon{width:72px;height:72px;background:linear-gradient(135deg,#11998e 0%,#38ef7d 100%);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
    .icon svg{width:36px;height:36px;color:white}
    h1{font-size:24px;color:#1a1a2e;margin-bottom:8px}
    .subtitle{color:#666;font-size:14px;margin-bottom:24px}
    .code-box{background:linear-gradient(135deg,#f5f7fa 0%,#c3cfe2 100%);border:2px dashed #667eea;border-radius:12px;padding:24px;margin-bottom:20px}
    .code-label{font-size:13px;color:#666;margin-bottom:8px}
    .code-value{font-size:32px;font-weight:700;letter-spacing:4px;color:#1a1a2e;font-family:'Courier New',monospace;user-select:all}
    .info{font-size:13px;color:#999;margin-top:8px}
    .copy-btn{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border:none;padding:12px 32px;border-radius:8px;font-size:16px;cursor:pointer;margin-bottom:12px;transition:transform .2s}
    .copy-btn:hover{transform:translateY(-1px);box-shadow:0 4px 15px rgba(102,126,234,.4)}
    .copy-btn:active{transform:scale(.98)}
    .order-info{margin-top:20px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#bbb}
    .toast{position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#333;color:white;padding:10px 24px;border-radius:8px;font-size:14px;opacity:0;transition:opacity .3s;pointer-events:none;z-index:999}
    .toast.show{opacity:1}
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    </div>
    <h1>支付成功！</h1>
    <p class="subtitle">${sub}</p>
    <div class="code-box">
      <div class="code-label">您的邀请码</div>
      <div class="code-value" id="inviteCode">${inviteCode}</div>
      <div class="info">有效期 365 天 | 可绑定 3 台设备</div>
    </div>
    <button class="copy-btn" onclick="copyCode()">一键复制邀请码</button>
    <p style="font-size:13px;color:#888;">复制后请返回快泛 Claw 客户端，粘贴邀请码并点击验证</p>
    <div class="order-info">订单号: ${outTradeNo}</div>
  </div>
  <div class="toast" id="toast">已复制到剪贴板</div>
  <script>
    function copyCode() {
      const code = document.getElementById('inviteCode').textContent;
      navigator.clipboard.writeText(code).then(() => {
        const t = document.getElementById('toast');
        t.classList.add('show');
        setTimeout(() => t.classList.remove('show'), 2000);
      }).catch(() => {
        const r = document.createRange();
        r.selectNode(document.getElementById('inviteCode'));
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(r);
      });
    }
  </script>
</body>
</html>`;
}

function renderPendingPage(outTradeNo, payStatus) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>支付处理中 - 快泛 Claw</title>
  <meta http-equiv="refresh" content="3">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .container{background:white;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:450px;width:100%;padding:40px 30px;text-align:center}
    .icon{width:72px;height:72px;background:linear-gradient(135deg,#f6d365 0%,#fda085 100%);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
    .icon svg{width:36px;height:36px;color:white}
    h1{font-size:22px;color:#1a1a2e;margin-bottom:8px}
    .message{color:#666;font-size:14px;margin-bottom:20px}
    .spinner{width:40px;height:40px;border:3px solid #f0f0f0;border-top-color:#667eea;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    </div>
    <h1>支付处理中</h1>
    <p class="message">正在确认支付结果，页面自动刷新中...</p>
    <div class="spinner"></div>
    <p class="message" style="font-size:12px;color:#bbb;margin-top:16px;">订单号: ${outTradeNo} | 状态: ${payStatus}</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(message) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>支付处理 - 快泛 Claw</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
    .container{background:white;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);max-width:450px;width:100%;padding:40px 30px;text-align:center}
    .icon{width:72px;height:72px;background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
    .icon svg{width:36px;height:36px;color:white}
    h1{font-size:22px;color:#1a1a2e;margin-bottom:8px}
    .message{color:#666;font-size:14px;margin-bottom:20px;line-height:1.6}
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    </div>
    <h1>处理遇到问题</h1>
    <p class="message">${message}</p>
    <p class="message" style="font-size:12px;color:#999;">如有疑问，请联系代理并提供订单号</p>
  </div>
</body>
</html>`;
}

module.exports = router;
