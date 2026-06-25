const { Sequelize } = require('sequelize');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });

// 连接数据库
const sequelize = new Sequelize(
  process.env.DB_NAME || 'agent_backend',
  process.env.DB_USER || 'root',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false
  }
);

const User = require('../backend/src/models/User');
const InviteCode = require('../backend/src/models/InviteCode');

async function initDb() {
  try {
    await sequelize.authenticate();
    console.log('MySQL已连接到:', sequelize.config.database);

    // 同步模型到数据库（创建表）
    await sequelize.sync({ alter: true });
    console.log('表已同步');

    // 检查是否已有管理员账号
    const adminExists = await User.findOne({ where: { role: 'admin' } });
    console.log('管理员是否存在:', !!adminExists);

    if (!adminExists) {
      // 创建默认管理员账号
      const admin = await User.create({
        username: 'admin123',
        email: 'admin123@example.com',
        password: 'admin123',
        role: 'admin'
      });
      console.log('默认管理员账号已创建:', admin.username);
      console.log('账号密码: admin123 / admin123');
    } else {
      console.log('管理员账号已存在');
    }

    // 查看所有用户
    const users = await User.findAll({ attributes: { exclude: ['password'] } });
    console.log('用户列表:', users.map(u => u.username));

    console.log('数据库初始化成功');
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error('MySQL连接错误:', err);
    process.exit(1);
  }
}

initDb();
