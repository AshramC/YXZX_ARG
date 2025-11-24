window.initializeWallApp = function() {
  const cfg = window.WALL_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // 【基础工具】标准化字符串 (去空格，转小写)
  const norm = s => (s || "").toString().trim().toLowerCase().replace(/\s+/g, "");

  const STORAGE_ADMIN = "WALL_ADMIN";
  let currentMode = 'home';

  // =========================================================
  // 1. 初始化 (Boot Logic)
  // =========================================================

  // 清理界面
  $('#feed').innerHTML = '';
  $('#pinned').innerHTML = '';
  $('#chips').innerHTML = '';
  $('#termInfo').textContent = cfg.termInfo || "";

  // 绑定事件
  $('#doSearch').onclick = doSearch;
  $('#q').onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };

  $('#navHome').onclick = () => switchMode('home');
  const navDel = $('#navDeleted');
  if (navDel) navDel.onclick = () => switchMode('deleted');

  // 登录/退出逻辑
  $('#loginBtn').onclick = () => $('#loginModal').style.display = 'flex';
  $('#cancelLogin').onclick = () => $('#loginModal').style.display = 'none';

  $('#logoutBtn').onclick = () => {
    setAdmin(false);
    applyAdminUI();
    switchMode('home');
  };

  $('#confirmLogin').onclick = () => {
    const u = ($('#adminUser').value || '').trim();
    const p = ($('#adminPass').value || '');
    // 简单校验
    if (u === (cfg.admin?.username) && p === (cfg.admin?.password)) {
      setAdmin(true);
      applyAdminUI();
      $('#loginModal').style.display = 'none';
    } else {
      $('#loginError').style.display = 'block';
    }
  };

  // 初始渲染
  renderPinned();
  renderChips();
  applyAdminUI();
  switchMode('home');

  // =========================================================
  // 2. 状态与视图管理
  // =========================================================

  function isAdmin() {
    return localStorage.getItem(STORAGE_ADMIN) === "1";
  }

  function setAdmin(on) {
    on ? localStorage.setItem(STORAGE_ADMIN, "1") : localStorage.removeItem(STORAGE_ADMIN);
  }

  function applyAdminUI() {
    const on = isAdmin();
    $('#adminStatus').style.display = on ? "flex" : "none";
    $('#loginBtn').style.display = on ? "none" : "block";
    if ($('#navDeleted')) {
      $('#navDeleted').style.display = on ? "flex" : "none";
      // 如果退出管理员时正处于删除页，强制踢回主页
      if (!on && currentMode === 'deleted') switchMode('home');
    }
  }

  function switchMode(mode) {
    currentMode = mode;
    $$('.nav-item').forEach(el => el.classList.remove('active'));

    // 更新导航高亮
    if (mode === 'home') $('#navHome').classList.add('active');
    if (mode === 'deleted' && $('#navDeleted')) $('#navDeleted').classList.add('active');

    // 【修改点 1】删除模式下，不允许搜索 -> 隐藏搜索框
    const searchCard = $('.search-bar-card');
    if (searchCard) {
      searchCard.style.display = (mode === 'deleted') ? 'none' : 'flex';
    }

    // 重置搜索框内容（切模式清空输入）
    $('#q').value = '';

    // 刷新列表
    doSearch();
  }

  // =========================================================
  // 3. 核心搜索逻辑 (Mixed Strategy)
  // =========================================================
  function doSearch() {
    const qRaw = ($("#q").value || "").trim();
    const qNorm = norm(qRaw); // 标准化输入

    // 控制置顶显示：仅主页且无搜索时显示
    const pinned = $("#pinned");
    if (pinned) {
      pinned.style.display = (currentMode === 'home' && !qRaw) ? "block" : "none";
    }

    const list = [];

    // --- 策略 A: 模糊搜索 (用于普通帖子) ---
    function matchFuzzy(p) {
      if (!qRaw) return true; // 没输入则显示所有
      // 拼接所有字段进行宽泛匹配
      const contentPool = [
        p.title,
        p.body,
        (p.tags || []).join(" "),
        (p.aliases || []).join(" "), // 普通贴也可以搜别名
        p.author
      ].join(" ");
      return norm(contentPool).includes(qNorm);
    }

    // --- 策略 B: 严格别名搜索 (用于隐藏帖子) ---
    function matchStrictAlias(p) {
      if (!qRaw) return false; // 没输入绝对不显示
      const aliases = (p.aliases || []);
      // 逻辑：只要有一个别名标准化后 === 输入标准化，即匹配
      // 允许：大小写、空格差异 (因为 norm 处理过了)
      // 不允许：只匹配正文、部分匹配 ("Zhang" 不匹配 "Zhang Chen")
      return aliases.some(a => norm(a) === qNorm);
    }

    // --- 数据分发 ---
    if (currentMode === 'home') {
      // 1. 普通帖子 -> 模糊匹配
      (cfg.posts || []).filter(matchFuzzy).forEach(p => list.push({ item: p, deleted: false }));

      // 2. 隐藏帖子 -> 严格别名匹配 (仅当有搜索词时)
      if (qRaw) {
        (cfg.searchOnlyPosts || []).filter(matchStrictAlias).forEach(p => list.push({ item: p, deleted: false }));
      }
    }
    else if (currentMode === 'deleted') {
      // 3. 删除帖子 -> 不允许搜索 (直接展示所有)
      // 因为 switchMode 已经隐藏了搜索框，这里直接把所有 deletedPosts 倒进去即可
      (cfg.deletedPosts || []).forEach(p => list.push({ item: p, deleted: true }));
    }

    // --- 渲染 ---
    const isEn = localStorage.getItem('app_lang') === 'en';
    const emptyText = currentMode === 'deleted'
        ? (isEn ? "No deleted logs found" : "系统日志中未检索到相关删除记录")
        : (isEn ? "No posts found" : "没有找到相关内容");

    renderFeed(list, emptyText);
  }

  // =========================================================
  // 4. 渲染与交互函数
  // =========================================================

  function renderChips() {
    const box = $("#chips");
    (cfg.recommendedTags || []).forEach(t => {
      const el = document.createElement("div");
      el.className = "nav-item";
      el.style.fontSize = "0.9rem";
      el.innerHTML = `<span style="color:var(--brand)">#</span> ${t}`;
      el.onclick = () => handleTagClick(t);
      box.appendChild(el);
    });
  }

  function renderPinned() {
    const container = $("#pinned");
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
            <div class="post-meta">${localStorage.getItem('app_lang')==='en'?'Notice':'公告'}</div>
        </div>
        <div class="post-body">${summary}</div>
      `;
      div.onclick = () => openDetail(p, false);
      container.appendChild(div);
    });
  }

  function postToHTML(p, isDeleted) {
    const tags = (p.tags || []).map(t => `<span class="tag action-tag" data-tag="${t}">${t}</span>`).join("");
    const delClass = isDeleted ? " deleted" : "";
    const removedText = localStorage.getItem('app_lang')==='en'?'REMOVED':'已删除';
    const delBadge = isDeleted ? `<span style="font-size:0.8rem;color:#ef4444;border:1px solid;padding:0 4px;margin-left:6px">${removedText}</span>` : "";

    let summary = p.body;
    if (summary.length > 100) summary = summary.substring(0, 100) + "...";

    return `
      <div class="post-card${delClass}" data-id="${p.id}" data-deleted="${isDeleted?1:0}">
        <div class="post-header">
            <div class="post-title">${p.title} ${delBadge}</div>
            <div class="post-meta">${p.createdAt || ""}</div>
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

  function renderFeed(list, emptyMsg) {
    const feed = $("#feed");
    if (!list.length) {
      feed.innerHTML = `<div style="text-align:center; padding:3rem; color:var(--text-muted);">${emptyMsg}</div>`;
    } else {
      feed.innerHTML = list.map(x => postToHTML(x.item, x.deleted)).join("");
    }

    // 卡片点击
    $$(".post-card[data-id]").forEach(el => {
      el.onclick = (e) => {
        if (e.target.classList.contains('action-tag')) return;
        const id = el.getAttribute("data-id");
        let p = null;
        if (currentMode === 'deleted') {
          p = (cfg.deletedPosts || []).find(x => x.id === id);
        } else {
          p = (cfg.posts || []).find(x => x.id === id) || (cfg.searchOnlyPosts || []).find(x => x.id === id);
        }
        if (p) openDetail(p, currentMode === 'deleted');
      };
    });

    // Tag 点击
    $$(".action-tag").forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        handleTagClick(el.dataset.tag);
      };
    });
  }

  function handleTagClick(tag) {
    if (currentMode !== 'home') switchMode('home');
    $('#q').value = tag;
    doSearch();
  }

  function openDetail(p, isDeleted) {
    const box = $("#detailContent");
    const isEn = localStorage.getItem('app_lang') === 'en';

    const tags = (p.tags || []).map(t => `<span class="tag action-tag-detail" data-tag="${t}">${t}</span>`).join("");
    const comments = (p.comments || []).map(c => `
        <div class="comment-item">
            <div class="comment-author">${c.author}</div>
            <div style="font-size:0.9rem; color:#374151;">${c.body}</div>
        </div>
    `).join("");

    const delLabel = isDeleted ? `<span style="color:var(--danger)">(${isEn?'Deleted':'已删除'})</span>` : '';

    box.innerHTML = `
      <div style="animation: fadeIn 0.3s">
        <div style="font-size:0.85rem; color:var(--text-muted); margin-bottom:0.5rem;">
            ${p.author} · ${p.createdAt || ""} ${delLabel}
        </div>
        <h2>${p.title}</h2>
        <div style="line-height:1.8; color:#1f2937; margin:1rem 0; white-space:pre-wrap;">${p.body}</div>
        
        <div style="margin-top:1rem; padding-bottom:1rem; border-bottom:1px solid #eee;">
            ${tags}
        </div>
        
        <div class="comment-box">
            <div style="font-weight:700; margin-bottom:1rem;">${isEn?'Comments':'评论'} (${(p.comments||[]).length})</div>
            ${comments || `<div style="color:#999; font-size:0.9rem">${isEn?'No comments':'暂无评论'}</div>`}
        </div>
      </div>
    `;

    $$(".action-tag-detail").forEach(el => {
      el.onclick = () => handleTagClick(el.dataset.tag);
    });

    if (window.innerWidth <= 768) {
      $('#rightPanel').classList.add('active');
      $('#closeDetailBtn').style.display = 'block';
    }
  }

  window.closeDetail = function() {
    $('#rightPanel').classList.remove('active');
  }
};