/**
 * Terminal Mini-Game Engine v2.0
 * 终端小游戏引擎 - 模块化重构版
 * 
 * 从 window.TerminalMiniGameConfig 读取配置
 * 支持多关卡配置和多语言
 */

const TerminalGame = (function() {
    'use strict';

    // ===========================================
    // 配置引用
    // ===========================================
    let CONFIG = null;
    let FILE_SYSTEM = null;
    let UI_TEXT = null;

    // ===========================================
    // 游戏状态
    // ===========================================
    let currentLang = 'cn';
    let currentPath = '/';
    let commandHistory = [];
    let historyIndex = -1;
    let decryptedPaths = {};
    let matrixGameActive = false;
    let currentDecryptPath = null;
    let currentDecryptLevels = null;
    let isInputHandlersSetup = false;

    // [新增] 权限与输入状态机
    let currentUser = 'guest';      // 当前身份: 'guest' | 'root'
    let adminPassword = null;       // 破解成功后存储的正确密码
    let inputState = 'COMMAND';     // 输入模式: 'COMMAND'(命令) | 'PASSWORD'(密码)
    let tempTargetUser = null;      // 记录正在给谁改密码
    let currentLevelConfig = null;  // 保存当前关卡配置，用于切换语言刷新侧边栏
    let currentLevelMeta = {};

    // Matrix 游戏状态
    let matrixState = {
        currentLevel: 0,
        totalLevels: 1,
        grid: [],
        targetSeq: [],
        buffer: [],
        bufferSize: 5,
        axis: 0,
        lastIndex: { r: 0, c: -1 },
        selectedCells: new Set(),
        timerInterval: null,
        timeLeft: 0,
        hasStarted: false
    };

    // DOM 引用
    let outputEl = null;
    let inputEl = null;
    let promptEl = null;

    let startupTimer = null;

    // ===========================================
    // 多语言系统
    // ===========================================
    function setLanguage(lang) {
        currentLang = lang;
        document.body.classList.remove('lang-cn', 'lang-en');
        document.body.classList.add('lang-' + lang);
        localStorage.setItem('app_lang', lang);

        const btnCn = document.getElementById('btn-cn');
        const btnEn = document.getElementById('btn-en');
        if (btnCn) btnCn.classList.toggle('active', lang === 'cn');
        if (btnEn) btnEn.classList.toggle('active', lang === 'en');
        if (currentLevelConfig) {
            updateSidebarInfo(currentLevelConfig);
        }
    }

    async function toggleLanguage() {
        const newLang = currentLang === 'cn' ? 'en' : 'cn';
        
        // 重新加载对应语言的配置文件
        if (window.reloadConfig) {
            await window.reloadConfig(newLang);
            
            // 更新本地配置引用
            CONFIG = window.TerminalMiniGameConfig || CONFIG;
            UI_TEXT = CONFIG?.ui || {};
            
            // 重新加载当前关卡配置
            const targetLevelId = currentLevelMeta?.levelId || 'default';
            const levelConfig = CONFIG?.levels?.[targetLevelId] || CONFIG?.levels?.default;
            if (levelConfig) {
                currentLevelConfig = levelConfig;
                FILE_SYSTEM = levelConfig.fileSystem || FILE_SYSTEM;
                currentLevelMeta = levelConfig.meta || currentLevelMeta;
            }
        }
        
        setLanguage(newLang);
    }

    /**
     * 获取多语言文本
     * @param {string} key - 文本键名
     * @param {string} fallback - 后备文本
     */
    function t(key, fallback) {
        if (UI_TEXT && UI_TEXT[key]) {
            return UI_TEXT[key];
        }
        return fallback || key;
    }

    /**
     * 获取中英文文本
     * @param {string} cnText - 中文
     * @param {string} enText - 英文
     */
    function tt(cnText, enText) {
        return currentLang === 'cn' ? cnText : enText;
    }

    // ===========================================
    // 终端输出函数
    // ===========================================
    function print(text, className = '') {
        const line = document.createElement('div');
        line.className = 'output-line ' + className;
        line.innerHTML = text;
        outputEl.appendChild(line);
        outputEl.scrollTop = outputEl.scrollHeight;
    }

    function printAscii(text) {
        const line = document.createElement('div');
        line.className = 'output-line ascii-art';
        line.textContent = text;
        outputEl.appendChild(line);
        outputEl.scrollTop = outputEl.scrollHeight;
    }

    function clearOutput() {
        outputEl.innerHTML = '';
    }

    // [新增] 更新侧边栏任务信息
    function updateSidebarInfo(levelConfig) {
        if (!levelConfig || !levelConfig.sidebar) return;

        const sidebar = levelConfig.sidebar;
        const objBox = document.querySelector('.objective-box');

        if (objBox) {
            // 解析中英文
            let objText = '', targetText = '';

            if (typeof sidebar.objective === 'object') {
                objText = currentLang === 'cn' ? sidebar.objective.cn : sidebar.objective.en;
            } else {
                objText = sidebar.objective || '';
            }

            if (sidebar.target && typeof sidebar.target === 'object') {
                targetText = currentLang === 'cn' ? sidebar.target.cn : sidebar.target.en;
            } else {
                targetText = sidebar.target || '';
            }

            // 更新 HTML
            objBox.innerHTML = `
                <span class="lang-cn-only">${currentLang === 'cn' ? '任务目标' : 'OBJECTIVE'}</span>
                <span class="lang-en-only">${currentLang === 'en' ? 'OBJECTIVE' : '任务目标'}</span>
                
                <div class="objective-desc" style="margin-top:8px; color:#c0c0c0; font-size:12px; line-height:1.4;">
                    ${objText}
                </div>
                
                <div class="target-file" style="margin-top:8px; color:var(--accent-red); font-weight:bold; font-size:13px; text-shadow: 0 0 5px rgba(255, 50, 50, 0.3);">
                    ${targetText}
                </div>
            `;
        }
    }

    // [修改后] updatePrompt 函数
    function updatePrompt() {
        const displayPath = currentPath === '/' ? '/' : currentPath;

        // 1. 动态获取目标管理员名字（优先读取 YAML 配置，没有则默认为 root）
        const targetAdmin = (currentLevelMeta && currentLevelMeta.targetFileName) || 'root';

        // 2. 判定条件改为对比 targetAdmin
        if (currentUser === targetAdmin) {
            // 3. 提示符动态显示当前用户名
            promptEl.innerHTML = `<span style="color:#ff3333">${currentUser}@server</span>:${displayPath}<span style="color:#ff3333">#</span>`;
        } else {
            promptEl.textContent = `guest@server:${displayPath}$`;
        }
    }

    // ===========================================
    // 文件系统函数
    // ===========================================
    function resolvePath(input) {
        if (input.startsWith('/')) return input;
        if (currentPath === '/') return '/' + input;
        return currentPath + '/' + input;
    }

    function getNode(path) {
        path = path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        return FILE_SYSTEM[path];
    }

    function getCurrentFolder() {
        return getNode(currentPath);
    }

    function isPathDecrypted(path) {
        return decryptedPaths[path] === true;
    }

    // ===========================================
    // 命令处理器
    // ===========================================
    function cmdWhere() {
        const displayPath = currentPath === '/' ? '/' : currentPath;
        print(tt(`📍 当前位置: ${displayPath}`, `📍 Current location: ${displayPath}`), 'info');
    }

    function cmdLook() {
        const folder = getCurrentFolder();

        if (!folder || !folder.children || folder.children.length === 0) {
            print(tt('(这里什么都没有)', '(Nothing here)'), 'system');
            return;
        }

        print(tt('正在扫描当前目录...', 'Scanning current directory...'), 'system');
        print('', '');

        folder.children.forEach(child => {
            const childPath = currentPath === '/' ? '/' + child : currentPath + '/' + child;
            const childNode = getNode(childPath);

            let icon = '';
            let label = '';
            let cssClass = '';

            if (childNode.type === 'folder') {
                if (childNode.encrypted && !isPathDecrypted(childPath)) {
                    if (childNode.encryptLevel === 3) {
                        icon = '🔐';
                        label = tt('[高强度加密]', '[High Encryption]');
                    } else {
                        icon = '🔒';
                        label = tt('[已加密]', '[Encrypted]');
                    }
                    cssClass = 'warning';
                } else {
                    icon = '📁';
                    label = tt('[文件夹]', '[Folder]');
                    cssClass = 'info';
                }
            } else {
                if (childNode.encrypted && !isPathDecrypted(childPath)) {
                    if (childNode.encryptLevel === 3) {
                        icon = '🔐';
                        label = tt('[高强度加密]', '[High Encryption]');
                    } else {
                        icon = '🔒';
                        label = tt('[已加密]', '[Encrypted]');
                    }
                    cssClass = 'warning';
                } else if (childNode.isTarget) {
                    icon = '⭐';
                    label = tt('[目标文件]', '[Target]');
                    cssClass = 'success';
                } else {
                    icon = '📄';
                    label = tt('[文件]', '[File]');
                    cssClass = '';
                }
            }

            const name = child + (childNode.type === 'folder' ? '/' : '');
            print(`  ${icon} ${name}  <span style="opacity: 0.6">${label}</span>`, cssClass);
        });

        print('', '');
    }

    function cmdOpen(target) {
        if (!target) {
            print(tt('[错误] 用法: open <目录/文件名>', '[ERROR] Usage: open <folder/filename>'), 'error');
            return;
        }

        const fullPath = resolvePath(target.replace(/\/$/, ''));
        const node = getNode(fullPath);

        if (!node) {
            print(tt(`[错误] 未找到: ${target}`, `[ERROR] Not found: ${target}`), 'error');
            return;
        }

        if (node.type === 'folder') {
            if (node.encrypted && !isPathDecrypted(fullPath)) {
                print(tt('[拒绝访问] 目录已加密', '[ACCESS DENIED] Directory is encrypted'), 'error');
                print(tt(`使用 'decrypt ${target}' 解锁此目录`, `Use 'decrypt ${target}' to unlock`), 'warning');
                return;
            }

            currentPath = fullPath;
            updatePrompt();
            print(tt(`已进入: ${fullPath}`, `Entered: ${fullPath}`), 'system');

            const children = node.children;
            if (children && children.length > 0) {
                const listDiv = document.createElement('div');
                listDiv.className = 'dir-listing';

                children.forEach(child => {
                    const childPath = fullPath === '/' ? '/' + child : fullPath + '/' + child;
                    const childNode = getNode(childPath);
                    const item = document.createElement('div');
                    item.className = 'dir-item';

                    if (childNode.type === 'folder') {
                        if (childNode.encrypted && !isPathDecrypted(childPath)) {
                            item.classList.add(childNode.encryptLevel === 3 ? 'encrypted-high' : 'encrypted');
                        } else {
                            item.classList.add('folder');
                        }
                    } else {
                        if (childNode.encrypted && !isPathDecrypted(childPath)) {
                            item.classList.add(childNode.encryptLevel === 3 ? 'encrypted-high' : 'encrypted');
                        } else if (childNode.isTarget) {
                            item.classList.add('target');
                        } else {
                            item.classList.add('file');
                        }
                    }
                    item.textContent = child + (childNode.type === 'folder' ? '/' : '');
                    listDiv.appendChild(item);
                });

                outputEl.appendChild(listDiv);
                outputEl.scrollTop = outputEl.scrollHeight;
            } else {
                print(tt('(空目录)', '(empty directory)'), 'system');
            }
        } else {
            if (node.encrypted && !isPathDecrypted(fullPath)) {
                print(tt('[拒绝访问] 文件已加密', '[ACCESS DENIED] File is encrypted'), 'error');
                print(tt(`使用 'decrypt ${target}' 解锁此文件`, `Use 'decrypt ${target}' to unlock`), 'warning');
                return;
            }

            print(`── ${target} ──`, 'info');
            const content = getFileContent(node);
            print(content.replace(/\n/g, '<br>'), 'file-content');
            print('── EOF ──', 'info');
        }
    }

    function cmdBack() {
        if (currentPath === '/') {
            print(tt('[提示] 已在根目录', '[INFO] Already at root'), 'system');
            return;
        }

        const parts = currentPath.split('/').filter(p => p);
        parts.pop();
        currentPath = '/' + parts.join('/') || '/';
        updatePrompt();
        print(tt(`返回: ${currentPath}`, `Returned to: ${currentPath}`), 'system');
    }

    function cmdDownload(target) {
        if (!target) {
            print(tt('[错误] 用法: download <文件名>', '[ERROR] Usage: download <filename>'), 'error');
            return;
        }

        const fullPath = resolvePath(target);
        const node = getNode(fullPath);

        if (!node) {
            print(tt(`[错误] 未找到: ${target}`, `[ERROR] Not found: ${target}`), 'error');
            return;
        }

        if (node.type === 'folder') {
            print(tt('[错误] 无法下载文件夹', '[ERROR] Cannot download a folder'), 'error');
            return;
        }

        if (node.encrypted && !isPathDecrypted(fullPath)) {
            print(tt('[拒绝访问] 文件已加密，无法下载', '[ACCESS DENIED] File is encrypted, cannot download'), 'error');
            print(tt(`使用 'decrypt ${target}' 解锁此文件`, `Use 'decrypt ${target}' to unlock`), 'warning');
            return;
        }

        playDownloadAnimation(target, node.isTarget);
    }

    function playDownloadAnimation(filename, isTarget) {
        print(tt('[系统] 正在初始化安全传输...', '[SYSTEM] Initializing secure transfer...'), 'system');

        const progressDiv = document.createElement('div');
        progressDiv.className = 'download-progress';
        progressDiv.innerHTML = `
            <div class="progress-bar-container">
                <div class="progress-bar-fill" id="dl-progress"></div>
            </div>
            <div class="progress-text" id="dl-text">0%</div>
        `;
        outputEl.appendChild(progressDiv);
        outputEl.scrollTop = outputEl.scrollHeight;

        const progressBar = document.getElementById('dl-progress');
        const progressText = document.getElementById('dl-text');

        const stages = [
            { pct: 25, text: { cn: '建立加密隧道...', en: 'Establishing encrypted tunnel...' } },
            { pct: 50, text: { cn: '绕过防火墙...', en: 'Bypassing firewall...' } },
            { pct: 75, text: { cn: '检测到追踪程序，规避中...', en: 'Tracker detected, evading...' } },
            { pct: 100, text: { cn: '传输完成', en: 'Transfer complete' } }
        ];

        let stageIndex = 0;

        const interval = setInterval(() => {
            if (stageIndex >= stages.length) {
                clearInterval(interval);
                print('', '');
                print(tt(`>> ${filename} 已安全获取`, `>> ${filename} secured`), 'success');

                if (isTarget) {
                    print(tt('>> 断开连接...', '>> Disconnecting...'), 'success');
                    setTimeout(() => {
                        triggerMissionComplete();
                    }, 1000);
                }
                return;
            }

            const stage = stages[stageIndex];
            progressBar.style.width = stage.pct + '%';
            progressText.textContent = `${stage.pct}% - ${stage.text[currentLang]}`;
            stageIndex++;
        }, 800);
    }

    function cmdDecrypt(target) {
        if (!target) {
            print(tt('[错误] 用法: decrypt <目录/文件名>', '[ERROR] Usage: decrypt <folder/filename>'), 'error');
            return;
        }

        const fullPath = resolvePath(target.replace(/\/$/, ''));
        const node = getNode(fullPath);

        if (!node) {
            print(tt(`[错误] 未找到: ${target}`, `[ERROR] Not found: ${target}`), 'error');
            return;
        }

        if (!node.encrypted) {
            print(tt('[提示] 此目标未加密', '[INFO] Target is not encrypted'), 'system');
            return;
        }

        if (isPathDecrypted(fullPath)) {
            print(tt('[提示] 已解密', '[INFO] Already decrypted'), 'system');
            return;
        }

        const encryptLevel = node.encryptLevel || 1;
        currentDecryptPath = fullPath;

        print(tt('[系统] 启动解密协议...', '[SYSTEM] Initiating decryption protocol...'), 'system');

        if (encryptLevel === 1) {
            print(tt('[系统] 检测到 MATRIX_LOCK v1.0 - 单层加密', '[SYSTEM] Detected MATRIX_LOCK v1.0 - Single Layer'), 'warning');
            currentDecryptLevels = getMatrixLevels('level_1');
        } else {
            print(tt('[系统] 检测到 MATRIX_LOCK v3.0 - 三层加密', '[SYSTEM] Detected MATRIX_LOCK v3.0 - Triple Layer'), 'warning');
            currentDecryptLevels = getMatrixLevels('level_3');
        }

        setTimeout(() => {
            startMatrixGame();
        }, 500);
    }

    // [新增] 暴力破解指令
    function cmdCrack(arg) {
        if (!arg) {
            print(t('[错误] 用法: crack <文件路径>', '[ERROR] Usage: crack <filepath>'), 'error');
            return;
        }

        const fullPath = resolvePath(arg);
        const node = getNode(fullPath);
        const targetHashMarker = "$1$Gt5bD3kL";
        const truePassword = "ADMIN_2025";
        let isValidTarget = false;

        if (node && node.type === 'file') {
            if (node.encrypted && !isPathDecrypted(fullPath)) {
                print(t('[拒绝访问] 文件被加密锁定。', '[ACCESS DENIED] File encrypted.'), 'error');
                print(t(`提示：请先使用 'decrypt ${arg}'`, `Tip: Use 'decrypt ${arg}' first`), 'system');
                return;
            }
            if (getFileContent(node).includes(targetHashMarker)) {
                isValidTarget = true;
            }
        }

        if (!isValidTarget) {
            print(t(`[扫描] 目标 ${arg} 中未发现可破解的哈希值。`, `[SCAN] No crackable hash found in ${arg}.`), 'error');
            return;
        }

        // 动画逻辑
        inputEl.disabled = true;
        print(t('正在分析文件头... MD5 签名确认。', 'Analyzing header... MD5 signature confirmed.'), 'system');
        print(t('正在加载字典模块...', 'Loading dictionary module...'), 'warning');

        let attempts = 0;
        const maxAttempts = 30;
        const interval = setInterval(() => {
            attempts++;
            const randomPass = Math.random().toString(36).slice(-8).toUpperCase();
            print(`Testing: ${randomPass} ... [NO MATCH]`, 'output-line system');
            outputEl.scrollTop = outputEl.scrollHeight;

            if (attempts >= maxAttempts) {
                clearInterval(interval);
                adminPassword = truePassword; // 记录破解结果

                print('', '');
                print('╔══════════════════════════════════════╗', 'success');
                print(tt(`║  破解成功: 匹配项已找到              ║`, `║  CRACK SUCCESS: MATCH FOUND          ║`), 'success');
                print(`║  PASS: ${truePassword}                  ║`, 'success');
                print('╚══════════════════════════════════════╝', 'success');
                print(tt('凭证已缓存。可使用 su 提权。', 'Credentials cached. Ready for su escalation.'), 'info');

                inputEl.disabled = false;
                inputEl.focus();
            }
        }, 60);
    }

    // [修改后] cmdSu 函数
    function cmdSu(user) {
        if (!user) {
            print(t('用法: su <用户名>', 'Usage: su <username>'), 'system');
            return;
        }

        // 1. 动态获取目标管理员名字
        const targetAdmin = (currentLevelMeta && currentLevelMeta.targetFileName) || 'root';

        if (user === 'guest') {
            currentUser = 'guest';
            updatePrompt();
            print(t('已切换为 guest', 'Switched to guest'), 'system');
            return;
        }

        // 2. 判定条件改为对比 targetAdmin
        if (user === targetAdmin) {
            if (!adminPassword) {
                print(t('[错误] 认证失败：需要密码', '[ERROR] Auth failure: Password required'), 'error');
                return;
            }
            print(tt(`正在以 ${user} 身份验证...`, `Authenticating as ${user}...`), 'system');
            setTimeout(() => {
                print(t('访问被允许。', 'Access Granted.'), 'success');
                currentUser = user; // 设置为实际的用户名 (sysadmin)
                updatePrompt();
            }, 800);
        } else {
            // 3. 汉化提示信息：用户不存在
            print(t(`[错误] 用户 ${user} 不存在`, `User ${user} does not exist`), 'error');
        }
    }

    // [修改后] cmdPasswd 函数
    function cmdPasswd(targetUser) {
        // 1. 动态获取目标管理员名字
        const targetAdmin = (currentLevelMeta && currentLevelMeta.targetFileName) || 'root';

        // 2. 判定条件改为对比 targetAdmin
        if (currentUser !== targetAdmin) {
            print(t(`[拒绝访问] 只有 ${targetAdmin} 用户可以修改密码`, `[ACCESS DENIED] Only ${targetAdmin} can change passwords`), 'error');
            return;
        }

        if (!targetUser) {
            print(t('用法: passwd <用户名>', 'Usage: passwd <username>'), 'system');
            return;
        }

        // ... 后续输入密码逻辑保持不变 ...
        print(tt(`正在修改 ${targetUser} 的密码...`, `Changing password for ${targetUser}...`), 'system');
        print(tt('输入新的 UNIX 密码:', 'Enter new UNIX password:'), 'info');

        inputState = 'PASSWORD';
        tempTargetUser = targetUser;
        promptEl.textContent = 'Password:';
    }

    // [新增] 实际处理密码输入的逻辑
    function handlePasswordInput(password) {
        // 1. 验证非空
        if (!password || password.trim() === '') {
            print(tt('密码不能为空。请重试。', 'Password cannot be empty. Try again.'), 'error');
            print(tt('输入新的 UNIX 密码:', 'Enter new UNIX password:'), 'info');
            return; // 保持密码模式
        }

        // 2. 输入成功
        print(tt('passwd: 密码已成功更新', 'passwd: password updated successfully'), 'success');
        print(tt('[系统] 正在强制注销管理员会话...', '[SYSTEM] Forcing logout on admin sessions...'), 'warning');

        // 3. 恢复命令模式
        inputState = 'COMMAND';
        tempTargetUser = null;
        updatePrompt(); // 恢复提示符

        // 4. 触发胜利
        setTimeout(() => {
            triggerMissionComplete();
        }, 1500);
    }

    function cmdHelp() {
        print('╔══════════════════════════════════════════╗', 'info');
        print('║  ' + tt('可用命令列表', 'AVAILABLE COMMANDS') + '            ║', 'info');
        print('╠══════════════════════════════════════════╣', 'info');
        print('║  where           ' + tt('显示当前位置', 'Show location') + '       ║', 'info');
        print('║  look / ls       ' + tt('查看目录内容', 'List contents') + '       ║', 'info');
        print('║  open / cd <n>   ' + tt('打开目录/文件', 'Open folder/file') + '     ║', 'info');
        print('║  back            ' + tt('返回上级目录', 'Go to parent dir') + '     ║', 'info');
        print('║  download <file> ' + tt('下载文件', 'Download file') + '         ║', 'info');
        print('║  decrypt <path>  ' + tt('解密目录/文件', 'Decrypt target') + '     ║', 'info');
        print('║                                          ║', 'info');
        print('║  crack <file>    ' + tt('暴力破解哈希', 'Crack Hash') + '         ║', 'info');
        print('║  su <user>       ' + tt('切换用户身份', 'Switch User') + '        ║', 'info');
        print('║  passwd <user>   ' + tt('修改账户密码', 'Change Password') + '    ║', 'info');
        print('║                                          ║', 'info');
        print('║  clear           ' + tt('清空屏幕', 'Clear screen') + '           ║', 'info');
        print('║  help            ' + tt('显示此帮助', 'Show this help') + '        ║', 'info');
        print('╚══════════════════════════════════════════╝', 'info');
    }

    function cmdClear() {
        clearOutput();
    }

    // ===========================================
    // 文件内容获取
    // ===========================================
    function getFileContent(node) {
        if (!node.content) return '';
        
        // 如果配置已经被 build.js 处理过，content 直接是字符串
        if (typeof node.content === 'string') {
            return node.content;
        }
        
        // 否则是多语言对象
        return node.content[currentLang] || node.content.cn || '';
    }

    // ===========================================
    // Matrix 配置获取
    // ===========================================
    function getMatrixLevels(levelKey) {
        if (CONFIG && CONFIG.matrixLevels && CONFIG.matrixLevels[levelKey]) {
            return CONFIG.matrixLevels[levelKey];
        }
        
        // 默认配置
        const defaults = {
            level_1: [
                { gridSize: 5, seqLength: 4, bufferSize: 6, timeLimit: 15.0 }
            ],
            level_3: [
                { gridSize: 4, seqLength: 3, bufferSize: 5, timeLimit: 15.0 },
                { gridSize: 5, seqLength: 4, bufferSize: 6, timeLimit: 12.0 },
                { gridSize: 6, seqLength: 5, bufferSize: 7, timeLimit: 10.0 }
            ]
        };
        
        return defaults[levelKey] || defaults.level_1;
    }

    // ===========================================
    // MATRIX MINI-GAME
    // ===========================================
    function startMatrixGame() {
        matrixState.currentLevel = 0;
        matrixState.totalLevels = currentDecryptLevels.length;
        matrixGameActive = true;
        inputEl.disabled = true;
        loadMatrixLevel(0);
    }

    function loadMatrixLevel(levelIndex) {
        const config = currentDecryptLevels[levelIndex];
        matrixState.currentLevel = levelIndex;
        matrixState.grid = [];
        matrixState.targetSeq = [];
        matrixState.buffer = [];
        matrixState.bufferSize = config.bufferSize;
        matrixState.axis = 0;
        matrixState.lastIndex = { r: 0, c: -1 };
        matrixState.selectedCells = new Set();

        matrixState.timeLeft = config.timeLimit;
        matrixState.hasStarted = false;
        if (matrixState.timerInterval) clearInterval(matrixState.timerInterval);

        const hexChars = ['1C', '55', '7A', 'BD', 'E9', 'FF'];

        for (let r = 0; r < config.gridSize; r++) {
            let row = [];
            for (let c = 0; c < config.gridSize; c++) {
                row.push(hexChars[Math.floor(Math.random() * hexChars.length)]);
            }
            matrixState.grid.push(row);
        }

        matrixState.targetSeq = generateSolvableSequence(
            matrixState.grid,
            config.seqLength,
            config.gridSize
        );

        renderMatrixUI(config);
    }

    function generateSolvableSequence(grid, seqLength, gridSize) {
        let sequence = [];
        let axis = 0;
        let currentRow = 0;
        let currentCol = -1;
        let usedCells = new Set();

        for (let i = 0; i < seqLength; i++) {
            let validCells = [];

            if (axis === 0) {
                for (let c = 0; c < gridSize; c++) {
                    const key = `${currentRow},${c}`;
                    if (!usedCells.has(key)) {
                        validCells.push({ r: currentRow, c: c, val: grid[currentRow][c] });
                    }
                }
            } else {
                for (let r = 0; r < gridSize; r++) {
                    const key = `${r},${currentCol}`;
                    if (!usedCells.has(key)) {
                        validCells.push({ r: r, c: currentCol, val: grid[r][currentCol] });
                    }
                }
            }

            if (validCells.length === 0) break;

            const pick = validCells[Math.floor(Math.random() * validCells.length)];
            sequence.push(pick.val);
            usedCells.add(`${pick.r},${pick.c}`);
            currentRow = pick.r;
            currentCol = pick.c;
            axis = 1 - axis;
        }

        return sequence;
    }

    function startTimer() {
        if (matrixState.hasStarted) return;
        matrixState.hasStarted = true;

        const timerEl = document.getElementById('matrix-timer-val');

        matrixState.timerInterval = setInterval(() => {
            matrixState.timeLeft -= 0.1;
            if (timerEl) {
                timerEl.textContent = matrixState.timeLeft.toFixed(2);
            }

            if (matrixState.timeLeft <= 0) {
                clearInterval(matrixState.timerInterval);
                if (timerEl) timerEl.textContent = "0.00";
                matrixFailed(true);
            }
        }, 100);
    }

    function renderMatrixUI(config) {
        const container = document.createElement('div');
        container.className = 'matrix-container';
        container.id = 'matrix-container';

        const header = document.createElement('div');
        header.className = 'matrix-header';
        header.innerHTML = `
            <span class="matrix-level">${tt('解密层级', 'DECRYPTION LAYER')} ${matrixState.currentLevel + 1}/${matrixState.totalLevels}</span>
            <span style="color: #ff3333; font-weight: bold;">
                T-MINUS: <span id="matrix-timer-val">${config.timeLimit.toFixed(2)}</span>s
            </span>
            <span class="matrix-progress">${config.gridSize}×${config.gridSize} | ${tt('序列', 'SEQ')}: ${config.seqLength}</span>
        `;
        container.appendChild(header);

        const body = document.createElement('div');
        body.className = 'matrix-body';

        const left = document.createElement('div');
        left.className = 'matrix-left';

        // 目标序列
        const seqDisplay = document.createElement('div');
        seqDisplay.className = 'sequence-display';
        seqDisplay.innerHTML = `<div class="sequence-label">${tt('目标序列', 'TARGET SEQUENCE')}</div>`;
        const seqBoxes = document.createElement('div');
        seqBoxes.className = 'sequence-boxes';
        seqBoxes.id = 'target-seq-boxes';
        matrixState.targetSeq.forEach((val, i) => {
            const box = document.createElement('div');
            box.className = 'seq-box';
            box.textContent = val;
            box.dataset.index = i;
            seqBoxes.appendChild(box);
        });
        seqDisplay.appendChild(seqBoxes);
        left.appendChild(seqDisplay);

        // 缓冲区
        const bufDisplay = document.createElement('div');
        bufDisplay.className = 'buffer-display';
        bufDisplay.innerHTML = `<div class="sequence-label">${tt('缓冲区', 'BUFFER')} (${matrixState.bufferSize})</div>`;
        const bufBoxes = document.createElement('div');
        bufBoxes.className = 'buffer-boxes';
        bufBoxes.id = 'buffer-boxes';
        for (let i = 0; i < matrixState.bufferSize; i++) {
            const box = document.createElement('div');
            box.className = 'buf-box';
            box.dataset.index = i;
            bufBoxes.appendChild(box);
        }
        bufDisplay.appendChild(bufBoxes);
        left.appendChild(bufDisplay);

        body.appendChild(left);

        // 矩阵网格
        const gridDiv = document.createElement('div');
        gridDiv.className = 'matrix-grid';
        gridDiv.id = 'matrix-grid';
        gridDiv.style.gridTemplateColumns = `repeat(${config.gridSize}, 44px)`;

        matrixState.grid.forEach((row, r) => {
            row.forEach((val, c) => {
                const cell = document.createElement('div');
                cell.className = 'matrix-cell';
                cell.textContent = val;
                cell.dataset.r = r;
                cell.dataset.c = c;
                cell.onclick = () => handleMatrixClick(r, c, val, cell);
                gridDiv.appendChild(cell);
            });
        });

        body.appendChild(gridDiv);
        container.appendChild(body);

        const hint = document.createElement('div');
        hint.className = 'matrix-hint';
        hint.innerHTML = tt(
            '规则: 必须连续匹配目标序列。点击第一个方块开始计时。',
            'Rule: Match sequence continuously. Timer starts on first click.'
        );
        container.appendChild(hint);

        outputEl.appendChild(container);
        outputEl.scrollTop = outputEl.scrollHeight;

        updateMatrixHighlights();
    }

    function updateMatrixHighlights() {
        const cells = document.querySelectorAll('#matrix-grid .matrix-cell');
        cells.forEach(cell => {
            const r = parseInt(cell.dataset.r);
            const c = parseInt(cell.dataset.c);
            const key = `${r},${c}`;

            cell.classList.remove('active-zone', 'disabled');

            if (matrixState.selectedCells.has(key)) {
                return;
            }

            if (matrixState.lastIndex.c === -1) {
                if (r === 0) {
                    cell.classList.add('active-zone');
                } else {
                    cell.classList.add('disabled');
                }
            } else {
                if (matrixState.axis === 0) {
                    if (r === matrixState.lastIndex.r) cell.classList.add('active-zone');
                    else cell.classList.add('disabled');
                } else {
                    if (c === matrixState.lastIndex.c) cell.classList.add('active-zone');
                    else cell.classList.add('disabled');
                }
            }
        });

        const remaining = matrixState.bufferSize - matrixState.buffer.length;
        const bufBoxes = document.querySelectorAll('#buffer-boxes .buf-box');
        bufBoxes.forEach((box, i) => {
            if (i >= matrixState.buffer.length && remaining <= 2) {
                box.classList.add('overflow-warning');
            } else {
                box.classList.remove('overflow-warning');
            }
        });
    }

    function handleMatrixClick(r, c, val, cellElement) {
        if (!matrixGameActive) return;
        if (matrixState.selectedCells.has(`${r},${c}`)) return;
        if (!cellElement.classList.contains('active-zone')) return;

        if (!matrixState.hasStarted) {
            startTimer();
        }

        matrixState.buffer.push(val);
        matrixState.selectedCells.add(`${r},${c}`);
        cellElement.classList.add('selected');
        cellElement.classList.remove('active-zone');

        const bufBoxes = document.querySelectorAll('#buffer-boxes .buf-box');
        const bufIndex = matrixState.buffer.length - 1;
        if (bufBoxes[bufIndex]) {
            bufBoxes[bufIndex].textContent = val;
            bufBoxes[bufIndex].classList.add('filled');
        }

        const matchResult = checkSequenceMatch();

        matrixState.lastIndex = { r: r, c: c };
        matrixState.axis = 1 - matrixState.axis;

        if (matchResult === 'WIN') {
            matrixLevelComplete();
            return;
        }

        if (matrixState.buffer.length >= matrixState.bufferSize) {
            matrixFailed(false);
            return;
        }

        updateMatrixHighlights();
    }

    function checkSequenceMatch() {
        const targetStr = matrixState.targetSeq.join(',');
        const bufferStr = matrixState.buffer.join(',');

        if (bufferStr.includes(targetStr)) {
            const seqBoxes = document.querySelectorAll('#target-seq-boxes .seq-box');
            seqBoxes.forEach(box => box.classList.add('matched'));
            return 'WIN';
        }

        const seqBoxes = document.querySelectorAll('#target-seq-boxes .seq-box');
        seqBoxes.forEach(box => box.classList.remove('matched'));

        let matchCount = 0;
        const targetLen = matrixState.targetSeq.length;
        const bufferLen = matrixState.buffer.length;

        for (let len = Math.min(targetLen, bufferLen); len > 0; len--) {
            const subBuffer = matrixState.buffer.slice(bufferLen - len);
            const subTarget = matrixState.targetSeq.slice(0, len);
            if (subBuffer.join(',') === subTarget.join(',')) {
                matchCount = len;
                break;
            }
        }

        for (let i = 0; i < matchCount; i++) {
            seqBoxes[i].classList.add('matched');
        }

        return 'CONTINUE';
    }

    function matrixLevelComplete() {
        if (matrixState.timerInterval) clearInterval(matrixState.timerInterval);

        const container = document.getElementById('matrix-container');
        if (container) {
            container.style.borderColor = '#33ff33';
            container.style.boxShadow = '0 0 20px rgba(50, 255, 50, 0.3)';
        }

        print(tt(`[成功] 第 ${matrixState.currentLevel + 1} 层解密完成!`,
            `[SUCCESS] Layer ${matrixState.currentLevel + 1} decrypted!`), 'success');

        setTimeout(() => {
            if (container) container.remove();

            if (matrixState.currentLevel < matrixState.totalLevels - 1) {
                print(tt('[系统] 加载下一层加密...', '[SYSTEM] Loading next encryption layer...'), 'system');
                setTimeout(() => {
                    loadMatrixLevel(matrixState.currentLevel + 1);
                }, 800);
            } else {
                matrixGameComplete();
            }
        }, 1000);
    }

    function matrixFailed(isTimeout) {
        if (!matrixGameActive) return;
        matrixGameActive = false;

        if (matrixState.timerInterval) {
            clearInterval(matrixState.timerInterval);
            matrixState.timerInterval = null;
        }

        const container = document.getElementById('matrix-container');
        if (container) {
            container.style.borderColor = '#ff3333';
            container.style.boxShadow = '0 0 20px rgba(255, 50, 50, 0.3)';
        }

        const failMsg = isTimeout
            ? tt('[失败] 连接超时 - 追踪程序已锁定', '[FAILED] Connection Timeout - Trace complete')
            : tt('[失败] 缓冲区溢出 - 哈希验证失败', '[FAILED] Buffer overflow - Hash mismatch');

        print(failMsg, 'error');

        setTimeout(() => {
            if (matrixGameActive) return;
            if (container) container.remove();

            matrixState.hasStarted = false;

            inputEl.disabled = false;
            inputEl.focus();

            print(tt('[警告] 安全协议触发，连接已断开。', '[WARNING] Security protocol triggered. Connection dropped.'), 'warning');
            print(tt("请重新输入 'decrypt' 尝试建立新连接。", "Please re-enter 'decrypt' to attempt new connection."), 'system');

            updatePrompt();
        }, 1500);
    }

    function matrixGameComplete() {
        matrixGameActive = false;
        inputEl.disabled = false;
        inputEl.focus();

        decryptedPaths[currentDecryptPath] = true;

        const node = getNode(currentDecryptPath);
        const targetName = currentDecryptPath.split('/').pop();

        print('', '');
        printAscii('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
        printAscii('▓▓                                  ▓▓');
        printAscii('▓▓     ██ ACCESS GRANTED ██        ▓▓');
        printAscii('▓▓                                  ▓▓');
        printAscii('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
        print('', '');

        if (node.type === 'folder') {
            print(tt(`[系统] ${targetName}/ 目录已解锁`, `[SYSTEM] ${targetName}/ directory unlocked`), 'success');
            print(tt(`使用 'open ${targetName}' 进入目录`, `Use 'open ${targetName}' to enter directory`), 'info');
        } else {
            print(tt(`[系统] ${targetName} 文件已解锁`, `[SYSTEM] ${targetName} file unlocked`), 'success');
            print(tt(`使用 'open ${targetName}' 查看内容，或 'download ${targetName}' 下载`,
                `Use 'open ${targetName}' to view, or 'download ${targetName}' to download`), 'info');
        }

        currentDecryptPath = null;
        currentDecryptLevels = null;
    }

    // ===========================================
    // 任务完成
    // ===========================================
    function triggerMissionComplete() {
        document.getElementById('success-overlay').classList.add('visible');

        setTimeout(() => {
            console.log('[Terminal] Sending complete message to parent...');
            window.parent.postMessage({
                type: 'minigame-complete',
                result: { success: true }
            }, '*');
        }, 2000);
    }

    // ===========================================
    // TAB 补全
    // ===========================================
    function getCompletions(input) {
        const parts = input.trim().split(/\s+/);
        const commands = ['where', 'look', 'open', 'back', 'download', 'decrypt', 'clear', 'crack', 'su', 'passwd', 'help'];

        if (parts.length === 1) {
            const partial = parts[0].toLowerCase();
            return commands.filter(cmd => cmd.startsWith(partial));
        } else if (parts.length === 2) {
            const partial = parts[1].toLowerCase();
            const folder = getCurrentFolder();

            if (folder && folder.children) {
                return folder.children
                    .filter(name => name.toLowerCase().startsWith(partial))
                    .map(name => {
                        const fullPath = currentPath === '/' ? '/' + name : currentPath + '/' + name;
                        const node = getNode(fullPath);
                        return name + (node && node.type === 'folder' ? '/' : '');
                    });
            }
        }

        return [];
    }

    // ===========================================
    // 命令解析器
    // ===========================================
    function executeCommand(input) {
        const trimmed = input.trim();
        if (!trimmed) return;

        print(`<span style="color: var(--accent-cyan)">$</span> ${trimmed}`, '');

        commandHistory.push(trimmed);
        historyIndex = commandHistory.length;

        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1).join(' ');

        switch (cmd) {
            case 'where':
                cmdWhere();
                break;
            case 'look':
            case 'ls':
                cmdLook();
                break;
            case 'open':
            case 'cd':
                cmdOpen(args);
                break;
            case 'back':
                cmdBack();
                break;
            case 'download':
                cmdDownload(args);
                break;
            case 'decrypt':
                cmdDecrypt(args);
                break;
            case 'clear':
                cmdClear();
                break;
            case 'help':
                cmdHelp();
                break;
            case 'crack':
                cmdCrack(args);
                break;
            case 'su':
                cmdSu(args);
                break;
            case 'passwd':
                cmdPasswd(args);
                break;
            default:
                print(tt(`[错误] 未知命令: ${cmd}`, `[ERROR] Unknown command: ${cmd}`), 'error');
                print(tt("输入 'help' 查看可用命令", "Type 'help' for available commands"), 'system');
        }
    }

    // ===========================================
    // 输入事件处理
    // ===========================================
    function setupInputHandlers() {
        inputEl.onkeydown = function(e) {
            if (matrixGameActive) {
                e.preventDefault();
                return;
            }

            if (e.key === 'Enter') {
                e.preventDefault();
                const value = inputEl.value;
                inputEl.value = '';

                if (inputState === 'COMMAND') {
                    executeCommand(value);
                } else if (inputState === 'PASSWORD') {
                    handlePasswordInput(value);
                }
            } else if (e.key === 'Tab' && inputState === 'COMMAND') {
                e.preventDefault();
                const completions = getCompletions(inputEl.value);

                if (completions.length === 1) {
                    const parts = inputEl.value.trim().split(/\s+/);
                    if (parts.length === 1) {
                        inputEl.value = completions[0] + ' ';
                    } else {
                        inputEl.value = parts[0] + ' ' + completions[0];
                    }
                } else if (completions.length > 1) {
                    print(tt('可选: ', 'Options: ') + completions.join('  '), 'system');
                }
            } else if (e.key === 'ArrowUp' && inputState === 'COMMAND') {
                e.preventDefault();
                if (historyIndex > 0) {
                    historyIndex--;
                    inputEl.value = commandHistory[historyIndex];
                }
            } else if (e.key === 'ArrowDown' && inputState === 'COMMAND') {
                e.preventDefault();
                if (historyIndex < commandHistory.length - 1) {
                    historyIndex++;
                    inputEl.value = commandHistory[historyIndex];
                } else {
                    historyIndex = commandHistory.length;
                    inputEl.value = '';
                }
            }
        };

        document.addEventListener('click', function(e) {
            if (!e.target.closest('.manual-panel') && !matrixGameActive && inputEl) {
                inputEl.focus();
            }
        });
    }

    // ===========================================
    // 启动界面
    // ===========================================
    function renderStartup() {
        printAscii('   █████╗ ███╗   ██╗ ██████╗ ███╗   ███╗ █████╗ ██╗  ██╗   ██╗');
        printAscii('  ██╔══██╗████╗  ██║██╔═══██╗████╗ ████║██╔══██╗██║  ╚██╗ ██╔╝');
        printAscii('  ███████║██╔██╗ ██║██║   ██║██╔████╔██║███████║██║   ╚████╔╝ ');
        printAscii('  ██╔══██║██║╚██╗██║██║   ██║██║╚██╔╝██║██╔══██║██║    ╚██╔╝  ');
        printAscii('  ██║  ██║██║ ╚████║╚██████╔╝██║ ╚═╝ ██║██║  ██║███████╗██║   ');
        printAscii('  ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝   ');
        print('', '');
        print(tt('[系统] 远程连接已建立', '[SYSTEM] Remote connection established'), 'system');
        print(tt('[系统] 数据中心存档模式 - 2019年停止维护', '[SYSTEM] Data Center Archive Mode - Decommissioned 2019'), 'system');
        print('', '');

        startupTimer = setTimeout(() => {
            const hintCmd = currentLevelMeta.startHintCmd || 'open readme.txt';
            print(tt(`提示: 输入 '${hintCmd}' 阅读系统指引`,
                `Tip: Type '${hintCmd}' to read system guide`), 'info');
            print('', '');

            const folder = getCurrentFolder();
            if (folder && folder.children) {
                const listDiv = document.createElement('div');
                listDiv.className = 'dir-listing';

                folder.children.forEach(child => {
                    const childPath = '/' + child;
                    const childNode = getNode(childPath);
                    const item = document.createElement('div');
                    item.className = 'dir-item';

                    if (childNode.type === 'folder') {
                        if (childNode.encrypted) {
                            item.classList.add('encrypted');
                        } else {
                            item.classList.add('folder');
                        }
                    } else {
                        item.classList.add('file');
                    }
                    item.textContent = child + (childNode.type === 'folder' ? '/' : '');
                    listDiv.appendChild(item);
                });

                outputEl.appendChild(listDiv);
                outputEl.scrollTop = outputEl.scrollHeight;
            }

            startupTimer = null;
        }, 500);

        updatePrompt();
        inputEl.focus();
    }

    // ===========================================
    // 初始化
    // ===========================================
    async function init(initData) {
        console.log('[Terminal] Initializing with data:', initData);

        // 获取 DOM 引用
        outputEl = document.getElementById('terminal-output');
        inputEl = document.getElementById('terminal-input');
        promptEl = document.getElementById('prompt');

        if (!outputEl || !inputEl || !promptEl) {
            console.error('[Terminal] DOM elements not found!');
            return;
        }

        // 重置输入状态，防止上次游戏残留
        inputState = 'COMMAND';
        tempTargetUser = null;
        currentUser = 'guest';
        adminPassword = null;
        currentPath = '/';
        decryptedPaths = {};
        if(promptEl) promptEl.textContent = 'guest@server:/$';

        if (startupTimer) {
            clearTimeout(startupTimer);
            startupTimer = null;
        }
        clearOutput();

        // 【关键修复】确定目标语言并在需要时重新加载配置
        const targetLang = initData?.lang || localStorage.getItem('app_lang') || 'cn';
        if (targetLang !== currentLang && window.reloadConfig) {
            console.log(`[Terminal] 语言切换: ${currentLang} -> ${targetLang}, 重新加载配置...`);
            await window.reloadConfig(targetLang);
        }

        // 加载配置
        const injectedConfig = initData?.node?.config?.injectedLevelData;

        if (injectedConfig) {
            console.log('[Terminal] ✅ 成功接收父窗口注入的关卡配置');
            CONFIG = injectedConfig;
            window.TerminalMiniGameConfig = injectedConfig;
        } else {
            console.warn('[Terminal] ⚠️ 未检测到注入数据，回退到本地默认配置');
            CONFIG = window.TerminalMiniGameConfig || null;
        }

        let targetLevelId = 'default';

        if (initData?.levelId) {
            targetLevelId = initData.levelId;
        } else if (initData?.node?.config?.levelId) {
            targetLevelId = initData.node.config.levelId;
        }

        console.log(`[Terminal] Target Level ID identified: ${targetLevelId}`);

        if (CONFIG) {
            console.log('[Terminal] Config loaded from window.TerminalMiniGameConfig');
            UI_TEXT = CONFIG.ui || {};

            const levelConfig = CONFIG.levels?.[targetLevelId] || CONFIG.levels?.default;
            if (levelConfig && levelConfig.fileSystem) {
                currentLevelConfig = levelConfig;
                FILE_SYSTEM = levelConfig.fileSystem;
                currentLevelMeta = levelConfig.meta || {};
                updateSidebarInfo(levelConfig);
            } else {
                console.warn('[Terminal] No file system found in config, using default');
                FILE_SYSTEM = getDefaultFileSystem();
            }
        } else {
            console.warn('[Terminal] Config not found, using defaults');
            UI_TEXT = {};
            FILE_SYSTEM = getDefaultFileSystem();
        }

        // 设置语言
        setLanguage(targetLang);

        if (!isInputHandlersSetup) {
            setupInputHandlers();
            isInputHandlersSetup = true;
        }
        updateManualUI();

        // 渲染启动界面
        renderStartup();

        setTimeout(() => {
            if(inputEl) inputEl.focus();
        }, 100);
    }

    function updateManualUI() {
        const hintEl = document.querySelector('.start-hint-cmd');
        if (hintEl && currentLevelMeta.startHintCmd) {
            hintEl.textContent = currentLevelMeta.startHintCmd;
        }
    }

    // ===========================================
    // 默认文件系统（后备）
    // ===========================================
    function getDefaultFileSystem() {
        return {
            '/': {
                type: 'folder',
                children: ['readme.txt', 'notice', 'directory', 'logs', 'archives']
            },
            '/readme.txt': {
                type: 'file',
                content: tt(
                    '[系统] 配置文件未加载，使用默认配置。',
                    '[SYSTEM] Config not loaded, using defaults.'
                )
            },
            '/notice': {
                type: 'folder',
                encrypted: true,
                encryptLevel: 1,
                children: ['memo.txt']
            },
            '/notice/memo.txt': {
                type: 'file',
                content: tt('内部备忘录', 'Internal Memo')
            },
            '/directory': {
                type: 'folder',
                encrypted: true,
                encryptLevel: 1,
                children: ['staff.csv']
            },
            '/directory/staff.csv': {
                type: 'file',
                content: tt('员工列表', 'Staff List')
            },
            '/logs': {
                type: 'folder',
                encrypted: true,
                encryptLevel: 1,
                children: ['audit.log']
            },
            '/logs/audit.log': {
                type: 'file',
                content: tt('审计日志', 'Audit Log')
            },
            '/archives': {
                type: 'folder',
                children: ['FIN']
            },
            '/archives/FIN': {
                type: 'folder',
                children: ['F-2003']
            },
            '/archives/FIN/F-2003': {
                type: 'folder',
                children: ['20190418']
            },
            '/archives/FIN/F-2003/20190418': {
                type: 'folder',
                children: ['TARGET_FILE.dat']
            },
            '/archives/FIN/F-2003/20190418/TARGET_FILE.dat': {
                type: 'file',
                encrypted: true,
                encryptLevel: 3,
                isTarget: true,
                content: tt(
                    '[机密文件] 这是目标文件。使用 download 命令获取。',
                    '[CLASSIFIED] This is the target file. Use download command to retrieve.'
                )
            }
        };
    }

    // ===========================================
    // 暴露公共 API
    // ===========================================
    return {
        init: init,
        toggleLanguage: toggleLanguage,
        setLanguage: setLanguage,
        debugWin: triggerMissionComplete
    };
})();

// ===========================================
// 消息监听 & 自动启动
// ===========================================
window.addEventListener('message', (event) => {
    const data = event.data;
    if (data && data.type === 'init') {
        console.log('[Terminal] Received init message:', data);
        TerminalGame.init(data);
    }
});
