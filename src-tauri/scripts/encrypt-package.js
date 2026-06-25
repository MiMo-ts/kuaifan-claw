const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 加密文件
 * @param {string} filePath 文件路径
 * @param {string} key 加密密钥
 * @returns {Promise<void>}
 */
async function encryptFile(filePath, key) {
  return new Promise((resolve, reject) => {
    // 读取文件
    fs.readFile(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      // 生成随机IV
      const iv = crypto.randomBytes(16);
      
      // 创建加密器
      const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key.padEnd(32, '0').substring(0, 32)), iv);
      
      // 加密数据
      let encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
      
      // 获取认证标签
      const tag = cipher.getAuthTag();
      
      // 组合加密数据：IV + 标签 + 加密内容
      const encryptedData = Buffer.concat([iv, tag, encrypted]);
      
      // 写入加密文件
      fs.writeFile(filePath + '.enc', encryptedData, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        // 删除原文件
        fs.unlink(filePath, (err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    });
  });
}

/**
 * 解密文件
 * @param {string} filePath 加密文件路径
 * @param {string} key 解密密钥
 * @returns {Promise<Buffer>}
 */
async function decryptFile(filePath, key) {
  return new Promise((resolve, reject) => {
    // 读取加密文件
    fs.readFile(filePath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }

      // 提取IV、标签和加密内容
      const iv = data.slice(0, 16);
      const tag = data.slice(16, 32);
      const encrypted = data.slice(32);
      
      // 创建解密器
      const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key.padEnd(32, '0').substring(0, 32)), iv);
      decipher.setAuthTag(tag);
      
      try {
        // 解密数据
        let decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        resolve(decrypted);
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * 加密目录
 * @param {string} dirPath 目录路径
 * @param {string} key 加密密钥
 * @returns {Promise<void>}
 */
async function encryptDirectory(dirPath, key) {
  const files = fs.readdirSync(dirPath);
  
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);
    
    if (stats.isDirectory()) {
      // 递归加密子目录
      await encryptDirectory(filePath, key);
    } else {
      // 加密文件
      console.log(`Encrypting ${filePath}...`);
      await encryptFile(filePath, key);
    }
  }
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node encrypt-package.js <directory> <key>');
    process.exit(1);
  }
  
  const dirPath = args[0];
  const key = args[1];
  
  if (!fs.existsSync(dirPath)) {
    console.log(`Directory ${dirPath} does not exist`);
    process.exit(1);
  }
  
  try {
    console.log(`Starting encryption of ${dirPath}...`);
    await encryptDirectory(dirPath, key);
    console.log('Encryption completed successfully');
  } catch (error) {
    console.error('Encryption failed:', error);
    process.exit(1);
  }
}

// 执行主函数
if (require.main === module) {
  main();
}

module.exports = {
  encryptFile,
  decryptFile,
  encryptDirectory
};
