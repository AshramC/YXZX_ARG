/**
 * Campus Engine - P5 Style (Finalized Architecture)
 * Features:
 * 1. Hybrid Ending System (Playlist + Outcome)
 * 2. Enhanced Phone System (AutoTrigger, Priority, Effects)
 * 3. Robust Event Handling & MiniGame Integration
 * 4. Full Bilingual Support (CN/EN)
 */
const CampusEngine = (function() {

    // ============================================================
    // 多语言工具函数
    // ============================================================

    // Speaker 名称翻译映射表
    const SPEAKER_MAP = {
        "吴宇": { cn: "吴宇", en: "Wu Yu" },
        "张晨": { cn: "张晨", en: "Zhang Chen" },
        "陆言": { cn: "陆言", en: "Lu Yan" },
        "张澄": { cn: "张澄", en: "Zhang Cheng" },
        "陈雨菲": { cn: "陈雨菲", en: "Chen Yufei" },
        "林浩": { cn: "林浩", en: "Lin Hao" },
        "匿名黑客": { cn: "匿名黑客", en: "Anonymous Hacker" },
        "肖楚生": { cn: "肖楚生", en: "Xiao Chusheng" },
        "孙强": { cn: "孙强", en: "Sun Qiang" },
        "周凯": { cn: "周凯", en: "Zhou Kai" },
        "System": { cn: "System", en: "System" },
        "系统": { cn: "系统", en: "System" },
        "校领导": { cn: "校领导", en: "School Leader" },
        "学生A": { cn: "学生A", en: "Student A" },
        "学生B": { cn: "学生B", en: "Student B" },
        "学生C": { cn: "学生C", en: "Student C" },
        "班主任-王老师": { cn: "班主任-王老师", en: "Teacher Wang" },
        "保卫科": { cn: "保卫科", en: "Security Team" },
        "神秘人": { cn: "神秘人", en: "Mystery Man" }
    };

    function getText(obj) {
        if (!obj) return "";
        if (typeof obj === 'string') return obj;
        const lang = localStorage.getItem('app_lang') || 'cn';
        return obj[lang] || obj['cn'] || "";
    }

    /**
     * 获取翻译后的 Speaker 名称
     */
    function getSpeaker(name) {
        if (!name) return "";
        // 如果已经是双语对象，直接用 getText
        if (typeof name === 'object') return getText(name);
        // 查找映射表
        const mapped = SPEAKER_MAP[name];
        if (mapped) return getText(mapped);
        // 没有映射则返回原名
        return name;
    }

    /**
     * 快捷双语文本
     * @param {string} cn - 中文文本
     * @param {string} en - 英文文本
     */
    function tt(cn, en) {
        const lang = localStorage.getItem('app_lang') || 'cn';
        return lang === 'cn' ? cn : en;
    }

    /**
     * 切换语言
     */
    function toggleLanguage() {
        const current = localStorage.getItem('app_lang') || 'cn';
        const newLang = current === 'cn' ? 'en' : 'cn';
        localStorage.setItem('app_lang', newLang);

        console.log(`[Engine] Language switched to: ${newLang}, reloading...`);

        // 刷新页面以重新加载对应语言的配置文件
        window.location.reload();
    }

    /**
     * 初始化语言显示
     */
    function initLanguage() {
        const lang = localStorage.getItem('app_lang') || 'cn';
        document.body.classList.remove('lang-cn', 'lang-en');
        document.body.classList.add('lang-' + lang);

        const btnCn = document.getElementById('btn-cn');
        const btnEn = document.getElementById('btn-en');
        if (btnCn) btnCn.classList.toggle('active', lang === 'cn');
        if (btnEn) btnEn.classList.toggle('active', lang === 'en');
    }

    const BGMSystem = {
        audio: null,
        userInteracted: false,

        init() {
            this.audio = new Audio('../bgm/campus.mp3');
            this.audio.loop = true;
            this.audio.volume = 0.5;

            document.addEventListener('click', () => {
                if (!this.userInteracted) {
                    this.userInteracted = true;
                    if (this.audio.paused) this.play();
                }
            }, { once: true });
        },

        play() {
            if (!this.audio) return;
            this.audio.play().catch(() => console.log("[BGM] Autoplay blocked"));
        },

        pause() {
            if (!this.audio) return;
            this.audio.pause();
        }
    };

    // ============================================================
    // State Management
    // ============================================================
    const state = {
        day: 1,
        slotIndex: 0,
        flags: new Set(),
        trust: {},
        runtime: { score: 0, currentEventScript: null },
        phone: { inbox: [], unreadCount: 0 },
        dailyExecutedEvents: new Set(),
        history: new Set()
    };

    // Skip System (unlocked after first clear)
    const SKIP_UNLOCK_KEY = 'CAMPUS_GAME_CLEARED';
    const skipState = {
        unlocked: false,
        active: false
    };

    let Config = { schedule: null, events: null, phone: null };
    const els = {};

    // ============================================================
    // Persistence (Save/Load System)
    // ============================================================
    const SAVE_KEY = 'campus_save_data_v1';

    function saveState() {
        try {
            const serializedState = JSON.stringify(state, (key, value) => {
                if (value instanceof Set) {
                    return { _type: 'Set', value: Array.from(value) };
                }
                return value;
            });
            localStorage.setItem(SAVE_KEY, serializedState);
            console.log(`[System] Auto-saved at Day ${state.day}, Slot ${state.slotIndex}`);
        } catch (e) {
            console.error("[System] Save failed:", e);
        }
    }

    function loadState() {
        try {
            const data = localStorage.getItem(SAVE_KEY);
            if (!data) return false;

            const parsed = JSON.parse(data, (key, value) => {
                if (value && value._type === 'Set') {
                    return new Set(value.value);
                }
                return value;
            });

            Object.assign(state, parsed);
            console.log(`[System] Game loaded from Day ${state.day}, Slot ${state.slotIndex}`);
            return true;
        } catch (e) {
            console.error("[System] Load failed:", e);
            return false;
        }
    }

    function clearSave() {
        localStorage.removeItem(SAVE_KEY);
        localStorage.removeItem('WALL_SPECIAL_MODE');
        localStorage.removeItem('WALL_PERFORMANCE_SEEN');
    }

    // ============================================================
    // Initialization
    // ============================================================
    async function init() {
        cacheDOM();
        bindUIEvents();
        initLanguage();
        BGMSystem.init();

        // Check if skip mode is unlocked
        skipState.unlocked = localStorage.getItem(SKIP_UNLOCK_KEY) === 'true';
        console.log(`[Skip] Unlocked: ${skipState.unlocked}`);

        const lang = localStorage.getItem('app_lang') || 'cn';
        console.log(`[Engine] Booting in ${lang}...`);

        try {
            await Promise.all([
                UnifiedLoader.load('campus-schedule-config', 'CampusScheduleConfig', 'ENCRYPTED_SCHEDULE_CONFIG', lang),
                UnifiedLoader.load('campus-events-config', 'CampusEventsConfig', 'ENCRYPTED_EVENTS_CONFIG', lang),
                UnifiedLoader.load('phone-config', 'PhoneConfig', 'ENCRYPTED_PHONE_CONFIG', lang)
            ]);

            if (window.CampusScheduleConfig && window.CampusEventsConfig) {
                Config.schedule = window.CampusScheduleConfig;
                Config.events = window.CampusEventsConfig;
                Config.phone = window.PhoneConfig || {};
                console.log("[Engine] Systems Online.");
            } else {
                throw new Error("Config missing.");
            }

            if (loadState()) {
                console.log("[Engine] Found save file. Resuming game...");

                els.uiDay.innerText = state.day < 10 ? `0${state.day}` : state.day;
                const weeks = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                els.uiWeek.innerText = weeks[state.day % 7] || 'UNK';

                BGMSystem.play();
                PhoneSystem.updateGlobalBadge();
                processCurrentSlot();

            } else {
                console.log("[Engine] No save file found. Starting new game...");

                state.day = Config.schedule.config.initialDay || 1;
                state.slotIndex = 0;
                state.trust = {};
                state.flags = new Set();
                state.dailyExecutedEvents = new Set();
                state.history = new Set();
                state.phone = { inbox: [], unreadCount: 0 };

                BGMSystem.play();
                startDay(state.day);
            }

        } catch (e) {
            console.error("[Engine] Init Error:", e);
            if(els.transText) els.transText.innerText = "SYSTEM ERROR";
            if(els.transLayer) els.transLayer.classList.add('active');
        }
    }

    function cacheDOM() {
        ['uiDay', 'uiWeek', 'uiTimeSlot', 'transLayer', 'transText', 'menuLayer', 'menuList',
            'dialogLayer', 'dialogText', 'speakerName', 'choiceContainer', 'phoneBtn', 'phoneGlobalBadge',
            'phoneLayer', 'phoneTitle', 'phoneBackBtn', 'contactListView', 'chatDetailView', 'chatList', 'chatInput'
        ].forEach(id => els[id] = document.getElementById(id));

        els.endingLayer = document.getElementById('endingLayer');
        els.endTitle = document.getElementById('endTitle');
        els.endDesc = document.getElementById('endDesc');
        els.skipBtn = document.getElementById('skipBtn');
    }

    function bindUIEvents() {
        if (els.phoneBackBtn) {
            els.phoneBackBtn.onclick = (e) => {
                e.stopPropagation();
                if (PhoneSystem.isProcessing) return;
                PhoneSystem.goBackToList();
            };
        }
        document.addEventListener('click', (e) => {
            const layer = els.phoneLayer;
            const btn = els.phoneBtn;
            if (layer.classList.contains('active')) {
                if (!layer.contains(e.target) && !btn.contains(e.target)) {
                    if (!PhoneSystem.isProcessing) PhoneSystem.close();
                }
            }
        });
    }

    // ============================================================
    // Time Flow
    // ============================================================
    function startDay(day) {
        state.day = day;
        state.slotIndex = 0;
        state.dailyExecutedEvents.clear();
        saveState();
        els.uiDay.innerText = day < 10 ? `0${day}` : day;
        const weeks = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
        els.uiWeek.innerText = weeks[day % 7] || 'UNK';
        processCurrentSlot();
    }

    async function processCurrentSlot() {
        const slots = Config.schedule.timeSlots;
        if (state.slotIndex >= slots.length) {
            triggerDayTransition();
            return;
        }

        const currentSlot = slots[state.slotIndex];
        PhoneSystem.checkExpiration(state.day, currentSlot.id);
        const phoneTriggerId = `phone_d${state.day}_${currentSlot.id}`;
        const autoMsgItem = PhoneSystem.receiveMessage(phoneTriggerId);

        const slotLabel = getText(currentSlot.label).toUpperCase();
        els.uiTimeSlot.innerText = slotLabel;
        console.log(`[Engine] Slot: ${currentSlot.id}`);

        const onTransitionComplete = () => {
            if (autoMsgItem && autoMsgItem.status === 'unread') {
                console.log("[Engine] Auto-trigger detected.");
                PhoneSystem.forceOpen(autoMsgItem, () => executeSlotActivity());
            } else {
                executeSlotActivity();
            }
        };

        const executeSlotActivity = () => {
            if (currentSlot.type === 'passive') advanceTime();
            else setupDecisionMenu(state.day, currentSlot.id);
        };

        const duration = currentSlot.type === 'passive' ? 3000 : 2000;
        playTransition(slotLabel, duration, onTransitionComplete);
    }

    function advanceTime() {
        state.slotIndex++;
        saveState();
        processCurrentSlot();
    }

    function triggerDayTransition() {
        const transText = tt("一天结束", "DAY ENDED");
        playTransition(transText, 3000, () => {
            const nextDay = state.day + 1;
            if (Config.schedule.schedule[`Day_${nextDay}`]) {
                startDay(nextDay);
            } else {
                els.transText.innerText = tt("演示结束", "DEMO END");
                els.transLayer.classList.add('active');
            }
        });
    }

    function triggerEndingSequence() {
        BGMSystem.pause();

        const hasChen = state.flags.has("LINE_CHEN_COMPLETE");
        const hasLin = state.flags.has("LINE_LIN_COMPLETE");
        const hasHacker = state.flags.has("LINE_HACKER_COMPLETE");
        const hasLuyan = state.flags.has("LINE_LUYAN_COMPLETE");

        if (hasHacker) {
            console.log("[Engine] Hacker line complete. Unlocking Wall Special Mode.");
            localStorage.setItem('WALL_SPECIAL_MODE', 'true');
        }

        let outcome = "bad";
        let playlist = ["seq_intro"];

        if (hasHacker || state.flags.has("FLAG_OPINION_WALL")) {
            playlist.push("task_spawn_crowd");
        }

        playlist.push("seq_round_1_start");
        if (hasChen) {
            playlist.push("seq_round_1_counter");
        } else {
            console.log("[Ending] Failed at Round 1 (No Chen Evidence)");
            playlist.push("seq_bad_end_brawl");
            launchIframe("bad", playlist);
            return;
        }

        playlist.push("seq_round_2_trap");
        if (hasLin) {
            playlist.push("seq_round_2_block");
        } else {
            console.log("[Ending] Failed at Round 2 (No Lin Evidence)");
            playlist.push("seq_bad_end_arrest");
            launchIframe("bad_arrest", playlist);
            return;
        }

        if (hasHacker) {
            playlist.push("seq_round_3_denial");
        } else {
            playlist.push("seq_round_3_denial_no_crowd");
        }

        if (hasHacker && hasLuyan) {
            outcome = "perfect";
            playlist.push("seq_true_ending");
        } else if (hasHacker) {
            outcome = "good";
            playlist.push("seq_normal_ending");
        } else {
            outcome = "normal";
            playlist.push("seq_normal_ending");
        }

        console.log(`[Ending] Survival Confirmed. Outcome: [${outcome}]`);
        launchIframe(outcome, playlist);
    }

    function simulateScenario(scenarioType) {
        console.log(`[Debug] Simulating Scenario: ${scenarioType}`);
        state.flags.clear();
        BGMSystem.pause();

        switch (scenarioType) {
            case 'perfect':
                state.flags.add("LINE_CHEN_COMPLETE").add("LINE_LIN_COMPLETE").add("LINE_HACKER_COMPLETE").add("LINE_LUYAN_COMPLETE");
                break;
            case 'good':
                state.flags.add("LINE_CHEN_COMPLETE").add("LINE_LIN_COMPLETE").add("LINE_HACKER_COMPLETE");
                break;
            case 'normal':
                state.flags.add("LINE_CHEN_COMPLETE").add("LINE_LIN_COMPLETE");
                break;
            case 'bad_brawl':
                break;
            case 'bad_arrest':
                state.flags.add("LINE_CHEN_COMPLETE");
                break;
        }
        triggerEndingSequence();
    }

    function launchIframe(outcome, playlist) {
        const playlistStr = encodeURIComponent(JSON.stringify(playlist));
        const iframe = document.createElement('iframe');
        iframe.src = `../monitor-system/monitor-system.html?mode=ending&outcome=${outcome}&playlist=${playlistStr}`;

        Object.assign(iframe.style, {
            position: 'fixed', top: '0', left: '0',
            width: '100vw', height: '100vh', border: 'none',
            zIndex: '99999', background: '#000',
            transition: 'opacity 1s', opacity: '0'
        });

        iframe.id = 'ending-iframe';
        document.body.appendChild(iframe);

        requestAnimationFrame(() => iframe.style.opacity = '1');

        const handleEndingMessage = async (event) => {
            if (event.data && event.data.type === 'ENDING_COMPLETE') {
                console.log("[Engine] Received ending signal from Director.");

                const finalOutcome = outcome;

                console.log(`[Engine] Transitioning to Epilogue: ${finalOutcome}`);

                window.removeEventListener('message', handleEndingMessage);

                iframe.style.opacity = '0';

                if (els.transLayer && els.transText) {
                    els.transText.innerText = tt("三天后", "THREE DAYS LATER");
                    els.transLayer.classList.add('active');
                    els.transLayer.style.display = 'flex';
                }

                await wait(1000);

                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);

                resetStateForEpilogue();

                try {
                    await performDateSkipAnimation(12, 15);
                } catch(e) {
                    console.error("[Engine] Date animation skipped:", e);
                }

                if (els.transLayer) {
                    els.transLayer.classList.remove('active');
                    els.transLayer.style.display = 'none';
                }

                BGMSystem.play();

                setTimeout(() => {
                    triggerEpilogueEvent(finalOutcome);
                }, 500);
            }
        };

        window.addEventListener('message', handleEndingMessage);
    }

    // ============================================================
    // Helper: 结局环境清理
    // ============================================================
    function resetStateForEpilogue() {
        console.log("[Engine] Cleaning up UI for Epilogue...");

        els.phoneLayer.classList.remove('active');

        state.phone.inbox = [];
        state.phone.unreadCount = 0;
        PhoneSystem.updateGlobalBadge();
        els.phoneBtn.classList.remove('shaking');
        els.phoneLayer.classList.remove('active');
        els.menuLayer.classList.remove('active');

        els.menuLayer.classList.remove('active');
        els.menuList.innerHTML = '';
    }

    async function triggerEpilogueEvent(outcome) {
        console.log(`[Engine] Director returned outcome: ${outcome}`);

        const eventId = `epilogue_${outcome}`;
        console.log(`[Engine] Playing Epilogue Event: ${eventId}`);

        const eventData = Config.events.events[eventId];

        if (eventData) {
            els.dialogLayer.classList.add('visible');
            // Show skip button if unlocked
            if (skipState.unlocked && els.skipBtn) {
                els.skipBtn.classList.add('visible');
            }
            await executeScript(eventData.script);
            els.dialogLayer.classList.remove('visible');
            // Hide skip button and reset
            if (els.skipBtn) els.skipBtn.classList.remove('visible');
            skipState.active = false;
            updateSkipButtonUI();

            handleGameComplete(outcome);
        } else {
            console.warn(`[Engine] Missing epilogue for: ${outcome}, falling back to normal.`);
            const fallbackEvent = Config.events.events['epilogue_normal'];
            if (fallbackEvent) {
                await executeScript(fallbackEvent.script);
            }
            handleGameComplete(outcome || 'normal');
        }
    }

    function handleGameComplete(outcome) {
        console.log(`[Engine] Game Over (${outcome}). Showing Ending Screen...`);

        // Unlock skip mode for future playthroughs
        localStorage.setItem(SKIP_UNLOCK_KEY, 'true');
        skipState.unlocked = true;
        console.log('[Skip] Mode unlocked for future playthroughs.');

        const bgMap = {
            'perfect': '../ending/perfect.jpg',
            'good':    '../ending/good.jpg',
            'normal':  '../ending/normal.jpg',
            'bad':     '../ending/bad.jpg',
            'bad_arrest': '../ending/bad.jpg'
        };

        const bgUrl = bgMap[outcome] || '../ending/normal.jpg';
        const endingBgEl = document.getElementById('endingBg');

        if (endingBgEl) {
            endingBgEl.style.backgroundImage = `url('${bgUrl}')`;
        }

        const titleEl = document.getElementById('endTitle');
        if (titleEl) {
            const titleMap = {
                'perfect': tt("完美结局", "PERFECT ENDING"),
                'good': tt("好结局", "GOOD ENDING"),
                'normal': tt("普通结局", "NORMAL ENDING"),
                'bad': tt("坏结局", "BAD ENDING"),
                'bad_arrest': tt("坏结局", "BAD ENDING")
            };
            titleEl.innerText = titleMap[outcome] || tt("结局", "ENDING");
        }

        if(els.endingLayer) els.endingLayer.classList.add('active');

        resetStateForEpilogue();
    }

    function reloadGame() {
        console.log("[Engine] Reloading system...");
        clearSave();
        window.location.reload();
    }

    function confirmReset() {
        const confirmMsg = tt(
            "【警告】\n这将清除所有存档并重置到第一天。\n\n是否确定？",
            "【WARNING】\nThis will clear all save data and reset to Day 1.\n\nAre you sure?"
        );
        const result = window.confirm(confirmMsg);
        if (result) {
            reloadGame();
        }
    }


    // ============================================================
    // Phone System
    // ============================================================
    const PhoneSystem = {
        isProcessing: false,

        open() {
            els.phoneLayer.classList.add('active');
            this.renderContactList();
            this.goBackToList();
        },
        close() {
            els.phoneLayer.classList.remove('active');
            setTimeout(() => this.goBackToList(), 300);
        },
        forceOpen(item, onComplete) {
            els.phoneLayer.classList.add('active');
            this.openChatDetail(item);
            const originalClose = this.close.bind(this);
            this.close = () => {
                originalClose();
                this.close = originalClose;
                if (onComplete) onComplete();
            };
        },

        receiveMessage(triggerId) {
            let phoneData = Config.phone ? Config.phone[triggerId] : null;
            if (!phoneData) return null;
            const candidatesConfig = Array.isArray(phoneData) ? phoneData : [phoneData];
            let validCandidates = [];

            for (const chatConfig of candidatesConfig) {
                if (chatConfig.notTriggerIf && checkRequirements(chatConfig.notTriggerIf)) continue;
                if ((chatConfig.triggerIf || chatConfig.requires) && !checkRequirements(chatConfig.triggerIf || chatConfig.requires)) continue;

                validCandidates.push({
                    uid: `contact_${chatConfig.contact}`,
                    config: chatConfig,
                    contact: chatConfig.contact,
                    preview: chatConfig.preview || {cn: "新消息", en: "New message"},
                    expireSlot: chatConfig.expire,
                    createDay: state.day,
                    status: 'unread',
                    _score: 0
                });
            }

            if (validCandidates.length === 0) return null;

            validCandidates.forEach(item => {
                let score = 0;
                const charMap = {'陈雨菲':'evt_chen', '林浩':'evt_lin', '陆言':'evt_luyan', '匿名黑客':'evt_hacker'};
                const targetPrefix = charMap[item.contact];
                if (targetPrefix) {
                    for (let eventId of state.dailyExecutedEvents) {
                        if (eventId.startsWith(targetPrefix)) { score += 100; break; }
                    }
                }
                if (item.contact === '张晨') score += 50;
                if (item.config.priority) score += item.config.priority;
                item._score = score;
            });

            validCandidates.sort((a, b) => b._score - a._score);
            const winner = validCandidates[0];
            delete winner._score;

            let existingItem = state.phone.inbox.find(i => i.uid === winner.uid);
            if (!existingItem) {
                state.phone.inbox.push(winner);
                existingItem = winner;
            } else {
                Object.assign(existingItem, {
                    status: 'unread', preview: winner.preview,
                    config: winner.config, expireSlot: winner.expireSlot,
                    createDay: state.day
                });
            }

            this.updateGlobalBadge();
            this.triggerShake();

            if (existingItem.config.autoTrigger) return existingItem;
            return null;
        },

        checkExpiration(currentDay, currentSlotId) {
            let changed = false;
            state.phone.inbox.forEach(item => {
                if (item.status === 'replied' || item.status === 'expired') return;
                let shouldExpire = (currentDay > item.createDay);
                if (item.expireSlot && item.expireSlot !== 'day_end') {
                    if (currentDay === item.createDay && currentSlotId === item.expireSlot) shouldExpire = true;
                }
                if (shouldExpire) { item.status = 'expired'; changed = true; }
            });
            if (changed) this.updateGlobalBadge();
        },

        updateGlobalBadge() {
            const count = state.phone.inbox.filter(i => i.status === 'unread').length;
            state.phone.unreadCount = count;
            if (count > 0) {
                els.phoneGlobalBadge.innerText = count;
                els.phoneGlobalBadge.classList.remove('hidden');
                els.phoneBtn.classList.add('shaking');
            } else {
                els.phoneGlobalBadge.classList.add('hidden');
                els.phoneBtn.classList.remove('shaking');
            }
        },

        triggerShake() {
            els.phoneBtn.classList.remove('shaking');
            void els.phoneBtn.offsetWidth;
            els.phoneBtn.classList.add('shaking');
        },

        renderContactList() {
            els.contactListView.innerHTML = '';
            const list = [...state.phone.inbox].sort((a,b) => {
                if(a.status === 'unread' && b.status !== 'unread') return -1;
                if(a.status !== 'unread' && b.status === 'unread') return 1;
                return 0;
            });

            list.forEach(item => {
                const el = document.createElement('div');
                el.className = `contact-item ${item.status === 'unread' ? 'has-unread' : ''}`;
                let badgeHtml = '';
                if (item.status === 'unread') badgeHtml = `<div class="c-badge">NEW</div>`;
                if (item.status === 'expired') badgeHtml = `<div class="c-expired">EXP</div>`;
                if (item.status === 'replied') badgeHtml = `<div style="font-size:0.8rem;color:#999;">✔</div>`;

                el.innerHTML = `
                    <div class="contact-avatar">${getSpeaker(item.contact).substring(0,2)}</div>
                    <div class="contact-info">
                        <div class="c-name">${getSpeaker(item.contact)}</div>
                        <div class="c-preview">${getText(item.preview)}</div>
                    </div>
                    ${badgeHtml}
                `;
                el.onclick = (e) => { e.stopPropagation(); this.openChatDetail(item); };
                els.contactListView.appendChild(el);
            });
        },

        openChatDetail(item) {
            els.contactListView.classList.add('hidden');
            els.chatDetailView.classList.remove('hidden');
            els.phoneBackBtn.classList.remove('hidden');
            els.phoneTitle.innerText = getSpeaker(item.contact);
            els.chatList.innerHTML = '';
            els.chatInput.innerHTML = '';

            if (item.status === 'expired') {
                this.addBubble(tt("消息已过期", "Message Expired."), 'system');
            } else if (item.status === 'replied') {
                this.addBubble(tt("对话已结束", "Conversation Ended."), 'system');
            } else {
                if (item.status === 'unread') {
                    item.status = 'read';
                    this.updateGlobalBadge();
                    if (item.config && item.config.notTriggerIf && item.config.notTriggerIf.flag) {
                        state.flags.add(item.config.notTriggerIf.flag);
                    }
                }
                this.runQueue(item.config.messages, item);
            }
        },

        goBackToList() {
            els.contactListView.classList.remove('hidden');
            els.chatDetailView.classList.add('hidden');
            els.phoneBackBtn.classList.add('hidden');
            els.phoneTitle.innerText = "MESSAGES";
            this.renderContactList();
        },

        async runQueue(messages, itemRef) {
            this.isProcessing = true;
            try {
                for (let msg of messages) {
                    if (msg.type === 'received') await this.showReceived(msg);
                    else if (msg.type === 'reply') await this.waitForReply(msg.options, itemRef);
                    else if (msg.type === 'system') this.addBubble(getText(msg.text), 'system');
                }
            } catch (e) { console.error(e); }
            finally { this.isProcessing = false; }
        },

        async showReceived(msg) {
            const typing = document.createElement('div');
            typing.className = 'chat-bubble left typing-dots';
            els.chatList.appendChild(typing);
            this.scrollToBottom();
            await wait(msg.delay || 800);
            typing.remove();
            this.addBubble(getText(msg.text), 'left');
            await wait(500);
        },

        async waitForReply(options, itemRef) {
            return new Promise(resolve => {
                els.chatInput.innerHTML = '';
                const validOptions = options.filter(opt => checkRequirements(opt.requirements));

                validOptions.forEach(opt => {
                    const btn = document.createElement('div');
                    btn.className = 'chat-option-btn';
                    btn.innerText = getText(opt.label);
                    btn.onclick = async (e) => {
                        e.stopPropagation();
                        els.chatInput.innerHTML = '';
                        this.addBubble(getText(opt.label), 'right');
                        await wait(500);
                        if (itemRef) itemRef.status = 'replied';

                        if (opt.effect) applyReward(opt.effect);
                        if (opt.reward) applyReward(opt.reward);
                        if (opt.next) await this.runQueue(opt.next, itemRef);
                        resolve();
                    };
                    els.chatInput.appendChild(btn);
                });
                this.scrollToBottom();
            });
        },

        addBubble(text, type) {
            const div = document.createElement('div');
            div.className = `chat-bubble ${type}`;
            div.innerText = text;
            els.chatList.appendChild(div);
            this.scrollToBottom();
        },
        scrollToBottom() {
            requestAnimationFrame(() => els.chatList.scrollTop = els.chatList.scrollHeight);
        }
    };

    // ============================================================
    // Interaction & Logic
    // ============================================================
    function togglePhone() {
        const isActive = els.phoneLayer.classList.contains('active');
        isActive ? PhoneSystem.close() : PhoneSystem.open();
    }

    function playTransition(text, duration, callback) {
        els.transText.innerText = text;
        els.transLayer.classList.add('active');
        setTimeout(() => {
            els.transLayer.classList.remove('active');
            if (callback) callback();
        }, duration);
    }

    function setupDecisionMenu(day, slotId) {
        const daySchedule = Config.schedule.schedule[`Day_${day}`];
        const events = daySchedule ? daySchedule[slotId] : [];
        els.menuList.innerHTML = '';
        els.menuLayer.classList.add('active');

        if (!events || events.length === 0) {
            addMenuItem(tt("自由活动", "Free Time"), () => { hideMenu(); advanceTime(); });
            return;
        }

        const addedLabels = new Set();
        const COMPLETION_FLAGS = {'chen':'LINE_CHEN_COMPLETE', 'lin':'LINE_LIN_COMPLETE', 'hacker':'LINE_HACKER_COMPLETE', 'luyan':'LINE_LUYAN_COMPLETE'};
        const getCharPrefix = (id) => { const m = id && id.match(/^evt_([a-z]+)_/); return m ? m[1] : null; };

        [...events].reverse().forEach(evt => {
            if (!checkRequirements(evt.requires)) return;
            if (evt.eventId && state.dailyExecutedEvents.has(evt.eventId)) return;

            if (evt.eventId) {
                const char = getCharPrefix(evt.eventId);
                if (char) {
                    if (COMPLETION_FLAGS[char] && state.flags.has(COMPLETION_FLAGS[char])) return;
                    if (['chen','lin','hacker','luyan'].includes(char)) {
                        for (let eid of state.dailyExecutedEvents) {
                            if (getCharPrefix(eid) === char) return;
                        }
                    }
                }
            }

            let label = evt.name || evt.location;
            if (evt.eventId) {
                const eData = Config.events.events[evt.eventId];
                if (eData) {
                    if (eData.requires && !checkRequirements(eData.requires)) return;
                    label = getText(eData.title);
                }
            }

            if (addedLabels.has(label)) return;
            addedLabels.add(label);
            addMenuItem(label, () => { hideMenu(); runEvent(evt.eventId); });
        });

        if (els.menuList.children.length === 0) {
            addMenuItem(tt("休息", "Rest"), () => { hideMenu(); advanceTime(); });
        }
    }

    function addMenuItem(text, onClick) {
        const item = document.createElement('div');
        item.className = 'menu-item';
        item.innerHTML = text;
        item.onclick = (e) => { e.stopPropagation(); onClick(); };
        els.menuList.appendChild(item);
    }

    function hideMenu() { els.menuLayer.classList.remove('active'); }

    // ============================================================
    // Event Execution
    // ============================================================
    async function runEvent(eventId) {
        const eventData = Config.events.events[eventId];
        if (!eventData) { advanceTime(); return; }

        state.dailyExecutedEvents.add(eventId);
        state.history.add(eventId);
        state.runtime.score = 0;
        state.runtime.currentEventScript = eventData.script;

        els.dialogLayer.classList.add('visible');

        // Show skip button if unlocked
        if (skipState.unlocked && els.skipBtn) {
            els.skipBtn.classList.add('visible');
        }

        const result = await executeScript(eventData.script);

        els.dialogLayer.classList.remove('visible');

        // Hide skip button and reset state
        if (els.skipBtn) {
            els.skipBtn.classList.remove('visible');
        }
        skipState.active = false;
        updateSkipButtonUI();

        if (result === 'STOP') {
            console.log("[Engine] Event triggered ending sequence. Halting time flow.");
            return;
        }
        advanceTime();
    }

    async function executeScript(scriptLines) {
        if (!scriptLines) return;
        for (let i = 0; i < scriptLines.length; i++) {
            const line = scriptLines[i];

            if (line.cmd === 'dialog') {
                await showDialog(getSpeaker(line.speaker), getText(line.text));
            }
            else if (line.cmd === 'choice') {
                // Stop skip mode when reaching choices
                if (skipState.active) {
                    skipState.active = false;
                    updateSkipButtonUI();
                }
                const idx = await showChoices(line.options);
                if (idx !== -1 && line.options[idx].next) {
                    await jumpToLabel(scriptLines, line.options[idx].next);
                    return;
                }
            }
            else if (line.cmd === 'check_score') {
                const pass = state.runtime.score >= (line.threshold || 1);
                if (pass && line.pass) await jumpToLabel(scriptLines, line.pass);
                else if (!pass && line.fail) await jumpToLabel(scriptLines, line.fail);
                if (pass || !pass) return;
            }
            else if (line.cmd === 'reward') {
                applyReward(line);
            }
            else if (line.cmd === 'jump') {
                await jumpToLabel(scriptLines, line.target);
                return;
            }
            else if (line.cmd === 'check_flag') {
                const target = state.flags.has(line.flag) ? line.yes : line.no;
                if (target) { await jumpToLabel(scriptLines, target); return; }
            }
            else if (line.cmd === 'minigame') {
                await handleMinigame(line, scriptLines);
                if (line.pass || line.fail) return;
            }
            else if (line.cmd === 'play_ending') {
                await triggerEndingSequence();
                return 'STOP';
            }
            else if (line.cmd === 'end_event') {
                return;
            }
        }
    }

    async function handleMinigame(line, scriptLines) {
        BGMSystem.pause();
        els.dialogLayer.classList.remove('visible');

        // Hide skip button during minigame
        skipState.active = false;
        updateSkipButtonUI();
        if (els.skipBtn) els.skipBtn.classList.remove('visible');

        let finalConfig = line.config || {};
        if (line.config && line.config.configFile) {
            try {
                const lang = localStorage.getItem('app_lang') || 'cn';
                const loaded = await UnifiedLoader.load(
                    `../hacker-system/${line.config.configFile}-config`,
                    line.config.globalVar || 'LevelConfig',
                    line.config.encryptedVar || `ENCRYPTED_${line.config.configFile.toUpperCase()}_CONFIG`,
                    lang
                );
                finalConfig.injectedLevelData = loaded;
            } catch(e) { console.error("Minigame Config Error", e); }
        }

        const result = await new Promise(resolve => {
            if (!window.MiniGameManager) return resolve({success:false});

            const msgHandler = (e) => {
                if (e.data && e.data.type === 'minigame_complete') {
                    window.removeEventListener('message', msgHandler);
                    if(window.MiniGameManager.close) window.MiniGameManager.close();
                    resolve(e.data.payload || {success:true});
                }
            };
            window.addEventListener('message', msgHandler);

            window.MiniGameManager.start(line.gameId, {
                node: { config: finalConfig },
                onComplete: (res) => { window.removeEventListener('message', msgHandler); resolve(res); },
                onExit: () => { window.removeEventListener('message', msgHandler); resolve({success:false}); }
            });
        });

        BGMSystem.play();

        if (result && result.success) {
            if (line.reward) applyReward(line.reward);
            if (line.pass) {
                els.dialogLayer.classList.add('visible');
                // Restore skip button after minigame
                if (skipState.unlocked && els.skipBtn) els.skipBtn.classList.add('visible');
                await jumpToLabel(scriptLines, line.pass);
            }
        } else {
            if (line.fail) {
                els.dialogLayer.classList.add('visible');
                // Restore skip button after minigame
                if (skipState.unlocked && els.skipBtn) els.skipBtn.classList.add('visible');
                await jumpToLabel(scriptLines, line.fail);
            }
        }
        els.dialogLayer.classList.add('visible');
        // Restore skip button after minigame
        if (skipState.unlocked && els.skipBtn) els.skipBtn.classList.add('visible');
    }

    async function jumpToLabel(script, label) {
        const root = state.runtime.currentEventScript;
        const target = root ? root.find(i => i.label === label) : null;
        if (target && target.script) await executeScript(target.script);
    }

    function showDialog(speaker, text) {
        return new Promise(resolve => {
            els.speakerName.innerText = speaker;
            els.dialogText.innerText = '';

            // Skip mode: show text immediately and auto-advance
            if (skipState.active) {
                els.dialogText.innerText = text;
                setTimeout(resolve, 100);
                return;
            }

            // Normal mode: typewriter effect
            let i = 0, skipped = false;
            const timer = setInterval(() => {
                if(skipped) return;
                els.dialogText.innerText += text[i++];
                if(i >= text.length) finish();
            }, 30);
            function finish() {
                clearInterval(timer);
                els.dialogText.innerText = text;
                skipped = true;
                const h = (e) => { e.stopPropagation(); els.dialogLayer.removeEventListener('click', h); resolve(); };
                els.dialogLayer.addEventListener('click', h, {once:true});
            }
            els.dialogLayer.onclick = (e) => { e.stopPropagation(); if(!skipped) finish(); };
        });
    }

    function showChoices(options) {
        return new Promise(resolve => {
            els.choiceContainer.innerHTML = '';
            els.choiceContainer.style.display = 'flex';
            const valid = options.filter(opt => checkRequirements(opt.requirements));
            valid.forEach(opt => {
                const btn = document.createElement('div');
                btn.className = 'choice-btn';
                btn.innerText = getText(opt.label);
                btn.onclick = (e) => {
                    e.stopPropagation();
                    els.choiceContainer.style.display = 'none';
                    if (opt.score) state.runtime.score += opt.score;
                    resolve(options.indexOf(opt));
                };
                els.choiceContainer.appendChild(btn);
            });
        });
    }

    // ============================================================
    // Utilities
    // ============================================================
    function checkRequirements(req) {
        if (!req) return true;
        if (req.flag && !state.flags.has(req.flag)) return false;
        if (req.notFlag && state.flags.has(req.notFlag)) return false;
        if (req.trust) {
            const v = state.trust[req.trust.target] || 0;
            if (req.trust.min !== undefined && v < req.trust.min) return false;
            if (req.trust.max !== undefined && v > req.trust.max) return false;
        }
        if (req.eventExecuted && !state.history.has(req.eventExecuted)) return false;
        return true;
    }

    function updateTrust(target, value) {
        state.trust[target] = (state.trust[target] || 0) + value;
        console.log(`[Trust] ${target}: ${state.trust[target]}`);
    }

    function applyReward(data) {
        if (!data) return;
        if (data.trust) updateTrust(data.trust.target, data.trust.value);
        if (data.addTrust) updateTrust(data.addTrust.target, data.addTrust.value);
        if (data.addFlag) {
            state.flags.add(data.addFlag);
            console.log(`[Reward] Flag: ${data.addFlag}`);
        }
        if (data.globalBadge) localStorage.setItem(data.globalBadge, 'true');
    }

    function showQrModal(imageSrc) {
        const modal = document.getElementById('qrModal');
        const modalImg = document.getElementById('qrModalImg');

        if (modal && modalImg) {
            modal.style.display = "flex";
            modalImg.src = imageSrc;
            document.body.style.overflow = 'hidden';
        }
    }

    function hideQrModal() {
        const modal = document.getElementById('qrModal');
        if (modal) {
            modal.style.display = "none";
            document.body.style.overflow = '';
        }
    }

    // ============================================================
    // Helper: 日期跳变动画
    // ============================================================
    async function performDateSkipAnimation(startDay, targetDay) {
        console.log(`[Engine] Skipping time from ${startDay} to ${targetDay}...`);

        const weeks = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

        if (!els.uiDay || !els.uiWeek) return;

        for (let d = startDay; d <= targetDay; d++) {
            els.uiDay.classList.add('jumping');
            els.uiDay.innerText = d < 10 ? `0${d}` : d;
            els.uiWeek.innerText = weeks[d % 7];

            state.day = d;

            await wait(400);
        }

        els.uiDay.innerText = targetDay < 10 ? `0${targetDay}` : targetDay;
        els.uiWeek.innerText = weeks[targetDay % 7];
    }

    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ============================================================
    // Skip System Controls
    // ============================================================
    function toggleSkipMode() {
        if (!skipState.unlocked) return;
        skipState.active = !skipState.active;
        updateSkipButtonUI();
        console.log(`[Skip] Mode: ${skipState.active ? 'ON' : 'OFF'}`);
    }

    function updateSkipButtonUI() {
        if (!els.skipBtn) return;
        els.skipBtn.classList.toggle('active', skipState.active);
    }

    return {
        init,
        togglePhone,
        toggleLanguage,
        toggleSkipMode,
        debugSimulateScenario: simulateScenario,
        reloadGame,
        confirmReset,
        showQrModal: showQrModal,
        hideQrModal: hideQrModal
    };

})();

window.CampusEngine = CampusEngine;
window.addEventListener('DOMContentLoaded', CampusEngine.init);
