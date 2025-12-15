/**
 * MiniGameManager v2.0 (Style Mode Supported)
 * 小游戏管理器 - 负责加载和管理嵌入式小游戏
 * * 主要更新：
 * 1. 支持 styleMode ('p5' 或 'fullscreen')
 * 2. 移除内联样式，全面对接 campus-style.css
 */

(function() {
    'use strict';

    // 1. [修改] 小游戏注册表：添加新游戏和样式模式
    const GAMES = {
        'terminal': {
            name: 'Terminal Access',
            src: '../hacker-system/terminal-minigame.html',
            description: '终端模拟器',
            styleMode: 'fullscreen'
        },
        'puzzle': {
            name: 'Data Recovery',
            src: 'puzzle_game.html',
            description: '数据碎片修复',
            styleMode: 'p5' // P5 红黑窗口风格
        },
        'hacker': {
            name: 'Infiltration Protocol',
            src: '../hacker-system/hacker-view.html',
            description: '潜入系统',
            styleMode: 'fullscreen'
        }
    };

    // 状态
    let currentGame = null;
    let gameFrame = null;
    let overlay = null;
    let callbacks = {};

    /**
     * 2. [修改] 创建游戏容器
     * 移除硬编码样式，使用 ID 和 Class 配合 CSS 文件
     */
    function createGameContainer(styleMode) {
        // 创建遮罩层
        overlay = document.createElement('div');
        overlay.id = 'minigame-overlay'; // 对应 CSS #minigame-overlay

        // 创建 P5 风格的容器包装 (这就是那个倾斜的红黑框)
        const container = document.createElement('div');
        container.id = 'minigame-container'; // 对应 CSS #minigame-container

        // 根据模式添加类名
        if (styleMode === 'p5') {
            container.classList.add('mode-p5');
        } else if (styleMode === 'fullscreen') {
            container.classList.add('mode-fullscreen');
            // 全屏模式下隐藏通用标题栏（Hacker系统自带UI）
            container.classList.add('mode-fullscreen-header-hidden');
        }

        // 创建顶部栏
        const header = document.createElement('div');
        header.id = 'minigame-header'; // 对应 CSS #minigame-header

        const title = document.createElement('span');
        title.id = 'minigame-title';   // 对应 CSS #minigame-title

        const exitBtn = document.createElement('button');
        exitBtn.id = 'minigame-close-btn'; // 对应 CSS #minigame-close-btn
        exitBtn.textContent = 'CLOSE [X]';

        exitBtn.onclick = () => {
            close();
            if (callbacks.onExit) callbacks.onExit();
        };

        header.appendChild(title);
        header.appendChild(exitBtn);

        // 创建 iframe
        gameFrame = document.createElement('iframe');
        gameFrame.id = 'minigame-frame'; // 对应 CSS #minigame-frame

        // 组装 DOM 结构: Overlay -> Container -> (Header + Iframe)
        container.appendChild(header);
        container.appendChild(gameFrame);
        overlay.appendChild(container);
        document.body.appendChild(overlay);

        // 触发淡入 (由 CSS transition 控制)
        requestAnimationFrame(() => {
            overlay.style.opacity = '1';
        });
    }

    /**
     * 启动小游戏
     */
    function start(gameId, options = {}) {
        const game = GAMES[gameId];
        if (!game) {
            console.error(`[MiniGameManager] Unknown game: ${gameId}`);
            if (options.onExit) options.onExit();
            return;
        }

        console.log(`[MiniGameManager] Starting game: ${gameId} (Mode: ${game.styleMode})`);
        currentGame = gameId;
        callbacks = {
            onComplete: options.onComplete,
            onExit: options.onExit
        };

        // 3. [修改] 传递 styleMode
        createGameContainer(game.styleMode);

        // 设置标题
        const titleEl = document.getElementById('minigame-title');
        if (titleEl) {
            titleEl.textContent = `// ${game.name.toUpperCase()}`;
        }

        // 加载游戏
        gameFrame.src = game.src;

        // 监听来自 iframe 的消息
        window.addEventListener('message', handleGameMessage);

        // 设置 iframe 加载完成后的回调
        gameFrame.onload = () => {
            console.log('[MiniGameManager] iframe loaded, sending init message...');
            const currentLang = localStorage.getItem('app_lang') || 'cn';

            const initPayload = {
                type: 'init',
                lang: currentLang,
                node: options.node,
                inventory: options.inventory
            };

            // 发送初始化数据
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
        }, 800);
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

    console.log('[MiniGameManager v2.0] Initialized with Style Support');
})();