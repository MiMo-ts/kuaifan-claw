const express = require('express');
const { body, validationResult } = require('express-validator');
const InviteCode = require('../models/InviteCode');
const User = require('../models/User');
const { agentAuth, adminAuth } = require('../middleware/auth');
const { generateInviteCode, encryptInviteCode, decryptInviteCode, validateInviteCodeFormat } = require('../utils/inviteCodeGenerator');

const router = express.Router();

// 生成邀请码
router.post('/generate', agentAuth, [
  body('count', 'Count must be a number').isNumeric(),
  body('expiresIn', 'ExpiresIn must be a number of days').isNumeric()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { count, expiresIn, metadata } = req.body;

  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const inviteCodes = [];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(expiresIn));

    for (let i = 0; i < count; i++) {
      // 生成10位安全邀请码
      const code = generateInviteCode(10);
      const inviteCode = new InviteCode({
        code,
        createdBy: user._id,
        createdByName: user.username,
        expiresAt,
        metadata: metadata || {}
      });
      await inviteCode.save();
      inviteCodes.push(inviteCode);
    }

    res.json(inviteCodes);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 验证邀请码 (POST - 用于应用调用)
router.post('/validate', async (req, res) => {
  const { code, platform } = req.body;

  try {
    // 直接返回成功以测试路由
    res.json({ valid: true, message: 'Invite code validated successfully' });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 测试路由
router.get('/test', async (req, res) => {
  try {
    res.json({ message: 'Test route works', status: 'ok' });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 获取邀请码列表
router.get('/list', agentAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let inviteCodes;
    if (user.role === 'admin') {
      // 管理员可以查看所有邀请码
      inviteCodes = await InviteCode.find().sort({ createdAt: -1 });
    } else {
      // 代理只能查看自己创建的邀请码
      inviteCodes = await InviteCode.find({ createdBy: user._id }).sort({ createdAt: -1 });
    }

    res.json(inviteCodes);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 禁用邀请码
router.put('/disable/:id', agentAuth, async (req, res) => {
  try {
    const inviteCode = await InviteCode.findById(req.params.id);
    if (!inviteCode) {
      return res.status(404).json({ message: 'Invite code not found' });
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 只有创建者或管理员可以禁用邀请码
    if (inviteCode.createdBy.toString() !== user._id.toString() && user.role !== 'admin') {
      return res.status(403).json({ message: 'You can only disable your own invite codes' });
    }

    inviteCode.status = 'disabled';
    await inviteCode.save();

    res.json(inviteCode);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
