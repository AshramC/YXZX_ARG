// ========================================
// 配置开关检测器 - 自动选择加密或明文配置
// ========================================

(function(window) {
  'use strict';
  
  // ===== 检测是否使用加密配置 =====
  function shouldUseEncrypted() {
    // 优先级1: URL参数
    const urlParams = new URLSearchParams(window.location.search);
    const urlParam = urlParams.get('useEncrypted');
    if (urlParam !== null) {
      return urlParam !== 'false';
    }
    
    // 优先级2: LocalStorage
    const storageValue = localStorage.getItem('USE_ENCRYPTED_CONFIG');
    if (storageValue !== null) {
      return storageValue !== 'false';
    }
    
    // 优先级3: 全局变量
    if (typeof window.USE_ENCRYPTED_CONFIG !== 'undefined') {
      return window.USE_ENCRYPTED_CONFIG !== false;
    }
    
    // 默认值: true（使用加密配置）
    return true;
  }
  
  // ===== 加载配置函数 =====
  async function loadConfig(configName, encryptedVar, plaintextPath) {
    const useEncrypted = shouldUseEncrypted();
    
    console.log('[Config Loader] ==================');
    console.log('[Config Loader] 配置名称:', configName);
    console.log('[Config Loader] 使用加密配置:', useEncrypted);
    
    try {
      if (useEncrypted && window[encryptedVar]) {
        // 使用加密配置
        console.log('[Config Loader] 从加密变量加载:', encryptedVar);
        
        if (typeof window.decryptConfig !== 'function') {
          throw new Error('解密函数未加载，请确保已引入 decrypt-lib.js');
        }
        
        const config = window.decryptConfig(window[encryptedVar]);
        console.log('[Config Loader] 加密配置加载成功');
        console.log('[Config Loader] ==================');
        return config;
        
      } else {
        // 使用明文配置
        console.log('[Config Loader] 尝试加载明文配置:', plaintextPath);
        
        // 检查是否已经通过 <script> 标签加载
        if (window[configName]) {
          console.log('[Config Loader] 明文配置已通过 <script> 标签加载');
          console.log('[Config Loader] ==================');
          return window[configName];
        }
        
        // 动态导入明文配置（作为降级方案）
        try {
          const script = document.createElement('script');
          script.src = plaintextPath;
          
          await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = () => reject(new Error('明文配置文件加载失败'));
            document.head.appendChild(script);
          });
          
          if (window[configName]) {
            console.log('[Config Loader] 明文配置动态加载成功');
            console.log('[Config Loader] ==================');
            return window[configName];
          } else {
            throw new Error('明文配置加载后未找到配置对象');
          }
          
        } catch (error) {
          console.error('[Config Loader] 明文配置加载失败:', error.message);
          
          // 如果明文加载失败，尝试降级到加密配置
          if (window[encryptedVar] && window.decryptConfig) {
            console.warn('[Config Loader] 降级到加密配置');
            const config = window.decryptConfig(window[encryptedVar]);
            console.log('[Config Loader] ==================');
            return config;
          }
          
          throw new Error('无法加载配置文件（明文和加密均失败）');
        }
      }
      
    } catch (error) {
      console.error('[Config Loader] 配置加载失败:', error);
      console.log('[Config Loader] ==================');
      return {};
    }
  }
  
  // ===== 设置开关的辅助函数 =====
  function setUseEncrypted(value) {
    localStorage.setItem('USE_ENCRYPTED_CONFIG', value ? 'true' : 'false');
    console.log('[Config Loader] 已设置配置模式:', value ? '加密' : '明文');
    console.log('[Config Loader] 刷新页面以应用更改');
  }
  
  function clearEncryptedSetting() {
    localStorage.removeItem('USE_ENCRYPTED_CONFIG');
    console.log('[Config Loader] 已清除配置模式设置');
    console.log('[Config Loader] 刷新页面以应用更改');
  }
  
  // ===== 导出到全局 =====
  window.loadConfig = loadConfig;
  window.setUseEncrypted = setUseEncrypted;
  window.clearEncryptedSetting = clearEncryptedSetting;
  
  // 调试信息
  console.log('[Config Loader] 配置加载器已初始化');
  console.log('[Config Loader] 当前模式:', shouldUseEncrypted() ? '加密' : '明文');
  
  // 提供开关设置提示
  console.log('[Config Loader] 切换方法:');
  console.log('[Config Loader]   - URL参数: ?useEncrypted=false');
  console.log('[Config Loader]   - 控制台: setUseEncrypted(false)');
  console.log('[Config Loader]   - 控制台: clearEncryptedSetting()');
  
})(window);
