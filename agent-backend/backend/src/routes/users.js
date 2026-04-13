const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { adminAuth } = require('../middleware/auth');

const router = express.Router();

// 获取用户列表
router.get('/list', adminAuth, async (req, res) => {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 创建用户
router.post('/create', adminAuth, [
  body('username', 'Username is required').notEmpty(),
  body('email').optional().isEmail(),
  body('password', 'Password must be at least 6 characters').isLength({ min: 6 }),
  body('role', 'Role must be admin or agent').isIn(['admin', 'agent'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, password, role } = req.body;

  try {
    // 检查用户是否已存在
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    user = await User.findOne({ username });
    if (user) {
      return res.status(400).json({ message: 'Username already exists' });
    }

    // 创建新用户
    user = new User({ username, email, password, role });
    await user.save();

    res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 更新用户
router.put('/update/:id', adminAuth, [
  body('username', 'Username is required').notEmpty(),
  body('email').optional().isEmail(),
  body('role', 'Role must be admin or agent').isIn(['admin', 'agent'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, role, password } = req.body;

  try {
    let user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // 检查用户名和邮箱是否已被其他用户使用
    const existingUser = await User.findOne({ email, _id: { $ne: req.params.id } });
    if (existingUser) {
      return res.status(400).json({ message: 'Email already in use' });
    }

    const existingUsername = await User.findOne({ username, _id: { $ne: req.params.id } });
    if (existingUsername) {
      return res.status(400).json({ message: 'Username already in use' });
    }

    // 更新用户信息
    user.username = username;
    user.email = email;
    user.role = role;
    if (password) {
      user.password = password;
    }

    await user.save();

    res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 删除用户
router.delete('/delete/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await user.remove();

    res.json({ message: 'User deleted' });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
