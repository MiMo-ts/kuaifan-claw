const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const auth = (req, res, next) => {
  console.log('AUTH DEBUG: JWT_SECRET:', process.env.JWT_SECRET ? 'set' : 'UNSET');
  console.log('AUTH DEBUG: Authorization header:', req.header('Authorization')?.substring(0, 30));
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    console.log('AUTH DEBUG: token:', token?.substring(0, 30));
    if (!token) {
      return res.status(401).json({ message: '未提供令牌，访问被拒绝' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('AUTH DEBUG: decoded:', decoded);
    req.user = decoded;
    next();
  } catch (error) {
    console.error('AUTH ERROR:', error.message);
    res.status(401).json({ message: '令牌无效' });
  }
};

const adminAuth = (req, res, next) => {
  auth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '需要管理员权限' });
    }
    next();
  });
};

const agentAuth = (req, res, next) => {
  auth(req, res, () => {
    if (req.user.role !== 'agent' && req.user.role !== 'admin') {
      return res.status(403).json({ message: '需要代理或管理员权限' });
    }
    next();
  });
};

module.exports = { auth, adminAuth, agentAuth };
