// ─── PAGE NAVIGATION ───

function switchPage(pageName) {
  const normalizedPage = String(pageName || '').toLowerCase();

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const targetPage = document.getElementById('page-' + normalizedPage);
  if (targetPage) {
    targetPage.classList.add('active');
  }

  const targetNav = document.querySelector(`.nav-btn[data-page="${normalizedPage}"]`);
  if (targetNav) {
    targetNav.classList.add('active');
  }

  // Refresh data-dependent pages whenever they're shown
  if (normalizedPage === 'tools') {
    renderComparison();
  }
  if (normalizedPage === 'stats') {
    renderStats();
  }
  if (normalizedPage === 'library') {
    if (typeof onLibraryPageOpen === 'function') {
      onLibraryPageOpen();
    }
  }

  closeSidebar();
}

function switchTool(toolName) {
  document.querySelectorAll('.tool-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tools-tab').forEach(b => b.classList.remove('active'));

  document.getElementById('tool-' + toolName).classList.add('active');
  document.querySelector(`.tools-tab[data-tool="${toolName}"]`).classList.add('active');

  if (toolName === 'target') {
    renderTargetSnapshot();
  }
}

// ─── SIDEBAR (mobile) ───

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ─── SIDEBAR COLLAPSE (desktop rail) ───

function toggleCollapse() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('collapse-toggle');
  const isCollapsed = sidebar.classList.toggle('collapsed');
  btn.title = isCollapsed ? 'Expand menu' : 'Collapse menu';
}
