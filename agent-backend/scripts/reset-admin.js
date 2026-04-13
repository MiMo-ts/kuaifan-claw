const mongoose = require('../backend/node_modules/mongoose');
const User = require('../backend/src/models/User');

// 连接数据库
mongoose.connect('mongodb://localhost:27017/agent_backend')
.then(async () => {
  console.log('MongoDB connected');
  
  // 删除所有管理员账号
  const result = await User.deleteMany({ role: 'admin' });
  console.log(`Deleted ${result.deletedCount} admin users`);
  
  // 退出连接
  mongoose.disconnect();
  console.log('Database connection closed');
  console.log('Admin users reset. Run init-db.js to create new admin user.');
})
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});