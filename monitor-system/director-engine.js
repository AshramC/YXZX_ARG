/**
 * Director Engine - 异象中学监控系统演出引擎
 * 核心功能：解析 ending.yaml 剧本，结合 stage_config.json 坐标，在监控屏幕上进行实时演出
 */
const DirectorEngine = (function() {

    // === 内部状态 ===
    const state = {
        isRunning: false,
        stageData: null,    // stage_config.json (坐标字典)
        scriptData: null,   // ending.yaml (剧本)
        activeActors: {},   // 存活的 DOM 元素引用 { actorId: HTMLElement }
        lang: 'cn'
    };

    // DOM 容器
    let stageLayer = null;
    let uiLayer = null;

    // ============================================================
    // 1. 初始化与启动
    // ============================================================

    async function init() {
        state.lang = localStorage.getItem('app_lang') || 'cn';
        console.log("[Director] Engine Initialized.");
    }

    /**
     * 启动演出
     * @param {string} endingScriptId - 剧本配置名，如 'ending'
     * @param {string} stageConfigId - 舞台配置名，如 'stage'
     * @param {object} options - [新增] 接收外部传入的参数 { outcome, playlist }
     */
    async function start(endingScriptId = 'ending', stageConfigId = 'stage', options = {}) {
        if (state.isRunning) return;
        state.isRunning = true;

        // 1. 锁定原有监控界面
        lockMonitorInterface();

        // 2. 加载配置
        await ensureConfigsLoaded(endingScriptId, stageConfigId);

        // 3. 准备舞台 DOM
        setupStageDOM();

        // 4. 开始执行
        try {
            // === 情况 A: Playlist 模式 (Campus 传递列表) ===
            if (options.playlist) {
                let sequenceList = [];
                try {
                    sequenceList = JSON.parse(decodeURIComponent(options.playlist));
                } catch(e) {
                    console.error("[Director] Playlist JSON Parse Error:", e);
                }

                if (sequenceList && sequenceList.length > 0) {
                    console.log("[Director] Playing from Playlist:", sequenceList);

                    for (const seqId of sequenceList) {
                        if (!state.isRunning) break;
                        const commands = state.scriptData.scripts[seqId];

                        if (commands) {
                            // [修复点]：检查是否为背景任务 (task_/bg_)
                            // 如果是背景任务，不使用 await，让它在后台运行，不阻塞主流程
                            if (seqId.startsWith("task_") || seqId.startsWith("bg_")) {
                                console.log(`[Director] >> Async Task Started: ${seqId}`);
                                executeCommands(commands); // 不 await
                            } else {
                                console.log(`[Director] > Running Sequence: ${seqId}`);
                                await executeCommands(commands); // 阻塞等待完成
                            }
                        } else {
                            console.warn(`[Director] Sequence missing: ${seqId}`);
                        }
                    }

                    return;
                }
            }

            // === 情况 B: Outcome 模式 (调试兼容) ===
            if (options.outcome) {
                console.log(`[Director] Playing Outcome Mode: ${options.outcome}`);
                // 伪造 localStorage Flag
                if (options.outcome === 'perfect') localStorage.setItem('FLAG_ENDING_PERFECT', 'true');
                if (options.outcome === 'good') localStorage.setItem('FLAG_ENDING_GOOD', 'true');
                if (options.outcome === 'bad') localStorage.setItem('FLAG_ENDING_BAD', 'true');
            }

            // === 情况 C: 默认流程 (Ending.yaml Flow) ===
            if (state.scriptData.flow) {
                console.log("[Director] Running Default Flow");
                await runFlow(state.scriptData.flow);
            } else {
                console.warn("[Director] No playlist and no flow defined.");
            }

        } catch (e) {
            console.error("[Director] Runtime Error:", e);
            showDialog(`SYSTEM ERROR: ${e.message}`);
        }
    }

    function stop() {
        state.isRunning = false;
        state.activeActors = {};
        if (stageLayer) stageLayer.remove();
        if (uiLayer) uiLayer.remove();
        unlockMonitorInterface();
    }

    // ============================================================
    // 2. 核心执行循环 (The Loop)
    // ============================================================

    async function runFlow(flowArray) {
        if (!flowArray) return;

        for (const step of flowArray) {
            if (!state.isRunning) break;

            if (step.run) {
                const seqId = step.run;
                const commands = state.scriptData.scripts[seqId];
                if (commands) {
                    // Flow 模式下的 Async 判断
                    if (seqId.startsWith("task_") || seqId.startsWith("bg_")) {
                        executeCommands(commands);
                    } else {
                        await executeCommands(commands);
                    }
                }
            }
            else if (step.check) {
                const flagKey = step.check;
                const val = localStorage.getItem(flagKey);
                const isPass = val === 'true' || val === '1';
                const targetSeq = isPass ? step.pass : step.fail;

                if (targetSeq) {
                    // 同样支持 Async 任务
                    const commands = state.scriptData.scripts[targetSeq];
                    if (commands) {
                        if (targetSeq.startsWith("task_") || targetSeq.startsWith("bg_")) {
                            executeCommands(commands);
                        } else {
                            await executeCommands(commands);
                        }
                    }
                }
            }
        }
    }

    async function executeCommands(commands) {
        for (const cmd of commands) {
            if (!state.isRunning) break;
            if (cmd.cmd === 'parallel') {
                await Promise.all(cmd.actions.map(subCmd => processCommand(subCmd)));
            } else {
                await processCommand(cmd);
            }
        }
    }

    // ============================================================
    // 3. 指令处理器
    // ============================================================

    async function processCommand(cmd) {
        try {
            switch (cmd.cmd) {
                case 'wait': await wait(cmd.time); break;
                case 'spawn': await cmd_spawn(cmd); break;
                case 'move_to': case 'move': await cmd_move(cmd); break;
                case 'move_path': await cmd_move_path(cmd); break;
                case 'stop_move':await cmd_stop_move(cmd); break;
                case 'bubble': await cmd_bubble(cmd); break;
                case 'shake': await cmd_shake(cmd); break;
                case 'fight': await cmd_fight(cmd); break;
                case 'set_style': cmd_set_style(cmd); break;
                case 'dialog_box': await cmd_dialog_box(cmd); break;
                case 'loop': await cmd_loop(cmd); break;
                case 'end_show':
                    stop();

                    // === 修改开始：向父窗口发送消息 ===
                    const outcome = cmd.outcome || 'normal';

                    // 判断是否被父页面嵌入 (iframe模式)
                    if (window.parent && window.parent !== window) {
                        console.log(`[Director] Sending ENDING_COMPLETE signal: ${outcome}`);
                        window.parent.postMessage({
                            type: 'ENDING_COMPLETE',
                            outcome: outcome
                        }, '*'); // 在生产环境中建议将 '*' 替换为具体的域名
                    } else {
                        // 如果是单独调试 monitor-system.html，保持原有弹窗
                        alert(`ENDING FINISHED: ${outcome}`);
                    }
                    // === 修改结束 ===

                    break;
                default: console.warn(`[Director] Unknown command: ${cmd.cmd}`);
            }
        } catch (e) {
            console.error(`[Director] Command Error (${cmd.cmd}):`, e);
        }
    }

    // ============================================================
    // 4. 指令实现
    // ============================================================

    async function cmd_spawn(data) {
        const actorDef = state.scriptData.actors[data.actorId];
        if (!actorDef) { console.error(`Actor def missing: ${data.actorId}`); return; }

        const el = document.createElement('div');
        const instanceId = data.alias || data.actorId;

        // 类型样式
        if (actorDef.type === 'rect') el.className = 'stage-actor rect';
        else if (actorDef.type === 'image') el.className = 'stage-actor image';
        else el.className = 'stage-actor circle';

        el.style.backgroundColor = actorDef.color || '#fff';
        el.style.borderColor = actorDef.color || '#fff';

        const displayName = resolveName(actorDef.charId);
        el.setAttribute('data-name', displayName);

        // 位置解析
        let pos = { x: 50, y: 50 };
        if (data.at) {
            pos = resolvePosition(data.at);
        } else {
            const stageActor = getStageActorData(data.actorId);
            if (stageActor) { pos = { x: stageActor.x, y: stageActor.y }; }
            else if (actorDef.x) { pos = { x: actorDef.x, y: actorDef.y }; }
        }

        el.style.left = pos.x + '%';
        el.style.top = pos.y + '%';

        // 记录引用
        // 注意：如果是 crowd 循环 spawn 且没有 alias，会覆盖引用，但这通常是预期的
        state.activeActors[instanceId] = el;
        stageLayer.appendChild(el);

        // 淡入
        el.style.opacity = 0;
        requestAnimationFrame(() => {
            el.style.transition = 'opacity 0.5s';
            el.style.opacity = 1;
        });
    }

    function cmd_move(data) {
        return new Promise(resolve => {
            const el = state.activeActors[data.target];
            if (!el) { resolve(); return; } // Actor 不存在则忽略

            const dest = resolvePosition(data.dest || data.to);
            const duration = data.duration || 1000;
            const ease = data.ease || 'linear';

            el.style.transition = `left ${duration}ms ${ease}, top ${duration}ms ${ease}`;
            el.style.left = dest.x + '%';
            el.style.top = dest.y + '%';

            setTimeout(resolve, duration);
        });
    }

// --- 修改 director-engine.js 中的 cmd_move_path ---
    async function cmd_move_path(data) {
        console.log(`[Debug] Attempting move_path for: ${data.target} via ${data.path}`);

        const el = state.activeActors[data.target];
        if (!el) {
            console.error(`[Error] Actor not found: ${data.target}`);
            return;
        }

        const pathPoints = getStagePathData(data.path);
        if (!pathPoints || pathPoints.length === 0) {
            console.error(`[Error] Path not found or empty: ${data.path}`);
            return;
        }

        console.log(`[Debug] Path found. Points: ${pathPoints.length}`);

        const totalDuration = data.duration || 3000;
        const stepDuration = totalDuration / pathPoints.length;

        for (const point of pathPoints) {
            if (!state.isRunning) break;
            // 确保 transition 生效
            el.style.transition = `left ${stepDuration}ms linear, top ${stepDuration}ms linear`;
            // 强制重绘
            void el.offsetWidth;

            el.style.left = point.x + '%';
            el.style.top = point.y + '%';
            await wait(stepDuration);
        }
    }
    async function cmd_stop_move(data) {
        const el = state.activeActors[data.target];
        if (!el) return;

        // 1. 获取当前计算后的位置 (Computed Style)
        // 这一步是为了把正在移动中的物体“定格”在当前视觉位置
        const computedStyle = window.getComputedStyle(el);
        const currentLeft = computedStyle.left;
        const currentTop = computedStyle.top;

        // 2. 强制停止 transition，并固定在当前位置
        el.style.transition = 'none';
        el.style.left = currentLeft;
        el.style.top = currentTop;

        // 3. 稍微延迟后恢复 transition 属性
        // 这里不需要 await，让它在后台默默恢复即可，不影响主流程继续执行
        setTimeout(() => {
            if(el) el.style.transition = '';
        }, 50);
    }

    async function cmd_bubble(data) {
        const actorEl = state.activeActors[data.target];
        if (!actorEl) return;

        const bubble = document.createElement('div');
        bubble.className = 'director-bubble';

        const content = data.text ? getText(data.text) : "...";
        if (data.content && data.content.type === 'image') {
            bubble.innerHTML = `<img src="${data.content.src}" style="max-width:100px;">`;
        } else {
            bubble.innerText = content;
        }

        bubble.style.position = 'absolute';
        bubble.style.bottom = '120%';
        bubble.style.left = '50%';
        bubble.style.transform = 'translateX(-50%)';
        actorEl.appendChild(bubble);

        await wait(data.duration || 2000);
        bubble.remove();
    }

    async function cmd_shake(data) {
        const el = state.activeActors[data.target];
        if (!el) return;
        const intensity = data.intensity === 'heavy' ? 'shake-hard' : 'shake-normal';
        el.classList.add(intensity);
        await wait(data.duration || 500);
        el.classList.remove(intensity);
    }

    async function cmd_fight(data) {
        const el1 = state.activeActors[data.target1];
        const el2 = state.activeActors[data.target2];

        if (!el1 || !el2) {
            console.warn("[Director] Fight command skipped: targets not found.");
            return;
        }

        const count = data.count || 3; // 碰撞次数
        const speed = data.speed || 150; // 单程速度(毫秒)，越小越快

        // 1. 获取起始位置 (必须解析为数值)
        const getPos = (el) => ({
            leftStr: el.style.left,
            topStr: el.style.top,
            x: parseFloat(el.style.left),
            y: parseFloat(el.style.top)
        });

        const start1 = getPos(el1);
        const start2 = getPos(el2);

        // 2. 计算碰撞中心点 (两个点的中点)
        const midX = (start1.x + start2.x) / 2;
        const midY = (start1.y + start2.y) / 2;

        // 3. 开始循环碰撞
        for (let i = 0; i < count; i++) {
            if (!state.isRunning) break;

            // --- 阶段 A: 冲撞 (Ease-In 加速) ---
            el1.style.transition = `left ${speed}ms ease-in, top ${speed}ms ease-in`;
            el2.style.transition = `left ${speed}ms ease-in, top ${speed}ms ease-in`;

            // 稍微错开一点点位置，避免完全重叠显得假，或者让其中一方稍微击退另一方
            // 这里简单处理：直接撞在一起
            el1.style.left = (midX - 1) + '%'; // 稍微留一点缝隙
            el1.style.top = midY + '%';

            el2.style.left = (midX + 1) + '%';
            el2.style.top = midY + '%';

            await wait(speed);

            // --- 阶段 B: 撞击瞬间 (震动 + 暂停) ---
            // 强制添加 heavy shake
            el1.classList.add('shake-hard');
            el2.classList.add('shake-hard');

            // 可选：撞击时变红一瞬间
            const originColor1 = el1.style.borderColor;
            const originColor2 = el2.style.borderColor;
            el1.style.borderColor = '#fff';
            el2.style.borderColor = '#fff';

            await wait(80); // 撞击停顿感

            // 恢复颜色
            el1.style.borderColor = originColor1;
            el2.style.borderColor = originColor2;
            el1.classList.remove('shake-hard');
            el2.classList.remove('shake-hard');

            // --- 阶段 C: 弹回 (Ease-Out 减速) ---
            // 弹回速度稍微慢一点，体现阻力
            const recoilSpeed = speed * 1.5;

            el1.style.transition = `left ${recoilSpeed}ms ease-out, top ${recoilSpeed}ms ease-out`;
            el2.style.transition = `left ${recoilSpeed}ms ease-out, top ${recoilSpeed}ms ease-out`;

            el1.style.left = start1.leftStr;
            el1.style.top = start1.topStr;

            el2.style.left = start2.leftStr;
            el2.style.top = start2.topStr;

            await wait(recoilSpeed);

            // 两次撞击之间的微小间隔
            await wait(50);
        }
    }

    function cmd_set_style(data) {
        const el = state.activeActors[data.target];
        if (!el) return;
        if (data.color) {
            el.style.backgroundColor = data.color;
            el.style.borderColor = data.color;
        }
    }

    async function cmd_dialog_box(data) {
        const box = document.createElement('div');
        box.className = 'director-subtitle-box';
        box.innerText = getText(data.text);
        uiLayer.innerHTML = '';
        uiLayer.appendChild(box);
        if (data.duration) { await wait(data.duration); box.remove(); }
    }

    async function cmd_loop(data) {
        const count = data.count || 1;
        const interval = data.interval || 200;
        for (let i = 0; i < count; i++) {
            if (!state.isRunning) break;
            // Loop 内部通常是 fire-and-forget 的粒子/人群生成
            executeCommands(data.script);
            await wait(interval);
        }
    }

    // ============================================================
    // 5. 辅助工具 (Helpers)
    // ============================================================

    function resolvePosition(input) {
        if (!input) return { x: 50, y: 50 };
        if (typeof input === 'object' && input.x !== undefined) return input;

        const wp = getStageWaypoint(input);
        if (wp) return wp;

        const zone = getStageZone(input);
        if (zone) {
            return {
                x: zone.x + Math.random() * zone.w,
                y: zone.y + Math.random() * zone.h
            };
        }

        const actorEl = state.activeActors[input];
        if (actorEl) {
            return {
                x: parseFloat(actorEl.style.left),
                y: parseFloat(actorEl.style.top)
            };
        }

        return { x: 50, y: 50 };
    }

    function resolveName(charId) {
        if (window.CharacterConfig && window.CharacterConfig[charId]) {
            return getText(window.CharacterConfig[charId]);
        }
        return charId || "Unknown";
    }

    function getText(obj) {
        if (typeof obj === 'string') return obj;
        if (!obj) return "";
        return obj[state.lang] || obj['cn'] || "";
    }

    // [修复点] 增加非空检查，防止 stageId 不匹配导致报错
    function getStageActorData(actorId) {
        if (!state.stageData || !state.scriptData) return null;
        const mapId = state.scriptData.meta.stageId;
        const stage = state.stageData[mapId];
        return stage && stage.actors ? stage.actors[actorId] : null;
    }

    function getStageWaypoint(wpId) {
        if (!state.stageData || !state.scriptData) return null;
        const mapId = state.scriptData.meta.stageId;
        const stage = state.stageData[mapId];
        return stage && stage.waypoints ? stage.waypoints[wpId] : null;
    }

    function getStageZone(zoneId) {
        if (!state.stageData || !state.scriptData) return null;
        const mapId = state.scriptData.meta.stageId;
        const stage = state.stageData[mapId];
        return stage && stage.zones ? stage.zones[zoneId] : null;
    }

    function getStagePathData(pathId) {
        if (!state.stageData || !state.scriptData) return null;
        const mapId = state.scriptData.meta.stageId;
        const stage = state.stageData[mapId];
        return stage && stage.paths ? stage.paths[pathId] : null;
    }

    // ============================================================
    // 6. DOM & 环境管理
    // ============================================================

    async function ensureConfigsLoaded(scriptId, stageId) {
        let attempts = 0;
        // 等待 monitor-system.html 中的 loader 完成
        while ((!window.EndingConfig || !window.StageConfig) && attempts < 20) {
            await wait(100);
            attempts++;
        }

        state.scriptData = window.EndingConfig;
        state.stageData = window.StageConfig;

        if (!state.scriptData) throw new Error("EndingConfig load failed");
        if (!state.stageData) throw new Error("StageConfig load failed");
    }

    function setupStageDOM() {
        const container = document.getElementById('screenContainer');
        container.innerHTML = '';

        stageLayer = document.createElement('div');
        stageLayer.className = 'director-stage';
        Object.assign(stageLayer.style, {
            position: 'absolute', inset: '0', overflow: 'hidden', background: '#050505'
        });

        uiLayer = document.createElement('div');
        uiLayer.className = 'director-ui';
        Object.assign(uiLayer.style, {
            position: 'absolute', inset: '0', pointerEvents: 'none'
        });

        container.appendChild(stageLayer);
        container.appendChild(uiLayer);
        injectStyles();
    }

    function injectStyles() {
        if (document.getElementById('director-style')) return;
        const css = `
            .stage-actor { position: absolute; width: 16px; height: 16px; border-radius: 50%; border: 2px solid white; transform: translate(-50%, -50%); box-shadow: 0 0 5px rgba(0,0,0,0.5); z-index: 10; transition: opacity 0.3s; }
            .stage-actor.rect { border-radius: 2px; }
            .stage-actor::after { content: attr(data-name); position: absolute; top: -18px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #aaa; white-space: nowrap; text-shadow: 1px 1px 0 #000; }
            .director-bubble { background: rgba(0,0,0,0.8); border: 1px solid var(--cctv-green, #0f0); color: var(--cctv-green, #0f0); padding: 5px 10px; border-radius: 4px; font-size: 12px; white-space: nowrap; z-index: 100; animation: pop-in 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
            .director-subtitle-box { position: absolute; bottom: 10%; width: 80%; left: 10%; text-align: center; background: rgba(0,0,0,0.7); color: white; padding: 10px; font-size: 14px; border-top: 2px solid var(--cctv-green, #0f0); animation: fade-up 0.5s; }
            .shake-normal { animation: shake 0.5s infinite; }
            .shake-hard { animation: shake 0.2s infinite; }
            @keyframes pop-in { from { transform: translateX(-50%) scale(0); } to { transform: translateX(-50%) scale(1); } }
            @keyframes fade-up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes shake { 0% { transform: translate(-51%, -50%); } 25% { transform: translate(-49%, -50%); } 50% { transform: translate(-51%, -50%); } 75% { transform: translate(-49%, -50%); } 100% { transform: translate(-50%, -50%); } }
        `;
        const style = document.createElement('style');
        style.id = 'director-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function lockMonitorInterface() {
        const side = document.querySelector('.sidebar');
        const bar = document.querySelector('.control-bar');
        const layout = document.querySelector('.layout-container');
        if(side) side.style.display = 'none';
        if(bar) bar.style.display = 'none';
        if(layout) layout.style.gridTemplateColumns = '1fr';
    }

    function unlockMonitorInterface() {
        const side = document.querySelector('.sidebar');
        const bar = document.querySelector('.control-bar');
        const layout = document.querySelector('.layout-container');
        if(side) side.style.display = 'flex';
        if(bar) bar.style.display = 'flex';
        if(layout) layout.style.gridTemplateColumns = '250px 1fr';
        if (window.initSystem) window.initSystem();
    }

    function showDialog(text) {
        const d = document.createElement('div');
        d.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:red;color:white;padding:10px;z-index:9999;";
        d.innerText = text;
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 3000);
    }

    const wait = (ms) => new Promise(r => setTimeout(r, ms));

    return { init, start, stop };
})();

window.DirectorEngine = DirectorEngine;
window.addEventListener('DOMContentLoaded', DirectorEngine.init);