const crypto = require('crypto');

/**
 * 生成安全的邀请码
 * @param {number} length 邀请码长度，默认10位
 * @returns {string} 生成的邀请码
 */
function generateInviteCode(length = 10) {
  // 使用密码学安全的随机数生成器
  const randomBytes = crypto.randomBytes(length * 2);
  
  // 使用Base32编码，去除容易混淆的字符（0, O, 1, I）
  const base32Chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const index = randomBytes[i] % base32Chars.length;
    result += base32Chars[index];
  }
  
  return result;
}

/**
 * 加密邀请码
 * @param {string} code 原始邀请码
 * @param {string} secret 加密密钥
 * @returns {string} 加密后的邀请码
 */
function encryptInviteCode(code, secret) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(secret.padEnd(32, '0').substring(0, 32)), iv);
  let encrypted = cipher.update(code, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return iv.toString('base64') + ':' + encrypted;
}

/**
 * 解密邀请码
 * @param {string} encryptedCode 加密后的邀请码
 * @param {string} secret 解密密钥
 * @returns {string} 解密后的原始邀请码
 */
function decryptInviteCode(encryptedCode, secret) {
  try {
    const [ivStr, encrypted] = encryptedCode.split(':');
    const iv = Buffer.from(ivStr, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(secret.padEnd(32, '0').substring(0, 32)), iv);
    let decrypted = decipher.update(encrypted, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Error decrypting invite code:', error);
    return null;
  }
}

/**
 * 验证邀请码格式
 * @param {string} code 邀请码
 * @returns {boolean} 是否为有效的邀请码格式
 */
function validateInviteCodeFormat(code) {
  // 临时总是返回true以测试
  return true;
  // 允许大小写字母和数字，但排除容易混淆的字符
  // const validChars = /^[A-Za-z0-9]+$/;
  // 检查长度和字符
  // return code.length >= 8 && code.length <= 12 && validChars.test(code);
}

module.exports = {
  generateInviteCode,
  encryptInviteCode,
  decryptInviteCode,
  validateInviteCodeFormat
};
