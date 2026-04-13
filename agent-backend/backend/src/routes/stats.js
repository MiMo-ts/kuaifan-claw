const express = require('express');
const InviteCode = require('../models/InviteCode');
const User = require('../models/User');
const { agentAuth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// 获取邀请码统计数据
router.get('/invite-codes', agentAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let query = {};
    if (user.role !== 'admin') {
      query.createdBy = user._id;
    }

    const total = await InviteCode.countDocuments(query);
    const active = await InviteCode.countDocuments({ ...query, status: 'active' });
    const used = await InviteCode.countDocuments({ ...query, status: 'used' });
    const disabled = await InviteCode.countDocuments({ ...query, status: 'disabled' });

    // 按平台统计
    const platformStats = await InviteCode.aggregate([
      { $match: { ...query, platform: { $ne: null } } },
      { $group: { _id: '$platform', count: { $sum: 1 } } }
    ]);

    // 按日期统计
    const dateStats = await InviteCode.aggregate([
      { $match: query },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      total,
      active,
      used,
      disabled,
      platformStats,
      dateStats
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 获取用户统计数据
router.get('/users', adminAuth, async (req, res) => {
  try {
    const total = await User.countDocuments();
    const admins = await User.countDocuments({ role: 'admin' });
    const agents = await User.countDocuments({ role: 'agent' });

    res.json({
      total,
      admins,
      agents
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
