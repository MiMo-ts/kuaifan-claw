const express = require('express');
const InviteCode = require('../models/InviteCode');
const User = require('../models/User');
const { agentAuth, adminAuth } = require('../middleware/auth');
const { Op } = require('sequelize');
const { fn, col } = require('sequelize');

const router = express.Router();

// 获取邀请码统计数据
router.get('/invite-codes', agentAuth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    let where = {};
    if (user.role !== 'admin') {
      where.createdBy = user.id;
    }

    const total = await InviteCode.count({ where });
    const active = await InviteCode.count({ where: { ...where, status: 'active' } });
    const used = await InviteCode.count({ where: { ...where, status: 'used' } });
    const disabled = await InviteCode.count({ where: { ...where, status: 'disabled' } });

    // 按平台统计
    const platformStats = await InviteCode.findAll({
      where: { ...where, platform: { [Op.ne]: null } },
      attributes: ['platform', [fn('COUNT', col('platform')), 'count']],
      group: ['platform']
    });

    // 按日期统计
    const dateStats = await InviteCode.findAll({
      where,
      attributes: [[fn('DATE', col('createdAt')), 'date'], [fn('COUNT', col('id')), 'count']],
      group: [[fn('DATE', col('createdAt'))]],
      order: [[fn('DATE', col('createdAt')), 'ASC']]
    });

    res.json({
      total,
      active,
      used,
      disabled,
      platformStats: platformStats.map(s => ({ id: s.platform, count: parseInt(s.get('count')) })),
      dateStats: dateStats.map(s => ({ id: s.get('date'), count: parseInt(s.get('count')) }))
    });
  } catch (error) {
    console.error('获取统计数据错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 获取用户统计数据
router.get('/users', adminAuth, async (req, res) => {
  try {
    const total = await User.count();
    const admins = await User.count({ where: { role: 'admin' } });
    const agents = await User.count({ where: { role: 'agent' } });

    res.json({
      total,
      admins,
      agents
    });
  } catch (error) {
    console.error('获取用户统计数据错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router;
