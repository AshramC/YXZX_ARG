// OS 核心逻辑
const OS = (function() {
    let zIndexCounter = 100;
    const windows = {};
    const notesList = document.getElementById('notesList');

    // 1. 核心重载逻辑
    window.reloadConfig = async function(lang) {
        try {
            await UnifiedLoader.load('os-config', 'OS_CONFIG', 'ENCRYPTED_OS_CONFIG', lang);
            initNotesFromConfig();
            initTasksFromConfig();
        } catch(e) { console.warn("OS Config Load Failed", e); }
    };

    // 2. 初始化
    async function init() {
        updateClock();
        setInterval(updateClock, 60000);

        // [新增] 托盘图标语言切换
        const langToggle = document.getElementById('langToggle');
        if (langToggle) {
            langToggle.addEventListener('click', () => {
                const current = localStorage.getItem('app_lang') || 'cn';
                const next = current === 'cn' ? 'en' : 'cn';

                // 根据当前语言给出提示文案
                const msgCn = '切换语言会清空所有调查笔记（包括你自己写的内容），是否继续？';
                const msgEn = 'Switching language will clear all notes (including your own notes). Continue?';
                const confirmMsg = (current === 'cn') ? msgEn : msgCn;

                // 让玩家确认
                const ok = window.confirm(confirmMsg);
                if (!ok) {
                    // 玩家取消切换：什么都不做，保持当前语言和笔记
                    return;
                }

                // 玩家确认切换：1) 切换语言 2) 清除旧笔记 3) 刷新
                localStorage.setItem('app_lang', next);

                // 清掉旧的调查笔记存档，让新语言重新生成初始笔记
                localStorage.removeItem('GHOST_NOTES');

                // 如果你希望连任务完成进度也跟着重置，可以顺便清这个（可选）：
                // localStorage.removeItem('GHOST_TASKS_STATE');

                // 刷新页面以应用新语言
                location.reload();
            });
        }

        const currentLang = localStorage.getItem('app_lang') || 'cn';
        await window.reloadConfig(currentLang);

        loadNotesFromStorage();
        updateTaskProgress();

        setTimeout(() => {
            const boot = document.getElementById('bootScreen');
            if(boot) {
                boot.style.opacity = '0';
                setTimeout(() => boot.remove(), 500);
            }
        }, 1200);

        bindWindowEvents();

        // 添加笔记 (双语支持)
        document.getElementById('btnAddNote').addEventListener('click', () => {
            // 用户输入的笔记无法自动翻译，直接用当前语言占位
            const isEn = localStorage.getItem('app_lang') === 'en';
            addNote(isEn ? "New note..." : "新笔记...");
        });
        document.getElementById('btnClear').addEventListener('click', clearNotes);

        document.getElementById('sidebarProgressBtn').addEventListener('click', () => open('tasks'));
        document.getElementById('hiddenHeader').addEventListener('click', () => {
            document.getElementById('hiddenSection').classList.toggle('collapsed');
        });

        window.addEventListener('message', handleMessage);
        initTools();
    }

    function initTools() {
        // 1. Tab 切换
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // UI 切换
                document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const target = tab.getAttribute('data-tab');
                document.getElementById('panel-notes').classList.remove('active');
                document.getElementById('panel-tools').classList.remove('active');
                document.getElementById(`panel-${target}`).classList.add('active');
            });
        });

        // 2. 凯撒偏移量输入框显隐
        const methodSelect = document.getElementById('decodeMethod');
        const caesarInput = document.getElementById('caesarShift');

        methodSelect.addEventListener('change', () => {
            if (methodSelect.value === 'caesar') {
                caesarInput.style.display = 'block';
            } else {
                caesarInput.style.display = 'none';
            }
        });

        // 3. 执行解码
        document.getElementById('btnDecode').addEventListener('click', () => {
            const input = document.getElementById('decodeInput').value.trim();
            const method = methodSelect.value;
            const outputBox = document.getElementById('decodeOutput');
            const btnCopy = document.getElementById('btnCopyResult');

            if (!input) return;

            let result = "";
            try {
                if (method === 'base64') {
                    // Base64 解码 (支持中文)
                    result = decodeURIComponent(escape(window.atob(input)));
                }
                else if (method === 'url') {
                    result = decodeURIComponent(input);
                }
                else if (method === 'caesar') {
                    const shift = parseInt(caesarInput.value) || 13;
                    result = caesarCipher(input, -shift); // 解密通常是反向位移
                }

                outputBox.textContent = result;
                outputBox.style.color = '#10b981'; // 成功色
                outputBox.style.borderColor = '#10b981';
                btnCopy.style.display = 'block'; // 显示复制按钮

            } catch (e) {
                outputBox.textContent = "Error: Invalid Format";
                outputBox.style.color = '#ef4444'; // 失败色
                outputBox.style.borderColor = '#ef4444';
                btnCopy.style.display = 'none';
            }
        });

        // 4. 结果转存笔记
        document.getElementById('btnCopyResult').addEventListener('click', () => {
            const res = document.getElementById('decodeOutput').textContent;
            if(res) {
                addNote(`解码结果: ${res}`);
                // 自动切回笔记 Tab
                document.querySelector('.sidebar-tab[data-tab="notes"]').click();
            }
        });
    }

    // 凯撒密码算法 (支持大小写，忽略符号)
    function caesarCipher(str, shift) {
        return str.replace(/[a-zA-Z]/g, function (c) {
            const base = c >= 'a' ? 97 : 65;
            // JavaScript 的 % 运算符处理负数会有问题，需要特殊处理
            return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26 + 26) % 26 + base);
        });
    }

    function initTasksFromConfig() {
        const cfg = window.OS_CONFIG || {};
        const tasks = cfg.tasks || { main: [], hidden: [] };

        // 渲染主线
        renderTaskList('taskListMain', tasks.main, 'main');

        // 渲染隐藏
        renderTaskList('taskListHidden', tasks.hidden, 'hidden');

        updateTaskProgress();
    }

    // 渲染函数：支持遍历章节
    function renderTaskList(containerId, chapters, type) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        const savedState = JSON.parse(localStorage.getItem('GHOST_TASKS_STATE') || '[]');

        // 兼容处理：如果 chapters 是一维数组（旧版结构），将其包装成一个默认章节
        if (chapters.length > 0 && !chapters[0].list) {
            chapters = [{ title: null, list: chapters }];
        }

        chapters.forEach(chapter => {
            // 1. 渲染章节标题 (如果有)
            if (chapter.title) {
                const header = document.createElement('div');
                header.className = 'task-chapter-header';

                let cnTitle = chapter.title.cn || chapter.title;
                let enTitle = chapter.title.en || chapter.title;

                header.innerHTML = `
                    <span class="lang-cn-only">${cnTitle}</span>
                    <span class="lang-en-only">${enTitle}</span>
                `;
                container.appendChild(header);
            }

            // 2. 渲染该章节下的任务列表
            (chapter.list || []).forEach(item => {
                const div = document.createElement('div');
                div.className = 'task-item';
                const isChecked = savedState.includes(item.id);

                let cnText = '', enText = '';
                if(typeof item.text === 'object') {
                    cnText = item.text.cn || item.text;
                    enText = item.text.en || item.text;
                } else { cnText = item.text; enText = item.text; }

                div.innerHTML = `
                    <input type="checkbox" id="${item.id}" data-type="${type}" ${isChecked ? 'checked' : ''}>
                    <label for="${item.id}">
                        <span class="lang-cn-only">${cnText}</span>
                        <span class="lang-en-only">${enText}</span>
                    </label>
                `;
                div.querySelector('input').addEventListener('change', (e) => toggleTask(item.id, e.target.checked));
                container.appendChild(div);
            });
        });
    }

    function toggleTask(id, isChecked) {
        let savedState = JSON.parse(localStorage.getItem('GHOST_TASKS_STATE') || '[]');
        if (isChecked) { if (!savedState.includes(id)) savedState.push(id); }
        else { savedState = savedState.filter(tid => tid !== id); }
        localStorage.setItem('GHOST_TASKS_STATE', JSON.stringify(savedState));
        updateTaskProgress();
    }

    // 进度计算函数：先扁平化再计算
    function updateTaskProgress() {
        const cfg = window.OS_CONFIG || {};
        const mainChapters = (cfg.tasks && cfg.tasks.main) || [];
        const hiddenChapters = (cfg.tasks && cfg.tasks.hidden) || [];
        const savedState = JSON.parse(localStorage.getItem('GHOST_TASKS_STATE') || '[]');

        // 辅助函数：将章节结构扁平化为任务数组
        const flattenTasks = (chapters) => {
            // 兼容旧版一维数组
            if (chapters.length > 0 && !chapters[0].list) return chapters;
            // 新版：提取所有章节的 list 并合并
            return chapters.reduce((acc, chapter) => acc.concat(chapter.list || []), []);
        };

        const allMainTasks = flattenTasks(mainChapters);
        const allHiddenTasks = flattenTasks(hiddenChapters);

        // 计算主线进度
        let mainDone = 0;
        allMainTasks.forEach(t => { if (savedState.includes(t.id)) mainDone++; });

        const totalMain = allMainTasks.length;
        const percent = totalMain === 0 ? 0 : Math.round((mainDone / totalMain) * 100);

        document.getElementById('progressPercent').textContent = `${percent}%`;
        document.getElementById('progressFill').style.width = `${percent}%`;

        // 计算隐藏任务数量
        let hiddenDone = 0;
        allHiddenTasks.forEach(t => { if (savedState.includes(t.id)) hiddenDone++; });
        document.getElementById('hiddenCount').textContent = `${hiddenDone}/${allHiddenTasks.length}`;
    }

    // === 笔记系统 (升级：支持双语结构) ===
    function initNotesFromConfig() {
        // 只有当本地没有笔记时才加载初始配置
        if (localStorage.getItem('GHOST_NOTES') === null) {
            const cfg = window.OS_CONFIG || {};
            const initialNotes = cfg.notes?.initial || [];

            if (initialNotes.length > 0) {
                notesList.innerHTML = '';

                // 倒序插入
                [...initialNotes].reverse().forEach(note => {
                    // 【修复点】在这里解析数据结构
                    // 如果 note 是对象且有 text 字段，说明是新格式 {text: "...", style: "..."}
                    // 否则可能只是一个简单的字符串
                    let content = note;
                    let style = 'normal';

                    if (typeof note === 'object' && note !== null) {
                        content = note.text ?? note;
                        style = note.style || 'normal';
                    }

                    addNoteHTML(content, false, style);
                });

                saveNotes();
            } else {
                // 默认欢迎语
                addNoteHTML({
                    cn: "系统：正在初始化笔记模块...",
                    en: "System: Initializing notes module..."
                }, false, 'system');
                saveNotes();
            }
        }
    }
    function loadNotesFromStorage() {
        const saved = localStorage.getItem('GHOST_NOTES');
        if (saved) {
            notesList.innerHTML = saved;
            document.querySelectorAll('.note-item').forEach(el => el.oninput = saveNotes);
        }
    }
    function saveNotes() { localStorage.setItem('GHOST_NOTES', notesList.innerHTML); }
    function addNote(text) { addNoteHTML(text, true, 'normal'); saveNotes(); }

    function addNoteHTML(contentObj, editable=true, style='normal') {
        const div = document.createElement('div');
        div.className = `note-item ${style}`;
        if (style === 'system' || style === 'warning') div.classList.add('system-msg');

        let htmlContent = "";
        if (typeof contentObj === 'object' && (contentObj.cn || contentObj.en)) {
            // 构造双语 HTML 结构
            htmlContent = `
                <span class="lang-cn-only">${contentObj.cn || ""}</span>
                <span class="lang-en-only">${contentObj.en || ""}</span>
            `;
        } else {
            // 纯文本 (用户输入)
            htmlContent = contentObj;
        }

        div.innerHTML = htmlContent;
        div.contentEditable = editable;
        if(editable) div.oninput = saveNotes;
        notesList.prepend(div);
    }

    function clearNotes() {
        const isEn = localStorage.getItem('app_lang') === 'en';
        if(confirm(isEn ? 'Clear all notes?' : '确定清空所有笔记吗？')) {
            notesList.innerHTML = '';
            localStorage.removeItem('GHOST_NOTES');
            initNotesFromConfig();
        }
    }

    function bindWindowEvents() {
        document.querySelectorAll('.window').forEach(win => {
            const id = win.getAttribute('data-app');
            windows[id] = win;

            // 点击置顶
            win.addEventListener('mousedown', () => bringToFront(win));

            // 关闭按钮
            const closeBtn = win.querySelector('.close');
            if(closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(id); });

            // 最小化按钮
            const minBtn = win.querySelector('.min');
            if(minBtn) minBtn.addEventListener('click', (e) => { e.stopPropagation(); minimize(id); });

            // 1. 拖拽移动
            setupDraggable(win);

            // 2. [新增] 动态插入缩放手柄并绑定事件
            // 这样你就不需要手动去 os.html 里每个窗口加 div 了
            if (!win.querySelector('.resize-handle')) {
                const handle = document.createElement('div');
                handle.className = 'resize-handle';
                win.appendChild(handle);
                setupResizable(win, handle);
            }
        });
    }

    function setupResizable(win, handle) {
        let isResizing = false;
        let startX, startY, startW, startH;

        handle.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 防止选中文字
            isResizing = true;
            win.classList.add('resizing'); // 激活 CSS 遮罩，防止 iframe 抢事件

            startX = e.clientX;
            startY = e.clientY;
            // 获取当前计算后的宽高 (像素值)
            const rect = win.getBoundingClientRect();
            startW = rect.width;
            startH = rect.height;

            bringToFront(win);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            // 计算新尺寸
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // 直接修改 style 属性
            win.style.width = `${startW + dx}px`;
            win.style.height = `${startH + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                win.classList.remove('resizing'); // 移除遮罩，恢复 iframe 交互
            }
        });
    }

    function open(appId) {
        const win = windows[appId];
        if (!win) return;
        const iframe = win.querySelector('iframe');
        if (iframe && !iframe.getAttribute('src')) iframe.src = iframe.getAttribute('data-src');
        win.style.display = 'flex';
        bringToFront(win);
        const dockIcon = document.querySelector(`.app-icon[onclick="OS.open('${appId}')"]`);
        if(dockIcon) dockIcon.classList.add('active');
    }
    function close(appId) {
        const win = windows[appId];
        if (win) {
            win.style.display = 'none';
            const dockIcon = document.querySelector(`.app-icon[onclick="OS.open('${appId}')"]`);
            if(dockIcon) dockIcon.classList.remove('active');
        }
    }
    function minimize(appId) { close(appId); }
    function bringToFront(win) { zIndexCounter++; win.style.zIndex = zIndexCounter; }
    function setupDraggable(win) {
        const titleBar = win.querySelector('.title-bar');
        if(!titleBar) return;
        let isDragging = false; let startX, startY, initialLeft, initialTop;
        titleBar.addEventListener('mousedown', (e) => {
            isDragging = true; win.classList.add('dragging');
            startX = e.clientX; startY = e.clientY;
            initialLeft = win.offsetLeft; initialTop = win.offsetTop;
            bringToFront(win);
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX; const dy = e.clientY - startY;
            win.style.left = `${initialLeft + dx}px`; win.style.top = `${initialTop + dy}px`;
        });
        document.addEventListener('mouseup', () => { isDragging = false; win.classList.remove('dragging'); });
    }

    // === 消息通信 ===
    function handleMessage(e) {
        if (!e.data || !e.data.type) return;
        if (e.data.type === 'CLIPBOARD_SYNC') {
            const text = e.data.content;
            if (text && text.length < 500) {
                const isEn = localStorage.getItem('app_lang') === 'en';
                // 使用双语系统消息添加到笔记
                const confirmMsg = isEn
                    ? `[System] Captured text:\n"${text.substring(0,30)}..."\n\nAdd to notes?`
                    : `[系统] 捕获到新文本：\n"${text.substring(0,30)}..."\n\n添加到笔记？`;

                if(confirm(confirmMsg)) {
                    addNote(text);
                }
            }
        }
    }

    function updateClock() {
        const now = new Date();
        const str = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
        const c = document.getElementById('clock'); if(c) c.textContent = str;
    }

    return { init, open, close };
})();

window.addEventListener('DOMContentLoaded', OS.init);