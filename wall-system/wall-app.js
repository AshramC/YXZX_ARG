function initializeWallApp() {
  const cfg = window.WALL_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const norm = s => (s || "").toString().trim().toLowerCase().replace(/\s+/g, "");
  const STORAGE_ADMIN = "WALL_ADMIN";

  // === 核心状态：当前视图模式 ===
  // 'home'    = 正常主页 (posts + searchOnlyPosts)
  // 'deleted' = 回收站/已删除记录 (deletedPosts only)
  let currentMode = 'home';

  // ---------- 1. 管理员状态管理 ----------
  function isAdmin() {
    return localStorage.getItem(STORAGE_ADMIN) === "1";
  }

  function setAdmin(on) {
    on ? localStorage.setItem(STORAGE_ADMIN, "1") : localStorage.removeItem(STORAGE_ADMIN);
  }

  function applyAdminUI() {
    const on = isAdmin();
    const adminStatus = $('#adminStatus');
    const loginBtn = $('#loginBtn');
    const navDeleted = $('#navDeleted'); // 获取“已删除记录”导航项

    if (adminStatus) adminStatus.style.display = on ? "flex" : "none";
    if (loginBtn) loginBtn.style.display = on ? "none" : "block";

    // 核心逻辑：只有管理员才能看到“已删除记录”入口
    if (navDeleted) {
      navDeleted.style.display = on ? "flex" : "none";

      // 安全检查：如果退出了管理员，且当前正停留在删除页，强制踢回主页
      if (!on && currentMode === 'deleted') {
        switchMode('home');
      }
    }
  }

  // ---------- 2. 视图切换逻辑 ----------
  function switchMode(mode) {
    currentMode = mode;

    // 1. 更新导航栏 UI 高亮状态
    $$('.nav-item').forEach(el => el.classList.remove('active'));
    if (mode === 'home') {
      const el = $('#navHome');
      if(el) el.classList.add('active');
    }
    if (mode === 'deleted') {
      const el = $('#navDeleted');
      if(el) el.classList.add('active');
    }

    // 2. 刷新数据 (复用搜索逻辑，它会根据 currentMode 选择数据源)
    // 注意：切换模式时不清空搜索框，这样可以在不同视图下搜同一个词
    doSearch();
  }

  // ---------- 3. 渲染辅助函数 ----------

  // 渲染左侧推荐话题 Tag
  function renderChips() {
    const box = $("#chips");
    if (!box) return;
    box.innerHTML = "";
    (cfg.recommendedTags || []).forEach(t => {
      const el = document.createElement("div");
      el.className = "nav-item";
      el.style.fontSize = "0.9rem";
      el.innerHTML = `<span style="color:var(--brand)">#</span> ${t}`;
      // 点击左侧话题 -> 切换回主页 -> 搜索该话题 -> 触发右侧详情
      el.addEventListener("click", () => handleTagClick(t));
      box.appendChild(el);
    });
  }

  // 渲染置顶公告 (仅在主页显示)
  function renderPinned() {
    const container = $("#pinned");
    if (!container) return;
    container.innerHTML = "";

    (cfg.pinned || []).forEach(p => {
      const div = document.createElement("div");
      div.className = "post-card";
      div.style.borderLeft = "4px solid var(--brand)";
      div.style.background = "#fff7ed";

      let summary = p.body || "";
      if (summary.length > 80) summary = summary.substring(0, 80) + "...";

      div.innerHTML = `
        <div class="post-header">
            <div class="post-title">📌 ${p.title}</div>
            <div class="post-meta">公告</div>
        </div>
        <div class="post-body">${summary}</div>
      `;
      // 修复交互：置顶贴也需要点击查看详情
      div.addEventListener("click", () => openDetail(p, false));
      container.appendChild(div);
    });
  }

  // 生成帖子卡片 HTML
  function postToHTML(p, isDeleted) {
    // 给 Tag 添加 action-tag 类，用于事件委托拦截
    const tags = (p.tags || []).map(t => `<span class="tag action-tag" data-tag="${t}">${t}</span>`).join("");

    // 如果是删除模式，添加 .deleted 类以应用“黑客/终端”风格 CSS
    const delClass = isDeleted ? " deleted" : "";
    const delBadge = isDeleted ? `<span style="font-size:0.8rem;color:#ef4444;border:1px solid;padding:0 4px;margin-left:6px">REMOVED</span>` : "";

    let summary = p.body;
    if (summary.length > 100) summary = summary.substring(0, 100) + "...";

    return `
      <div class="post-card${delClass}" data-id="${p.id}" data-deleted="${isDeleted?1:0}">
        <div class="post-header">
            <div class="post-title">${p.title} ${delBadge}</div>
            <div class="post-meta">${p.createdAt || "刚刚"}</div>
        </div>
        <div class="post-body">${summary}</div>
        <div class="post-footer">
            <div class="tag-list">${tags}</div>
            <div style="font-size:0.85rem; color:var(--text-muted)">
                💬 ${(p.comments||[]).length}
            </div>
        </div>
      </div>`;
  }

  // ---------- 4. 核心交互逻辑 ----------

  // 处理 Tag 点击 (核心：联动搜索 + 话题剧情)
  function handleTagClick(tag) {
    // 1. 强制切回主页 (话题剧情通常基于公开信息)
    if (currentMode !== 'home') switchMode('home');

    // 2. 填入搜索框并执行搜索
    $('#q').value = tag;
    doSearch();

    // 3. 检查是否有话题专属剧情配置 (Topic Config)
    const tCfg = (cfg.topics || {})[tag];

    if (tCfg) {
      // 如果有配置，右侧显示富文本剧情面板
      const detailBox = $("#detailContent");
      const ev = (tCfg.evidence || []).map(a =>
          `<div class="evidence-box">证据碎片：${a.name} <div style="font-size:0.8rem;color:#666">${a.caption||""}</div></div>`
      ).join("");

      const cmts = (tCfg.comments || []).map(c =>
          `<div class="comment-item"><div class="comment-author">${c.author}</div><div>${c.body}</div></div>`
      ).join("");

      detailBox.innerHTML = `
            <div style="animation: fadeIn 0.3s">
                <div style="color:var(--brand); font-weight:700; margin-bottom:0.5rem;">话题档案</div>
                <h2>#${tCfg.title}</h2>
                <div style="color:#4b5563; margin-bottom:1rem; line-height:1.6;">${tCfg.lead || "暂无简介"}</div>
                ${ev}
                <div class="comment-box">
                   <div style="font-weight:700; margin-bottom:1rem;">相关讨论</div>
                   ${cmts}
                </div>
            </div>
        `;

      // 移动端适配
      if (window.innerWidth <= 768) {
        $('#rightPanel').classList.add('active');
        $('#closeDetailBtn').style.display = 'block';
      }
    }
    // 如果没有 Topic 配置，右侧保持“点击帖子查看详情”或当前状态不变
  }

  // 渲染帖子流列表
  function renderFeed(list, emptyMsg) {
    const feed = $("#feed");
    if (!feed) return;

    if (!list.length) {
      feed.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted);">${emptyMsg || "空空如也"}</div>`;
    } else {
      feed.innerHTML = list.map(x => postToHTML(x.item, x.deleted)).join("");
    }

    // 绑定卡片点击事件 (查看详情)
    $$(".post-card[data-id]").forEach(el => {
      el.addEventListener("click", (e) => {
        // 修复：防止点击 Tag 时同时也触发卡片打开
        if (e.target.classList.contains('action-tag')) return;

        const id = el.getAttribute("data-id");
        let p = null;

        // 根据当前模式去不同的数据源找帖子
        if (currentMode === 'deleted') {
          p = (cfg.deletedPosts || []).find(x => x.id === id);
        } else {
          // 主页模式下，可能在普通贴，也可能在搜索出的隐藏贴中
          p = (cfg.posts || []).find(x => x.id === id) ||
              (cfg.searchOnlyPosts || []).find(x => x.id === id);
        }

        if (p) openDetail(p, currentMode === 'deleted');
      });
    });

    // 绑定卡片内部的 Tag 点击事件
    $$(".action-tag").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation(); // 阻止冒泡到卡片点击
        handleTagClick(el.dataset.tag);
      });
    });
  }

  // 打开右侧详情页
  function openDetail(p, isDeleted) {
    const box = $("#detailContent");

    const tags = (p.tags || []).map(t => `<span class="tag action-tag-detail" data-tag="${t}">${t}</span>`).join("");
    const comments = (p.comments || []).map(c => `
        <div class="comment-item">
            <div class="comment-author">${c.author}</div>
            <div style="font-size:0.9rem; color:#374151;">${c.body}</div>
        </div>
    `).join("");

    const attachments = (p.attachments || []).map(a => `
        <div class="evidence-box">
            <strong>📎 附件:</strong> ${a.name}
            <div style="font-size:0.8rem; color:#666; margin-top:4px">${a.caption||""}</div>
        </div>
    `).join("");

    box.innerHTML = `
      <div style="animation: fadeIn 0.3s">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem;">
            ${p.author} · ${p.createdAt || "未知时间"} 
            ${isDeleted ? '<span style="color:var(--danger)">(已删除)</span>' : ''}
        </div>
        <h2>${p.title}</h2>
        <div style="line-height:1.8; color:#1f2937; margin:1rem 0; white-space:pre-wrap;">${p.body}</div>
        
        ${attachments}
        
        <div style="margin-top:1rem; padding-bottom:1rem; border-bottom:1px solid #eee;">
            ${tags}
        </div>
        
        <div class="comment-box">
            <div style="font-weight:700; margin-bottom:1rem;">评论 (${(p.comments||[]).length})</div>
            ${comments || '<div style="color:#999; font-size:0.9rem">暂无评论</div>'}
        </div>
      </div>
    `;

    // 详情页里的 Tag 也要能点
    $$(".action-tag-detail").forEach(el => {
      el.addEventListener("click", () => handleTagClick(el.dataset.tag));
    });

    // 移动端适配
    if (window.innerWidth <= 768) {
      $('#rightPanel').classList.add('active');
      $('#closeDetailBtn').style.display = 'block';
    }
  }

  window.closeDetail = function() {
    $('#rightPanel').classList.remove('active');
  }

  // ---------- 5. 核心搜索/数据分发逻辑 ----------
  function doSearch() {
    const q = ($("#q").value || "").trim();
    const pinned = $("#pinned");

    // 1. 控制置顶显隐
    // 逻辑：只有在 [主页模式] 且 [没有搜索词] 时才显示置顶
    // 如果在删除页，或者正在搜索，置顶区隐藏，减少干扰
    if (pinned) {
      pinned.style.display = (currentMode === 'home' && !q) ? "block" : "none";
    }

    const list = [];

    // 通用匹配函数 (匹配标题、正文、标签、别名、附件名)
    function match(p) {
      if (!q) return true; // 没搜词就返回所有
      const pool = [
        p.title,
        p.body,
        (p.tags || []).join(" "),
        (p.aliases || []).join(" "),
        (p.attachments || []).map(a => a.name).join(" ")
      ].join(" || ");
      return norm(pool).includes(norm(q));
    }

    // 2. 根据 currentMode 决定数据源 (完全隔离)
    if (currentMode === 'home') {
      // === 主页模式 ===
      // 数据源 A: 普通帖子 (posts)
      (cfg.posts || []).filter(match).forEach(p => list.push({
        item: p,
        deleted: false
      }));

      // 数据源 B: 隐藏帖子 (searchOnlyPosts)
      // 规则：只有当搜索框有内容(q)，且匹配成功时，才显示
      if (q) {
        (cfg.searchOnlyPosts || []).filter(match).forEach(p => list.push({
          item: p,
          deleted: false
        }));
      }
    }
    else if (currentMode === 'deleted') {
      // === 删除模式 ===
      // 数据源 C: 仅删除帖子 (deletedPosts)
      // 强制标记 deleted: true，以便 postToHTML 应用黑客风格样式
      (cfg.deletedPosts || []).filter(match).forEach(p => list.push({
        item: p,
        deleted: true
      }));
    }

    // 3. 渲染列表
    const emptyText = currentMode === 'deleted' ? "系统日志中未检索到相关删除记录" : "没有找到相关内容";
    renderFeed(list, emptyText);
  }

  // ---------- 6. 启动与事件绑定 ----------
  function boot() {
    if ($('#termInfo')) $('#termInfo').textContent = cfg.termInfo || "";

    // 搜索事件
    $('#doSearch').addEventListener('click', doSearch);
    $('#q').addEventListener('keydown', e => {
      if (e.key === 'Enter') doSearch();
    });

    // 导航点击事件
    $('#navHome').addEventListener('click', () => switchMode('home'));

    // “已删除记录”导航项 (可能不存在，如果HTML没写好，所以要做空判断)
    const navDel = $('#navDeleted');
    if (navDel) navDel.addEventListener('click', () => switchMode('deleted'));

    // 初始化
    renderPinned();
    renderChips();
    applyAdminUI(); // 检查本地存储的 admin 状态

    // 默认进入主页
    switchMode('home');

    // 登录弹窗逻辑
    $('#loginBtn').addEventListener('click', () => $('#loginModal').style.display = 'flex');
    $('#cancelLogin').addEventListener('click', () => $('#loginModal').style.display = 'none');

    // 退出登录逻辑
    $('#logoutBtn').addEventListener('click', () => {
      setAdmin(false);
      applyAdminUI();
      switchMode('home'); // 退出后强制回主页
    });

    // 确认登录逻辑
    $('#confirmLogin').addEventListener('click', () => {
      const u = ($('#adminUser').value || '').trim();
      const p = ($('#adminPass').value || '');

      if (u === (cfg.admin?.username) && p === (cfg.admin?.password)) {
        setAdmin(true);
        applyAdminUI();
        $('#loginModal').style.display = 'none';
        // 登录成功后，不强制跳转，只是显示了红色的删除入口，需要用户自己去发现
      } else {
        $('#loginError').style.display = 'block';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', boot);
}