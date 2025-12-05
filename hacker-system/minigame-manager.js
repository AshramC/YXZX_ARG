/**
 * MiniGameManager v1.0
 * 小游戏管理器 - 负责加载和管理嵌入式小游戏
 * 
 * 使用方式:
 * 1. 在 HTML 中引入此文件: <script src="minigame-manager.js"></script>
 * 2. 引擎调用: window.MiniGameManager.start('terminal', { onComplete, onExit })
 */

(function() {
    'use strict';

    // 小游戏注册表
    const GAMES = {
        'terminal': {
            name: 'Terminal Access',
            src: 'terminal-minigame.html',
            description: '终端模拟器 - 找到并下载机密文件'
        }
        // 可以添加更多小游戏
    };

    // 状态
    let currentGame = null;
    let gameFrame = null;
    let overlay = null;
    let callbacks = {};

    /**
     * 创建游戏容器
     */
    function createGameContainer() {
        // 创建遮罩层
        overlay = document.createElement('div');
        overlay.id = 'minigame-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            z-index: 9999;
            display: flex;
            flex-direction: column;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;

        // 创建顶部栏
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 20px;
            background: #0a0a0a;
            border-bottom: 1px solid #1a2a1a;
        `;

        const title = document.createElement('span');
        title.id = 'minigame-title';
        title.style.cssText = `
            color: #00ff41;
            font-family: 'Consolas', monospace;
            font-size: 14px;
            letter-spacing: 2px;
        `;

        const exitBtn = document.createElement('button');
        exitBtn.textContent = '[ EXIT ]';
        exitBtn.style.cssText = `
            background: transparent;
            border: 1px solid #333;
            color: #888;
            font-family: 'Consolas', monospace;
            font-size: 12px;
            padding: 5px 15px;
            cursor: pointer;
            transition: all 0.2s;
        `;
        exitBtn.onmouseenter = () => {
            exitBtn.style.borderColor = '#ef4444';
            exitBtn.style.color = '#ef4444';
        };
        exitBtn.onmouseleave = () => {
            exitBtn.style.borderColor = '#333';
            exitBtn.style.color = '#888';
        };
        exitBtn.onclick = () => {
            close();
            if (callbacks.onExit) callbacks.onExit();
        };

        header.appendChild(title);
        header.appendChild(exitBtn);

        // 创建 iframe 容器
        const frameContainer = document.createElement('div');
        frameContainer.style.cssText = `
            flex: 1;
            display: flex;
            justify-content: center;
            align-items: center;
            overflow: hidden;
        `;

        gameFrame = document.createElement('iframe');
        gameFrame.id = 'minigame-frame';
        gameFrame.style.cssText = `
            width: 100%;
            height: 100%;
            border: none;
            background: #050505;
        `;

        frameContainer.appendChild(gameFrame);
        overlay.appendChild(header);
        overlay.appendChild(frameContainer);
        document.body.appendChild(overlay);

        // 触发淡入
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });
    }

    /**
     * 启动小游戏
     * @param {string} gameId - 游戏ID
     * @param {Object} options - 配置选项
     * @param {Function} options.onComplete - 完成回调
     * @param {Function} options.onExit - 退出回调
     * @param {Object} options.node - 关卡节点数据
     * @param {Array} options.inventory - 玩家道具
     */
    function start(gameId, options = {}) {
        const game = GAMES[gameId];
        if (!game) {
            console.error(`[MiniGameManager] Unknown game: ${gameId}`);
            if (options.onExit) options.onExit();
            return;
        }

        console.log(`[MiniGameManager] Starting game: ${gameId}`);
        currentGame = gameId;
        callbacks = {
            onComplete: options.onComplete,
            onExit: options.onExit
        };

        // 创建容器
        createGameContainer();

        // 设置标题
        const titleEl = document.getElementById('minigame-title');
        if (titleEl) {
            titleEl.textContent = `[ ${game.name.toUpperCase()} ]`;
        }

        // 加载游戏
        gameFrame.src = game.src;

        // 监听来自 iframe 的消息
        window.addEventListener('message', handleGameMessage);


        // 设置 iframe 加载完成后的回调
        gameFrame.onload = () => {
            console.log('[MiniGameManager] iframe loaded, sending init message...');

            // 获取当前语言
            const currentLang = localStorage.getItem('app_lang') || 'cn';

            // 【核心修改】使用 postMessage 发送初始化数据，而不是直接赋值
            //这避开了 file:// 协议下的跨域安全报错
            const initPayload = {
                type: 'init',
                lang: currentLang,
                node: options.node,
                inventory: options.inventory
            };

            // '*' 表示允许发送给任何源，这在本地调试(file://)时是必须的
            gameFrame.contentWindow.postMessage(initPayload, '*');
        };
    }

    /**
     * 处理游戏消息
     */
    function handleGameMessage(event) {
        if (event.data && event.data.type === 'minigame-complete') {
            handleGameComplete(event.data.result);
        }
    }

    /**
     * 处理游戏完成
     */
    function handleGameComplete(result) {
        console.log('[MiniGameManager] Game completed:', result);
        
        // 延迟关闭，让玩家看到胜利画面
        setTimeout(() => {
            close();
            if (callbacks.onComplete) {
                callbacks.onComplete(result);
            }
        }, 500);
    }

    /**
     * 关闭小游戏
     */
    function close() {
        window.removeEventListener('message', handleGameMessage);

        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => {
                if (overlay && overlay.parentNode) {
                    overlay.parentNode.removeChild(overlay);
                }
                overlay = null;
                gameFrame = null;
                currentGame = null;
            }, 300);
        }
    }

    /**
     * 检查是否有游戏正在运行
     */
    function isRunning() {
        return currentGame !== null;
    }

    // 暴露 API
    window.MiniGameManager = {
        start: start,
        close: close,
        isRunning: isRunning,
        GAMES: GAMES
    };

    console.log('[MiniGameManager] Initialized');
})();
