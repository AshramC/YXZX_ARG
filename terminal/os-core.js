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
                    return;
                }

                localStorage.setItem('app_lang', next);
                localStorage.removeItem('GHOST_NOTES');
                location.reload();
            });
        }

        const currentLang = localStorage.getItem('app_lang') || 'cn';
        await window.reloadConfig(currentLang);

        loadNotesFromStorage();
        updateTaskProgress(); // 确保这里调用时，函数内部逻辑已完善

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
            const isEn = localStorage.getItem('app_lang') === 'en';
            addNote(isEn ? "New note..." : "新笔记...");
        });
        document.getElementById('btnClear').addEventListener('click', clearNotes);

        document.getElementById('sidebarProgressBtn').addEventListener('click', () => open('tasks'));

        // 隐藏任务折叠
        const hiddenHeader = document.getElementById('hiddenHeader');
        if (hiddenHeader) {
            hiddenHeader.addEventListener('click', () => {
                document.getElementById('hiddenSection').classList.toggle('collapsed');
            });
        }

        // [新增] 侦探模块折叠事件 (修复点：确保元素存在才绑定)
        const detectiveHeader = document.getElementById('detectiveHeader');
        if (detectiveHeader) {
            detectiveHeader.addEventListener('click', () => {
                document.getElementById('detectiveSection').classList.toggle('collapsed');
            });
        }

        window.addEventListener('message', handleMessage);
        initTools();
    }

    function initTools() {
        // 1. Tab 切换
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', () => {
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
                    result = decodeURIComponent(escape(window.atob(input)));
                }
                else if (method === 'url') {
                    result = decodeURIComponent(input);
                }
                else if (method === 'caesar') {
                    const shift = parseInt(caesarInput.value) || 13;
                    result = caesarCipher(input, -shift);
                }

                outputBox.textContent = result;
                outputBox.style.color = '#10b981';
                outputBox.style.borderColor = '#10b981';
                btnCopy.style.display = 'block';

            } catch (e) {
                outputBox.textContent = "Error: Invalid Format";
                outputBox.style.color = '#ef4444';
                outputBox.style.borderColor = '#ef4444';
                btnCopy.style.display = 'none';
            }
        });

        // 4. 结果转存笔记
        document.getElementById('btnCopyResult').addEventListener('click', () => {
            const res = document.getElementById('decodeOutput').textContent;
            if(res) {
                addNote(`解码结果: ${res}`);
                document.querySelector('.sidebar-tab[data-tab="notes"]').click();
            }
        });
    }

    function caesarCipher(str, shift) {
        return str.replace(/[a-zA-Z]/g, function (c) {
            const base = c >= 'a' ? 97 : 65;
            return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26 + 26) % 26 + base);
        });
    }

    function initTasksFromConfig() {
        const cfg = window.OS_CONFIG || {};
        // [修复点] 确保 detective 默认为空数组
        const tasks = cfg.tasks || { main: [], hidden: [], detective: [] };

        // 渲染主线
        renderTaskList('taskListMain', tasks.main, 'main');

        // [新增] 渲染侦探任务
        renderTaskList('taskListDetective', tasks.detective || [], 'detective');

        // 渲染隐藏
        renderTaskList('taskListHidden', tasks.hidden, 'hidden');

        updateTaskProgress();
    }

// os-core.js -> renderTaskList (替换原函数)

    // 渲染函数：支持章节折叠
    function renderTaskList(containerId, chapters, type) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        const savedState = JSON.parse(localStorage.getItem('GHOST_TASKS_STATE') || '[]');

        // 兼容处理：如果 chapters 是一维数组，包装成默认章节
        if (chapters.length > 0 && !chapters[0].list) {
            chapters = [{ title: null, list: chapters }];
        }

        chapters.forEach((chapter, index) => {
            // 1. 创建章节容器
            const chapterWrapper = document.createElement('div');
            chapterWrapper.className = 'chapter-wrapper';

            // 2. 创建列表容器 (先创建，后面决定是否隐藏)
            const listContainer = document.createElement('div');
            listContainer.className = 'chapter-list';

            // 3. 渲染标题 (如果有)
            if (chapter.title) {
                const header = document.createElement('div');
                header.className = 'task-chapter-header toggle-chapter'; // 增加 toggle 类

                let cnTitle = chapter.title.cn || chapter.title;
                let enTitle = chapter.title.en || chapter.title;

                // 增加箭头指示器
                header.innerHTML = `
                    <span>
                        <span class="arrow">▼</span>
                        <span class="lang-cn-only">${cnTitle}</span>
                        <span class="lang-en-only">${enTitle}</span>
                    </span>
                `;

                // 绑定点击折叠事件
                header.addEventListener('click', () => {
                    chapterWrapper.classList.toggle('collapsed');
                });

                chapterWrapper.appendChild(header);
            }

            // 4. 智能折叠逻辑
            // 如果不是最后一个章节，且有标题，默认折叠 (collapsed)
            // 这样玩家进来直接看到最新的第二章，想看第一章再点开
            const isLastChapter = index === chapters.length - 1;
            if (!isLastChapter && chapter.title) {
                chapterWrapper.classList.add('collapsed');
            }

            // 5. 渲染任务项
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
                listContainer.appendChild(div);
            });

            chapterWrapper.appendChild(listContainer);
            container.appendChild(chapterWrapper);
        });
    }

    function toggleTask(id, isChecked) {
        let savedState = JSON.parse(localStorage.getItem('GHOST_TASKS_STATE') || '[]');
        if (isChecked) { if (!savedState.includes(id)) savedState.push(id); }
        else { savedState = savedState.filter(tid => tid !== id); }
        localStorage.setItem('GHOST_TASKS_STATE', JSON.stringify(savedState));
        updateTaskProgress();
    }

    // 进度计算函数
    function updateTaskProgress() {
        const cfg = window.OS_CONFIG || {};

        // 1. 获取各模块数据
        const mainChapters = (cfg.tasks && cfg.tasks.main) || [];
        const hiddenChapters = (cfg.tasks && cfg.tasks.hidden) || [];
        // [新增] 获取侦探数据
        const detectiveChapters = (cfg.tasks && cfg.tasks.detective) || [];

        const savedState = JSON.parse(localStorage.getItem('GHOST_TASKS_STATE') || '[]');

        // 辅助函数
        const flattenTasks = (chapters) => {
            if (chapters.length > 0 && !chapters[0].list) return chapters;
            return chapters.reduce((acc, chapter) => acc.concat(chapter.list || []), []);
        };

        const allMainTasks = flattenTasks(mainChapters);
        const allHiddenTasks = flattenTasks(hiddenChapters);
        // [修复点] 在这里正确定义 allDetectiveTasks
        const allDetectiveTasks = flattenTasks(detectiveChapters);

        // --- 主线进度 (Total Progress) ---
        let mainDone = 0;
        allMainTasks.forEach(t => { if (savedState.includes(t.id)) mainDone++; });

        const totalMain = allMainTasks.length;
        const percent = totalMain === 0 ? 0 : Math.round((mainDone / totalMain) * 100);

        const progressText = document.getElementById('progressPercent');
        const progressFill = document.getElementById('progressFill');
        if(progressText) progressText.textContent = `${percent}%`;
        if(progressFill) progressFill.style.width = `${percent}%`;

        // --- 隐藏任务计数 ---
        let hiddenDone = 0;
        allHiddenTasks.forEach(t => { if (savedState.includes(t.id)) hiddenDone++; });
        const hiddenCount = document.getElementById('hiddenCount');
        if(hiddenCount) hiddenCount.textContent = `${hiddenDone}/${allHiddenTasks.length}`;

        // --- [新增] 侦探任务独立计数 ---
        let detectiveDone = 0;
        // [修复点] allDetectiveTasks 现在已经定义，不会报错了
        allDetectiveTasks.forEach(t => { if (savedState.includes(t.id)) detectiveDone++; });

        const detectiveCount = document.getElementById('detectiveCount');
        if(detectiveCount) {
            detectiveCount.textContent = `${detectiveDone}/${allDetectiveTasks.length}`;

            // 样式彩蛋
            if (allDetectiveTasks.length > 0 && detectiveDone === allDetectiveTasks.length) {
                detectiveCount.style.backgroundColor = 'rgba(22, 163, 74, 0.3)';
                detectiveCount.style.fontWeight = 'bold';
            } else {
                detectiveCount.style.backgroundColor = 'rgba(22, 101, 52, 0.1)';
            }
        }
    }

    function initNotesFromConfig() {
        if (localStorage.getItem('GHOST_NOTES') === null) {
            const cfg = window.OS_CONFIG || {};
            const initialNotes = cfg.notes?.initial || [];

            if (initialNotes.length > 0) {
                notesList.innerHTML = '';
                [...initialNotes].reverse().forEach(note => {
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
            htmlContent = `
                <span class="lang-cn-only">${contentObj.cn || ""}</span>
                <span class="lang-en-only">${contentObj.en || ""}</span>
            `;
        } else {
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

            win.addEventListener('mousedown', () => bringToFront(win));

            const closeBtn = win.querySelector('.close');
            if(closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(id); });

            const minBtn = win.querySelector('.min');
            if(minBtn) minBtn.addEventListener('click', (e) => { e.stopPropagation(); minimize(id); });

            setupDraggable(win);

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
            e.preventDefault();
            isResizing = true;
            win.classList.add('resizing');

            startX = e.clientX;
            startY = e.clientY;
            const rect = win.getBoundingClientRect();
            startW = rect.width;
            startH = rect.height;

            bringToFront(win);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            win.style.width = `${startW + dx}px`;
            win.style.height = `${startH + dy}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                win.classList.remove('resizing');
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

    function handleMessage(e) {
        if (!e.data || !e.data.type) return;
        if (e.data.type === 'CLIPBOARD_SYNC') {
            const text = e.data.content;
            if (text && text.length < 500) {
                const isEn = localStorage.getItem('app_lang') === 'en';
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