// =========================================================
// BroZ Food Billing Portal
// =========================================================

const CREDS = {
  admin: { password: 'broz123', role: 'admin' },
  user:  { password: 'broz',    role: 'user' },
};

const $ = (id) => document.getElementById(id);

const PROPERTIES = [
  { key: 'samalbong', name: 'Tibetan Villa Samalbong',   prefix: 'SAM', address: 'Raidara, Samalbong, Kalimpong - 734301' },
  { key: 'gangtok',   name: 'BroZ Nazom Retreat, Gangtok', prefix: 'GTK', address: 'Manbir Colony, Gangtok, Sikkim - 737101' },
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

let currentUser = null;
let selectedProperty = null;
let editingRecord = null;

const DRIVE_FOLDER_NAME = 'BroZ Food Bills';

const DriveState = {
  clientId: null,
  accessToken: null,
  tokenExpiry: 0,
  folderId: null,
  tokenClient: null,
  ready: false,
  cache: null,
};

const FolderCache = {};

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.yr').forEach(el => el.textContent = new Date().getFullYear());
  initLogin();
  initGlobalActions();
  initFoodBilling();
  initMenuManagement();
  initArchive();
  initModal();
  initDrive();
  renderPropertyTiles();
});

// =========================================================
// NAVIGATION
// =========================================================
function showScreen(id) {
  ['loginScreen', 'homeScreen', 'foodBillingScreen', 'menuManagementScreen', 'archiveScreen'].forEach(sid => {
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
  const driveStatus = document.querySelectorAll('[data-drive-status]');
  driveStatus.forEach(el => el.style.display = isAdmin ? '' : 'none');
  if (!isAdmin && DriveState.accessToken) updateDriveUI(true);
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
  loadMenuItems(selectedProperty);
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
      currentUser = null;
      editingRecord = null;
      $('loginForm').reset();
      $('foodForm').reset();
      resetFoodForm();
      showScreen('loginScreen');
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
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
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
      updateItemTotal(row);
    }
    renderFoodInvoice();
  });
  $('f_itemsContainer').addEventListener('input', (e) => {
    const row = e.target.closest('.food-item-row');
    if (row) { updateItemTotal(row); renderFoodInvoice(); }
  });
  $('f_discount').addEventListener('input', renderFoodInvoice);
  $('f_roomNo').addEventListener('input', renderFoodInvoice);
  $('f_guestName').addEventListener('input', renderFoodInvoice);
  $('f_authorizedBy').addEventListener('input', renderFoodInvoice);
  $('f_notes').addEventListener('input', renderFoodInvoice);

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

function addFoodItemRow(name = '', qty = 1, price = '') {
  const container = $('f_itemsContainer');
  const row = document.createElement('div');
  row.className = 'food-item-row';
  row.innerHTML = `
    <input type="text" class="item-name" placeholder="Item name" value="${esc(name)}" />
    <input type="number" class="item-qty" min="1" value="${qty}" placeholder="Qty" />
    <input type="number" class="item-price" min="0" step="0.01" value="${price}" placeholder="Price" />
    <span class="item-total">₹ ${money(price * qty)}</span>
    <button type="button" class="btn-remove" aria-label="Remove"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
  container.appendChild(row);
  renderFoodInvoice();
}

function updateItemTotal(row) {
  const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
  const price = parseFloat(row.querySelector('.item-price').value) || 0;
  row.querySelector('.item-total').textContent = `₹ ${money(qty * price)}`;
}

function loadMenuItems(propKey) {
  const chips = $('f_menuChips');
  const menu = getMenuFromStorage(propKey);
  if (!menu || menu.items.length === 0) { chips.innerHTML = ''; return; }
  chips.innerHTML = menu.items.map((item, i) =>
    `<span class="menu-chip" data-idx="${i}">${esc(item.name)} <span class="chip-price">₹${item.defaultPrice}</span></span>`
  ).join('');
  chips.querySelectorAll('.menu-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = parseInt(chip.dataset.idx);
      const item = menu.items[idx];
      addFoodItemRow(item.name, 1, item.defaultPrice);
    });
  });
}

function resetFoodForm() {
  $('foodForm').reset();
  $('f_countryCode').value = '+91';
  editingRecord = null;
  const container = $('f_itemsContainer');
  container.innerHTML = '';
  addFoodItemRow();
  $('f_discount').value = '0';
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
    if (name && qty > 0) items.push({ name, qty, price, total: qty * price });
  });

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const grand = Math.max(0, subtotal - discount);

  const prefix = prop ? prop.prefix : 'FB';
  $('f_invNumber').textContent = (generated || guestName) ? generateInvNumber(guestName || 'FB', prefix) : '—';
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

      const metadata = { ...data, pdfFileId: pdfFile.id, pdfFileName: pdfName, savedAt: new Date().toISOString(), type: 'food' };

      // If editing, delete old record first
      if (editingRecord) {
        try { await driveDelete(editingRecord.jsonFileId); } catch (e) {}
        try { if (editingRecord.metadata?.pdfFileId) await driveDelete(editingRecord.metadata.pdfFileId); } catch (e) {}
        editingRecord = null;
      }

      await driveUpload(jsonName, 'application/json', JSON.stringify(metadata, null, 2), targetFolderId);

      toast(`Saved to Drive ✓ (${invNum})`, 'success');
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
    if (name && qty > 0) items.push({ name, qty, price, total: qty * price });
  });
  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const discount = parseFloat($('f_discount').value) || 0;
  const grand = Math.max(0, subtotal - discount);

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
    subtotal,
    discount,
    grandTotal: grand,
    authorizedBy: $('f_authorizedBy').value.trim(),
    notes: $('f_notes').value.trim(),
    status: 'active',
  };
}

// =========================================================
// MENU MANAGEMENT
// =========================================================
function initMenuManagement() {
  $('m_property').addEventListener('change', () => {
    const key = $('m_property').value;
    renderMenuItems(key);
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
    }
  });

  $('m_addItem').addEventListener('click', () => {
    addMenuRow('', '');
  });

  $('m_saveBtn').addEventListener('click', saveMenuItems);
}

function populateMenuPropertySelect() {
  const sel = $('m_property');
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Select a property --</option>' +
    PROPERTIES.map(p => `<option value="${p.key}">${esc(p.name)}</option>`).join('');
  sel.value = current || '';
  if (sel.value) renderMenuItems(sel.value);
  else $('m_itemsContainer').innerHTML = '';
}

function addMenuRow(name = '', price = '') {
  const container = $('m_itemsContainer');
  const row = document.createElement('div');
  row.className = 'menu-mgmt-row';
  row.innerHTML = `
    <input type="text" class="m-item-name" placeholder="Item name" value="${esc(name)}" />
    <input type="number" class="m-item-price" min="0" step="0.01" placeholder="Price" value="${price}" />
    <button type="button" class="btn-remove" aria-label="Remove"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>`;
  container.appendChild(row);
}

function renderMenuItems(propKey) {
  const container = $('m_itemsContainer');
  container.innerHTML = '';
  const menu = getMenuFromStorage(propKey);
  if (menu && menu.items.length > 0) {
    menu.items.forEach(item => addMenuRow(item.name, item.defaultPrice));
  } else {
    addMenuRow('', '');
  }
}

function getMenuFromStorage(propKey) {
  try {
    const stored = localStorage.getItem(`broz_menu_${propKey}`);
    return stored ? JSON.parse(stored) : null;
  } catch (e) { return null; }
}

function saveMenuToStorage(propKey, items) {
  localStorage.setItem(`broz_menu_${propKey}`, JSON.stringify({ property: propKey, items, updatedAt: new Date().toISOString() }));
}

async function saveMenuItems() {
  const propKey = $('m_property').value;
  if (!propKey) { toast('Please select a property.', 'error'); return; }

  const items = [];
  document.querySelectorAll('#m_itemsContainer .menu-mgmt-row').forEach(row => {
    const name = row.querySelector('.m-item-name').value.trim();
    const price = parseFloat(row.querySelector('.m-item-price').value) || 0;
    if (name && price > 0) items.push({ name, defaultPrice: price });
  });

  if (items.length === 0) { toast('Please add at least one menu item.', 'error'); return; }

  saveMenuToStorage(propKey, items);
  toast(`Menu saved for ${PROPERTIES.find(p => p.key === propKey)?.name} ✓`, 'success');

  // Also save to Drive if connected
  if (!isDriveConnected()) return;

  try {
    await ensureFolder();
    const menusFolderId = await getOrCreateSubfolder(DriveState.folderId, 'Menus');
    const existingFiles = await driveListFilesInFolder(menusFolderId, `menu_${propKey}.json`);

    const menuData = { type: 'menu', property: propKey, items, updatedAt: new Date().toISOString() };

    if (existingFiles.length > 0) {
      await driveDelete(existingFiles[0].id);
    }
    await driveUpload(`menu_${propKey}.json`, 'application/json', JSON.stringify(menuData, null, 2), menusFolderId);
    toast('Menus synced to Drive ✓', 'success');
  } catch (err) {
    console.warn('Could not sync menus to Drive:', err.message);
  }
}

async function loadMenuFromDrive(propKey) {
  if (!isDriveConnected()) return;
  try {
    await ensureFolder();
    const menusFolderId = await getOrCreateSubfolder(DriveState.folderId, 'Menus');
    const files = await driveListFilesInFolder(menusFolderId, `menu_${propKey}.json`);
    if (files.length > 0) {
      const text = await driveDownloadText(files[0].id);
      const data = JSON.parse(text);
      if (data.items && data.items.length > 0) {
        saveMenuToStorage(propKey, data.items);
      }
    }
  } catch (e) { /* silent */ }
}

async function driveListFilesInFolder(folderId, namePattern) {
  const q = encodeURIComponent(`'${folderId}' in parents and name contains '${namePattern}' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
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
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
// GOOGLE DRIVE INTEGRATION
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
  if (resp.error) { toast('Could not connect to Drive.', 'error'); return; }
  DriveState.accessToken = resp.access_token;
  DriveState.tokenExpiry = Date.now() + (resp.expires_in * 1000);
  saveDriveTokenLocal();
  ensureFolder().then(() => {
    saveDriveTokenLocal();
    updateDriveUI(true);
    toast('Connected to Google Drive ✓', 'success');
    if (!$('archiveScreen').classList.contains('hidden')) loadArchive();
    // Also sync menus from Drive
    PROPERTIES.forEach(p => loadMenuFromDrive(p.key));
  }).catch(err => {
    console.error(err);
    toast('Connected, but could not set up folder.', 'error');
  });
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
    if (connected) { s.classList.add('connected'); const lbl = s.querySelector('.drive-btn-label'); if (lbl) lbl.textContent = 'Drive Connected'; }
    else { s.classList.remove('connected'); const lbl = s.querySelector('.drive-btn-label'); if (lbl) lbl.textContent = 'Connect Drive'; }
  });
}

function disconnectDrive() {
  DriveState.accessToken = null; DriveState.tokenExpiry = 0; DriveState.folderId = null; DriveState.cache = null;
  localStorage.removeItem('broz_drive_token');
  updateDriveUI(false);
}

// Drive API helpers
async function driveFetch(url, options = {}) {
  if (!isDriveConnected()) throw new Error('Not connected to Drive');
  const headers = options.headers || {};
  headers['Authorization'] = `Bearer ${DriveState.accessToken}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { disconnectDrive(); throw new Error('Drive session expired.'); }
  if (!res.ok) { const text = await res.text(); throw new Error(`Drive API error ${res.status}`); }
  return res;
}

async function ensureFolder() {
  if (DriveState.folderId) return DriveState.folderId;
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
  const data = await res.json();
  if (data.files && data.files.length > 0) { DriveState.folderId = data.files[0].id; return DriveState.folderId; }
  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const created = await createRes.json();
  DriveState.folderId = created.id;
  return DriveState.folderId;
}

async function driveUpload(filename, mimeType, content, parentId) {
  const boundary = '-------boz-' + Date.now();
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

  const res = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: body,
  });
  return res.json();
}

async function driveDownloadText(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.text();
}

async function driveDownloadBlob(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.blob();
}

async function driveListFiles() {
  await ensureFolder();
  const q = encodeURIComponent(`mimeType='application/json' and trashed=false and name contains '.json'`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,createdTime,parents)&pageSize=500&orderBy=createdTime desc`);
  const data = await res.json();
  return data.files || [];
}

async function driveDelete(fileId) {
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' });
}

// Nested folders
async function getOrCreateSubfolder(parentId, name) {
  const cacheKey = `${parentId}/${name}`;
  if (FolderCache[cacheKey]) return FolderCache[cacheKey];
  const q = encodeURIComponent(`'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`);
  const data = await res.json();
  if (data.files && data.files.length > 0) { FolderCache[cacheKey] = data.files[0].id; return data.files[0].id; }
  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files', {
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
  const propFolderId = await getOrCreateSubfolder(rootId, 'Food Bills');
  const nameFolderId = await getOrCreateSubfolder(propFolderId, propertyKey);
  return await getOrCreateSubfolder(nameFolderId, monthName);
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
}

async function loadArchive(force = false) {
  if (!isDriveConnected()) { showArchiveState('driveOff'); return; }
  if (DriveState.cache && !force) { showArchiveState('list'); renderArchiveList(); return; }
  showArchiveState('loading');

  try {
    const files = await driveListFiles();
    if (files.length === 0) { DriveState.cache = []; showArchiveState('empty'); return; }

    const records = [];
    const batchSize = 5;
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

  list.querySelectorAll('.archive-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.recordIdx);
      const filtered = getFilteredArchive();
      openInvoiceModal(filtered[idx]);
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
// INVOICE MODAL
// =========================================================
let currentModalRecord = null;

function initModal() {}

function openInvoiceModal(record) {
  currentModalRecord = record;
  const m = record.metadata || {};
  $('modalTitle').textContent = m.guestName || 'Food Bill';
  $('modalSubtitle').textContent = `FOOD · ${m.invoiceNumber || ''} · ${m.invoiceDate || ''}`;
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
    ? items.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td><td class="num">${money(i.price)}</td><td class="num">${money(i.total)}</td></tr>`).join('')
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
        <p class="invoice-label">FOOD BILL</p>
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
  try {
    await driveDelete(currentModalRecord.jsonFileId);
    if (m.pdfFileId) { try { await driveDelete(m.pdfFileId); } catch (e) {} }
    toast('Bill deleted from Drive.', 'success');
    closeModal();
    if (DriveState.cache) DriveState.cache = DriveState.cache.filter(r => r !== currentModalRecord);
    renderArchiveList();
  } catch (err) { toast('Could not delete: ' + err.message, 'error'); }
}

async function cancelInvoice(record) {
  if (!record) return;
  const m = record.metadata || {};
  const reason = prompt(`Cancel bill ${m.invoiceNumber}?\n\nEnter cancellation reason:`);
  if (reason === null) return;
  m.status = 'cancelled'; m.cancellationReason = reason; m.cancelledAt = new Date().toISOString();
  try {
    const jsonContent = JSON.stringify(m, null, 2);
    await driveDelete(record.jsonFileId);
    const baseName = ((m.guestName || 'guest').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 30)) + '_' + m.invoiceNumber;
    const newJson = await driveUpload(`${baseName}.json`, 'application/json', jsonContent, DriveState.folderId);
    record.jsonFileId = newJson.id; record.metadata = m;
    toast(`Bill ${m.invoiceNumber} marked as cancelled.`, 'success');
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
  if (items.length > 0) items.forEach(i => addFoodItemRow(i.name, i.qty, i.price));
  else addFoodItemRow();

  loadMenuItems(selectedProperty);
  renderFoodInvoice();
  toast('Bill loaded for editing. Make changes and click Generate Bill to save.', 'info', 5000);
}

// =========================================================
// WHATSAPP SHARE
// =========================================================
document.getElementById('f_whatsappBtn')?.addEventListener('click', () => {
  const guestName = $('f_guestName')?.value.trim() || 'Guest';
  const invNum = $('f_invNumber')?.textContent || '';
  const roomNo = $('f_roomNo')?.value.trim() || '';
  const grandText = $('f_grandTotal')?.textContent || '₹ 0.00';
  const phone = getFullPhone('f_phone', 'f_countryCode');

  const msg = encodeURIComponent(
    `Dear ${guestName},\n\nThank you for dining with BroZ Homes & Resorts! \n\nYour Food Bill (${invNum}) has been generated.\nRoom: ${roomNo}\nTotal: ${grandText}\n\nFor any queries, contact brozhelpdesk@gmail.com\n\nWarm regards,\nBroZ Homes & Resorts`
  );
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${msg}` : `https://wa.me/?text=${msg}`;
  window.open(url, '_blank');
});

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
