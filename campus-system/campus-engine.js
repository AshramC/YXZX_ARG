/**
 * Campus Engine - P5 Style (Finalized Architecture)
 * Features:
 * 1. Hybrid Ending System (Playlist + Outcome)
 * 2. Enhanced Phone System (AutoTrigger, Priority, Effects)
 * 3. Robust Event Handling & MiniGame Integration
 */
const CampusEngine = (function() {

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

    let Config = { schedule: null, events: null, phone: null };
    const els = {};

    // ============================================================
    // Initialization
    // ============================================================
    async function init() {
        cacheDOM();
        bindUIEvents();
        BGMSystem.init();
        BGMSystem.play();

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

            state.day = Config.schedule.config.initialDay || 1;
            state.slotIndex = 0;
            state.trust = {};
            state.flags = new Set();
            state.dailyExecutedEvents = new Set();

            startDay(state.day);

        } catch (e) {
            console.error(e);
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
            if (autoMsgItem) {
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
        processCurrentSlot();
    }

    function triggerDayTransition() {
        playTransition("一天结束", 3000, () => {
            const nextDay = state.day + 1;
            if (Config.schedule.schedule[`Day_${nextDay}`]) {
                startDay(nextDay);
            } else {
                els.transText.innerText = "DEMO END";
                els.transLayer.classList.add('active');
            }
        });
    }

    function triggerEndingSequence() {
        BGMSystem.pause();

        // 1. === 获取所有关键 Flag ===
        const hasChen = state.flags.has("LINE_CHEN_COMPLETE");   // 证据线（生存必需）
        const hasLin = state.flags.has("LINE_LIN_COMPLETE");     // 清白线（生存必需）
        const hasHacker = state.flags.has("LINE_HACKER_COMPLETE"); // 舆论线（升级结局）
        const hasLuyan = state.flags.has("LINE_LUYAN_COMPLETE");   // 证人线（完美必需）

        if (hasHacker) {
            console.log("[Engine] Hacker line complete. Unlocking Wall Special Mode.");
            localStorage.setItem('WALL_SPECIAL_MODE', 'true');
        }

        let outcome = "bad"; // 默认为坏结局
        let playlist = ["seq_intro"];

        // 2. === 场景构建与逻辑判定 ===

        // [阶段 0] 开场环境：如果控制了舆论，会有群众围观
        if (hasHacker || state.flags.has("FLAG_OPINION_WALL")) {
            playlist.push("task_spawn_crowd");
        }

        // [阶段 1] 第一轮：陈雨菲反击
        playlist.push("seq_round_1_start");
        if (hasChen) {
            playlist.push("seq_round_1_counter");
        } else {
            // --- 死局 1：没有视频证据，直接扭打被捕 ---
            console.log("[Ending] Failed at Round 1 (No Chen Evidence)");
            playlist.push("seq_bad_end_brawl");
            // 直接触发坏结局，不再继续
            launchIframe("bad", playlist);
            return;
        }

        // [阶段 2] 第二轮：林浩反击
        playlist.push("seq_round_2_trap");
        if (hasLin) {
            playlist.push("seq_round_2_block");
        } else {
            // --- 死局 2：没有照片证据，被栽赃带走 ---
            console.log("[Ending] Failed at Round 2 (No Lin Evidence)");
            playlist.push("seq_bad_end_arrest");
            // 直接触发坏结局，不再继续
            launchIframe("bad_arrest", playlist);
            return;
        }

        // === 能走到这里，说明玩家已经“存活”，至少完成了 陈+林 (2线) ===
        // 下面根据剩余线索决定结局档次

        // [阶段 3] 第三轮：反派抵赖 (根据是否有黑客线，播放不同版本的抵赖)
        if (hasHacker) {
            playlist.push("seq_round_3_denial"); // 有群众，有校园墙热搜，反派压力大
        } else {
            playlist.push("seq_round_3_denial_no_crowd"); // 无群众，反派嚣张
        }

        // [阶段 4] 最终裁决
        if (hasHacker && hasLuyan) {
            // --- 完美结局 (4线全齐) ---
            outcome = "perfect";
            playlist.push("seq_true_ending"); // 陆言出场作证
        } else if (hasHacker) {
            // --- 好结局 (3线：陈+林+黑客) ---
            // 只有舆论压力，陆言没站出来，但足以达成艰难胜利
            outcome = "good";
            // 演出上使用 Normal 的僵持（校领导介入），但在后续 epilogue 中会通过 outcome='good' 区分文本
            playlist.push("seq_normal_ending");
        } else {
            // --- 普通结局 (2线：陈+林) ---
            // 只有基础证据，陷入僵持
            outcome = "normal";
            playlist.push("seq_normal_ending");
        }

        console.log(`[Ending] Survival Confirmed. Outcome: [${outcome}]`);
        launchIframe(outcome, playlist);
    }

    // 在 CampusEngine 内部
    function simulateScenario(scenarioType) {
        console.log(`[Debug] Simulating Scenario: ${scenarioType}`);
        state.flags.clear();
        BGMSystem.pause();

        switch (scenarioType) {
            case 'perfect': // 4线全齐
                state.flags.add("LINE_CHEN_COMPLETE").add("LINE_LIN_COMPLETE").add("LINE_HACKER_COMPLETE").add("LINE_LUYAN_COMPLETE");
                break;
            case 'good': // 3线 (缺陆言)
                state.flags.add("LINE_CHEN_COMPLETE").add("LINE_LIN_COMPLETE").add("LINE_HACKER_COMPLETE");
                break;
            case 'normal': // 2线 (基础存活)
                state.flags.add("LINE_CHEN_COMPLETE").add("LINE_LIN_COMPLETE");
                break;
            case 'bad_brawl': // 0线 (第一轮死)
                // 没有任何 Flag
                break;
            case 'bad_arrest': // 1线 (第二轮死)
                state.flags.add("LINE_CHEN_COMPLETE");
                // 缺 LINE_LIN_COMPLETE
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
        // 淡入
        requestAnimationFrame(() => iframe.style.opacity = '1');

        // 2. === 新增：定义消息监听器 ===
        const handleEndingMessage = async (event) => {
            // 过滤消息类型
            if (event.data && event.data.type === 'ENDING_COMPLETE') {
                console.log("[Engine] Received ending signal:", event.data.outcome);

                // A. 移除监听器
                window.removeEventListener('message', handleEndingMessage);

                // B. Iframe 淡出
                iframe.style.opacity = '0';

                // === 动画开始：显示转场层 ===
                if (els.transLayer && els.transText) {
                    els.transText.innerText = "三天后";
                    els.transLayer.classList.add('active');
                }

                await wait(1000); // 等待 Iframe 完全淡出

                // 移除 Iframe DOM
                if (iframe.parentNode) iframe.parentNode.removeChild(iframe);

                // 清理 UI
                resetStateForEpilogue();

                // === 动画核心：日期跳变 (12 -> 15) ===
                // 模拟时间流逝的效果
                await performDateSkipAnimation(12, 15);

                // === 动画结束：隐藏转场层 ===
                if (els.transLayer) {
                    els.transLayer.classList.remove('active');
                }

                // C. 恢复 BGM
                BGMSystem.play();

                // D. 执行后日谈脚本
                // 稍微延迟一点，让玩家看清日期变成了 15 号
                setTimeout(() => {
                    triggerEpilogueEvent(event.data.outcome);
                }, 500);
            }
        };

        // 3. 绑定监听
        window.addEventListener('message', handleEndingMessage);
    }

    // ============================================================
    // Helper: 结局环境清理
    // ============================================================
    function resetStateForEpilogue() {
        console.log("[Engine] Cleaning up UI for Epilogue...");

        // 1. 强制关闭手机界面
        els.phoneLayer.classList.remove('active');

        // 2. 清空手机数据 (防止红点残留或旧消息弹出)
        state.phone.inbox = [];
        state.phone.unreadCount = 0;
        PhoneSystem.updateGlobalBadge(); // 强制刷新红点状态（会消失）
        els.phoneBtn.classList.remove('shaking'); // 停止震动
        els.phoneLayer.classList.remove('active');
        els.menuLayer.classList.remove('active');

        // 3. 强制关闭选项菜单 (如果是在选项中触发的结局)
        els.menuLayer.classList.remove('active');
        els.menuList.innerHTML = ''; // 清空选项内容


        // 4. (可选) 隐藏部分 HUD，让玩家专注于对话
        // if (els.phoneBtn) els.phoneBtn.style.display = 'none';
        // if (els.uiTimeSlot) els.uiTimeSlot.innerText = "END";
    }

    async function triggerEpilogueEvent(outcome) {
        console.log(`[Engine] Director returned outcome: ${outcome}`);

        // eventId 依然保持 epilogue_perfect 等格式
        const eventId = `epilogue_${outcome}`;
        console.log(`[Engine] Playing Epilogue Event: ${eventId}`);

        const eventData = Config.events.events[eventId];

        if (eventData) {
            els.dialogLayer.classList.add('visible');
            await executeScript(eventData.script);
            els.dialogLayer.classList.remove('visible');

            // ★★★ 修改点：将 outcome 传递给 handleGameComplete
            handleGameComplete(outcome);
        } else {
            console.warn(`[Engine] Missing epilogue for: ${outcome}, falling back to normal.`);
            // 兜底逻辑
            const fallbackEvent = Config.events.events['epilogue_normal'];
            if (fallbackEvent) {
                await executeScript(fallbackEvent.script);
            }
            // 兜底也传 outcome (或者默认 normal)
            handleGameComplete(outcome || 'normal');
        }
    }
    function handleGameComplete(outcome) {
        console.log(`[Engine] Game Over (${outcome}). Showing Ending Screen...`);

        // 1. 定义背景图映射 (确保文件名和你的实际文件一致)
        const bgMap = {
            'perfect': '../ending/perfect.jpg',
            'good':    '../ending/good.jpg',   // 假设 good 结局也有图
            'normal':  '../ending/normal.jpg',
            'bad':     '../ending/bad.jpg',     // 假设 bad 结局也有图
            'bad_arrest': '../ending/bad.jpg'   // 坏结局共用
        };

        // 2. 获取图片 URL，如果没有匹配则使用 normal
        const bgUrl = bgMap[outcome] || '../ending/normal.jpg';
        const endingBgEl = document.getElementById('endingBg');

        if (endingBgEl) {
            endingBgEl.style.backgroundImage = `url('${bgUrl}')`;
        }

        // 3. (可选) 修改大标题
        const titleEl = document.getElementById('endTitle');
        if (titleEl) {
            if (outcome === 'perfect') titleEl.innerText = "完美结局";
            else if (outcome === 'good') titleEl.innerText = "好结局";
            else if (outcome === 'normal') titleEl.innerText = "普通结局";
            else if (outcome === 'bad' || outcome === 'bad_arrest') titleEl.innerText = "坏结局";
            else titleEl.innerText = "CASE CLOSED";
        }

        // 4. 显示结局层
        if(els.endingLayer) els.endingLayer.classList.add('active');

        // 5. 清理底层 UI
        resetStateForEpilogue();
    }

    function reloadGame() {
        // 视觉反馈：让按钮变一下或者加个 loading
        console.log("[Engine] Reloading system...");

        localStorage.removeItem('WALL_PERFORMANCE_SEEN');

        localStorage.removeItem('WALL_SPECIAL_MODE');

        window.location.reload();
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

            // Calculate Priority
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
                    <div class="contact-avatar">${item.contact.substring(0,2)}</div>
                    <div class="contact-info">
                        <div class="c-name">${getText(item.contact)}</div>
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
            els.phoneTitle.innerText = getText(item.contact);
            els.chatList.innerHTML = '';
            els.chatInput.innerHTML = '';

            if (item.status === 'expired') {
                this.addBubble("Message Expired.", 'system');
            } else if (item.status === 'replied') {
                this.addBubble("Conversation Ended.", 'system');
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
            addMenuItem("Free Time", () => { hideMenu(); advanceTime(); });
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
                    // Daily interaction limit
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
            addMenuItem("休息 (Rest)", () => { hideMenu(); advanceTime(); });
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
        await executeScript(eventData.script);
        els.dialogLayer.classList.remove('visible');
        advanceTime();
    }

    async function executeScript(scriptLines) {
        if (!scriptLines) return;
        for (let i = 0; i < scriptLines.length; i++) {
            const line = scriptLines[i];

            if (line.cmd === 'dialog') {
                await showDialog(getText(line.speaker), getText(line.text));
            }
            else if (line.cmd === 'choice') {
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
                if (pass || !pass) return; // Jump interrupts current flow
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
                if (line.pass || line.fail) return; // If branching logic exists, stop here
            }
            else if (line.cmd === 'play_ending') {
                await triggerEndingSequence();
                return;
            }
            else if (line.cmd === 'end_event') {
                return;
            }
        }
    }

    // Extracted for readability
    async function handleMinigame(line, scriptLines) {
        BGMSystem.pause();
        els.dialogLayer.classList.remove('visible');

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
                await jumpToLabel(scriptLines, line.pass);
            }
        } else {
            if (line.fail) {
                els.dialogLayer.classList.add('visible');
                await jumpToLabel(scriptLines, line.fail);
            }
        }
        els.dialogLayer.classList.add('visible');
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

    function getText(obj) {
        if (!obj) return "";
        if (typeof obj === 'string') return obj;
        const lang = localStorage.getItem('app_lang') || 'cn';
        return obj[lang] || obj['cn'] || "";
    }

    function showQrModal(imageSrc) {
        const modal = document.getElementById('qrModal');
        const modalImg = document.getElementById('qrModalImg');

        if (modal && modalImg) {
            modal.style.display = "flex"; // 使用 flex 布局显示以居中
            modalImg.src = imageSrc; // 设置大图路径

            // 禁止背景页面滚动
            document.body.style.overflow = 'hidden';
        }
    }

    // 隐藏模态框
    function hideQrModal() {
        const modal = document.getElementById('qrModal');
        if (modal) {
            modal.style.display = "none";

            // 恢复背景页面滚动
            document.body.style.overflow = '';
        }
    }

    // ============================================================
    // Helper: 日期跳变动画
    // ============================================================
    async function performDateSkipAnimation(startDay, targetDay) {
        console.log(`[Engine] Skipping time from ${startDay} to ${targetDay}...`);

        const weeks = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

        // 确保 UI 元素存在
        if (!els.uiDay || !els.uiWeek) return;

        // 循环跳动
        for (let d = startDay; d <= targetDay; d++) {
            // 更新视觉
            els.uiDay.classList.add('jumping');
            els.uiDay.innerText = d < 10 ? `0${d}` : d;
            els.uiWeek.innerText = weeks[d % 7]; // 自动计算星期几

            // 更新内部状态 (虽然结局不需要slot逻辑，但保持状态一致是个好习惯)
            state.day = d;

            // 每次跳动的间隔时间（前慢后快或者匀速）
            // 这里用匀速，每 400ms 跳一天，模拟时间流逝
            await wait(400);
        }

        // 最终定格确认
        els.uiDay.innerText = targetDay < 10 ? `0${targetDay}` : targetDay;
        els.uiWeek.innerText = weeks[targetDay % 7];
    }

    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    return {
        init,
        togglePhone,
        debugSimulateScenario: simulateScenario,
        reloadGame,
        showQrModal: showQrModal,
        hideQrModal: hideQrModal
    };

})();

window.CampusEngine = CampusEngine;
window.addEventListener('DOMContentLoaded', CampusEngine.init);