const { Sequelize } = require('sequelize');

// 连接数据库
const sequelize = new Sequelize(
  'agent_backend',
  'root',
  '123456', // 修改为你的 MySQL 密码
  {
    host: 'localhost',
    port: 3306,
    dialect: 'mysql',
    logging: false
  }
);

const User = require('../backend/src/models/User');

async function resetAdmin() {
  try {
    await sequelize.authenticate();
    console.log('MySQL已连接');

    // 删除所有管理员账号
    const result = await User.destroy({ where: { role: 'admin' } });
    console.log(`已删除 ${result} 个管理员账号`);

    await sequelize.close();
    console.log('数据库连接已关闭');
    console.log('管理员账号已重置。运行 init-db.js 来创建新的管理员账号。');
    process.exit(0);
  } catch (err) {
    console.error('MySQL连接错误:', err);
    process.exit(1);
  }
}

resetAdmin();
