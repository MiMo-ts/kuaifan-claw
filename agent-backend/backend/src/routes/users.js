const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { adminAuth } = require('../middleware/auth');
const { Op } = require('sequelize');

const router = express.Router();

// 获取用户列表
router.get('/list', adminAuth, async (req, res) => {
  try {
    const { search } = req.query;
    let whereClause = {};

    if (search) {
      whereClause = {
        [Op.or]: [
          { username: { [Op.like]: `%${search}%` } },
          { email: { [Op.like]: `%${search}%` } }
        ]
      };
    }

    const users = await User.findAll({
      attributes: { exclude: ['password'] },
      where: whereClause
    });
    res.json(users);
  } catch (error) {
    console.error('获取用户列表错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 创建用户
router.post('/create', adminAuth, [
  body('username', '用户名不能为空').notEmpty(),
  body('email').optional().isEmail().withMessage('邮箱格式不正确'),
  body('password', '密码至少需要6个字符').isLength({ min: 6 }),
  body('role', '角色必须是管理员或代理').isIn(['admin', 'agent'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, password, role } = req.body;

  try {
    // 检查用户是否已存在
    if (email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ message: '用户已存在' });
      }
    }

    const existingUsername = await User.findOne({ where: { username } });
    if (existingUsername) {
      return res.status(400).json({ message: '用户名已存在' });
    }

    // 创建新用户
    const user = await User.create({ username, email, password, role });

    res.json({ id: user.id, username: user.username, email: user.email, role: user.role });
  } catch (error) {
    console.error('创建用户错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 更新用户
router.put('/update/:id', adminAuth, [
  body('username', '用户名不能为空').notEmpty(),
  body('email').optional().isEmail().withMessage('邮箱格式不正确'),
  body('role', '角色必须是管理员或代理').isIn(['admin', 'agent'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, role, password } = req.body;

  try {
    let user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    // 检查用户名和邮箱是否已被其他用户使用
    if (email) {
      const existingUser = await User.findOne({ 
        where: { 
          email, 
          id: { [require('sequelize').Op.ne]: req.params.id } 
        } 
      });
      if (existingUser) {
        return res.status(400).json({ message: '邮箱已被使用' });
      }
    }

    const existingUsername = await User.findOne({ 
      where: { 
        username, 
        id: { [require('sequelize').Op.ne]: req.params.id } 
      } 
    });
    if (existingUsername) {
      return res.status(400).json({ message: '用户名已被使用' });
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
    console.error('更新用户错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

// 删除用户
router.delete('/delete/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ message: '用户不存在' });
    }

    await user.destroy();

    res.json({ message: '用户已删除' });
  } catch (error) {
    console.error('删除用户错误:', error.message);
    res.status(500).json({ message: '服务器错误' });
  }
});

module.exports = router;
