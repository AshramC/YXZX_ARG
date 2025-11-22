// ========================================
// 配置解密库 - 前端使用
// ========================================

(function(window) {
  'use strict';
  
  // ===== 密钥生成算法（与加密端一致） =====
  function generateKey(seed) {
    const keyLength = 32;
    const key = [];
    
    for (let i = 0; i < keyLength; i++) {
      const charCode = seed.charCodeAt(i % seed.length);
      const computed = (charCode * (i + 1) + 127) % 256;
      key.push(computed);
    }
    
    return key;
  }
  
  // ===== Base64解码 =====
  function base64ToBytes(base64) {
    const binaryString = window.atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  
  // ===== 字节数组转字符串 =====
  function bytesToString(bytes) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  }
  
  // ===== XOR解密函数 =====
  function xorDecrypt(encryptedBase64, key) {
    try {
      const encryptedBytes = base64ToBytes(encryptedBase64);
      const decrypted = new Uint8Array(encryptedBytes.length);
      
      for (let i = 0; i < encryptedBytes.length; i++) {
        decrypted[i] = encryptedBytes[i] ^ key[i % key.length];
      }
      
      return bytesToString(decrypted);
    } catch (error) {
      console.error('[decrypt-lib] XOR解密失败:', error);
      throw error;
    }
  }
  
  // ===== 配置解密函数 =====
  function decryptConfig(encryptedData) {
    try {
      if (!encryptedData || typeof encryptedData !== 'string') {
        throw new Error('无效的加密数据');
      }
      
      // 生成密钥
      const seed = 'BIETOUKAN';
      const key = generateKey(seed);
      
      // 解密
      const decryptedText = xorDecrypt(encryptedData, key);
      
      // 解析JSON
      const configObj = (new Function('return ' + decryptedText))();

      console.log('[decrypt-lib] 配置解密成功');
      return configObj;
      
    } catch (error) {
      console.error('[decrypt-lib] 配置解密失败:', error.message);
      console.error('[decrypt-lib] 返回空对象作为降级方案');
      return {};
    }
  }
  
  // ===== 导出到全局 =====
  window.decryptConfig = decryptConfig;
  
  // 调试信息
  console.log('[decrypt-lib] 解密库已加载');
  
})(window);
