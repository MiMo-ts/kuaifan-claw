const mongoose = require('../backend/node_modules/mongoose');
const User = require('../backend/src/models/User');

// 连接数据库
mongoose.connect('mongodb://localhost:27017/agent_backend')
.then(async () => {
  console.log('MongoDB connected');
  
  // 检查所有用户
  const users = await User.find();
  console.log('Users in database:');
  users.forEach(user => {
    console.log(`- Username: ${user.username}, Email: ${user.email}, Role: ${user.role}`);
  });
  
  // 退出连接
  mongoose.disconnect();
  console.log('Database connection closed');
})
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});