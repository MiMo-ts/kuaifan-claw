const mongoose = require('../backend/node_modules/mongoose');
const User = require('../backend/src/models/User');

// 连接数据库
mongoose.connect('mongodb://localhost:27017/agent_backend')
.then(async () => {
  console.log('MongoDB connected to:', mongoose.connection.name);
  
  // 检查所有集合
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log('Collections:', collections.map(c => c.name));
  
  // 检查是否已有管理员账号
  const adminExists = await User.findOne({ role: 'admin' });
  console.log('Admin exists:', !!adminExists);
  
  if (!adminExists) {
    // 创建默认管理员账号
    const admin = new User({
      username: 'admin123',
      email: 'admin123@example.com',
      password: 'admin123', // 会自动加密
      role: 'admin'
    });
    await admin.save();
    console.log('Default admin user created');
  } else {
    console.log('Admin user already exists');
  }
  
  // 查看所有用户
  const users = await User.find();
  console.log('Users:', users);
  
  console.log('Database initialized successfully');
  mongoose.disconnect();
})
.catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});