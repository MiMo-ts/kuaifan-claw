const dotenv = require('dotenv');
const path = require('path');

// 加载 .env 文件
dotenv.config({ path: path.join(__dirname, '../backend/.env') });

const { sequelize } = require('../backend/src/config/database');
const User = require('../backend/src/models/User');
const InviteCode = require('../backend/src/models/InviteCode');

async function initDb() {
  try {
    await sequelize.authenticate();
    console.log('MySQL connected to:', sequelize.config.database);

    // 同步模型到数据库（创建表）
    await sequelize.sync({ alter: true });
    console.log('Tables synchronized');

    // 检查是否已有管理员账号
    const adminExists = await User.findOne({ where: { role: 'admin' } });
    console.log('Admin exists:', !!adminExists);

    if (!adminExists) {
      // 创建默认管理员账号
      const admin = await User.create({
        username: 'admin123',
        email: 'admin123@example.com',
        password: 'admin123',
        role: 'admin'
      });
      console.log('Default admin user created:', admin.username);
      console.log('Password: admin123');
    } else {
      console.log('Admin user already exists');
    }

    // 查看所有用户
    const users = await User.findAll({ attributes: { exclude: ['password'] } });
    console.log('Users:', users.map(u => ({ id: u.id, username: u.username, role: u.role })));

    console.log('Database initialized successfully');
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error('MySQL connection error:', err);
    process.exit(1);
  }
}

initDb();
