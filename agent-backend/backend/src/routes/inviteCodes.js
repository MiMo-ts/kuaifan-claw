const express = require('express');
const { body, validationResult } = require('express-validator');
const InviteCode = require('../models/InviteCode');
const InviteCodeDevice = require('../models/InviteCodeDevice');
const User = require('../models/User');
const { agentAuth } = require('../middleware/auth');
const { generateInviteCode } = require('../utils/inviteCodeGenerator');
const { Op } = require('sequelize');

const router = express.Router();

// 生成邀请码
router.post('/generate', agentAuth, [
  body('count', '数量必须是数字').isNumeric(),
  body('expiresIn', '过期天数必须是数字').isNumeric()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { count, expiresIn, metadata } = req.body;

  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    const inviteCodes = [];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(expiresIn));

    for (let i = 0; i < count; i++) {
      const code = generateInviteCode(10);
      const inviteCode = await InviteCode.create({
        code,
        createdBy: user.id,
        createdByName: user.username,
        expiresAt,
        maxDevices: 3,
        metadata: metadata || {}
      });
      inviteCodes.push(inviteCode);
    }

    res.json(inviteCodes);
  } catch (error) {
    console.error('生成邀请码错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 验证邀请码并绑定设备
router.post('/validate', async (req, res) => {
  const { code, platform, deviceFingerprint, deviceName } = req.body;

  if (!code) {
    return res.status(400).json({ valid: false, message: '邀请码不能为空' });
  }

  try {
    const inviteCode = await InviteCode.findOne({ where: { code } });

    if (!inviteCode) {
      return res.json({ valid: false, message: '邀请码不存在' });
    }

    if (inviteCode.status === 'disabled') {
      return res.json({ valid: false, message: '邀请码已禁用' });
    }

    if (inviteCode.status === 'used') {
      return res.json({ valid: false, message: '邀请码已被使用' });
    }

    if (new Date(inviteCode.expiresAt) < new Date()) {
      return res.json({ valid: false, message: '邀请码已过期' });
    }

    // 如果没有设备指纹参数，直接返回验证成功（旧版兼容）
    if (!deviceFingerprint) {
      return res.json({ valid: true, message: '邀请码验证成功' });
    }

    // 检查该设备是否已绑定此邀请码
    const existingBinding = await InviteCodeDevice.findOne({
      where: {
        inviteCodeId: inviteCode.id,
        deviceFingerprint: deviceFingerprint
      }
    });

    if (existingBinding) {
      // 设备已绑定，更新最后登录时间
      existingBinding.lastLoginAt = new Date();
      await existingBinding.save();

      const deviceCount = await InviteCodeDevice.count({
        where: { inviteCodeId: inviteCode.id }
      });

      return res.json({
        valid: true,
        alreadyBound: true,
        deviceCount: deviceCount,
        maxDevices: inviteCode.maxDevices || 3,
        message: '设备已绑定，更新登录时间'
      });
    }

    // 检查已绑定设备数量
    const maxDevices = inviteCode.maxDevices || 3;
    const currentDeviceCount = await InviteCodeDevice.count({
      where: { inviteCodeId: inviteCode.id }
    });

    if (currentDeviceCount >= maxDevices) {
      return res.status(400).json({
        valid: false,
        message: `此邀请码已绑定${maxDevices}个设备，达上限`
      });
    }

    // 绑定新设备
    const now = new Date();
    await InviteCodeDevice.create({
      inviteCodeId: inviteCode.id,
      deviceFingerprint: deviceFingerprint,
      deviceName: deviceName || null,
      platform: platform || 'desktop',
      boundAt: now,
      lastLoginAt: now
    });

    const newDeviceCount = currentDeviceCount + 1;

    // 如果达到设备上限，禁用邀请码
    if (newDeviceCount >= maxDevices) {
      inviteCode.status = 'disabled';
      await inviteCode.save();
    }

    res.json({
      valid: true,
      alreadyBound: false,
      deviceCount: newDeviceCount,
      maxDevices: maxDevices,
      message: '设备绑定成功'
    });
  } catch (error) {
    console.error('验证邀请码错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取邀请码已绑定设备列表
router.get('/devices/:inviteCodeId', agentAuth, async (req, res) => {
  try {
    const inviteCode = await InviteCode.findByPk(req.params.inviteCodeId);
    if (!inviteCode) {
      return res.status(404).json({ message: '邀请码不存在' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 非管理员只能查看自己创建的邀请码
    if (inviteCode.createdBy !== user.id && user.role !== 'admin') {
      return res.status(403).json({ message: '只能查看自己的邀请码' });
    }

    const devices = await InviteCodeDevice.findAll({
      where: { inviteCodeId: inviteCode.id },
      order: [['boundAt', 'DESC']]
    });

    res.json({
      inviteCodeId: inviteCode.id,
      code: inviteCode.code,
      maxDevices: inviteCode.maxDevices || 3,
      currentCount: devices.length,
      status: inviteCode.status,
      devices: devices
    });
  } catch (error) {
    console.error('获取设备列表错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 解绑设备
router.delete('/devices/:inviteCodeId/:deviceFingerprint', agentAuth, async (req, res) => {
  try {
    const { inviteCodeId, deviceFingerprint } = req.params;

    const inviteCode = await InviteCode.findByPk(inviteCodeId);
    if (!inviteCode) {
      return res.status(404).json({ message: '邀请码不存在' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 只有创建者或管理员可以解绑
    if (inviteCode.createdBy !== user.id && user.role !== 'admin') {
      return res.status(403).json({ message: '只能解绑自己的邀请码' });
    }

    const binding = await InviteCodeDevice.findOne({
      where: { inviteCodeId, deviceFingerprint }
    });

    if (!binding) {
      return res.status(404).json({ message: '设备绑定记录不存在' });
    }

    await binding.destroy();

    // 如果邀请码之前因达上限被禁用，解绑后可重新激活
    if (inviteCode.status === 'disabled') {
      const remainingCount = await InviteCodeDevice.count({
        where: { inviteCodeId: inviteCode.id }
      });
      if (remainingCount < (inviteCode.maxDevices || 3)) {
        inviteCode.status = 'active';
        await inviteCode.save();
      }
    }

    res.json({ success: true, message: '设备解绑成功' });
  } catch (error) {
    console.error('解绑设备错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 测试路由
router.get('/test', async (req, res) => {
  try {
    res.json({ message: '测试路由正常', status: 'ok' });
  } catch (error) {
    console.error('测试路由错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 内部测试路由（跳过 auth）
router.get('/internal-list', async (req, res) => {
  try {
    const InviteCode = require('../models/InviteCode');
    const InviteCodeDevice = require('../models/InviteCodeDevice');
    console.log('internal-list: starting');
    const codes = await InviteCode.findAll({ order: [['createdAt', 'DESC']] });
    console.log('internal-list: codes.length=', codes.length);
    const ids = codes.map(ic => ic.id);
    const devices = await InviteCodeDevice.findAll({
      where: { inviteCodeId: ids },
      attributes: ['inviteCodeId'],
    });
    console.log('internal-list: devices.length=', devices.length);
    const result = codes.map(ic => ({ ...ic.toJSON(), deviceCount: 0 }));
    res.json(result);
  } catch (error) {
    console.error('internal-list error:', error.message);
    console.error(error.stack);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取邀请码列表
router.get('/list', agentAuth, async (req, res) => {
  try {
    console.log('Step 1: find user');
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }
    console.log('Step 2: user found, role=', user.role);

    const { search } = req.query;
    let whereClause = {};
    if (search) {
      whereClause = {
        [Op.or]: [
          { code: { [Op.like]: `%${search}%` } },
          { createdByName: { [Op.like]: `%${search}%` } }
        ]
      };
    }

    let inviteCodes;
    if (user.role === 'admin') {
      console.log('Step 3a: admin mode, calling findAll');
      inviteCodes = await InviteCode.findAll({
        where: whereClause,
        order: [['createdAt', 'DESC']]
      });
    } else {
      console.log('Step 3b: agent mode, calling findAll with where');
      inviteCodes = await InviteCode.findAll({
        where: { ...whereClause, createdBy: user.id },
        order: [['createdAt', 'DESC']]
      });
    }
    console.log('Step 4: inviteCodes.length=', inviteCodes.length);

    // 获取每个邀请码的设备数量
    const inviteCodeIds = inviteCodes.map(ic => {
      console.log('  mapping ic.id:', ic.id, 'type:', typeof ic.id);
      return ic.id;
    });
    console.log('Step 5: inviteCodeIds=', inviteCodeIds);
    const deviceCounts = {};

    if (inviteCodeIds.length > 0) {
      console.log('Step 6: querying InviteCodeDevice');
      const devices = await InviteCodeDevice.findAll({
        where: { inviteCodeId: inviteCodeIds },
        attributes: ['inviteCodeId'],
      });
      console.log('Step 7: devices.length=', devices.length);

      devices.forEach(device => {
        const key = device.inviteCodeId;
        deviceCounts[key] = (deviceCounts[key] || 0) + 1;
      });
    }
    console.log('Step 8: deviceCounts=', deviceCounts);

    // 合并设备数量到邀请码数据
    console.log('Step 9: mapping result');
    const result = inviteCodes.map(ic => {
      const dc = deviceCounts[ic.id] || 0;
      return { ...ic.toJSON(), deviceCount: dc };
    });
    console.log('Step 10: returning result, length=', result.length);

    res.json(result);
  } catch (error) {
    console.error('获取邀请码列表错误:', error.message);
    console.error(error.stack);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 禁用邀请码
router.put('/disable/:id', agentAuth, async (req, res) => {
  try {
    const inviteCode = await InviteCode.findByPk(req.params.id);
    if (!inviteCode) {
      return res.status(404).json({ message: '邀请码不存在' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    if (inviteCode.createdBy !== user.id && user.role !== 'admin') {
      return res.status(403).json({ message: '只能禁用自己的邀请码' });
    }

    inviteCode.status = 'disabled';
    await inviteCode.save();

    res.json(inviteCode);
  } catch (error) {
    console.error('禁用邀请码错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除邀请码
router.delete('/:id', agentAuth, async (req, res) => {
  try {
    const inviteCode = await InviteCode.findByPk(req.params.id);
    if (!inviteCode) {
      return res.status(404).json({ message: '邀请码不存在' });
    }

    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    if (inviteCode.createdBy !== user.id && user.role !== 'admin') {
      return res.status(403).json({ message: '只能删除自己的邀请码' });
    }

    // 删除关联的设备记录
    await InviteCodeDevice.destroy({ where: { inviteCodeId: inviteCode.id } });

    // 删除邀请码
    await inviteCode.destroy();

    res.json({ message: '邀请码已删除' });
  } catch (error) {
    console.error('删除邀请码错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router;
