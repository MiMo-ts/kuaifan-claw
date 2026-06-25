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

async function checkUsers() {
  try {
    await sequelize.authenticate();
    console.log('MySQL已连接');

    // 检查所有用户
    const users = await User.findAll({ attributes: { exclude: ['password'] } });
    console.log('数据库中的用户:');
    users.forEach(user => {
      console.log(`- 用户名: ${user.username}, 邮箱: ${user.email}, 角色: ${user.role}`);
    });

    await sequelize.close();
    console.log('数据库连接已关闭');
    process.exit(0);
  } catch (err) {
    console.error('MySQL连接错误:', err);
    process.exit(1);
  }
}

checkUsers();
