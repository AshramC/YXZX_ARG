/**
 * Hacker Engine v4.0 (Final Integration)
 * - Features: Stealth, Hacking, Fog of War, Camera Pan/Zoom
 * - System: Save/Load System, MiniGame Support, Narrative Event
 * - Special: "The Kill Switch" Lockdown & Time Capsule Unlock
 */

class GameEngine {
    constructor() {
        // === 核心状态 ===
        this.levelLibrary = {};
        this.currentLevelId = null;
        this.levelData = null;
        this.isFirstLoad = true;

        this.player = {
            nodeId: null, x: 0, y: 0,
            state: 'IDLE', // IDLE, MOVING, HACKING
            targetNode: null,
            currentLink: null,
            moveStartTime: 0, moveDuration: 0
        };
        this.guards = [];
        this.inventory = [];
        this.isGameOver = false;

        // === Hack 机制状态 ===
        this.linkProgress = {};
        this.activeLink = null;

        // === 镜头与迷雾 ===
        this.camera = {
            zoom: 1.3,
            isDragging: false,
            dragStartX: 0, dragStartY: 0,
            panX: 0, panY: 0
        };

        this.fog = { radius: 35, dimRadius: 65 };

        // === 物理常量 ===
        this.NOISE_RADIUS = 25.0;
        this.GUARD_SPEED_PATROL = 10;
        this.GUARD_SPEED_HUNT = 32;

        // === 计时器 ===
        this.idleTimer = null;
        this.bubbleTimer = null;
        this.panicTimer = null;
        this.isPanicMode = false;
        this.invincibleUntil = 0;
        this.skipDeathSequence = false;

        // === DOM 引用 ===
        this.domMap = document.getElementById('mapContainer');
        this.domSvg = document.getElementById('svgLayer');
        this.domEntities = document.getElementById('entityLayer');
        this.domChat = document.getElementById('chatHistory');
        this.domActions = document.getElementById('actionArea');
        this.domInv = document.getElementById('inventoryList');

        this.domThoughtBubble = document.getElementById('thoughtBubble');
        this.domThoughtText = document.getElementById('thoughtText');

        this.domPlayer = null;
        this.previewRing = null;

        // Modal
        this.domModal = document.getElementById('modalOverlay');
        this.domTitle = document.getElementById('modalTitle');
        this.domMsg = document.getElementById('modalMsg');

        // === 背景音乐 ===
        this.bgm = null;
        this.bgmStarted = false;

        // === 绑定事件上下文 ===
        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);

        window.gameEngine = this;

        this.init();
    }

    t(key) {
        return window.HackerConfig?.[key] || key;
    }

    refreshUiText(lang) {
        this.updatePhoneOptions();
    }

    // === 初始化入口 ===
    async init() {
        if (window.LevelConfig) {
            this.levelLibrary = window.LevelConfig;

            // 尝试从存档恢复（包含锁定状态检查）
            if (!this.initFromSave()) {
                // 无存档或正常读档失败，从第一关开始
                const firstLevelId = Object.keys(this.levelLibrary)[0];
                if (firstLevelId) {
                    this.loadLevel(firstLevelId);
                } else {
                    console.error("Config is empty!");
                }
            }
        } else {
            console.error("No LevelConfig found.");
        }

        const monitor = document.querySelector('.monitor-wrapper');
        if (monitor) {
            monitor.addEventListener('mousedown', this.handleMouseDown);
            window.addEventListener('mousemove', this.handleMouseMove);
            window.addEventListener('mouseup', this.handleMouseUp);
            monitor.addEventListener('wheel', (e) => {
                e.preventDefault();
                this.camera.zoom += e.deltaY * -0.001;
                this.camera.zoom = Math.min(Math.max(0.5, this.camera.zoom), 3);
            });
        }

        // 获取背景音乐元素
        this.bgm = document.getElementById('bgmAudio');

        setInterval(() => {
            const timeEl = document.getElementById('clock');
            if(timeEl) timeEl.innerText = `REC ${new Date().toTimeString().split(' ')[0]}`;
        }, 1000);

        this.lastTime = performance.now();
        requestAnimationFrame((t) => this.gameLoop(t));
    }

    // =========================================================================
    // ★★★ 核心修改：存档初始化与锁定/解锁逻辑 ★★★
    // =========================================================================
    initFromSave() {
        if (!window.SaveManager || !window.SaveManager.hasSave()) return false;

        const save = window.SaveManager.currentSave;

        // 1. 检测锁定状态与解锁条件
        if (save.saveType === 'lockdown' || save.levelId === 'LOCKED_STATE') {

            // 定义解锁条件
            const UNLOCK_DATE = new Date('2025-12-12T00:00:00'); // 预设解锁日期
            const NOW = new Date();
            const NEXT_LEVEL_ID = 'level_04_awakening'; // 未来的新关卡ID

            // 检查：是否到了时间 且 是否有新关卡配置存在
            const hasNewContent = this.levelLibrary && this.levelLibrary[NEXT_LEVEL_ID];

            if (NOW >= UNLOCK_DATE && hasNewContent) {
                console.log('[Engine] 🔓 时间已到，解除封印！');

                // 自动迁移存档：复活到新关卡
                const nextLevel = this.levelLibrary[NEXT_LEVEL_ID];
                const startNode = nextLevel.elements.find(e => e.type === 'node');

                // 覆盖死档为正常存档
                window.SaveManager.save({
                    levelId: NEXT_LEVEL_ID,
                    nodeId: startNode ? startNode.id : 'n_start',
                    inventory: save.inventory,
                    saveType: 'manual'
                });

                this.addLog("SYSTEM: SECURE CHANNEL RE-ESTABLISHED.", "system");

                // 加载新关卡
                setTimeout(() => this.loadLevel(NEXT_LEVEL_ID), 100);
                return true;
            }

            // 如果未满足条件，执行锁定
            console.log('[Engine] 🔒 保持锁定状态');
            setTimeout(() => this.showFinalLockScreen(), 100);
            return true; // 阻止加载默认关卡
        }

        // 2. 正常读档逻辑
        if (!this.levelLibrary[save.levelId]) {
            console.warn('[Engine] 存档关卡不存在，从头开始');
            window.SaveManager.clear();
            return false;
        }

        console.log('[Engine] 📂 从存档恢复:', save);
        this.loadLevel(save.levelId);
        this.inventory = save.inventory || [];
        this.updateInventoryUi();

        const targetNode = this.getNode(save.nodeId);
        if (targetNode) {
            this.player.nodeId = targetNode.id;
            this.player.x = targetNode.x;
            this.player.y = targetNode.y;
            this.domPlayer.style.left = targetNode.x + '%';
            this.domPlayer.style.top = targetNode.y + '%';

            if (targetNode.nodeType === 'minigame') {
                this.showMiniGameEntry(targetNode);
            } else {
                this.updatePhoneOptions();
            }
        }
        return true;
    }

    // === 关卡加载 ===
    loadLevel(levelId) {
        if (!this.levelLibrary || !this.levelLibrary[levelId]) {
            console.error(`Level [${levelId}] not found!`);
            return;
        }

        this.cleanupLevel();

        this.currentLevelId = levelId;
        // 深拷贝关卡数据，避免 finishHack 等方法修改原始配置导致重载后状态不重置
        this.levelData = JSON.parse(JSON.stringify(this.levelLibrary[levelId]));
        console.log(`[Engine] Loaded Level: ${this.levelData.name} (${levelId})`);

        // 物理修正
        const STANDARD_NOISE_PIXELS = 125;
        const mapWidth = this.levelData.width || 1000;
        this.NOISE_RADIUS = (STANDARD_NOISE_PIXELS / mapWidth) * 100;

        this.isGameOver = false;
        this.player.state = 'IDLE';
        this.activeLink = null;
        this.linkProgress = {};

        this.renderStaticWorld();
        this.initEntities();

        if (this.domModal) this.domModal.classList.add('hidden');
        this.domMap.style.transition = 'none';
        this.camera.panX = 0;
        this.camera.panY = 0;

        this.addLog(`Loaded: ${this.levelData.name}`, 'system');
    }

    // === 恐慌与状态控制 ===
    triggerPanic() {
        if (this.isPanicMode) return;
        this.isPanicMode = true;

        if (this.player.state === 'MOVING') {
            const startNode = this.getNode(this.player.nodeId);
            const targetNode = this.player.targetNode;
            let nearestGuard = this.guards.find(g => g.state === 'HUNT');

            if (nearestGuard && startNode && targetNode) {
                const distToTarget = Math.sqrt(Math.pow(targetNode.x - nearestGuard.x, 2) + Math.pow(targetNode.y - nearestGuard.y, 2));
                const distToStart = Math.sqrt(Math.pow(startNode.x - nearestGuard.x, 2) + Math.pow(startNode.y - nearestGuard.y, 2));

                if (distToTarget < distToStart) {
                    const tempNode = this.player.targetNode;
                    this.player.targetNode = this.getNode(this.player.nodeId);
                    this.player.nodeId = tempNode.id;

                    const now = performance.now();
                    const elapsed = now - this.player.moveStartTime;
                    const progress = elapsed / this.player.moveDuration;
                    const newProgress = 1.0 - progress;
                    this.player.moveStartTime = now - (newProgress * this.player.moveDuration);
                }
            }
        }

        if (this.domThoughtBubble) {
            if (this.idleTimer) clearTimeout(this.idleTimer);
            if (this.bubbleTimer) clearTimeout(this.bubbleTimer);

            this.domThoughtBubble.classList.remove('hidden');
            this.domThoughtBubble.classList.add('visible');
            this.domThoughtBubble.classList.add('panic');
            this.domThoughtText.innerHTML = '';
            this.updatePlayerPosition(this.player.x, this.player.y);
        }

        this.panicTimer = setInterval(() => {
            if (!this.domThoughtText) return;
            const line = document.createElement('div');
            line.className = 'panic-line';
            line.innerText = "我被发现了快教教我";
            if (Math.random() > 0.7) line.style.fontSize = '1.3em';
            if (Math.random() > 0.95) {
                line.className = 'panic-line panic-error';
                line.innerText = "ERROR::PANIC_OVERFLOW";
            }
            this.domThoughtText.prepend(line);
        }, 80);
    }

    stopPanic() {
        this.isPanicMode = false;
        this.invincibleUntil = 0;
        if (this.panicTimer) {
            clearInterval(this.panicTimer);
            this.panicTimer = null;
        }
        if (this.domThoughtBubble) {
            this.domThoughtBubble.classList.remove('panic');
        }
    }

    cleanupLevel() {
        this.domSvg.innerHTML = '';
        this.domEntities.innerHTML = '';
        this.domActions.innerHTML = '';

        if (this.domChat) {
            if (this.isFirstLoad) {
                this.isFirstLoad = false;
            } else {
                this.domChat.innerHTML = '';
            }
        }

        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
        this.hideBubble();

        this.stopPanic();
        if (this.domThoughtBubble) this.domThoughtBubble.classList.remove('panic');

        const signalLayer = document.getElementById('signalLostLayer');
        if (signalLayer) {
            signalLayer.classList.remove('visible');
            signalLayer.classList.add('hidden');
        }

        const skipBtn = document.getElementById('skipButton');
        if (skipBtn) skipBtn.classList.add('hidden');

        this.guards = [];
        this.inventory = [];
        this.updateInventoryUi();
        this.previewRing = null;
        this.noiseRing = null;
        this.player.targetNode = null;
        this.player.currentLink = null;
    }

    handleIdleThought(node) {
        if (this.isPanicMode) return;
        this.hideBubble();
        if (!node.thought) return;

        // === 修改开始 ===
        // 旧逻辑: 固定 500ms
        // 新逻辑: 基础 200ms + 随机偏移 (0 ~ 1000ms)
        // 结果: 想法会在到达节点后的 0.2秒 到 1.2秒 之间随机浮现
        const baseDelay = 200;
        const randomOffset = Math.random() * 1000;
        const finalDelay = baseDelay + randomOffset;

        this.idleTimer = setTimeout(() => {
            this.showBubbleAtPlayer(node.thought);
        }, finalDelay);
    }

    showBubbleAtPlayer(text) {
        if (!this.domThoughtBubble) {
            this.domThoughtBubble = document.getElementById('thoughtBubble');
            this.domThoughtText = document.getElementById('thoughtText');
        }
        if (!this.domThoughtBubble) return;

        this.domThoughtBubble.style.left = this.player.x + '%';
        this.domThoughtBubble.style.top = this.player.y + '%';
        if(this.domThoughtText) this.domThoughtText.innerText = text;
        this.domThoughtBubble.classList.remove('hidden');
        void this.domThoughtBubble.offsetWidth;
        this.domThoughtBubble.classList.add('visible');

        this.bubbleTimer = setTimeout(() => {
            this.hideBubble();
        }, 4000);
    }

    hideBubble() {
        if (this.isPanicMode) return;
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.bubbleTimer) clearTimeout(this.bubbleTimer);

        if (!this.domThoughtBubble) this.domThoughtBubble = document.getElementById('thoughtBubble');
        if (this.domThoughtBubble) {
            this.domThoughtBubble.classList.remove('visible');
            this.domThoughtBubble.classList.add('hidden');
        }
    }

    renderStaticWorld() {
        this.domMap.style.width = (this.levelData.width || 1000) + 'px';
        this.domMap.style.height = (this.levelData.height || 600) + 'px';

        const bubble = document.createElement('div');
        bubble.id = 'thoughtBubble';
        bubble.className = 'thought-bubble hidden';
        bubble.innerHTML = '<div id="thoughtText" class="thought-content"></div>';
        this.domEntities.appendChild(bubble);

        this.domThoughtBubble = bubble;
        this.domThoughtText = bubble.querySelector('#thoughtText');

        this.levelData.elements.forEach(el => {
            const div = document.createElement('div');
            div.style.left = el.x + '%'; div.style.top = el.y + '%';
            div.dataset.x = el.x; div.dataset.y = el.y;

            if (el.type === 'zone') {
                div.className = 'zone'; div.style.width = el.w + '%'; div.style.height = el.h + '%';
            } else if (el.type === 'obstacle') {
                div.className = 'obstacle'; div.style.width = el.w + '%'; div.style.height = el.h + '%';
            } else if (el.type === 'node') {
                div.className = 'node';
                div.dataset.id = el.id;
                if (el.nodeType) div.dataset.nodeType = el.nodeType;
                if (el.nodeType === 'exit') div.classList.add('target');
                if (el.loot && !this.inventory.includes(el.loot)) div.classList.add('has-loot');
            }
            if (['zone','obstacle','node'].includes(el.type)) this.domEntities.appendChild(div);
        });

        if (this.levelData.links) {
            this.levelData.links.forEach(link => {
                const n1 = this.getNode(link.from);
                const n2 = this.getNode(link.to);
                if (!n1 || !n2) return;
                const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
                line.dataset.id = link.id;
                line.setAttribute("x1", n1.x + "%"); line.setAttribute("y1", n1.y + "%");
                line.setAttribute("x2", n2.x + "%"); line.setAttribute("y2", n2.y + "%");
                line.setAttribute("class", `link-line ${link.isHidden ? 'link-hidden' : 'link-open'}`);
                line.dataset.cx = (n1.x + n2.x) / 2;
                line.dataset.cy = (n1.y + n2.y) / 2;
                this.domSvg.appendChild(line);
            });
        }
    }

    initEntities() {
        const startNode = this.levelData.elements.find(e => e.type === 'node');
        this.domPlayer = document.createElement('div');
        this.domPlayer.className = 'player-dot';
        this.domEntities.appendChild(this.domPlayer);
        if (startNode) this.setPlayerNode(startNode);

        const guardData = this.levelData.elements.filter(e => e.type === 'guard');
        guardData.forEach(g => {
            const dom = document.createElement('div');
            dom.className = 'guard-dot';
            dom.style.width = '14px'; dom.style.height = '14px';
            dom.style.background = '#ef4444'; dom.style.borderRadius = '50%';
            dom.style.position = 'absolute'; dom.style.transform = 'translate(-50%, -50%)';
            dom.style.zIndex = '50'; dom.style.boxShadow = '0 0 10px #ef4444';
            this.domEntities.appendChild(dom);

            let pathNodes = [];
            if (g.patrolPath && g.patrolPath.length > 0) {
                pathNodes = g.patrolPath.map(nid => this.getNode(nid)).filter(n => n);
            }
            const startX = pathNodes.length > 0 ? pathNodes[0].x : g.x;
            const startY = pathNodes.length > 0 ? pathNodes[0].y : g.y;

            this.guards.push({
                id: g.id, dom: dom, path: pathNodes,
                x: startX, y: startY, targetIndex: 1,
                state: 'PATROL',
                speed: this.GUARD_SPEED_PATROL
            });
        });
    }

    // === 主循环 ===
    gameLoop(timestamp) {
        requestAnimationFrame((t) => this.gameLoop(t));

        if (this.isGameOver) {
            this.lastTime = timestamp;
            this.updateCamera();
            return;
        }

        const dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        this.updateGuards(dt);
        this.updatePlayer(dt);
        this.updateHacking(dt);
        this.checkCollisions();
        this.updateVisualFX();

        this.updateCamera();
        this.updateFog();
    }

    // === 交互逻辑 ===
    toggleHack(link) {
        if (this.player.state === 'HACKING') {
            this.player.state = 'IDLE';
            this.activeLink = null;
            this.hideNoisePreview();
            this.addLog(this.t('hack_abort'), 'system');
            this.updatePhoneOptions();
            return;
        }

        if (this.player.state === 'IDLE') {
            this.player.state = 'HACKING';
            this.activeLink = link;
            this.showNoisePreview();
            this.addLog(this.t('hack_start'), 'system');
        }
    }

    updateHacking(dt) {
        if (this.player.state !== 'HACKING' || !this.activeLink) return;

        const lid = this.activeLink.id;
        if (this.linkProgress[lid] === undefined) this.linkProgress[lid] = 0;

        const speed = 100 / (this.activeLink.cost || 5);
        this.linkProgress[lid] += speed * dt;

        const btn = this.domActions.querySelector(`button[data-lid="${lid}"]`);
        if (btn) {
            const pct = Math.min(100, this.linkProgress[lid]).toFixed(1);
            btn.innerHTML = `<span style="color:#f59e0b">⚡ ${this.t('hack_progress')}... ${pct}%</span>
                             <div class="progress-bar" style="width:${pct}%; position:absolute; bottom:0; left:0; height:4px; background:#f59e0b; transition:width 0.1s;"></div>`;
            btn.classList.add('hacking-active');
        }

        if (this.linkProgress[lid] >= 100) {
            this.finishHack(this.activeLink);
        }
    }

    finishHack(link) {
        this.player.state = 'IDLE';
        this.linkProgress[link.id] = 100;
        this.activeLink = null;
        this.hideNoisePreview();

        link.interaction = 'none';
        link.cost = 1;

        this.addLog(this.t('hack_success'), 'system');
        this.executeMove(link);
    }

    handleMouseDown(e) {
        // 用户交互后启动背景音乐
        this.startBgm();

        if (e.target.closest('.phone-terminal') || e.target.closest('.hacker-lang-switch') || e.target.closest('button') || e.target.closest('.modal-box')) return;
        this.camera.isDragging = true;
        this.camera.dragStartX = e.clientX;
        this.camera.dragStartY = e.clientY;
        this.domMap.style.transition = 'none';
    }

    handleMouseMove(e) {
        if (!this.camera.isDragging) return;
        this.camera.panX += (e.clientX - this.camera.dragStartX);
        this.camera.panY += (e.clientY - this.camera.dragStartY);
        this.camera.dragStartX = e.clientX;
        this.camera.dragStartY = e.clientY;
    }

    handleMouseUp() {
        if(this.camera.isDragging) {
            this.camera.isDragging = false;
            this.domMap.style.transition = 'transform 0.2s cubic-bezier(0.25, 1, 0.5, 1)';
        }
    }

    updateCamera() {
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const mapBaseW = this.levelData.width || 1000;
        const mapBaseH = this.levelData.height || 600;

        const playerPixelX = (this.player.x / 100) * mapBaseW;
        const playerPixelY = (this.player.y / 100) * mapBaseH;

        let offsetX = (viewportW / 2) - (playerPixelX * this.camera.zoom) + this.camera.panX;
        let offsetY = (viewportH / 2) - (playerPixelY * this.camera.zoom) + this.camera.panY;

        this.domMap.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.camera.zoom})`;
    }

    checkCollisions() {
        const px = this.player.x; const py = this.player.y;
        const HIT_RADIUS = 2.0;
        const now = performance.now();
        const isInvincible = now < this.invincibleUntil;

        for (let g of this.guards) {
            const dx = px - g.x; const dy = py - g.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < HIT_RADIUS) {
                const isSneaking = this.player.state === 'MOVING' &&
                    this.player.currentLink &&
                    this.player.currentLink.isHidden;

                if (isSneaking && !this.isPanicMode) {
                    g.state = 'HUNT';
                    g.speed = this.GUARD_SPEED_HUNT;
                    g.dom.classList.add('alerted');
                    this.addLog(this.t('alert_spotted') || '!! 被发现了！ !!', 'alert');
                    this.invincibleUntil = now + 800;
                    this.triggerPanic();
                    return;
                }

                if (!isInvincible) {
                    this.triggerGameOver(this.t('caught'), this.t('reason_caught'), g);
                    return;
                }
            }
        }

        if ((this.player.state === 'MOVING' && this.player.currentLink && !this.player.currentLink.isHidden) ||
            (this.player.state === 'HACKING')) {
            for (let g of this.guards) {
                const dx = px - g.x; const dy = py - g.y;
                const dist = Math.sqrt(dx*dx + dy*dy);

                if (dist < this.NOISE_RADIUS) {
                    if (g.state !== 'HUNT') {
                        g.state = 'HUNT';
                        g.speed = this.GUARD_SPEED_HUNT;
                        g.dom.classList.add('alerted');
                        this.addLog(this.t('alert_noise'), 'alert');
                        this.triggerPanic();
                    }
                }
            }
        }
    }

    showNoisePreview() {
        if (this.previewRing) return;
        this.previewRing = document.createElement('div');
        this.previewRing.className = 'noise-preview';
        this.previewRing.style.width = (this.NOISE_RADIUS * 2) + '%';
        this.previewRing.style.height = (this.NOISE_RADIUS * 2) + '%';
        this.previewRing.style.left = this.player.x + '%';
        this.previewRing.style.top = this.player.y + '%';
        this.domEntities.appendChild(this.previewRing);
    }

    hideNoisePreview() {
        if (this.previewRing) {
            this.previewRing.remove();
            this.previewRing = null;
        }
        this.guards.forEach(g => g.dom.classList.remove('warning'));
    }

    updateVisualFX() {
        const px = this.player.x; const py = this.player.y;
        let minDistance = 1000;
        for (let g of this.guards) {
            const dx = px - g.x; const dy = py - g.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < minDistance) minDistance = dist;
        }
        const layer = document.getElementById('glitchLayer');
        if (layer && minDistance < 30) {
            layer.style.opacity = (1 - minDistance/30) * 0.5;
        } else if (layer) {
            layer.style.opacity = 0;
        }

        if (this.previewRing) {
            this.guards.forEach(g => {
                const dx = px - g.x; const dy = py - g.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                if (dist < this.NOISE_RADIUS) {
                    g.dom.classList.add('warning');
                } else {
                    g.dom.classList.remove('warning');
                }
            });
        }
    }

    triggerGameOver(reason, code, killer = null) {
        if (this.isGameOver) return;
        this.isGameOver = true;

        // 停止背景音乐
        this.stopBgm();

        if (this.domPlayer && this.domMap) {
            const computed = window.getComputedStyle(this.domPlayer);
            const currentPixelX = parseFloat(computed.left);
            const currentPixelY = parseFloat(computed.top);

            this.domPlayer.style.transition = 'none';
            this.domPlayer.style.left = currentPixelX + 'px';
            this.domPlayer.style.top = currentPixelY + 'px';

            const mapW = this.domMap.offsetWidth;
            const mapH = this.domMap.offsetHeight;
            this.player.x = (currentPixelX / mapW) * 100;
            this.player.y = (currentPixelY / mapH) * 100;

            this.domPlayer.style.backgroundColor = '#ef4444';
            this.domPlayer.style.boxShadow = '0 0 15px #ef4444';
        }

        if (killer) {
            killer.dom.classList.remove('fog-hidden', 'fog-dim');
            killer.dom.classList.add('revealed');

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", this.player.x + "%"); line.setAttribute("y1", this.player.y + "%");
            line.setAttribute("x2", killer.x + "%"); line.setAttribute("y2", killer.y + "%");
            line.setAttribute("class", "detection-line");
            this.domSvg.appendChild(line);
        }

        document.querySelector('.monitor-wrapper').classList.add('shaking');
        const glitch = document.getElementById('glitchLayer');
        if(glitch) {
            glitch.style.opacity = 0.8;
            glitch.style.filter = "contrast(200%) hue-rotate(90deg)";
        }

        setTimeout(() => {
            this.playSignalLostTransition();
        }, 1500);
    }

    playSignalLostTransition() {
        const signalLayer = document.getElementById('signalLostLayer');
        if (!signalLayer) {
            this.playDeathSequence();
            return;
        }

        if (this.panicTimer) {
            clearInterval(this.panicTimer);
            this.panicTimer = null;
        }
        if (this.domThoughtBubble) {
            this.domThoughtBubble.classList.add('hidden');
            this.domThoughtBubble.classList.remove('visible', 'panic');
        }

        document.querySelector('.monitor-wrapper').classList.remove('shaking');
        const glitch = document.getElementById('glitchLayer');
        if (glitch) {
            glitch.style.opacity = 0;
        }

        signalLayer.classList.remove('hidden');
        requestAnimationFrame(() => {
            signalLayer.classList.add('visible');
        });

        setTimeout(() => {
            this.playDeathSequence();
        }, 2000);
    }

    triggerWin() {
        if (this.isGameOver) return;
        this.isGameOver = true;

        this.addLog(">> ACCESS GRANTED. SEQUENCE COMPLETE. <<", "system");

        if (this.levelData.nextLevel && this.levelLibrary[this.levelData.nextLevel]) {
            if (window.SaveManager) {
                const nextLevelData = this.levelLibrary[this.levelData.nextLevel];
                const firstNode = nextLevelData.elements.find(e => e.type === 'node');

                window.SaveManager.save({
                    levelId: this.levelData.nextLevel,
                    nodeId: firstNode?.id || null,
                    inventory: this.inventory,
                    saveType: 'level_complete',
                    completedLevelId: this.currentLevelId
                });
                this.addLog('[SYSTEM] Checkpoint saved.', 'system');
            }

            this.addLog(">> UPLOADING TO NEXT SERVER NODE... <<", "system");
            setTimeout(() => {
                this.loadLevel(this.levelData.nextLevel);
            }, 1500);

        } else {
            const winTitle = this.t('win_title') || "SYSTEM SECURED";
            const winMsg = this.t('win_msg') || "All protocols executed successfully.";

            if (this.domTitle && this.domMsg && this.domModal) {
                this.domTitle.innerText = winTitle;
                this.domMsg.innerHTML = winMsg;
                this.domModal.classList.remove('hidden');
                this.domModal.classList.add('win');
            }
        }
    }

    async playDeathSequence() {
        const screen = document.getElementById('deathScreen');
        const container = document.getElementById('deathTextContainer');
        const controls = document.getElementById('deathControls');
        const cursor = document.getElementById('deathCursor');
        const skipBtn = document.getElementById('skipButton');

        screen.classList.remove('hidden');
        container.innerHTML = '';
        cursor.style.display = 'inline-block';

        this.skipDeathSequence = false;
        if (skipBtn) {
            skipBtn.classList.remove('hidden');
            skipBtn.onclick = () => {
                this.skipDeathSequence = true;
            };
        }

        const lines = window.HackerConfig.death_lines;
        const lineKeys = Object.keys(lines);

        for (let key of lineKeys) {
            if (this.skipDeathSequence) break;
            const lineDiv = document.createElement('div');
            lineDiv.className = 'death-line';
            container.appendChild(lineDiv);
            await this.typeWriter(lineDiv, lines[key]);
            if (!this.skipDeathSequence) {
                await this.interruptibleDelay(700);
            }
        }

        if (this.skipDeathSequence) {
            container.innerHTML = '';
            for (let key of lineKeys) {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'death-line';
                lineDiv.innerHTML = lines[key];
                container.appendChild(lineDiv);
            }
        }

        cursor.style.display = 'none';
        if (skipBtn) skipBtn.classList.add('hidden');

        document.getElementById('retryPrompt').innerHTML = this.t('retry_prompt');
        document.getElementById('retryButton').innerHTML = this.t('retry_button');

        const retryBtn = document.getElementById('retryButton');
        retryBtn.onclick = () => {
            document.getElementById('deathScreen').classList.add('hidden');
            document.getElementById('deathControls').classList.add('hidden');
            document.querySelector('.monitor-wrapper').classList.remove('shaking');
            document.getElementById('glitchLayer').style.opacity = 0;
            document.getElementById('glitchLayer').style.filter = "none";
            const signalLayer = document.getElementById('signalLostLayer');
            if (signalLayer) {
                signalLayer.classList.remove('visible');
                signalLayer.classList.add('hidden');
            }
            this.loadLevel(this.currentLevelId);
        };

        if (!this.skipDeathSequence) {
            await this.interruptibleDelay(500);
        }
        controls.classList.remove('hidden');
        setTimeout(() => controls.classList.add('visible'), 50);
    }

    interruptibleDelay(ms) {
        return new Promise(resolve => {
            const startTime = performance.now();
            const check = () => {
                if (this.skipDeathSequence || performance.now() - startTime >= ms) {
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }

    typeWriter(element, text) {
        return new Promise(resolve => {
            element.innerHTML = text;
            const duration = text.length > 50 ? 1500 : 800;
            const startTime = performance.now();
            const check = () => {
                if (this.skipDeathSequence || performance.now() - startTime >= duration) {
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }

    setPlayerNode(node) {
        this.player.nodeId = node.id;
        this.player.x = node.x; this.player.y = node.y;
        this.player.state = 'IDLE'; this.player.currentLink = null;
        this.domPlayer.style.left = node.x + '%'; this.domPlayer.style.top = node.y + '%';
        this.domPlayer.classList.remove('sneaking');

        if (node.loot && !this.inventory.includes(node.loot)) {
            this.inventory.push(node.loot);
            this.addLog(`${this.t('item_get')} [${node.loot}]`, 'system');
            this.updateInventoryUi();
            const currentDom = this.domEntities.querySelector(`.node[data-id="${node.id}"]`);
            if (currentDom) { currentDom.classList.remove('has-loot'); currentDom.classList.add('looted'); }
        }

        if (node.nodeType === 'exit') {
            this.triggerWin();
            return;
        }

        // ★★★ 新增: minigame 节点处理 ★★★
        if (node.nodeType === 'minigame') {
            if (window.SaveManager) {
                window.SaveManager.save({
                    levelId: this.currentLevelId,
                    nodeId: node.id,
                    inventory: this.inventory,
                    saveType: 'minigame'
                });
                this.addLog('[SYSTEM] Checkpoint saved.', 'system');
            }

            if (node.msg) this.addLog(node.msg, 'npc');
            this.showMiniGameEntry(node);
            this.handleIdleThought(node);
            return;
        }

        if (node.msg) this.addLog(node.msg, 'npc');

        this.updatePhoneOptions();
        this.handleIdleThought(node);
    }

    executeMove(link) {
        if (this.player.state === 'HACKING') {
            this.player.state = 'IDLE';
            this.activeLink = null;
            this.hideNoisePreview();
        }
        if (this.player.state !== 'IDLE') return;

        this.hideBubble();
        this.clearLinkHighlight();
        this.hideNoisePreview();

        const target = this.getNode(link.to);
        if(!target) return;

        this.player.state = 'MOVING';
        this.player.targetNode = target;
        this.player.currentLink = link;
        this.player.moveStartTime = performance.now();
        this.player.moveDuration = (link.cost || 1) * 1000;

        if (!link.isHidden) {
            this.noiseRing = document.createElement('div');
            this.noiseRing.className = 'noise-ring';
            this.noiseRing.style.width = (this.NOISE_RADIUS * 2) + '%';
            this.noiseRing.style.height = (this.NOISE_RADIUS * 2) + '%';
            this.domEntities.appendChild(this.noiseRing);
        }

        this.domActions.innerHTML = `<button class="btn-opt" disabled>... ${this.t('btn_move')} ...</button>`;
        this.domPlayer.style.transition = `left ${this.player.moveDuration}ms linear, top ${this.player.moveDuration}ms linear`;
        if (link.isHidden) this.domPlayer.classList.add('sneaking');

        requestAnimationFrame(() => {
            this.domPlayer.style.left = target.x + '%'; this.domPlayer.style.top = target.y + '%';
        });

        setTimeout(() => {
            if (!this.isGameOver) {
                this.domPlayer.style.transition = 'none';
                if (this.noiseRing) { this.noiseRing.remove(); this.noiseRing = null; }
                this.setPlayerNode(target);
            }
        }, this.player.moveDuration);
    }

    updatePhoneOptions() {
        this.domActions.innerHTML = '';
        const validLinks = this.levelData.links.filter(l => l.from === this.player.nodeId);

        if (validLinks.length === 0) {
            this.addLog(this.t('dead_end'), 'alert');
            return;
        }

        validLinks.forEach(link => {
            const btn = document.createElement('button');
            btn.dataset.lid = link.id;

            let btnClass = link.isHidden ? 'btn-opt btn-sneak' : 'btn-opt btn-run';
            let icon = link.isHidden ? '🔵' : '🏃';
            let isLocked = false;
            let statusText = `${link.cost}s`;

            const currentProgress = this.linkProgress[link.id] || 0;

            if (link.interaction === 'key') {
                if (this.inventory.includes(link.paramId)) { icon = '🔓'; }
                else { isLocked = true; icon = '🔒'; btnClass = 'btn-opt btn-locked'; statusText = this.t('btn_need_item'); }
            } else if (link.interaction === 'locked') {
                isLocked = true; icon = '🚫'; btnClass = 'btn-opt btn-locked'; statusText = this.t('btn_locked');
            } else if (link.interaction === 'hack') {
                icon = '⚡'; btnClass = 'btn-opt';
                if (currentProgress > 0) statusText = `${this.t('btn_progress')}: ${currentProgress.toFixed(0)}%`;
                else statusText = this.t('btn_need_hack');
            }

            btn.className = btnClass;
            const displayText = link.btnText || this.t('btn_move');
            btn.innerHTML = `<span><span class="btn-icon">${icon}</span> ${displayText}</span><span class="btn-cost">${statusText}</span>`;

            if (currentProgress > 0 && currentProgress < 100 && link.interaction === 'hack') {
                btn.style.background = `linear-gradient(90deg, #1e293b ${currentProgress}%, #eee ${currentProgress}%)`;
                btn.style.color = currentProgress > 50 ? '#fff' : '#000';
            }

            if (isLocked) {
                btn.disabled = true;
            } else {
                if (link.interaction === 'hack') {
                    btn.onclick = () => this.toggleHack(link);
                } else {
                    btn.onclick = () => this.executeMove(link);
                }

                btn.onmouseenter = () => {
                    this.highlightLink(link);
                    if (!link.isHidden || link.interaction === 'hack') this.showNoisePreview();
                };
                btn.onmouseleave = () => {
                    this.clearLinkHighlight();
                    if (this.player.state !== 'HACKING') this.hideNoisePreview();
                };
            }
            this.domActions.appendChild(btn);
        });
    }

    highlightLink(link) {
        const line = this.domSvg.querySelector(`.link-line[data-id="${link.id}"]`);
        if (line) line.classList.add('active');
        const targetNode = this.domEntities.querySelector(`.node[data-id="${link.to}"]`);
        if (targetNode) targetNode.classList.add('active');
    }

    clearLinkHighlight() {
        this.domSvg.querySelectorAll('.link-line.active').forEach(el => el.classList.remove('active'));
        this.domEntities.querySelectorAll('.node.active').forEach(el => el.classList.remove('active'));
    }

    updateGuards(dt) {
        this.guards.forEach(g => {
            let targetX, targetY;
            if (g.state === 'HUNT') {
                targetX = this.player.x; targetY = this.player.y;
            } else {
                if (!g.path || g.path.length < 2) {
                    g.dom.style.left = g.x + '%'; g.dom.style.top = g.y + '%'; return;
                }
                const pt = g.path[g.targetIndex];
                targetX = pt.x; targetY = pt.y;
            }

            const dx = targetX - g.x; const dy = targetY - g.y;
            const dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < 0.5) {
                if (g.state === 'PATROL') {
                    g.x = targetX; g.y = targetY;
                    g.targetIndex = (g.targetIndex + 1) % g.path.length;
                }
            } else {
                const moveStep = g.speed * dt;
                g.x += (dx / dist) * moveStep;
                g.y += (dy / dist) * moveStep;
            }
            g.dom.style.left = g.x + '%'; g.dom.style.top = g.y + '%';
        });
    }

    updatePlayer(dt) {
        if (this.player.state === 'MOVING') {
            const now = performance.now();
            const elapsed = now - this.player.moveStartTime;
            const progress = Math.min(elapsed / this.player.moveDuration, 1);

            const startNode = this.getNode(this.player.nodeId);
            const endNode = this.player.targetNode;

            const curX = startNode.x + (endNode.x - startNode.x) * progress;
            const curY = startNode.y + (endNode.y - startNode.y) * progress;

            this.player.x = curX;
            this.player.y = curY;

            if (this.noiseRing) {
                this.noiseRing.style.left = curX + '%';
                this.noiseRing.style.top = curY + '%';
            }

            if (this.domThoughtBubble) {
                this.domThoughtBubble.style.left = curX + '%';
                this.domThoughtBubble.style.top = curY + '%';
            }

            return;
        }

        if (this.isPanicMode && this.player.state === 'IDLE' && !this.isGameOver) {
            this.panicFleeDecision();
        }
    }

    panicFleeDecision() {
        const validLinks = this.levelData.links.filter(l => l.from === this.player.nodeId);
        if (validLinks.length === 0) return;

        let nearestGuard = this.guards.find(g => g.state === 'HUNT');
        if (!nearestGuard) return;

        let bestLink = null;
        let maxDist = -1;

        const currentDist = Math.sqrt(Math.pow(this.player.x - nearestGuard.x, 2) + Math.pow(this.player.y - nearestGuard.y, 2));

        validLinks.forEach(link => {
            const targetNode = this.getNode(link.to);
            if (!targetNode) return;
            const distAfterMove = Math.sqrt(Math.pow(targetNode.x - nearestGuard.x, 2) + Math.pow(targetNode.y - nearestGuard.y, 2));
            if (distAfterMove > currentDist && distAfterMove > maxDist) {
                maxDist = distAfterMove;
                bestLink = link;
            }
        });

        if (bestLink) {
            const originalCost = bestLink.cost;
            bestLink.cost = Math.max(0.5, originalCost * 0.7);
            this.executeMove(bestLink);
            bestLink.cost = originalCost;
        }
    }

    updatePlayerPosition(x, y) {
        this.player.x = x;
        this.player.y = y;

        if (this.noiseRing) {
            this.noiseRing.style.left = x + '%';
            this.noiseRing.style.top = y + '%';
        }
        if (this.domThoughtBubble) {
            this.domThoughtBubble.style.left = x + '%';
            this.domThoughtBubble.style.top = y + '%';
        }
    }

    updateFog() {
        const px = this.player.x; const py = this.player.y;
        const staticEls = this.domEntities.querySelectorAll('.zone, .obstacle, .node');
        staticEls.forEach(el => {
            if(!el.dataset.x) return;
            const dist = Math.sqrt(Math.pow(px - el.dataset.x, 2) + Math.pow(py - el.dataset.y, 2));
            el.classList.remove('fog-dim', 'fog-hidden');
            if (dist > this.fog.radius) el.classList.add('fog-dim');
        });
        const lines = this.domSvg.querySelectorAll('.link-line');
        lines.forEach(line => {
            if(!line.dataset.cx) return;
            const dist = Math.sqrt(Math.pow(px - line.dataset.cx, 2) + Math.pow(py - line.dataset.cy, 2));
            line.classList.remove('fog-dim', 'fog-hidden');
            if (dist > this.fog.radius) line.classList.add('fog-dim');
        });
        this.guards.forEach(g => {
            if (g.state === 'HUNT') { g.dom.classList.remove('fog-hidden', 'fog-dim'); return; }
            const dist = Math.sqrt(Math.pow(px - g.x, 2) + Math.pow(py - g.y, 2));
            g.dom.classList.remove('fog-hidden');
            if (dist > this.fog.radius) g.dom.classList.add('fog-hidden');
        });
    }

    getNode(id) { return this.levelData.elements.find(e => e.id === id); }

    async addLog(text, type = 'npc') {
        if(!this.domChat) return;
        const div = document.createElement('div');
        div.className = `msg ${type} typing`;
        this.domChat.appendChild(div);
        this.domChat.scrollTop = this.domChat.scrollHeight;
        const chars = text.split('');
        for (let char of chars) {
            div.innerText += char;
            await new Promise(r => setTimeout(r, Math.random() * 20 + 10));
        }
        div.classList.remove('typing');
    }

    updateInventoryUi() {
        this.domInv.innerHTML = '';
        this.inventory.forEach(i => {
            const s = document.createElement('span'); s.className='key-icon'; s.innerText='🔑'; this.domInv.appendChild(s);
        });
    }

    // =========================================================================
    // ★★★ 小游戏相关逻辑 ★★★
    // =========================================================================

    showMiniGameEntry(node) {
        this.domActions.innerHTML = '';

        const btn = document.createElement('button');
        btn.className = 'btn-opt btn-minigame';
        btn.innerHTML = `
            <span><span class="btn-icon">🎮</span> ${node.minigameName || this.t('btn_minigame') || '进入小游戏'}</span>
            <span class="btn-cost">READY</span>
        `;
        btn.onclick = () => this.startMiniGame(node);
        this.domActions.appendChild(btn);
    }

    startMiniGame(node) {
        const gameId = node.minigameId || 'default';
        console.log('[Engine] 🎮 启动小游戏:', gameId);

        if (window.MiniGameManager) {
            window.MiniGameManager.start(gameId, {
                node: node,
                inventory: this.inventory,
                onComplete: (result) => this.onMiniGameComplete(result),
                onExit: () => this.onMiniGameExit()
            });
        } else {
            this.addLog('[SYSTEM] MiniGame module not loaded yet.', 'system');
            console.warn('[Engine] MiniGameManager 未加载');
        }
    }

    // ★★★ 核心修改：剧情演出与永久锁定 ★★★
    async onMiniGameComplete(result) {
        if (!result || !result.success) return;

        console.log('[剧情] 小游戏完成，开始演出...');

        // 1. 获取配置 (从 window.HackerConfig 读取当前语言)
        const config = window.HackerConfig || {};
        const script = config.lockdown_script || [];
        const btnText = config.lockdown_btn || "⚠ UPLOADING... ⚠";

        // 2. 锁定操作按钮
        this.domActions.innerHTML = `<button class="btn-opt" disabled>${btnText}</button>`;

        // 3. 执行剧本 (build.js 已处理多语言，直接遍历即可)
        for (let line of script) {
            await this.addLog(line.text, line.type);
            await this.delay(line.delay);
        }

        // 4. 视觉干扰演出
        await this.addLog("SYSTEM: REMOTE HOST INITIATED DISCONNECT...", "system");
        document.querySelector('.monitor-wrapper').classList.add('shaking');
        const glitch = document.getElementById('glitchLayer');
        if(glitch) { glitch.style.opacity = 0.8; glitch.style.filter = "contrast(200%) hue-rotate(90deg)"; }

        const signalLayer = document.getElementById('signalLostLayer');
        if (signalLayer) { signalLayer.classList.remove('hidden'); setTimeout(() => signalLayer.classList.add('visible'), 50); }

        await this.delay(2000);

        // 5. 写入“死档”
        if (window.SaveManager) {
            window.SaveManager.save({
                levelId: 'LOCKED_STATE',
                nodeId: 'final',
                inventory: this.inventory,
                saveType: 'lockdown'
            });
        }

        // 6. 显示锁定页
        this.showFinalLockScreen();
    }

    onMiniGameExit() {
        console.log('[Engine] 小游戏退出');
        const currentNode = this.getNode(this.player.nodeId);
        if (currentNode && currentNode.nodeType === 'minigame') {
            this.showMiniGameEntry(currentNode);
        } else {
            this.updatePhoneOptions();
        }
    }

    // 显示锁定屏幕的辅助方法
    showFinalLockScreen() {
        // 停止背景音乐
        this.stopBgm();

        const lockScreen = document.getElementById('finalLockScreen');
        if (lockScreen) {
            lockScreen.classList.remove('hidden');
            void lockScreen.offsetWidth; // 强制重绘
            lockScreen.classList.add('visible');
        }
        if (this.domActions) this.domActions.innerHTML = '';
        this.isGameOver = true;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // =========================================================================
    // ★★★ 背景音乐控制 ★★★
    // =========================================================================
    startBgm() {
        if (this.bgm && !this.bgmStarted) {
            this.bgm.volume = 0.5;
            this.bgm.play().catch(e => console.log('[BGM] 等待用户交互'));
            this.bgmStarted = true;
        }
    }

    stopBgm() {
        if (this.bgm) {
            this.bgm.pause();
            this.bgm.currentTime = 0;
            this.bgmStarted = false;
        }
    }

    // =========================================================================
    // ★★★ 调试功能 ★★★
    // =========================================================================
    skipLevel() {
        const nextLevelId = this.levelData?.nextLevel;
        if (nextLevelId && this.levelLibrary[nextLevelId]) {
            console.log(`[DEBUG] Skipping to: ${nextLevelId}`);
            this.loadLevel(nextLevelId);
        } else {
            // 没有下一关时，显示所有可用关卡
            const allLevels = Object.keys(this.levelLibrary);
            const choice = prompt(
                `当前已是最后一关。\n可用关卡: ${allLevels.join(', ')}\n\n输入关卡ID跳转:`
            );
            if (choice && this.levelLibrary[choice]) {
                this.loadLevel(choice);
            }
        }
    }

    // =========================================================================
    // ★★★ 跳过游戏功能（面向玩家） ★★★
    // =========================================================================
    
    // 显示确认弹窗
    showSkipConfirm() {
        const modal = document.getElementById('skipConfirmModal');
        if (modal) {
            modal.classList.remove('hidden');
            // 强制重绘后添加 visible 类，触发过渡动画
            requestAnimationFrame(() => {
                modal.classList.add('visible');
            });
        }
    }
    
    // 隐藏确认弹窗
    hideSkipConfirm() {
        const modal = document.getElementById('skipConfirmModal');
        if (modal) {
            modal.classList.remove('visible');
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300); // 等待过渡动画完成
        }
    }
    
    // 确认跳过 - 执行实际跳转
    confirmSkipToMiniGame() {
        this.hideSkipConfirm();
        
        // 给一个短暂延迟，让弹窗关闭动画完成
        setTimeout(() => {
            this.skipToMiniGame();
        }, 350);
    }

    // 直接跳到小游戏节点
    skipToMiniGame() {
        // 1. 先在当前关卡查找 minigame 节点
        let targetNodeId = null;
        let targetLevelId = this.currentLevelId;

        const currentMiniGame = this.levelData?.elements?.find(e => e.type === 'node' && e.nodeType === 'minigame');
        if (currentMiniGame) {
            targetNodeId = currentMiniGame.id;
        }

        // 2. 如果当前关卡没有，遍历所有关卡查找
        if (!targetNodeId) {
            for (let levelId in this.levelLibrary) {
                const level = this.levelLibrary[levelId];
                const found = level.elements?.find(e => e.type === 'node' && e.nodeType === 'minigame');
                if (found) {
                    targetNodeId = found.id;
                    targetLevelId = levelId;
                    break;
                }
            }
        }

        // 3. 找到了，执行跳转
        if (targetNodeId) {
            console.log(`[Skip] 跳转到小游戏节点: ${targetNodeId} (关卡: ${targetLevelId})`);

            // 如果不是当前关卡，先加载目标关卡
            if (targetLevelId !== this.currentLevelId) {
                this.loadLevel(targetLevelId);
            }

            // 从new levelData 中重新获取节点（因为 loadLevel 会深拷贝）
            const targetNode = this.getNode(targetNodeId);
            if (!targetNode) {
                console.error('[Skip] 跳转失败：节点不存在');
                return;
            }

            // 重置游戏状态
            this.isGameOver = false;
            this.stopPanic();

            // 直接传送玩家到小游戏节点
            this.player.nodeId = targetNode.id;
            this.player.x = targetNode.x;
            this.player.y = targetNode.y;
            this.player.state = 'IDLE';

            if (this.domPlayer) {
                this.domPlayer.style.transition = 'none';
                this.domPlayer.style.left = targetNode.x + '%';
                this.domPlayer.style.top = targetNode.y + '%';
                this.domPlayer.style.backgroundColor = '';
                this.domPlayer.style.boxShadow = '';
            }

            // 触发小游戏入口
            this.addLog('[SYSTEM] 已跳过至下一阶段', 'system');
            this.showMiniGameEntry(targetNode);
            this.handleIdleThought(targetNode);

        } else {
            console.warn('[Skip] 未找到任何 minigame 节点');
            this.addLog('[SYSTEM] 本关没有可跳过的内容', 'system');
        }
    }
}
