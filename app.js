// =========================================================
// BroZ Food Billing Portal — v2
// - Centralized shared Drive folder (no per-user fragmentation)
// - Token auto-refresh
// - Item categories (Food / Beverage / Alcohol)
// - Menu UX: search, category tabs, qty +/- on chip click
// - Sales dashboard (revenue, by category, by property, top items, daily)
// - Bug fixes: invoice number persistence, race conditions, etc.
// =========================================================

const CREDS = {
  admin: { password: 'broz123', role: 'admin' },
  user:  { password: 'broz',    role: 'user' },
};

const $ = (id) => document.getElementById(id);

const PROPERTIES = [
  { key: 'samalbong', name: 'Tibetan Villa Samalbong',                  prefix: 'SAM', address: 'Raidara, Samalbong, Kalimpong - 734301' },
  { key: 'gangtok',   name: 'BroZ Nazom Retreat, Gangtok',              prefix: 'GTK', address: 'Manbir Colony, Gangtok, Sikkim - 737101' },
  { key: 'sisamara',  name: 'Sisamara River View Forest Villa, Jaldapara', prefix: 'JLD', address: 'Munshipara, Jaldapara, West Bengal 736204' },
];

const COUNTRY_CODES = [
  { code: '+91', name: 'India', flag: '\ud83c\uddee\ud83c\uddf3', digits: 10 },
  { code: '+1',  name: 'USA/Canada', flag: '\ud83c\uddfa\ud83c\uddf8', digits: 10 },
  { code: '+44', name: 'UK', flag: '\ud83c\uddec\ud83c\udde7', digits: 10 },
  { code: '+61', name: 'Australia', flag: '\ud83c\udde6\ud83c\uddfa', digits: 9 },
  { code: '+971', name: 'UAE', flag: '\ud83c\udde6\ud83c\uddea', digits: 9 },
  { code: '+65', name: 'Singapore', flag: '\ud83c\uddf8\ud83c\uddec', digits: 8 },
  { code: '+977', name: 'Nepal', flag: '\ud83c\uddf3\ud83c\uddf5', digits: 10 },
  { code: '+880', name: 'Bangladesh', flag: '\ud83c\udde7\ud83c\udde9', digits: 10 },
  { code: '+975', name: 'Bhutan', flag: '\ud83c\udde7\ud83c\uddf9', digits: 8 },
];

const CATEGORIES = ['Food', 'Beverage', 'Alcohol'];

let currentUser = null;
let selectedProperty = null;
let editingRecord = null;

// Menu UI state
let currentMenuFilterCategory = 'All';
let currentMenuSearch = '';

const DRIVE_FOLDER_NAME = 'BroZ Food Bills';
const SHARED_FOLDER_STORAGE_KEY = 'broz_shared_folder_id';

const DriveState = {
  clientId: null,
  accessToken: null,
  tokenExpiry: 0,
  folderId: null,           // Active root folder (shared if configured, else personal)
  sharedFolderId: null,     // Configured shared folder ID (centralized) — null = use personal
  tokenClient: null,
  ready: false,
  cache: null,              // Past invoices cache
  refreshTimer: null,
  refreshing: false,
  initialFolderResolved: false,
};

const FolderCache = {};

// In-memory menu cache (loaded from Drive, fallback to localStorage)
const MenuCache = {}; // { [propKey]: { items: [...], updatedAt } }

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.yr').forEach(el => el.textContent = new Date().getFullYear());
  // Read configured shared folder ID (meta tag first, then localStorage override)
  const meta = document.querySelector('meta[name="broz-shared-folder-id"]');
  const metaSharedId = meta ? (meta.content || '').trim() : '';
  const localSharedId = (localStorage.getItem(SHARED_FOLDER_STORAGE_KEY) || '').trim();
  DriveState.sharedFolderId = localSharedId || metaSharedId || null;

  initLogin();
  initGlobalActions();
  initFoodBilling();
  initMenuManagement();
  initArchive();
  initDashboard();
  initDriveSettings();
  initWhatsApp();
  initDrive();
  renderPropertyTiles();
});

// =========================================================
// NAVIGATION
// =========================================================
const ALL_SCREENS = ['loginScreen', 'homeScreen', 'foodBillingScreen', 'menuManagementScreen', 'archiveScreen', 'dashboardScreen'];

function showScreen(id) {
  ALL_SCREENS.forEach(sid => {
    const el = $(sid);
    if (el) el.classList.toggle('hidden', sid !== id);
  });
  window.scrollTo(0, 0);
}

// =========================================================
// LOGIN
// =========================================================
function initLogin() {
  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const u = $('loginUser').value.trim();
    const p = $('loginPass').value;
    const err = $('loginError');

    if (CREDS[u] && CREDS[u].password === p) {
      currentUser = { username: u, role: CREDS[u].role };
      err.classList.remove('show');
      err.textContent = '';
      updateUIForUser();
      $('loginScreen').style.opacity = '0';
      setTimeout(() => {
        showScreen('homeScreen');
        $('loginScreen').style.opacity = '1';
      }, 400);
      // Auto-load menus from Drive in background if connected
      if (isDriveConnected()) {
        refreshAllMenusFromDrive().catch(() => {});
      }
    } else {
      err.textContent = 'Invalid credentials. Please try again.';
      err.classList.add('show');
      $('loginForm').classList.add('shake');
      setTimeout(() => $('loginForm').classList.remove('shake'), 400);
    }
  });
}

function updateUIForUser() {
  const isAdmin = currentUser && currentUser.role === 'admin';
  $('homeUserLabel').textContent = isAdmin ? 'Admin' : 'User';
  $('homePastInvoicesBtn').style.display = isAdmin ? '' : 'none';
  $('homeManageMenusBtn').style.display = isAdmin ? '' : 'none';
  $('homeDashboardBtn').style.display = isAdmin ? '' : 'none';
  $('homeDriveSettingsBtn').style.display = isAdmin ? '' : 'none';

  // FIX: Drive connect is available to BOTH admin and user so non-admin staff
  // can also save bills to the shared folder. (Previously hidden for non-admin.)
  const driveStatus = document.querySelectorAll('[data-drive-status]');
  driveStatus.forEach(el => el.style.display = '');
}

// =========================================================
// HOME - PROPERTY TILES
// =========================================================
function renderPropertyTiles() {
  const container = $('propertyTiles');
  container.innerHTML = PROPERTIES.map(p => `
    <button class="chooser-card" data-property="${p.key}">
      <h3>${esc(p.name)}</h3>
      <p>${esc(p.address)}</p>
      <span class="chooser-cta">Create Food Bill <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>
    </button>
  `).join('');

  container.querySelectorAll('.chooser-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedProperty = card.dataset.property;
      openFoodBilling();
    });
  });
}

function openFoodBilling() {
  const prop = PROPERTIES.find(p => p.key === selectedProperty);
  if (!prop) return;
  $('f_propertyDisplay').textContent = prop.name;
  showScreen('foodBillingScreen');
  resetFoodForm();
  loadMenuItemsIntoUI(selectedProperty);
  // Refresh menu from Drive in background — if it returns a newer menu, re-render
  if (isDriveConnected()) {
    loadMenuFromDrive(selectedProperty).then((loaded) => {
      if (loaded) loadMenuItemsIntoUI(selectedProperty);
    }).catch(() => {});
  }
}

// =========================================================
// GLOBAL ACTIONS
// =========================================================
function initGlobalActions() {
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'logout') {
      logout();
    } else if (action === 'back') {
      showScreen('homeScreen');
    } else if (action === 'pdf') {
      downloadPDF(btn.dataset.target);
    } else if (action === 'reset') {
      if (btn.dataset.form === 'food') resetFoodForm();
    } else if (action === 'drive-connect') {
      driveConnect();
    } else if (action === 'close-modal') {
      closeModal();
    } else if (action === 'download-invoice') {
      downloadModalInvoice();
    } else if (action === 'delete-invoice') {
      deleteModalInvoice();
    } else if (action === 'edit-invoice') {
      editInvoice(currentModalRecord);
    } else if (action === 'cancel-invoice') {
      cancelInvoice(currentModalRecord);
    } else if (action === 'past-invoices') {
      showScreen('archiveScreen');
      loadArchive();
    } else if (action === 'manage-menus') {
      showScreen('menuManagementScreen');
      populateMenuPropertySelect();
    } else if (action === 'dashboard') {
      showScreen('dashboardScreen');
      loadDashboard();
    } else if (action === 'drive-settings') {
      openDriveSettings();
    } else if (action === 'close-drive-settings') {
      closeDriveSettings();
    } else if (action === 'drive-settings-save') {
      saveDriveSettings();
    } else if (action === 'drive-settings-clear') {
      clearDriveSettings();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); closeDriveSettings(); }
  });
}

function logout() {
  currentUser = null;
  editingRecord = null;
  selectedProperty = null;
  $('loginForm').reset();
  $('foodForm').reset();
  resetFoodForm();
  // Reset visibility-dependent UI so next login shows correct buttons
  ['homePastInvoicesBtn', 'homeManageMenusBtn', 'homeDashboardBtn', 'homeDriveSettingsBtn'].forEach(id => {
    const el = $(id); if (el) el.style.display = 'none';
  });
  showScreen('loginScreen');
}

// =========================================================
// FOOD BILLING
// =========================================================
function initFoodBilling() {
  populateCountryCode('f_countryCode');
  $('f_addItem').addEventListener('click', () => addFoodItemRow());
  $('f_itemsContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove');
    if (!btn) return;
    const container = $('f_itemsContainer');
    const rows = container.querySelectorAll('.food-item-row');
    if (rows.length > 1) btn.closest('.food-item-row').remove();
    else {
      const row = btn.closest('.food-item-row');
      row.querySelector('.item-name').value = '';
      row.querySelector('.item-qty').value = '1';
      row.querySelector('.item-price').value = '';
      const catSel = row.querySelector('.item-cat'); if (catSel) catSel.value = 'Food';
      updateItemTotal(row);
    }
    renderFoodInvoice();
    loadMenuItemsIntoUI(selectedProperty); // refresh "already added" highlights
  });
  $('f_itemsContainer').addEventListener('input', (e) => {
    const row = e.target.closest('.food-item-row');
    if (row) { updateItemTotal(row); renderFoodInvoice(); loadMenuItemsIntoUI(selectedProperty); }
  });
  $('f_itemsContainer').addEventListener('change', (e) => {
    if (e.target.classList.contains('item-cat')) renderFoodInvoice();
  });
  $('f_discount').addEventListener('input', renderFoodInvoice);
  $('f_roomNo').addEventListener('input', renderFoodInvoice);
  $('f_guestName').addEventListener('input', renderFoodInvoice);
  $('f_authorizedBy').addEventListener('input', renderFoodInvoice);
  $('f_notes').addEventListener('input', renderFoodInvoice);

  // Menu search + category tabs
  const search = $('f_menuSearch');
  if (search) {
    search.addEventListener('input', () => {
      currentMenuSearch = search.value.toLowerCase().trim();
      renderMenuChips(selectedProperty);
    });
  }

  $('foodForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!$('foodForm').checkValidity()) { $('foodForm').reportValidity(); return; }
    renderFoodInvoice(true);
    saveFoodBillToDrive();
    if (window.innerWidth < 1100) {
      $('foodInvoiceDoc').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function addFoodItemRow(name = '', qty = 1, price = '', category = 'Food') {
  const container = $('f_itemsContainer');
  const row = document.createElement('div');
  row.className = 'food-item-row';
  const catOptions = CATEGORIES.map(c => `<option value="${c}" ${c === category ? 'selected' : ''}>${c}</option>`).join('');
  row.innerHTML = `
    <input type="text" class="item-name" placeholder="Item name" value="${esc(name)}" />
    <select class="item-cat" title="Category">${catOptions}</select>
    <input type="number" class="item-qty" min="1" value="${qty}" placeholder="Qty" />
    <input type="number" class="item-price" min="0" step="0.01" value="${price}" placeholder="Price" />
    <span class="item-total">₹ ${money((parseFloat(price) || 0) * (parseFloat(qty) || 0))}</span>
    <button type="button" class="btn-remove" aria-label="Remove"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
  container.appendChild(row);
  renderFoodInvoice();
  loadMenuItemsIntoUI(selectedProperty);
  return row;
}

function updateItemTotal(row) {
  const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
  const price = parseFloat(row.querySelector('.item-price').value) || 0;
  row.querySelector('.item-total').textContent = `₹ ${money(qty * price)}`;
}

// ---- Menu rendering with categories & search ----
function loadMenuItemsIntoUI(propKey) {
  const menu = getMenu(propKey);
  const toolbar = $('f_menuToolbar');
  const hint = $('f_menuEmptyHint');
  const chips = $('f_menuChips');

  if (!menu || !menu.items || menu.items.length === 0) {
    if (toolbar) toolbar.style.display = 'none';
    if (chips) chips.innerHTML = '';
    if (hint) hint.style.display = 'none';
    return;
  }

  if (toolbar) toolbar.style.display = '';
  renderCategoryTabs(menu);
  renderMenuChips(propKey);
}

function renderCategoryTabs(menu) {
  const tabs = $('f_menuCatTabs');
  if (!tabs) return;
  const cats = new Set(['All']);
  menu.items.forEach(it => cats.add(it.category || 'Food'));
  const catList = ['All', ...CATEGORIES.filter(c => cats.has(c))];
  // Only show categories that actually exist in the menu (besides All)
  const visibleCats = ['All'].concat(CATEGORIES.filter(c => menu.items.some(it => (it.category || 'Food') === c)));

  tabs.innerHTML = visibleCats.map(c =>
    `<button type="button" class="menu-cat-tab${currentMenuFilterCategory === c ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`
  ).join('');
  tabs.querySelectorAll('.menu-cat-tab').forEach(b => {
    b.addEventListener('click', () => {
      currentMenuFilterCategory = b.dataset.cat;
      renderCategoryTabs(menu);
      renderMenuChips(selectedProperty);
    });
  });
}

function renderMenuChips(propKey) {
  const menu = getMenu(propKey);
  const chips = $('f_menuChips');
  const hint = $('f_menuEmptyHint');
  if (!chips) return;
  if (!menu || !menu.items || menu.items.length === 0) {
    chips.innerHTML = '';
    if (hint) hint.style.display = 'none';
    return;
  }

  // Filter
  const filtered = menu.items.filter(it => {
    const cat = it.category || 'Food';
    if (currentMenuFilterCategory !== 'All' && cat !== currentMenuFilterCategory) return false;
    if (currentMenuSearch && !it.name.toLowerCase().includes(currentMenuSearch)) return false;
    return true;
  });

  // Map of currently-added items (by lower-cased name)
  const addedQty = {};
  document.querySelectorAll('#f_itemsContainer .food-item-row').forEach(row => {
    const name = (row.querySelector('.item-name').value || '').trim().toLowerCase();
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    if (name) addedQty[name] = (addedQty[name] || 0) + qty;
  });

  if (filtered.length === 0) {
    chips.innerHTML = '';
    if (hint) { hint.style.display = ''; hint.textContent = 'No menu items match this filter.'; }
    return;
  }
  if (hint) hint.style.display = 'none';

  chips.innerHTML = filtered.map((item, i) => {
    const realIdx = menu.items.indexOf(item);
    const qtyAdded = addedQty[item.name.toLowerCase()] || 0;
    const isAdded = qtyAdded > 0;
    const cat = item.category || 'Food';
    return `<div class="menu-chip${isAdded ? ' added' : ''}" data-idx="${realIdx}" data-cat="${esc(cat)}">
      <span class="chip-cat-dot cat-${cat.toLowerCase()}"></span>
      <span class="chip-name">${esc(item.name)}</span>
      <span class="chip-price">₹${item.defaultPrice}</span>
      ${isAdded ? `<span class="chip-qty">×${qtyAdded}</span>
        <button type="button" class="chip-minus" data-action-chip="dec" data-idx="${realIdx}" aria-label="Decrease">–</button>
        <button type="button" class="chip-plus" data-action-chip="inc" data-idx="${realIdx}" aria-label="Increase">+</button>`
      : `<button type="button" class="chip-plus" data-action-chip="add" data-idx="${realIdx}" aria-label="Add">+</button>`}
    </div>`;
  }).join('');

  chips.querySelectorAll('[data-action-chip]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const action = btn.dataset.actionChip;
      const item = menu.items[idx];
      if (!item) return;
      if (action === 'inc' || action === 'add') incrementMenuItem(item);
      else if (action === 'dec') decrementMenuItem(item);
    });
  });

  // Clicking the chip body (anywhere but a button) also adds one
  chips.querySelectorAll('.menu-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const idx = parseInt(chip.dataset.idx);
      const item = menu.items[idx];
      if (item) incrementMenuItem(item);
    });
  });
}

function findExistingFoodRow(itemName) {
  const target = itemName.trim().toLowerCase();
  const rows = document.querySelectorAll('#f_itemsContainer .food-item-row');
  for (const row of rows) {
    const name = (row.querySelector('.item-name').value || '').trim().toLowerCase();
    if (name === target) return row;
  }
  return null;
}

function findFirstEmptyRow() {
  const rows = document.querySelectorAll('#f_itemsContainer .food-item-row');
  for (const row of rows) {
    const name = (row.querySelector('.item-name').value || '').trim();
    const price = (row.querySelector('.item-price').value || '').trim();
    if (!name && !price) return row;
  }
  return null;
}

function incrementMenuItem(item) {
  const existing = findExistingFoodRow(item.name);
  if (existing) {
    const qtyInput = existing.querySelector('.item-qty');
    qtyInput.value = (parseFloat(qtyInput.value) || 0) + 1;
    updateItemTotal(existing);
  } else {
    // Reuse first empty row if present, else add new
    const empty = findFirstEmptyRow();
    if (empty) {
      empty.querySelector('.item-name').value = item.name;
      empty.querySelector('.item-qty').value = 1;
      empty.querySelector('.item-price').value = item.defaultPrice;
      const catSel = empty.querySelector('.item-cat');
      if (catSel) catSel.value = item.category || 'Food';
      updateItemTotal(empty);
    } else {
      addFoodItemRow(item.name, 1, item.defaultPrice, item.category || 'Food');
    }
  }
  renderFoodInvoice();
  loadMenuItemsIntoUI(selectedProperty);
}

function decrementMenuItem(item) {
  const existing = findExistingFoodRow(item.name);
  if (!existing) return;
  const qtyInput = existing.querySelector('.item-qty');
  const newQty = (parseFloat(qtyInput.value) || 0) - 1;
  if (newQty <= 0) {
    const rows = document.querySelectorAll('#f_itemsContainer .food-item-row');
    if (rows.length > 1) existing.remove();
    else {
      // last row — clear instead of remove
      existing.querySelector('.item-name').value = '';
      existing.querySelector('.item-qty').value = '1';
      existing.querySelector('.item-price').value = '';
    }
  } else {
    qtyInput.value = newQty;
    updateItemTotal(existing);
  }
  renderFoodInvoice();
  loadMenuItemsIntoUI(selectedProperty);
}

function resetFoodForm() {
  $('foodForm').reset();
  $('f_countryCode').value = '+91';
  editingRecord = null;
  const container = $('f_itemsContainer');
  container.innerHTML = '';
  addFoodItemRow();
  $('f_discount').value = '0';
  currentMenuFilterCategory = 'All';
  currentMenuSearch = '';
  const ms = $('f_menuSearch'); if (ms) ms.value = '';
  renderFoodInvoice();
}

function renderFoodInvoice(generated = false) {
  const roomNo = $('f_roomNo').value.trim();
  const guestName = $('f_guestName').value.trim();
  const phone = getFullPhone('f_phone', 'f_countryCode');
  const prop = PROPERTIES.find(p => p.key === selectedProperty);
  const discount = parseFloat($('f_discount').value) || 0;
  const authBy = $('f_authorizedBy').value.trim();
  const notes = $('f_notes').value.trim();

  const items = [];
  document.querySelectorAll('#f_itemsContainer .food-item-row').forEach(row => {
    const name = row.querySelector('.item-name').value.trim();
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const category = row.querySelector('.item-cat')?.value || 'Food';
    if (name && qty > 0) items.push({ name, qty, price, total: qty * price, category });
  });

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const grand = Math.max(0, subtotal - discount);

  // FIX: Invoice number is set ONCE per bill:
  //   - on edit: keep the original invoice number from the record
  //   - on first submit (generated=true): assign a fresh stable number
  //   - until then, keep showing dash
  const numEl = $('f_invNumber');
  const prefix = prop ? prop.prefix : 'FB';
  if (editingRecord && editingRecord.metadata?.invoiceNumber) {
    numEl.textContent = editingRecord.metadata.invoiceNumber;
  } else if (generated) {
    // Only generate (and lock) on submit if we don't already have one for this draft
    if (!numEl.dataset.locked) {
      numEl.textContent = generateInvNumber(guestName || 'FB', prefix);
      numEl.dataset.locked = '1';
    }
  } else if (numEl.dataset.locked) {
    // keep the previously locked number
  } else {
    numEl.textContent = '—';
  }

  $('f_invDate').textContent = formatDate(new Date().toISOString().split('T')[0]);
  $('f_invGuest').textContent = guestName || '—';
  $('f_invRoom').textContent = roomNo || '—';
  $('f_invPhone').textContent = phone || '';
  $('f_invProperty').textContent = prop ? prop.name : '—';
  const addrEl = $('f_invPropertyAddr');
  if (addrEl) addrEl.textContent = prop ? prop.address : '';

  const tbody = $('f_invTableBody');
  if (items.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">Add items to preview the bill.</td></tr>';
  } else {
    tbody.innerHTML = items.map(i =>
      `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.total)}</td></tr>`
    ).join('');
  }

  $('f_invSubtotal').textContent = money(subtotal);
  $('f_invDiscount').textContent = money(discount);
  $('f_invGrand').textContent = money(grand);

  $('f_invDiscountRow').style.display = discount > 0 ? '' : 'none';

  // Form totals
  $('f_subtotal').textContent = `₹ ${money(subtotal)}`;
  $('f_grandTotal').textContent = `₹ ${money(grand)}`;

  // Category breakdown in form
  const catBreakRow = $('f_catBreakdownRow');
  const catBreak = $('f_catBreakdown');
  if (catBreak) {
    const totals = {};
    items.forEach(it => { totals[it.category] = (totals[it.category] || 0) + it.total; });
    const parts = Object.keys(totals).filter(c => totals[c] > 0)
      .map(c => `<span class="cat-pill cat-${c.toLowerCase()}">${c}: ₹${money(totals[c])}</span>`);
    catBreak.innerHTML = parts.join('');
    if (catBreakRow) catBreakRow.style.display = parts.length > 1 ? '' : 'none';
  }

  // Notes
  const notesBlock = $('f_invNotesBlock');
  if (notesBlock) {
    notesBlock.style.display = notes ? '' : 'none';
    $('f_invNotes').textContent = notes;
  }

  $('f_invAuthBy').textContent = authBy || '—';

  const hasData = guestName && roomNo && items.length > 0;
  document.querySelectorAll('#f_previewActions button').forEach(btn => btn.disabled = !hasData);
}

// =========================================================
// SAVE FOOD BILL TO DRIVE
// =========================================================
function saveFoodBillToDrive() {
  if (!isDriveConnected()) {
    toast('Tip: Connect Google Drive to auto-save bills.', 'info', 4500);
    return;
  }

  const data = collectFoodBillData();
  if (!data) return;

  const invNum = data.invoiceNumber;
  const guestSlug = (data.guestName || 'guest').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 30);
  const baseName = `${guestSlug}_${invNum}`;
  const jsonName = `${baseName}.json`;
  const pdfName = `${baseName}.pdf`;

  toast('Saving to Drive…', 'info');

  (async () => {
    try {
      await ensureFolder();
      const targetFolderId = await getNestedFolder(data);

      const pdfBlob = await renderInvoicePDFBlob('foodInvoiceDoc');
      const pdfFile = await driveUpload(pdfName, 'application/pdf', pdfBlob, targetFolderId);

      const metadata = {
        ...data,
        pdfFileId: pdfFile.id,
        pdfFileName: pdfName,
        folderId: targetFolderId,
        savedAt: new Date().toISOString(),
        savedBy: currentUser?.username || 'unknown',
        type: 'food',
      };

      // If editing, delete old record first (only AFTER new upload succeeded)
      if (editingRecord) {
        try { await driveDelete(editingRecord.jsonFileId); } catch (e) { /* ignore */ }
        try { if (editingRecord.metadata?.pdfFileId) await driveDelete(editingRecord.metadata.pdfFileId); } catch (e) { /* ignore */ }
        editingRecord = null;
      }

      await driveUpload(jsonName, 'application/json', JSON.stringify(metadata, null, 2), targetFolderId);

      toast(`Saved to Drive ✓ (${invNum})`, 'success');
      // Invalidate cache so next archive load is fresh
      DriveState.cache = null;
    } catch (err) {
      console.error(err);
      toast('Could not save to Drive: ' + (err.message || 'unknown error'), 'error', 6000);
    }
  })();
}

function collectFoodBillData() {
  const prop = PROPERTIES.find(p => p.key === selectedProperty);
  const items = [];
  document.querySelectorAll('#f_itemsContainer .food-item-row').forEach(row => {
    const name = row.querySelector('.item-name').value.trim();
    const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
    const price = parseFloat(row.querySelector('.item-price').value) || 0;
    const category = row.querySelector('.item-cat')?.value || 'Food';
    if (name && qty > 0) items.push({ name, qty, price, total: qty * price, category });
  });
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const discount = parseFloat($('f_discount').value) || 0;
  const grand = Math.max(0, subtotal - discount);

  // Per-category totals
  const categoryTotals = {};
  items.forEach(it => {
    categoryTotals[it.category] = (categoryTotals[it.category] || 0) + it.total;
  });

  return {
    type: 'food',
    invoiceNumber: $('f_invNumber').textContent.trim(),
    invoiceDate: $('f_invDate').textContent.trim(),
    propertyKey: selectedProperty,
    propertyName: prop ? prop.name : '',
    propertyAddress: prop ? prop.address : '',
    roomNo: $('f_roomNo').value.trim(),
    guestName: $('f_guestName').value.trim(),
    guestPhone: getFullPhone('f_phone', 'f_countryCode'),
    items,
    categoryTotals,
    subtotal,
    discount,
    grandTotal: grand,
    authorizedBy: $('f_authorizedBy').value.trim(),
    notes: $('f_notes').value.trim(),
    // Preserve original status when editing (e.g., don't accidentally un-cancel)
    status: editingRecord?.metadata?.status === 'cancelled' ? 'cancelled' : 'active',
    cancellationReason: editingRecord?.metadata?.cancellationReason,
    cancelledAt: editingRecord?.metadata?.cancelledAt,
  };
}

// =========================================================
// MENU MANAGEMENT
// =========================================================
function initMenuManagement() {
  $('m_property').addEventListener('change', () => {
    const key = $('m_property').value;
    if (key && isDriveConnected()) {
      loadMenuFromDrive(key).finally(() => renderMenuMgmtItems(key));
    } else {
      renderMenuMgmtItems(key);
    }
  });

  $('m_itemsContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove');
    if (!btn) return;
    const container = $('m_itemsContainer');
    const rows = container.querySelectorAll('.menu-mgmt-row');
    if (rows.length > 1) btn.closest('.menu-mgmt-row').remove();
    else {
      const row = btn.closest('.menu-mgmt-row');
      row.querySelector('.m-item-name').value = '';
      row.querySelector('.m-item-price').value = '';
      const catSel = row.querySelector('.m-item-cat');
      if (catSel) catSel.value = 'Food';
    }
  });

  $('m_addItem').addEventListener('click', () => addMenuRow('', '', 'Food'));
  $('m_saveBtn').addEventListener('click', saveMenuItems);
}

function populateMenuPropertySelect() {
  const sel = $('m_property');
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Select a property --</option>' +
    PROPERTIES.map(p => `<option value="${p.key}">${esc(p.name)}</option>`).join('');
  sel.value = current || '';
  if (sel.value) {
    if (isDriveConnected()) loadMenuFromDrive(sel.value).finally(() => renderMenuMgmtItems(sel.value));
    else renderMenuMgmtItems(sel.value);
  } else {
    $('m_itemsContainer').innerHTML = '';
  }
}

function addMenuRow(name = '', price = '', category = 'Food') {
  const container = $('m_itemsContainer');
  const row = document.createElement('div');
  row.className = 'menu-mgmt-row';
  const catOptions = CATEGORIES.map(c => `<option value="${c}" ${c === category ? 'selected' : ''}>${c}</option>`).join('');
  row.innerHTML = `
    <input type="text" class="m-item-name" placeholder="Item name" value="${esc(name)}" />
    <select class="m-item-cat">${catOptions}</select>
    <input type="number" class="m-item-price" min="0" step="0.01" placeholder="Price" value="${price}" />
    <button type="button" class="btn-remove" aria-label="Remove"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
  container.appendChild(row);
}

function renderMenuMgmtItems(propKey) {
  const container = $('m_itemsContainer');
  container.innerHTML = '';
  if (!propKey) return;
  const menu = getMenu(propKey);
  if (menu && menu.items && menu.items.length > 0) {
    menu.items.forEach(item => addMenuRow(item.name, item.defaultPrice, item.category || 'Food'));
  } else {
    addMenuRow('', '', 'Food');
  }
}

function getMenu(propKey) {
  if (MenuCache[propKey]) return MenuCache[propKey];
  // Fallback to localStorage cache (for offline)
  try {
    const stored = localStorage.getItem(`broz_menu_${propKey}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      MenuCache[propKey] = parsed;
      return parsed;
    }
  } catch (e) {}
  return null;
}

function saveMenuLocal(propKey, items) {
  const data = { property: propKey, items, updatedAt: new Date().toISOString() };
  MenuCache[propKey] = data;
  try {
    localStorage.setItem(`broz_menu_${propKey}`, JSON.stringify(data));
  } catch (e) { /* quota / private mode */ }
}

async function saveMenuItems() {
  const propKey = $('m_property').value;
  if (!propKey) { toast('Please select a property.', 'error'); return; }

  const items = [];
  document.querySelectorAll('#m_itemsContainer .menu-mgmt-row').forEach(row => {
    const name = row.querySelector('.m-item-name').value.trim();
    const price = parseFloat(row.querySelector('.m-item-price').value) || 0;
    const category = row.querySelector('.m-item-cat')?.value || 'Food';
    if (name && price > 0) items.push({ name, defaultPrice: price, category });
  });

  if (items.length === 0) { toast('Please add at least one menu item.', 'error'); return; }

  saveMenuLocal(propKey, items);

  if (!isDriveConnected()) {
    toast(`Menu saved locally. Connect Drive to sync across devices.`, 'info', 4500);
    return;
  }

  toast('Saving menu to Drive…', 'info');
  try {
    await ensureFolder();
    const menusFolderId = await getOrCreateSubfolder(DriveState.folderId, 'Menus');
    const existingFiles = await driveListFilesByExactName(menusFolderId, `menu_${propKey}.json`);

    const menuData = { type: 'menu', property: propKey, items, updatedAt: new Date().toISOString(), updatedBy: currentUser?.username || 'unknown' };

    if (existingFiles.length > 0) {
      await driveDelete(existingFiles[0].id);
    }
    await driveUpload(`menu_${propKey}.json`, 'application/json', JSON.stringify(menuData, null, 2), menusFolderId);
    toast(`Menu for ${PROPERTIES.find(p => p.key === propKey)?.name} saved ✓`, 'success');
  } catch (err) {
    console.error(err);
    toast('Saved locally, but could not sync to Drive: ' + (err.message || ''), 'error', 5000);
  }
}

async function loadMenuFromDrive(propKey) {
  if (!isDriveConnected()) return false;
  try {
    await ensureFolder();
    const menusFolderId = await getOrCreateSubfolder(DriveState.folderId, 'Menus');
    const files = await driveListFilesByExactName(menusFolderId, `menu_${propKey}.json`);
    if (files.length === 0) return false;
    const text = await driveDownloadText(files[0].id);
    const data = JSON.parse(text);
    if (data.items && Array.isArray(data.items)) {
      saveMenuLocal(propKey, data.items);
      return true;
    }
  } catch (e) {
    console.warn('Menu load from Drive failed for', propKey, e.message);
  }
  return false;
}

async function refreshAllMenusFromDrive() {
  if (!isDriveConnected()) return;
  try {
    await ensureFolder();
    await Promise.all(PROPERTIES.map(p => loadMenuFromDrive(p.key).catch(() => false)));
  } catch (e) { /* silent */ }
}

// Exact-name search: avoids false positives from "name contains"
async function driveListFilesByExactName(folderId, name) {
  const safe = name.replace(/['\\]/g, '\\$&');
  const q = encodeURIComponent(`'${folderId}' in parents and name='${safe}' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  const data = await res.json();
  return data.files || [];
}

// =========================================================
// SHARED UTILITIES
// =========================================================
function money(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function esc(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateInvNumber(name, prefix = 'FB') {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const initials = String(name).split(/\s+/).map(p => p[0] || '').join('').slice(0, 3).toUpperCase() || prefix;
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${prefix}-${yy}${mm}${dd}-${initials}${rand}`;
}

function populateCountryCode(selectId) {
  const sel = $(selectId);
  if (!sel) return;
  sel.innerHTML = COUNTRY_CODES.map(c => `<option value="${c.code}" data-digits="${c.digits}">${c.flag} ${c.code}</option>`).join('');
  sel.value = '+91';
}

function getFullPhone(inputId, codeSelectId) {
  const code = $(codeSelectId)?.value || '+91';
  const num = $(inputId)?.value.replace(/\D/g, '') || '';
  return num ? `${code} ${num}` : '';
}

function captureFullHeight(el) {
  const parent = el.parentNode;
  const parentOverflow = parent ? parent.style.overflow : '';
  const origOverflow = el.style.overflow;
  const origMaxH = el.style.maxHeight;
  const origHeight = el.style.height;
  if (parent) parent.style.overflow = 'visible';
  el.style.overflow = 'visible';
  el.style.maxHeight = 'none';
  el.style.height = el.scrollHeight + 'px';
  return () => {
    el.style.overflow = origOverflow;
    el.style.maxHeight = origMaxH;
    el.style.height = origHeight;
    if (parent) parent.style.overflow = parentOverflow;
  };
}

async function downloadPDF(targetId) {
  const target = $(targetId);
  if (!target) return;
  if (!window.jspdf || !window.jspdf.jsPDF) {
    toast('PDF library not loaded. Check internet connection.', 'error');
    return;
  }
  const btn = document.querySelector(`[data-action="pdf"][data-target="${targetId}"]`);
  const originalText = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = 'Generating…'; }

  try {
    const restore = captureFullHeight(target);
    await new Promise(r => setTimeout(r, 50));
    const { jsPDF } = window.jspdf;
    const canvas = await html2canvas(target, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      allowTaint: false,
      useCORS: false,
    });
    restore();

    const imgData = canvas.toDataURL('image/jpeg', 0.85);
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pdfWidth  = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidthMm = pdfWidth;
    const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;

    if (imgHeightMm <= pdfHeight) {
      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidthMm, imgHeightMm);
    } else {
      let heightLeft = imgHeightMm;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidthMm, imgHeightMm);
      heightLeft -= pdfHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeightMm;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidthMm, imgHeightMm);
        heightLeft -= pdfHeight;
      }
    }

    const guestName = target.querySelector('.big-name')?.textContent?.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_') || 'Guest';
    const invNum = target.querySelector('[id$="invNumber"]')?.textContent?.replace(/[^a-zA-Z0-9-]/g, '') || 'BroZ';
    pdf.save(`${guestName}_${invNum}.pdf`);
  } catch (err) {
    console.error('PDF generation error:', err);
    toast('Could not generate PDF. Please try again.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
  }
}

async function renderInvoicePDFBlob(targetId) {
  const target = $(targetId);
  if (!target || !window.jspdf || !window.jspdf.jsPDF) return null;
  const restore = captureFullHeight(target);
  await new Promise(r => setTimeout(r, 50));
  const { jsPDF } = window.jspdf;
  const canvas = await html2canvas(target, {
    scale: 2,
    backgroundColor: '#ffffff',
    logging: false,
    allowTaint: false,
    useCORS: false,
  });
  restore();
  const imgData = canvas.toDataURL('image/jpeg', 0.85);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgWidthMm = pdfWidth;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;

  if (imgHeightMm <= pdfHeight) {
    pdf.addImage(imgData, 'JPEG', 0, 0, imgWidthMm, imgHeightMm);
  } else {
    let heightLeft = imgHeightMm;
    let position = 0;
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidthMm, imgHeightMm);
    heightLeft -= pdfHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeightMm;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidthMm, imgHeightMm);
      heightLeft -= pdfHeight;
    }
  }
  return pdf.output('blob');
}

// =========================================================
// GOOGLE DRIVE INTEGRATION — CENTRALIZED SHARED FOLDER
// =========================================================
//
// HOW THE CENTRALIZED FOLDER WORKS:
// - Admin sets a shared folder ID once (via the meta tag in HTML, or
//   the in-app "Drive Settings" panel which writes to localStorage).
// - Every signed-in user (admin or staff) reads/writes into THAT folder.
// - The folder must be SHARED with each Google account using the app
//   (Editor permission) so the OAuth scope drive.file can access it.
// - Drive API queries use supportsAllDrives + includeItemsFromAllDrives
//   so shared folders are properly traversed.
// =========================================================

function initDrive() {
  const meta = document.querySelector('meta[name="google-client-id"]');
  DriveState.clientId = meta ? meta.content : null;
  if (!DriveState.clientId) return;

  try {
    const saved = JSON.parse(localStorage.getItem('broz_drive_token') || 'null');
    if (saved && saved.token && saved.expiry > Date.now() + 60000) {
      DriveState.accessToken = saved.token;
      DriveState.tokenExpiry = saved.expiry;
      DriveState.folderId = saved.folderId || null;
      updateDriveUI(true);
      scheduleTokenRefresh();
    }
  } catch (e) {}

  const waitForGIS = () => {
    if (window.google && google.accounts && google.accounts.oauth2) {
      DriveState.ready = true;
      try {
        DriveState.tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: DriveState.clientId,
          scope: 'https://www.googleapis.com/auth/drive.file',
          callback: handleTokenResponse,
        });
      } catch (e) { console.error('Drive init failed', e); }
    } else {
      setTimeout(waitForGIS, 200);
    }
  };
  waitForGIS();
}

function driveConnect() {
  if (!DriveState.ready) { toast('Drive library loading…', 'info'); return; }
  if (!DriveState.tokenClient) { toast('Drive not configured.', 'error'); return; }
  document.querySelectorAll('[data-drive-status]').forEach(s => s.classList.add('connecting'));
  DriveState.tokenClient.requestAccessToken({ prompt: DriveState.accessToken ? '' : 'consent' });
}

function handleTokenResponse(resp) {
  document.querySelectorAll('[data-drive-status]').forEach(s => s.classList.remove('connecting'));
  DriveState.refreshing = false;
  if (resp.error) {
    console.warn('Token error:', resp.error);
    toast('Could not connect to Drive.', 'error');
    return;
  }
  DriveState.accessToken = resp.access_token;
  DriveState.tokenExpiry = Date.now() + (resp.expires_in * 1000);
  saveDriveTokenLocal();
  scheduleTokenRefresh();
  ensureFolder().then(() => {
    saveDriveTokenLocal();
    updateDriveUI(true);
    const sharedNote = DriveState.sharedFolderId ? ' (shared folder)' : '';
    toast(`Connected to Google Drive ✓${sharedNote}`, 'success');
    if (!$('archiveScreen').classList.contains('hidden')) loadArchive();
    if (!$('dashboardScreen').classList.contains('hidden')) loadDashboard();
    // Sync all menus from Drive in background
    refreshAllMenusFromDrive().then(() => {
      if (!$('foodBillingScreen').classList.contains('hidden') && selectedProperty) {
        loadMenuItemsIntoUI(selectedProperty);
      }
    });
  }).catch(err => {
    console.error(err);
    if (DriveState.sharedFolderId && /(not.*found|404)/i.test(err.message || '')) {
      toast('Shared folder not found / not shared with this account.', 'error', 6000);
    } else {
      toast('Connected, but could not set up folder.', 'error');
    }
  });
}

// Schedule a silent token refresh ~2 min before expiry
function scheduleTokenRefresh() {
  if (DriveState.refreshTimer) { clearTimeout(DriveState.refreshTimer); DriveState.refreshTimer = null; }
  if (!DriveState.tokenExpiry) return;
  const msUntilRefresh = Math.max(5000, DriveState.tokenExpiry - Date.now() - 120000);
  DriveState.refreshTimer = setTimeout(silentRefreshToken, msUntilRefresh);
}

function silentRefreshToken() {
  if (!DriveState.tokenClient || DriveState.refreshing) return;
  DriveState.refreshing = true;
  try {
    DriveState.tokenClient.requestAccessToken({ prompt: '' });
  } catch (e) {
    DriveState.refreshing = false;
    console.warn('Silent refresh failed:', e);
  }
}

function saveDriveTokenLocal() {
  localStorage.setItem('broz_drive_token', JSON.stringify({
    token: DriveState.accessToken, expiry: DriveState.tokenExpiry, folderId: DriveState.folderId,
  }));
}

function isDriveConnected() {
  return DriveState.accessToken && DriveState.tokenExpiry > Date.now() + 5000;
}

function updateDriveUI(connected) {
  document.querySelectorAll('[data-drive-status]').forEach(s => {
    if (connected) {
      s.classList.add('connected');
      const lbl = s.querySelector('.drive-btn-label');
      if (lbl) lbl.textContent = DriveState.sharedFolderId ? 'Drive (Shared)' : 'Drive Connected';
    } else {
      s.classList.remove('connected');
      const lbl = s.querySelector('.drive-btn-label');
      if (lbl) lbl.textContent = 'Connect Drive';
    }
  });
}

function disconnectDrive() {
  DriveState.accessToken = null;
  DriveState.tokenExpiry = 0;
  DriveState.folderId = null;
  DriveState.cache = null;
  if (DriveState.refreshTimer) { clearTimeout(DriveState.refreshTimer); DriveState.refreshTimer = null; }
  localStorage.removeItem('broz_drive_token');
  // Clear folder cache too so next connection re-resolves
  Object.keys(FolderCache).forEach(k => delete FolderCache[k]);
  updateDriveUI(false);
}

// Drive API helpers
async function driveFetch(url, options = {}) {
  if (!isDriveConnected()) throw new Error('Not connected to Drive');
  const headers = options.headers || {};
  headers['Authorization'] = `Bearer ${DriveState.accessToken}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    // Try one silent refresh, then retry once
    if (!options._retried && DriveState.tokenClient) {
      await new Promise((resolve) => {
        const oldCallback = DriveState.tokenClient.callback;
        DriveState.tokenClient.callback = (resp) => {
          if (oldCallback) oldCallback(resp);
          resolve();
        };
        try { DriveState.tokenClient.requestAccessToken({ prompt: '' }); }
        catch (e) { resolve(); }
        setTimeout(resolve, 3000);
      });
      if (isDriveConnected()) {
        const retryHeaders = { ...headers, Authorization: `Bearer ${DriveState.accessToken}` };
        return fetch(url, { ...options, headers: retryHeaders, _retried: true });
      }
    }
    disconnectDrive();
    throw new Error('Drive session expired. Please reconnect.');
  }
  if (!res.ok) {
    let text = '';
    try { text = await res.text(); } catch (e) {}
    const detail = text ? text.slice(0, 200) : '';
    throw new Error(`Drive API error ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return res;
}

// Resolve and validate the active root folder (shared or personal)
async function ensureFolder() {
  if (DriveState.folderId && DriveState.initialFolderResolved) return DriveState.folderId;

  // 1) If admin configured a shared folder ID, USE IT (and verify access)
  if (DriveState.sharedFolderId) {
    try {
      const res = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(DriveState.sharedFolderId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`
      );
      const folder = await res.json();
      if (folder.trashed) throw new Error('Shared folder is in trash');
      if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Shared ID is not a folder');
      DriveState.folderId = folder.id;
      DriveState.initialFolderResolved = true;
      return DriveState.folderId;
    } catch (err) {
      console.error('Shared folder access failed:', err);
      throw new Error('Could not access the configured shared Drive folder. Make sure it is shared with your Google account.');
    }
  }

  // 2) Fallback: search/create personal "BroZ Food Bills" in My Drive
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    DriveState.folderId = data.files[0].id;
    DriveState.initialFolderResolved = true;
    return DriveState.folderId;
  }
  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const created = await createRes.json();
  DriveState.folderId = created.id;
  DriveState.initialFolderResolved = true;
  return DriveState.folderId;
}

async function driveUpload(filename, mimeType, content, parentId) {
  const boundary = '-------boz-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const metadata = { name: filename, mimeType: mimeType, parents: parentId ? [parentId] : undefined };

  let body;
  if (content instanceof Blob) {
    const meta = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);
    const head = meta + delimiter + `Content-Type: ${mimeType}\r\n\r\n`;
    const headBlob = new Blob([head]); const tailBlob = new Blob([closeDelim]);
    body = new Blob([headBlob, content, tailBlob], { type: `multipart/related; boundary=${boundary}` });
  } else {
    body = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
      delimiter + `Content-Type: ${mimeType}\r\n\r\n` + content + closeDelim;
  }

  const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,parents&supportsAllDrives=true', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: body,
  });
  return res.json();
}

async function driveDownloadText(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
  return res.text();
}

async function driveDownloadBlob(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`);
  return res.blob();
}

// List all JSON files under our root folder (recursively, by querying for
// files whose parent chain includes our root). For simplicity we just list
// all .json files we have access to (drive.file scope already limits this
// to files created by this app in the shared folder).
async function driveListInvoiceFiles() {
  await ensureFolder();
  // Listing all .json files visible to the app; we'll filter by type='food' in metadata
  const q = encodeURIComponent(`mimeType='application/json' and trashed=false and name contains '.json'`);
  let allFiles = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      q: decodeURIComponent(q),
      fields: 'nextPageToken,files(id,name,createdTime,parents)',
      pageSize: '1000',
      orderBy: 'createdTime desc',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
    const data = await res.json();
    allFiles = allFiles.concat(data.files || []);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return allFiles;
}

async function driveDelete(fileId) {
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, { method: 'DELETE' });
}

// Update a JSON file's content in-place (no folder change, preserves the ID)
async function driveUpdateJson(fileId, jsonContent) {
  const res = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true&fields=id,name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: jsonContent,
  });
  return res.json();
}

async function getOrCreateSubfolder(parentId, name) {
  const cacheKey = `${parentId}/${name}`;
  if (FolderCache[cacheKey]) return FolderCache[cacheKey];
  const safe = name.replace(/['\\]/g, '\\$&');
  const q = encodeURIComponent(`'${parentId}' in parents and name='${safe}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`);
  const data = await res.json();
  if (data.files && data.files.length > 0) { FolderCache[cacheKey] = data.files[0].id; return data.files[0].id; }
  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const created = await createRes.json();
  FolderCache[cacheKey] = created.id;
  return created.id;
}

function getMonthFolder() {
  const d = new Date();
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

async function getNestedFolder(data) {
  const rootId = DriveState.folderId;
  const monthName = getMonthFolder();
  const propertyKey = data.propertyKey || data.property || 'Other';
  const billsFolderId = await getOrCreateSubfolder(rootId, 'Food Bills');
  const propFolderId = await getOrCreateSubfolder(billsFolderId, propertyKey);
  return await getOrCreateSubfolder(propFolderId, monthName);
}

// =========================================================
// PAST INVOICES ARCHIVE
// =========================================================
function initArchive() {
  ['archiveSearch', 'archiveFilterProperty', 'archiveFilterMonth', 'archiveFilterStatus', 'archiveSort'].forEach(id => {
    const el = $(id);
    if (el) { el.addEventListener('input', renderArchiveList); el.addEventListener('change', renderArchiveList); }
  });
  $('archiveRefresh')?.addEventListener('click', () => loadArchive(true));

  // Summary panel: collapse toggle
  const toggleBtn = $('archiveSummaryToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const body = $('archiveSummaryBody');
      const expanded = toggleBtn.getAttribute('aria-expanded') !== 'false';
      const next = !expanded;
      toggleBtn.setAttribute('aria-expanded', String(next));
      if (body) body.classList.toggle('collapsed', !next);
      toggleBtn.classList.toggle('collapsed', !next);
    });
  }

  // Summary panel: view tabs (property / day / month)
  document.querySelectorAll('.summary-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.summaryView;
      document.querySelectorAll('.summary-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.summary-view').forEach(v => v.classList.add('hidden'));
      const target = $(`summaryView${view.charAt(0).toUpperCase() + view.slice(1)}`);
      if (target) target.classList.remove('hidden');
    });
  });
}

async function loadArchive(force = false) {
  if (!isDriveConnected()) { showArchiveState('driveOff'); return; }
  if (DriveState.cache && !force) { showArchiveState('list'); populateArchiveFilters(); renderArchiveList(); return; }
  showArchiveState('loading');

  try {
    const files = await driveListInvoiceFiles();
    if (files.length === 0) { DriveState.cache = []; showArchiveState('empty'); return; }

    const records = [];
    const batchSize = 8;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(async f => {
        try {
          const text = await driveDownloadText(f.id);
          const data = JSON.parse(text);
          if (data.type !== 'food') return null;
          return { metadata: data, jsonFileId: f.id, createdTime: f.createdTime };
        } catch (e) { return null; }
      }));
      records.push(...results.filter(Boolean));
    }

    DriveState.cache = records;
    showArchiveState(records.length ? 'list' : 'empty');
    populateArchiveFilters();
    renderArchiveList();
  } catch (err) {
    console.error(err);
    toast('Could not load archive: ' + (err.message || 'unknown error'), 'error', 6000);
    showArchiveState('driveOff');
  }
}

function showArchiveState(state) {
  $('archiveEmpty')?.classList.toggle('hidden', state !== 'empty');
  $('archiveDriveOff')?.classList.toggle('hidden', state !== 'driveOff');
  $('archiveLoading')?.classList.toggle('hidden', state !== 'loading');
  $('archiveList')?.classList.toggle('hidden', state !== 'list');
  $('archiveSummary')?.classList.toggle('hidden', state !== 'list');
  const label = $('archiveCountLabel');
  if (label) {
    label.textContent = state === 'driveOff' ? 'Connect Drive to view past bills'
      : state === 'loading' ? 'Loading from Google Drive…'
      : state === 'empty' ? 'No bills saved yet' : '';
  }
}

function getArchiveProperties() {
  if (!DriveState.cache) return [];
  const props = new Set();
  DriveState.cache.forEach(r => {
    if (r.metadata?.propertyName) props.add(r.metadata.propertyName);
  });
  return Array.from(props).sort();
}

function getArchiveMonths() {
  if (!DriveState.cache) return [];
  const months = new Set();
  DriveState.cache.forEach(r => {
    const d = r.metadata?.savedAt || r.createdTime;
    if (d) { const dt = new Date(d); months.add(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`); }
  });
  return Array.from(months).sort().reverse();
}

function populateArchiveFilters() {
  const propFilter = $('archiveFilterProperty');
  if (propFilter) {
    const current = propFilter.value;
    const props = getArchiveProperties();
    propFilter.innerHTML = '<option value="all">All properties</option>' + props.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    propFilter.value = current || 'all';
  }
  const monthFilter = $('archiveFilterMonth');
  if (monthFilter) {
    const current = monthFilter.value;
    const months = getArchiveMonths();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    monthFilter.innerHTML = '<option value="all">All months</option>' +
      months.map(m => { const [y, mo] = m.split('-'); return `<option value="${m}">${monthNames[parseInt(mo) - 1]} ${y}</option>`; }).join('');
    monthFilter.value = current || 'all';
  }
}

function renderArchiveList() {
  if (!DriveState.cache) return;
  const filtered = getFilteredArchive();
  const sortBy = $('archiveSort')?.value || 'newest';

  filtered.sort((a, b) => {
    const am = a.metadata || {}, bm = b.metadata || {};
    if (sortBy === 'newest') return new Date(b.createdTime || bm.savedAt || 0) - new Date(a.createdTime || am.savedAt || 0);
    if (sortBy === 'oldest') return new Date(a.createdTime || am.savedAt || 0) - new Date(b.createdTime || bm.savedAt || 0);
    if (sortBy === 'amount-desc') return (bm.grandTotal || 0) - (am.grandTotal || 0);
    if (sortBy === 'amount-asc') return (am.grandTotal || 0) - (bm.grandTotal || 0);
    return 0;
  });

  $('archiveCountLabel').textContent = `${filtered.length} of ${DriveState.cache.length} bill${DriveState.cache.length !== 1 ? 's' : ''}`;

  // Refresh summary panel using same filtered set (respects current filters)
  renderArchiveSummary(filtered);

  const list = $('archiveList');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="archive-empty" style="grid-column:1/-1;"><h3>No matches</h3><p>Try a different search or filter.</p></div>';
    return;
  }

  list.innerHTML = filtered.map((r, idx) => {
    const m = r.metadata || {};
    const isCancelled = m.status === 'cancelled';
    return `<div class="archive-card${isCancelled ? ' cancelled' : ''}" data-record-idx="${idx}">
      <div class="archive-card-top">
        <h3 class="archive-card-name">${esc(m.guestName || 'Unnamed')}</h3>
        ${isCancelled ? '<span class="archive-card-badge cancelled">Cancelled</span>' : '<span class="archive-card-badge">Food Bill</span>'}
      </div>
      <p class="archive-card-num">${esc(m.invoiceNumber || '—')}</p>
      <div class="archive-card-meta">
        <span>Property: <strong>${esc(m.propertyName || '—')}</strong></span>
        <span>Room: <strong>${esc(m.roomNo || '—')}</strong> · Items: <strong>${(m.items || []).length}</strong></span>
      </div>
      <div class="archive-card-bottom">
        <span class="archive-card-amount">₹ ${money(m.grandTotal || 0)}</span>
        <span class="archive-card-date">${esc(m.invoiceDate || '')}</span>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.archive-card').forEach((card, cardIdx) => {
    card.addEventListener('click', () => {
      openInvoiceModal(filtered[cardIdx]);
    });
  });
}

function getFilteredArchive() {
  if (!DriveState.cache) return [];
  const records = DriveState.cache.slice();
  const query = $('archiveSearch')?.value.toLowerCase().trim() || '';
  const propFilter = $('archiveFilterProperty')?.value || 'all';
  const monthFilter = $('archiveFilterMonth')?.value || 'all';
  const statusFilter = $('archiveFilterStatus')?.value || 'all';

  return records.filter(r => {
    const m = r.metadata || {};
    if (propFilter !== 'all' && m.propertyName !== propFilter) return false;
    if (monthFilter !== 'all') {
      const d = m.savedAt || r.createdTime || '';
      const dt = new Date(d);
      const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      if (ym !== monthFilter) return false;
    }
    if (statusFilter !== 'all' && (m.status || 'active') !== statusFilter) return false;
    if (!query) return true;
    const hay = [m.invoiceNumber, m.guestName, m.guestPhone, m.propertyName, m.roomNo, m.authorizedBy].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(query);
  });
}

// =========================================================
// ARCHIVE SUMMARY (property-wise, day-wise, month-wise)
// =========================================================
function renderArchiveSummary(filteredRecords) {
  // Exclude cancelled bills from revenue summary
  const active = filteredRecords.filter(r => (r.metadata?.status || 'active') !== 'cancelled');
  renderSummaryByProperty(active);
  renderSummaryByDay(active);
  renderSummaryByMonth(active);
}

function getRecordDate(r) {
  return new Date(r.metadata?.savedAt || r.createdTime || 0);
}

function renderSummaryByProperty(records) {
  const container = $('summaryViewProperty');
  if (!container) return;
  if (records.length === 0) {
    container.innerHTML = '<p class="summary-empty">No bills match the current filters.</p>';
    return;
  }

  // Group by property, sub-totals by day & month inside
  const groups = {};
  records.forEach(r => {
    const m = r.metadata || {};
    const propName = m.propertyName || 'Other';
    if (!groups[propName]) groups[propName] = { total: 0, count: 0, discount: 0, days: {}, months: {} };
    const dt = getRecordDate(r);
    const dayKey = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const monthKey = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    const amt = m.grandTotal || 0;
    groups[propName].total += amt;
    groups[propName].count += 1;
    groups[propName].discount += m.discount || 0;
    groups[propName].days[dayKey] = (groups[propName].days[dayKey] || 0) + amt;
    groups[propName].months[monthKey] = (groups[propName].months[monthKey] || 0) + amt;
  });

  // Grand total across properties
  const grandTotal = Object.values(groups).reduce((s, g) => s + g.total, 0);
  const grandCount = Object.values(groups).reduce((s, g) => s + g.count, 0);

  // Sort properties by revenue desc
  const sortedProps = Object.keys(groups).sort((a, b) => groups[b].total - groups[a].total);

  let html = `<div class="summary-total-row">
    <span class="summary-total-label">Total revenue (${grandCount} bill${grandCount !== 1 ? 's' : ''})</span>
    <span class="summary-total-amount">₹ ${money(grandTotal)}</span>
  </div>`;

  html += '<div class="summary-prop-cards">';
  sortedProps.forEach(propName => {
    const g = groups[propName];
    const pct = grandTotal > 0 ? (g.total / grandTotal) * 100 : 0;
    const avg = g.count > 0 ? g.total / g.count : 0;

    // Day-wise mini-list (last 7 distinct days, descending)
    const recentDays = Object.keys(g.days).sort().reverse().slice(0, 7);
    const dayRows = recentDays.map(d => {
      const dt = new Date(d);
      const label = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      return `<div class="summary-mini-row"><span>${label}</span><span>₹ ${money(g.days[d])}</span></div>`;
    }).join('');

    // Month-wise mini-list (all months, descending)
    const allMonths = Object.keys(g.months).sort().reverse();
    const monthRows = allMonths.map(mo => {
      const [y, m2] = mo.split('-');
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const label = `${monthNames[parseInt(m2)-1]} ${y}`;
      return `<div class="summary-mini-row"><span>${label}</span><span>₹ ${money(g.months[mo])}</span></div>`;
    }).join('');

    html += `<div class="summary-prop-card">
      <div class="summary-prop-header">
        <div>
          <h4 class="summary-prop-name">${esc(propName)}</h4>
          <p class="summary-prop-meta">${g.count} bill${g.count !== 1 ? 's' : ''} · Avg ₹ ${money(avg)}${g.discount > 0 ? ` · Disc ₹ ${money(g.discount)}` : ''}</p>
        </div>
        <div class="summary-prop-amount">
          <span class="summary-prop-total">₹ ${money(g.total)}</span>
          <span class="summary-prop-pct">${pct.toFixed(1)}%</span>
        </div>
      </div>
      <div class="summary-prop-bar"><div class="summary-prop-fill" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="summary-prop-breakdown">
        <div class="summary-mini-block">
          <p class="summary-mini-label">Recent days</p>
          ${dayRows || '<p class="summary-mini-empty">No days</p>'}
        </div>
        <div class="summary-mini-block">
          <p class="summary-mini-label">By month</p>
          ${monthRows || '<p class="summary-mini-empty">No months</p>'}
        </div>
      </div>
    </div>`;
  });
  html += '</div>';

  container.innerHTML = html;
}

function renderSummaryByDay(records) {
  const container = $('summaryViewDay');
  if (!container) return;
  if (records.length === 0) {
    container.innerHTML = '<p class="summary-empty">No bills match the current filters.</p>';
    return;
  }

  // Day → { total, count, byProperty: {propName: amount} }
  const days = {};
  const allProps = new Set();
  records.forEach(r => {
    const m = r.metadata || {};
    const dt = getRecordDate(r);
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const propName = m.propertyName || 'Other';
    allProps.add(propName);
    if (!days[key]) days[key] = { total: 0, count: 0, byProperty: {} };
    days[key].total += m.grandTotal || 0;
    days[key].count += 1;
    days[key].byProperty[propName] = (days[key].byProperty[propName] || 0) + (m.grandTotal || 0);
  });

  const sortedDays = Object.keys(days).sort().reverse();
  const grandTotal = sortedDays.reduce((s, k) => s + days[k].total, 0);
  const maxDay = Math.max(...sortedDays.map(k => days[k].total));
  const propList = Array.from(allProps).sort();

  let html = `<div class="summary-total-row">
    <span class="summary-total-label">${sortedDays.length} day${sortedDays.length !== 1 ? 's' : ''} of sales</span>
    <span class="summary-total-amount">₹ ${money(grandTotal)}</span>
  </div>`;

  html += '<div class="summary-table-wrap"><table class="summary-table"><thead><tr>';
  html += '<th>Date</th>';
  propList.forEach(p => { html += `<th class="num">${esc(p)}</th>`; });
  html += '<th class="num">Bills</th><th class="num">Total</th></tr></thead><tbody>';

  sortedDays.forEach(k => {
    const d = days[k];
    const dt = new Date(k);
    const label = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'short' });
    const pct = maxDay > 0 ? (d.total / maxDay) * 100 : 0;
    html += `<tr><td><div class="summary-day-label">${label}</div><div class="summary-row-bar"><div class="summary-row-fill" style="width:${pct.toFixed(1)}%"></div></div></td>`;
    propList.forEach(p => {
      const v = d.byProperty[p] || 0;
      html += `<td class="num">${v > 0 ? '₹ ' + money(v) : '—'}</td>`;
    });
    html += `<td class="num">${d.count}</td><td class="num"><strong>₹ ${money(d.total)}</strong></td></tr>`;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function renderSummaryByMonth(records) {
  const container = $('summaryViewMonth');
  if (!container) return;
  if (records.length === 0) {
    container.innerHTML = '<p class="summary-empty">No bills match the current filters.</p>';
    return;
  }

  const months = {};
  const allProps = new Set();
  records.forEach(r => {
    const m = r.metadata || {};
    const dt = getRecordDate(r);
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`;
    const propName = m.propertyName || 'Other';
    allProps.add(propName);
    if (!months[key]) months[key] = { total: 0, count: 0, byProperty: {} };
    months[key].total += m.grandTotal || 0;
    months[key].count += 1;
    months[key].byProperty[propName] = (months[key].byProperty[propName] || 0) + (m.grandTotal || 0);
  });

  const sortedMonths = Object.keys(months).sort().reverse();
  const grandTotal = sortedMonths.reduce((s, k) => s + months[k].total, 0);
  const maxMonth = Math.max(...sortedMonths.map(k => months[k].total));
  const propList = Array.from(allProps).sort();
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  let html = `<div class="summary-total-row">
    <span class="summary-total-label">${sortedMonths.length} month${sortedMonths.length !== 1 ? 's' : ''} of sales</span>
    <span class="summary-total-amount">₹ ${money(grandTotal)}</span>
  </div>`;

  html += '<div class="summary-table-wrap"><table class="summary-table"><thead><tr>';
  html += '<th>Month</th>';
  propList.forEach(p => { html += `<th class="num">${esc(p)}</th>`; });
  html += '<th class="num">Bills</th><th class="num">Total</th></tr></thead><tbody>';

  sortedMonths.forEach(k => {
    const m = months[k];
    const [y, mo] = k.split('-');
    const label = `${monthNames[parseInt(mo)-1]} ${y}`;
    const pct = maxMonth > 0 ? (m.total / maxMonth) * 100 : 0;
    html += `<tr><td><div class="summary-day-label">${label}</div><div class="summary-row-bar"><div class="summary-row-fill" style="width:${pct.toFixed(1)}%"></div></div></td>`;
    propList.forEach(p => {
      const v = m.byProperty[p] || 0;
      html += `<td class="num">${v > 0 ? '₹ ' + money(v) : '—'}</td>`;
    });
    html += `<td class="num">${m.count}</td><td class="num"><strong>₹ ${money(m.total)}</strong></td></tr>`;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// =========================================================
// INVOICE MODAL
// =========================================================
let currentModalRecord = null;

function openInvoiceModal(record) {
  currentModalRecord = record;
  const m = record.metadata || {};
  $('modalTitle').textContent = m.guestName || 'Food Bill';
  $('modalSubtitle').textContent = `FOOD · ${m.invoiceNumber || ''} · ${m.invoiceDate || ''}${m.status === 'cancelled' ? ' · CANCELLED' : ''}`;
  $('modalBody').innerHTML = renderModalInvoiceHTML(m);
  $('invoiceModal').classList.remove('hidden');
}

function closeModal() {
  $('invoiceModal').classList.add('hidden');
  currentModalRecord = null;
}

function renderModalInvoiceHTML(m) {
  const items = m.items || [];
  const itemsRows = items.length > 0
    ? items.map(i => `<tr><td>${esc(i.name)}${i.category ? ` <span class="cat-tag cat-${(i.category||'food').toLowerCase()}">${esc(i.category)}</span>` : ''}</td><td class="num">${i.qty}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.total)}</td></tr>`).join('')
    : '<tr class="empty-row"><td colspan="4">No items</td></tr>';

  return `<div class="invoice-doc" style="margin:0;border-radius:0;">
    <div class="invoice-watermark">BroZ</div>
    <div class="invoice-header">
      <div class="invoice-brand">
        <div class="invoice-logo"><svg width="48" height="48" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" rx="12" fill="#233b2e"/><text x="50" y="68" text-anchor="middle" font-family="'Cormorant Garamond',Georgia,serif" font-size="58" font-weight="600" fill="#c9a679">B</text></svg></div>
        <div class="invoice-brand-text">
          <h1>BroZ Homes <span class="amp">&amp;</span> Resorts</h1>
          <p class="addr-line">brozstays.com</p>
        </div>
      </div>
      <div class="invoice-meta">
        <p class="invoice-label">FOOD BILL${m.status === 'cancelled' ? ' (CANCELLED)' : ''}</p>
        <p class="invoice-num">No. <span>${esc(m.invoiceNumber || '—')}</span></p>
        <p class="invoice-date">Date: <span>${esc(m.invoiceDate || '—')}</span></p>
      </div>
    </div>
    <div class="invoice-divider"></div>
    <div class="invoice-billto">
      <div>
        <p class="muted-label">Guest</p>
        <p class="big-name">${esc(m.guestName || '—')}</p>
        <p class="sub-info">Room: ${esc(m.roomNo || '—')}</p>
        <p class="sub-info">${esc(m.guestPhone || '')}</p>
      </div>
      <div>
        <p class="muted-label">Property</p>
        <p class="big-name">${esc(m.propertyName || '—')}</p>
        <p class="sub-info">${esc(m.propertyAddress || '')}</p>
      </div>
    </div>
    <table class="invoice-table">
      <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price (₹)</th><th class="num">Total (₹)</th></tr></thead>
      <tbody>${itemsRows}</tbody>
    </table>
    <div class="invoice-totals">
      <div class="totals-row"><span>Subtotal</span><span>₹ ${money(m.subtotal)}</span></div>
      ${m.discount > 0 ? `<div class="totals-row"><span>Discount</span><span>– ₹ ${money(m.discount)}</span></div>` : ''}
      <div class="totals-row grand"><span>Grand Total</span><span>₹ ${money(m.grandTotal)}</span></div>
    </div>
    ${m.status === 'cancelled' && m.cancellationReason ? `<div class="invoice-notes"><p class="muted-label">Cancellation reason</p><p>${esc(m.cancellationReason)}</p></div>` : ''}
    <div class="invoice-notes" style="${m.notes ? '' : 'display:none;'}">
      <p class="muted-label">Notes</p>
      <p>${esc(m.notes || '')}</p>
    </div>
    <div class="invoice-footer">
      <div class="signature-block">
        <div class="sig-line"></div>
        <p class="sig-name">${esc(m.authorizedBy || '—')}</p>
        <p class="sig-title">Authorized Signatory</p>
      </div>
      <div class="thank-you">
        <p class="thanks">Thank you!</p>
      </div>
    </div>
  </div>`;
}

async function downloadModalInvoice() {
  if (!currentModalRecord) return;
  const m = currentModalRecord.metadata || {};
  if (!m.pdfFileId) { toast('PDF not found.', 'error'); return; }
  toast('Downloading PDF…', 'info');
  try {
    const blob = await driveDownloadBlob(m.pdfFileId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = m.pdfFileName || `FoodBill-${m.invoiceNumber || 'BroZ'}.pdf`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) { toast('Download failed: ' + err.message, 'error'); }
}

async function deleteModalInvoice() {
  if (!currentModalRecord) return;
  const m = currentModalRecord.metadata || {};
  if (!confirm(`Delete bill ${m.invoiceNumber} for ${m.guestName}?\n\nThis removes data and PDF from Drive. Cannot be undone.`)) return;
  const recordToDelete = currentModalRecord;
  try {
    await driveDelete(recordToDelete.jsonFileId);
    if (m.pdfFileId) { try { await driveDelete(m.pdfFileId); } catch (e) {} }
    toast('Bill deleted from Drive.', 'success');
    closeModal();
    if (DriveState.cache) DriveState.cache = DriveState.cache.filter(r => r !== recordToDelete);
    renderArchiveList();
  } catch (err) { toast('Could not delete: ' + err.message, 'error'); }
}

async function cancelInvoice(record) {
  if (!record) return;
  const m = record.metadata || {};
  if (m.status === 'cancelled') { toast('Already cancelled.', 'info'); return; }
  const reason = prompt(`Cancel bill ${m.invoiceNumber}?\n\nEnter cancellation reason:`);
  if (reason === null) return;
  const updated = { ...m, status: 'cancelled', cancellationReason: reason, cancelledAt: new Date().toISOString(), cancelledBy: currentUser?.username || 'unknown' };
  try {
    // FIX: Update JSON in-place (preserves original folder location & file ID)
    await driveUpdateJson(record.jsonFileId, JSON.stringify(updated, null, 2));
    record.metadata = updated;
    toast(`Bill ${m.invoiceNumber} marked as cancelled.`, 'success');
    closeModal();
    renderArchiveList();
  } catch (err) { toast('Could not cancel: ' + err.message, 'error'); }
}

async function editInvoice(record) {
  if (!record) return;
  const m = record.metadata || {};
  closeModal();
  selectedProperty = m.propertyKey || '';
  const prop = PROPERTIES.find(p => p.key === selectedProperty);
  if (!prop) { toast('Could not find property for this bill.', 'error'); return; }

  editingRecord = record;
  showScreen('foodBillingScreen');
  $('f_propertyDisplay').textContent = prop.name;
  resetFoodForm();
  editingRecord = record; // resetFoodForm sets editingRecord = null, so re-set

  // Load data into form
  $('f_roomNo').value = m.roomNo || '';
  $('f_guestName').value = m.guestName || '';

  const phone = m.guestPhone || '';
  const phoneMatch = phone.match(/^(\+\d+)\s*(.*)$/);
  if (phoneMatch) { $('f_countryCode').value = phoneMatch[1]; $('f_phone').value = phoneMatch[2].replace(/\D/g, ''); }
  else { $('f_phone').value = phone.replace(/\D/g, ''); }

  $('f_discount').value = m.discount || 0;
  $('f_authorizedBy').value = m.authorizedBy || '';
  $('f_notes').value = m.notes || '';

  // Items
  $('f_itemsContainer').innerHTML = '';
  const items = m.items || [];
  if (items.length > 0) items.forEach(i => addFoodItemRow(i.name, i.qty, i.price, i.category || 'Food'));
  else addFoodItemRow();

  // Set invoice number lock with the existing number
  const numEl = $('f_invNumber');
  numEl.textContent = m.invoiceNumber || '—';
  numEl.dataset.locked = '1';

  loadMenuItemsIntoUI(selectedProperty);
  renderFoodInvoice();
  toast('Bill loaded for editing. The invoice number is preserved. Click Generate Bill to save changes.', 'info', 5500);
}

// =========================================================
// DASHBOARD (sales summary)
// =========================================================
function initDashboard() {
  ['dashPeriod', 'dashProperty'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('change', renderDashboard);
  });
  $('dashRefresh')?.addEventListener('click', () => loadDashboard(true));
}

async function loadDashboard(force = false) {
  if (!isDriveConnected()) {
    $('dashDriveOff').classList.remove('hidden');
    $('dashLoading').classList.add('hidden');
    $('dashContent').classList.add('hidden');
    return;
  }
  $('dashDriveOff').classList.add('hidden');
  if (!DriveState.cache || force) {
    $('dashLoading').classList.remove('hidden');
    $('dashContent').classList.add('hidden');
    try {
      const files = await driveListInvoiceFiles();
      const records = [];
      const batchSize = 8;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(async f => {
          try {
            const text = await driveDownloadText(f.id);
            const data = JSON.parse(text);
            if (data.type !== 'food') return null;
            return { metadata: data, jsonFileId: f.id, createdTime: f.createdTime };
          } catch (e) { return null; }
        }));
        records.push(...results.filter(Boolean));
      }
      DriveState.cache = records;
    } catch (err) {
      toast('Could not load dashboard data: ' + (err.message || ''), 'error', 6000);
      $('dashLoading').classList.add('hidden');
      return;
    }
  }
  $('dashLoading').classList.add('hidden');
  $('dashContent').classList.remove('hidden');
  populateDashboardFilters();
  renderDashboard();
}

function populateDashboardFilters() {
  const sel = $('dashProperty');
  if (!sel) return;
  const current = sel.value;
  const props = new Set();
  (DriveState.cache || []).forEach(r => { if (r.metadata?.propertyName) props.add(r.metadata.propertyName); });
  sel.innerHTML = '<option value="all">All properties</option>' +
    Array.from(props).sort().map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  sel.value = current || 'all';
}

function getDashboardRange(period) {
  const now = new Date();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
  const endOfDay = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
  switch (period) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': { const y = new Date(now); y.setDate(y.getDate() - 1); return { from: startOfDay(y), to: endOfDay(y) }; }
    case 'week': { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: startOfDay(f), to: endOfDay(now) }; }
    case 'month': { const f = new Date(now.getFullYear(), now.getMonth(), 1); return { from: startOfDay(f), to: endOfDay(now) }; }
    case 'lastmonth': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: startOfDay(lm), to: endOfDay(lmEnd) };
    }
    case 'ytd': { const f = new Date(now.getFullYear(), 0, 1); return { from: startOfDay(f), to: endOfDay(now) }; }
    case 'all': return { from: new Date(0), to: endOfDay(now) };
    default: return { from: startOfDay(now), to: endOfDay(now) };
  }
}

function renderDashboard() {
  if (!DriveState.cache) return;
  const period = $('dashPeriod')?.value || 'month';
  const propFilter = $('dashProperty')?.value || 'all';
  const { from, to } = getDashboardRange(period);

  // Filter & exclude cancelled
  const records = DriveState.cache.filter(r => {
    const m = r.metadata || {};
    if (m.status === 'cancelled') return false;
    if (propFilter !== 'all' && m.propertyName !== propFilter) return false;
    const dt = new Date(m.savedAt || r.createdTime || 0);
    return dt >= from && dt <= to;
  });

  // KPIs
  const revenue = records.reduce((s, r) => s + (r.metadata?.grandTotal || 0), 0);
  const billCount = records.length;
  const avg = billCount > 0 ? revenue / billCount : 0;
  const discount = records.reduce((s, r) => s + (r.metadata?.discount || 0), 0);

  $('kpiRevenue').textContent = `₹ ${money(revenue)}`;
  $('kpiBills').textContent = String(billCount);
  $('kpiAvg').textContent = `₹ ${money(avg)}`;
  $('kpiDiscount').textContent = `₹ ${money(discount)}`;

  const periodLabels = {
    today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'This month',
    lastmonth: 'Last month', ytd: 'Year to date', all: 'All time',
  };
  $('kpiRevenueSub').textContent = periodLabels[period] || '';
  $('kpiBillsSub').textContent = `${billCount === 1 ? '1 bill' : billCount + ' bills'}`;
  $('kpiAvgSub').textContent = 'per bill';
  $('kpiDiscountSub').textContent = 'total given';

  // By category
  const catTotals = {};
  records.forEach(r => {
    const m = r.metadata || {};
    if (m.categoryTotals) {
      Object.entries(m.categoryTotals).forEach(([c, v]) => { catTotals[c] = (catTotals[c] || 0) + v; });
    } else {
      // Fallback: re-aggregate from items
      (m.items || []).forEach(it => {
        const c = it.category || 'Food';
        catTotals[c] = (catTotals[c] || 0) + (it.total || 0);
      });
    }
  });
  renderBars('dashByCategory', catTotals, '₹', { colorByKey: true, kind: 'category' });

  // By property
  const propTotals = {};
  records.forEach(r => {
    const m = r.metadata || {};
    const key = m.propertyName || 'Other';
    propTotals[key] = (propTotals[key] || 0) + (m.grandTotal || 0);
  });
  renderBars('dashByProperty', propTotals, '₹');

  // Top 10 items
  const itemTotals = {};
  const itemQty = {};
  records.forEach(r => {
    (r.metadata?.items || []).forEach(it => {
      const k = it.name;
      itemTotals[k] = (itemTotals[k] || 0) + (it.total || 0);
      itemQty[k] = (itemQty[k] || 0) + (it.qty || 0);
    });
  });
  const sortedItems = Object.keys(itemTotals).sort((a, b) => itemTotals[b] - itemTotals[a]).slice(0, 10);
  const top10 = {};
  sortedItems.forEach(k => { top10[k] = itemTotals[k]; });
  renderBars('dashTopItems', top10, '₹', { suffixFor: (k) => ` · ${itemQty[k]} sold` });

  // Daily revenue (last N days based on period; if 'all'/'ytd', limit to 30 most recent days)
  const dayMap = {};
  records.forEach(r => {
    const dt = new Date(r.metadata?.savedAt || r.createdTime || 0);
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    dayMap[key] = (dayMap[key] || 0) + (r.metadata?.grandTotal || 0);
  });
  renderDailySpark('dashDaily', dayMap, period);
}

function renderBars(containerId, totals, currency = '₹', opts = {}) {
  const container = $(containerId);
  if (!container) return;
  const keys = Object.keys(totals);
  if (keys.length === 0) {
    container.innerHTML = '<p class="muted-label" style="padding:14px 0;">No data for this period.</p>';
    return;
  }
  const max = Math.max(...keys.map(k => totals[k]));
  // Stable, descending order
  keys.sort((a, b) => totals[b] - totals[a]);
  container.innerHTML = keys.map(k => {
    const pct = max > 0 ? Math.max(2, (totals[k] / max) * 100) : 0;
    const colorClass = opts.colorByKey && opts.kind === 'category' ? ` bar-cat-${k.toLowerCase()}` : '';
    const suffix = opts.suffixFor ? opts.suffixFor(k) : '';
    return `<div class="bar-row">
      <div class="bar-label" title="${esc(k)}">${esc(k)}${suffix ? `<span class="bar-suffix">${esc(suffix)}</span>` : ''}</div>
      <div class="bar-track"><div class="bar-fill${colorClass}" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="bar-value">${currency} ${money(totals[k])}</div>
    </div>`;
  }).join('');
}

function renderDailySpark(containerId, dayMap, period) {
  const container = $(containerId);
  if (!container) return;
  const keys = Object.keys(dayMap).sort();
  if (keys.length === 0) {
    container.innerHTML = '<p class="muted-label" style="padding:14px 0;">No data for this period.</p>';
    return;
  }
  // Build continuous date range
  let fromKey = keys[0], toKey = keys[keys.length - 1];
  if (period === 'all' || period === 'ytd') {
    // Cap to most recent 30 days for readability
    const lastDate = new Date(toKey);
    const earliest = new Date(lastDate);
    earliest.setDate(earliest.getDate() - 29);
    fromKey = `${earliest.getFullYear()}-${String(earliest.getMonth()+1).padStart(2,'0')}-${String(earliest.getDate()).padStart(2,'0')}`;
  }
  const series = [];
  const start = new Date(fromKey);
  const end = new Date(toKey);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    series.push({ date: new Date(d), key, value: dayMap[key] || 0 });
  }
  if (series.length === 0) {
    container.innerHTML = '<p class="muted-label" style="padding:14px 0;">No data for this period.</p>';
    return;
  }
  const max = Math.max(...series.map(s => s.value), 1);
  container.innerHTML = `<div class="spark-bars">
    ${series.map(s => {
      const h = Math.max(2, (s.value / max) * 100);
      const label = s.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
      return `<div class="spark-bar-wrap" title="${label}: ₹${money(s.value)}">
        <div class="spark-bar" style="height:${h.toFixed(1)}%"></div>
        <div class="spark-label">${s.date.getDate()}</div>
      </div>`;
    }).join('')}
  </div>
  <div class="spark-footer">
    <span class="muted-label">${series[0].date.toLocaleDateString('en-IN', { day:'2-digit', month:'short' })} – ${series[series.length-1].date.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</span>
    <span class="muted-label">Peak: ₹${money(max)}</span>
  </div>`;
}

// =========================================================
// DRIVE SETTINGS MODAL
// =========================================================
function initDriveSettings() {
  // (handlers wired via initGlobalActions)
}

function openDriveSettings() {
  const input = $('driveSettingsFolderId');
  const active = $('driveSettingsActive');
  if (input) input.value = DriveState.sharedFolderId || '';
  if (active) {
    if (DriveState.sharedFolderId) {
      active.innerHTML = `Shared folder: <code>${esc(DriveState.sharedFolderId)}</code>`;
    } else {
      active.textContent = 'Per-user personal folder ("BroZ Food Bills" in My Drive)';
    }
  }
  $('driveSettingsModal').classList.remove('hidden');
}

function closeDriveSettings() {
  $('driveSettingsModal').classList.add('hidden');
}

function saveDriveSettings() {
  const input = $('driveSettingsFolderId');
  const newId = (input?.value || '').trim();
  if (newId && newId === DriveState.sharedFolderId) { closeDriveSettings(); return; }
  if (newId) {
    localStorage.setItem(SHARED_FOLDER_STORAGE_KEY, newId);
    DriveState.sharedFolderId = newId;
  } else {
    localStorage.removeItem(SHARED_FOLDER_STORAGE_KEY);
    DriveState.sharedFolderId = null;
  }
  // Reset Drive state so next ensureFolder() resolves the new folder
  DriveState.folderId = null;
  DriveState.initialFolderResolved = false;
  DriveState.cache = null;
  Object.keys(FolderCache).forEach(k => delete FolderCache[k]);
  Object.keys(MenuCache).forEach(k => delete MenuCache[k]);
  toast('Drive settings saved. Reloading folder…', 'info');
  closeDriveSettings();
  if (isDriveConnected()) {
    ensureFolder().then(() => {
      updateDriveUI(true);
      toast(`Active folder: ${DriveState.sharedFolderId ? 'Shared' : 'Personal'} ✓`, 'success');
      refreshAllMenusFromDrive();
    }).catch(err => {
      toast('Folder error: ' + (err.message || ''), 'error', 6000);
    });
  }
}

function clearDriveSettings() {
  const input = $('driveSettingsFolderId');
  if (input) input.value = '';
  localStorage.removeItem(SHARED_FOLDER_STORAGE_KEY);
  DriveState.sharedFolderId = null;
  DriveState.folderId = null;
  DriveState.initialFolderResolved = false;
  DriveState.cache = null;
  Object.keys(FolderCache).forEach(k => delete FolderCache[k]);
  Object.keys(MenuCache).forEach(k => delete MenuCache[k]);
  const active = $('driveSettingsActive');
  if (active) active.textContent = 'Per-user personal folder ("BroZ Food Bills" in My Drive)';
  toast('Switched to per-user personal folder.', 'info');
  updateDriveUI(isDriveConnected());
}

// =========================================================
// WHATSAPP SHARE
// =========================================================
function initWhatsApp() {
  // FIX: attach the WhatsApp listener INSIDE DOMContentLoaded so the element exists
  const btn = document.getElementById('f_whatsappBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const guestName = $('f_guestName')?.value.trim() || 'Guest';
    const invNum = $('f_invNumber')?.textContent || '';
    const roomNo = $('f_roomNo')?.value.trim() || '';
    const grandText = $('f_grandTotal')?.textContent || '₹ 0.00';
    const phone = getFullPhone('f_phone', 'f_countryCode');

    const message = `Dear ${guestName},

Thank you for dining with BroZ Homes & Resorts!

Your Food Bill (${invNum}) has been generated.
Room: ${roomNo}
Total: ${grandText}

For any queries, contact brozhelpdesk@gmail.com

Warm regards,
BroZ Homes & Resorts`;

    toast('Generating PDF for sharing…', 'info');

    let blob;
    try {
      blob = await renderInvoicePDFBlob('foodInvoiceDoc');
    } catch (e) {
      console.warn('PDF generation for share failed:', e);
    }

    if (!blob) {
      const msg = encodeURIComponent(message);
      const cleanPhone = phone.replace(/[^0-9]/g, '');
      window.open(cleanPhone ? `https://wa.me/${cleanPhone}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');
      return;
    }

    const fileName = `FoodBill_${invNum || 'BroZ'}.pdf`;
    const file = new File([blob], fileName, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text: message, title: `Food Bill ${invNum}` });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }

    const pdfUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(pdfUrl), 5000);

    const msg = encodeURIComponent(message);
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    window.open(cleanPhone ? `https://wa.me/${cleanPhone}?text=${msg}` : `https://wa.me/?text=${msg}`, '_blank');

    toast('PDF downloaded. WhatsApp opened with the bill message.', 'info', 5000);
  });
}

// =========================================================
// TOAST NOTIFICATIONS
// =========================================================
function toast(msg, type = 'info', duration = 3200) {
  const container = $('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : type === 'error'
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
  el.innerHTML = `${icon}<span>${esc(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); }, duration);
}
