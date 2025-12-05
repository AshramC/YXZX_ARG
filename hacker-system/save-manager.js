/**
 * =============================================================================
 * Hacker Save System v1.0
 * -----------------------------------------------------------------------------
 * 独立的存档管理模块，与 GameEngine 配合使用
 * 
 * 功能：
 * 1. 通关时自动存档（进入下一关前）
 * 2. 到达小游戏节点时存档
 * 3. 页面加载时恢复存档
 * 4. 提供手动存档/读档/清档 API
 * 
 * 集成方式：
 * 在 hacker-engine.js 之前引入此文件
 * =============================================================================
 */

(function() {
    'use strict';

    const SAVE_KEY = 'hacker_game_save';
    const SAVE_VERSION = 1;

    class SaveManager {
        constructor() {
            this.currentSave = null;
            this.load(); // 初始化时尝试加载存档
            console.log('[SaveManager] Initialized');
        }

        // =====================================================================
        // 核心 API
        // =====================================================================

        /**
         * 保存游戏进度
         * @param {Object} data - 存档数据
         * @param {string} data.levelId - 当前关卡ID
         * @param {string} data.nodeId - 当前节点ID
         * @param {Array} data.inventory - 道具列表
         * @param {string} [data.saveType] - 存档类型: 'level_complete' | 'minigame' | 'manual'
         * @param {string} [data.completedLevelId] - 刚完成的关卡ID (仅 level_complete 时)
         */
        save(data) {
            const saveData = {
                version: SAVE_VERSION,
                levelId: data.levelId,
                nodeId: data.nodeId,
                inventory: data.inventory || [],
                completedLevels: this.getCompletedLevels(),
                saveType: data.saveType || 'manual',
                timestamp: Date.now()
            };

            // 如果是通关存档，记录已完成的关卡
            if (data.saveType === 'level_complete' && data.completedLevelId) {
                if (!saveData.completedLevels.includes(data.completedLevelId)) {
                    saveData.completedLevels.push(data.completedLevelId);
                }
            }

            try {
                localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
                this.currentSave = saveData;
                console.log(`[SaveManager] ✅ 存档成功 [${data.saveType}]:`, {
                    level: saveData.levelId,
                    node: saveData.nodeId,
                    items: saveData.inventory.length
                });
                return true;
            } catch (e) {
                console.error('[SaveManager] ❌ 存档失败:', e);
                return false;
            }
        }

        /**
         * 加载存档
         * @returns {Object|null} 存档数据，无存档时返回 null
         */
        load() {
            try {
                const raw = localStorage.getItem(SAVE_KEY);
                if (!raw) {
                    console.log('[SaveManager] 无存档');
                    this.currentSave = null;
                    return null;
                }

                const data = JSON.parse(raw);
                
                // 版本兼容性检查
                if (data.version !== SAVE_VERSION) {
                    console.warn('[SaveManager] ⚠️ 存档版本不匹配，可能需要迁移');
                    // 未来可在此处添加版本迁移逻辑
                }

                this.currentSave = data;
                console.log('[SaveManager] 📂 读取存档:', {
                    level: data.levelId,
                    node: data.nodeId,
                    type: data.saveType,
                    time: this.formatTimeAgo(data.timestamp)
                });
                return data;
            } catch (e) {
                console.error('[SaveManager] ❌ 读取存档失败:', e);
                this.currentSave = null;
                return null;
            }
        }

        /**
         * 清除存档
         */
        clear() {
            localStorage.removeItem(SAVE_KEY);
            this.currentSave = null;
            console.log('[SaveManager] 🗑️ 存档已清除');
        }

        /**
         * 检查是否有存档
         * @returns {boolean}
         */
        hasSave() {
            return this.currentSave !== null;
        }

        /**
         * 获取已完成的关卡列表
         * @returns {Array<string>}
         */
        getCompletedLevels() {
            return this.currentSave?.completedLevels || [];
        }

        /**
         * 检查某关卡是否已完成
         * @param {string} levelId
         * @returns {boolean}
         */
        isLevelCompleted(levelId) {
            return this.getCompletedLevels().includes(levelId);
        }

        /**
         * 获取当前存档信息（用于 UI 显示）
         * @returns {Object|null}
         */
        getSaveInfo() {
            if (!this.currentSave) return null;
            
            return {
                levelId: this.currentSave.levelId,
                nodeId: this.currentSave.nodeId,
                saveType: this.currentSave.saveType,
                inventory: this.currentSave.inventory,
                completedCount: this.currentSave.completedLevels?.length || 0,
                timestamp: this.currentSave.timestamp,
                timeAgo: this.formatTimeAgo(this.currentSave.timestamp)
            };
        }

        // =====================================================================
        // 辅助方法
        // =====================================================================

        /**
         * 格式化时间为相对描述
         * @param {number} timestamp
         * @returns {string}
         */
        formatTimeAgo(timestamp) {
            const seconds = Math.floor((Date.now() - timestamp) / 1000);
            
            if (seconds < 60) return '刚刚';
            if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
            if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
            return `${Math.floor(seconds / 86400)} 天前`;
        }

        /**
         * 调试用：打印当前存档状态
         */
        debug() {
            console.group('[SaveManager] Debug Info');
            console.log('Has Save:', this.hasSave());
            console.log('Current Save:', this.currentSave);
            console.log('Completed Levels:', this.getCompletedLevels());
            console.groupEnd();
        }
    }

    // =========================================================================
    // 导出到全局
    // =========================================================================
    window.SaveManager = new SaveManager();

    // 开发时可通过控制台调试
    // SaveManager.debug()
    // SaveManager.clear()

})();
