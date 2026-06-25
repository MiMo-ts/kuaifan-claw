const bcrypt = require('bcryptjs');

async function gen() {
  const password = 'admin123';
  const saltRounds = 10;
  
  console.log('生成密码 hash...');
  
  const salt = await bcrypt.genSalt(saltRounds);
  const hash = await bcrypt.hash(password, salt);
  
  console.log('\n密码：admin123');
  console.log('Hash：' + hash);
  console.log('\nSQL：');
  console.log(`
INSERT INTO users (username, email, password, role, createdAt, updatedAt) 
VALUES (
  'admin123', 
  'admin123@example.com', 
  '${hash}', 
  'admin', 
  NOW(), 
  NOW()
);
  `);
}

gen().catch(console.error);
