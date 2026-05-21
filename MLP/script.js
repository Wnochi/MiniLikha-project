// script.js - Main POS logic (MVP)
// Keep functions simple and commented for clarity.

// Helpers for localStorage
function loadProducts(){
  const raw = localStorage.getItem('pos_products');
  if(raw) return JSON.parse(raw);
  // No initial products shipped — admin will add them
  return [];
}
function saveProducts(list){ localStorage.setItem('pos_products', JSON.stringify(list)); }

function loadArchivedProducts(){ const raw = localStorage.getItem('pos_products_archived'); return raw ? JSON.parse(raw) : []; }
function saveArchivedProducts(list){ localStorage.setItem('pos_products_archived', JSON.stringify(list)); }

function loadCart(){
  const raw = localStorage.getItem('pos_cart');
  if(!raw) return [];
  try{
    const parsed = JSON.parse(raw);
    if(Array.isArray(parsed)) return parsed;
    // If stored as an object (old format or corruption), try to coerce to array
    if(parsed && typeof parsed === 'object'){
      // Prefer values (handles {id: {...}} or numeric keys)
      const vals = Object.values(parsed);
      // Ensure each entry has qty; filter invalid entries
      return vals.filter(v => v && (v.id || v.name)).map(v=>({
        id: v.id || v.productId || null,
        name: v.name || v.productName || 'Unknown',
        price: Number(v.price) || 0,
        qty: Number(v.qty || v.quantity || v.count) || 0
      }));
    }
  } catch(e){
    console.warn('Failed to parse pos_cart from localStorage, resetting cart', e);
  }
  return [];
}
function saveCart(cart){ localStorage.setItem('pos_cart', JSON.stringify(cart)); updateCartBadge(); }

function loadSales(){
  const raw = localStorage.getItem('pos_sales');
  return raw ? JSON.parse(raw) : [];
}
function saveSales(list){ localStorage.setItem('pos_sales', JSON.stringify(list)); }

// UI helpers
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(()=>t.style.display='none',2500); }

function hideToast(){
  const t = document.getElementById('toast'); if(!t) return;
  if(t._hideTimer) { clearTimeout(t._hideTimer); t._hideTimer = null; }
  t.style.display = 'none'; t.innerHTML = '';
}

function showActionToast(msg, actions = [], timeout = 5000){
  const t = document.getElementById('toast'); if(!t) return;
  t.innerHTML = '';
  const txt = document.createElement('div'); txt.className = 'toast-msg'; txt.textContent = msg;
  t.appendChild(txt);
  const wrap = document.createElement('div'); wrap.className = 'toast-actions'; wrap.style.marginLeft = '12px';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    btn.className = a.class || 'btn-ghost';
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', ()=>{
      try{ if(typeof a.onClick === 'function') a.onClick(); }catch(e){ console.error(e); }
      hideToast();
    });
    wrap.appendChild(btn);
  });
  t.style.display = 'flex'; t.style.alignItems = 'center'; t.style.gap = '8px';
  t.appendChild(wrap);
  if(t._hideTimer) clearTimeout(t._hideTimer);
  if(timeout > 0) t._hideTimer = setTimeout(()=> hideToast(), timeout);
}

function showLogoutConfirmToast(){
  showActionToast('Confirm logout?', [
    { label: 'Logout', class: 'btn primary', onClick: ()=>{ logoutUser(); window.location.href = 'login.html'; } },
    { label: 'Cancel', class: 'btn-ghost', onClick: ()=>{} }
  ], 7000);
}

// Render products grid
function renderProducts(){
  const grid = document.getElementById('productsGrid'); grid.innerHTML='';
  const products = loadProducts();
  if(products.length===0){ grid.innerHTML='<div class="muted">No products yet. Admin can add products.</div>'; return; }
  products.forEach(p=>{
    const card = document.createElement('div'); card.className='card';
    card.innerHTML = `
      <img src="${p.image || 'https://via.placeholder.com/300x200?text=No+Image'}" alt="${p.name}">
      <div class="title">${p.name}</div>
      <div class="price">PHP ${Number(p.price).toFixed(2)}</div>
      <div>Stock: <span class="stock-pill">${p.stock}</span></div>
      <div class="actions"><button class="btn btn-block primary addBtn">Add to Cart</button></div>
    `;
    const btn = card.querySelector('.addBtn');
    btn.disabled = p.stock <= 0;
    if(p.stock<=0) btn.textContent = 'Out of stock';
    btn.addEventListener('click', ()=> addToCart(p.id));
    grid.appendChild(card);
  });
}

// Cart logic
function addToCart(productId){
  const products = loadProducts();
  const p = products.find(x=>x.id===productId);
  if(!p) return showToast('Product not found');
  if(p.stock <= 0) return showToast('Out of stock');
  const cart = loadCart();
  const item = cart.find(i=>i.id===productId);
  if(item){
    if(item.qty >= p.stock) return showToast('Cannot add more — not enough stock');
    item.qty += 1;
  } else {
    cart.push({id:productId, name:p.name, price:p.price, qty:1});
  }
  saveCart(cart); renderCart(); showToast('Added to cart');
}

function renderCart(){
  const list = document.getElementById('cartList');
  list.innerHTML = '';
  const cart = loadCart();

  if(cart.length === 0){
    list.innerHTML = '<div class="muted">Cart is empty</div>';
    document.getElementById('cartTotal').textContent = 'PHP 0.00';
    updateCartBadge();
    return;
  }

  cart.forEach(item => {
    const el = document.createElement('div');
    el.className = 'cart-item';
    el.innerHTML = `
      <div class="cart-thumb">🧶</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-unit">PHP ${Number(item.price).toFixed(2)} each</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" data-action="dec">−</button>
        <span class="qty-num">${item.qty}</span>
        <button class="qty-btn" data-action="inc">+</button>
      </div>
      <div class="cart-item-subtotal">PHP ${(item.qty * item.price).toFixed(2)}</div>
      <button class="cart-remove" title="Remove item">×</button>
    `;
    el.querySelector('[data-action="dec"]').addEventListener('click', () => changeQty(item.id, -1));
    el.querySelector('[data-action="inc"]').addEventListener('click', () => changeQty(item.id, 1));
    el.querySelector('.cart-remove').addEventListener('click', () => {
      const cart2 = loadCart();
      const idx = cart2.findIndex(i => i.id === item.id);
      if(idx !== -1){ cart2.splice(idx, 1); saveCart(cart2); renderCart(); }
    });
    list.appendChild(el);
  });

  const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
  document.getElementById('cartTotal').textContent = 'PHP ' + total.toFixed(2);
  updateCartBadge();
  // reset change display when cart updates
  calcChange();
}

// Calculate change & toggle checkout row/button
function calcChange(){
  const cashInputEl = document.getElementById('cashInput');
  const changeOut = document.getElementById('changeOut');
  const changeRow = document.getElementById('changeRow');
  const coBtn = document.getElementById('checkoutBtn');
  const cash = Number((cashInputEl && cashInputEl.value) || 0);
  const total = loadCart().reduce((s, i) => s + i.price * i.qty, 0);
  const change = cash - total;
  if(changeOut) changeOut.textContent = 'PHP ' + (change > 0 ? change.toFixed(2) : '0.00');
  if(changeRow) changeRow.style.display = (cash > 0 && cash >= total) ? 'flex' : 'none';
  if(coBtn) coBtn.disabled = cash > 0 && cash < total;
}

function changeQty(productId, delta){
  const cart = loadCart();
  const item = cart.find(i=>i.id===productId); if(!item) return;
  const products = loadProducts();
  const p = products.find(x=>x.id===productId);
  if(delta > 0){
    if(p && item.qty + delta > p.stock) return showToast('Cannot increase — not enough stock');
  }
  item.qty += delta; if(item.qty<=0){ const idx=cart.indexOf(item); cart.splice(idx,1); }
  saveCart(cart); renderCart();
}

function updateCartBadge(){
  const cart = loadCart(); const count = cart.reduce((s,i)=>s+i.qty,0);
  const el = document.getElementById('cartBadge'); if(el) el.textContent = count;
}

// Checkout: deduct stock and save sale
function checkout(){
  const cart = loadCart(); if(cart.length===0) return showToast('Cart empty');
  const cash = Number(document.getElementById('cashInput').value || 0);
  const total = cart.reduce((s,i)=>s + i.price * i.qty, 0);
  if(cash < total) return showToast('Insufficient cash');
  // Deduct stock
  const products = loadProducts();
  for(const item of cart){
    const p = products.find(x=>x.id===item.id);
    if(!p || p.stock < item.qty) return showToast('Not enough stock for ' + item.name);
    p.stock -= item.qty;
  }
  saveProducts(products);
  // Record sale
  const sales = loadSales();
  sales.push({id:Date.now(), items:cart, total, timestamp:new Date().toISOString()});
  saveSales(sales);
  // Clear cart
  saveCart([]);
  renderProducts(); renderCart();
  renderSales();
  const change = cash - total; document.getElementById('changeOut').textContent = 'PHP ' + change.toFixed(2);
  showToast('Checkout successful');
}

// Admin: add product (simple incremental id)
function validateProductInput({id,name,price,stock}){
  name = (name||'').trim();
  if(!name) return 'Name is required';
  if(isNaN(price) || Number(price) < 0) return 'Price must be >= 0';
  const nStock = Number(stock);
  if(!Number.isInteger(nStock) || nStock < 0) return 'Stock must be an integer >= 0';
  const products = loadProducts();
  const existing = products.find(p=>p.name.toLowerCase() === name.toLowerCase());
  if(existing && (!id || existing.id !== id)) return 'Product name already exists';
  return null;
}

function addProduct({name,price,stock,image}){
  const user = getCurrentUser(); if(!user || !user.isAdmin) return showToast('Admin only');
  const err = validateProductInput({name,price,stock}); if(err) return showToast(err);
  const products = loadProducts();
  const id = 'p' + Date.now();
  products.push({id,name,price:Number(price),stock:Number(stock),image});
  saveProducts(products); renderProducts(); renderAdminProducts();
}

function renderAdminProducts(){
  const el = document.getElementById('adminProducts');
  el.innerHTML = '';
  const products = loadProducts();

  if(products.length === 0){
    el.innerHTML = '<div class="muted">No products yet</div>';
    return;
  }

  products.forEach(p => {
    const stockClass = p.stock === 0 ? 'stock-out' : p.stock <= 3 ? 'stock-low' : 'stock-ok';
    const stockLabel = p.stock === 0 ? 'Out of stock' : `${p.stock} in stock`;

    const row = document.createElement('div');
    row.className = 'admin-prod-row';
    row.innerHTML = `
      <div class="admin-prod-thumb">
        ${p.image
          ? `<img src="${p.image}" alt="${p.name}">`
          : `<span>🧶</span>`}
      </div>
      <div class="admin-prod-info">
        <div class="admin-prod-name">${p.name}</div>
        <div class="admin-prod-price">PHP ${Number(p.price).toFixed(2)}</div>
      </div>
      <span class="stock-badge ${stockClass}">${stockLabel}</span>
      <div class="admin-row-actions">
        <button class="act-btn" data-action="edit" data-id="${p.id}">Edit</button>
        <button class="act-btn danger" data-action="delete" data-id="${p.id}">Delete</button>
      </div>
    `;
    row.querySelector('[data-action="delete"]').addEventListener('click', () => showDeleteConfirm(p.id, p.name));
    row.querySelector('[data-action="edit"]').addEventListener('click', () => startEditProduct(p.id));
    el.appendChild(row);
  });
}

  // Archived products: render, restore, permanently delete
  function renderArchivedProducts(){
    const el = document.getElementById('archivedProducts'); if(!el) return;
    const archived = loadArchivedProducts();
    el.innerHTML = '';
    if(archived.length === 0){ el.innerHTML = '<div class="muted">No archived products</div>'; return; }
    archived.forEach(p=>{
      const row = document.createElement('div'); row.style.display='flex'; row.style.justifyContent='space-between'; row.style.padding='8px 0';
      const deletedAt = p.deletedAt ? new Date(p.deletedAt).toLocaleString() : '—';
      row.innerHTML = `<div>${p.name} — PHP ${Number(p.price).toFixed(2)} — deleted: ${deletedAt}</div>
        <div>
          <button class='btn-ghost' data-action='restore' data-id='${p.id}'>Restore</button>
          <button class='btn-ghost' data-action='permadelete' data-id='${p.id}'>Delete permanently</button>
        </div>`;
      row.querySelector("[data-action='restore']").addEventListener('click', ()=>{ restoreArchivedProduct(p.id); });
      row.querySelector("[data-action='permadelete']").addEventListener('click', ()=>{ if(confirm('Permanently delete archived product?')) permanentlyDeleteArchived(p.id); });
      el.appendChild(row);
    });
  }

  function restoreArchivedProduct(id){
    const archived = loadArchivedProducts();
    const idx = archived.findIndex(x=>x.id===id); if(idx === -1) return showToast('Archived product not found');
    const [item] = archived.splice(idx,1);
    saveArchivedProducts(archived);
    const products = loadProducts();
    // ensure unique name
    if(products.find(p=>p.name.toLowerCase() === item.name.toLowerCase())){
      item.name = item.name + ' (restored)';
    }
    // remove deletedAt before restoring
    if(item.deletedAt) delete item.deletedAt;
    products.push(item);
    saveProducts(products);
    renderProducts(); renderAdminProducts(); renderArchivedProducts(); showToast('Product restored');
  }

  function permanentlyDeleteArchived(id){
    const archived = loadArchivedProducts();
    const idx = archived.findIndex(x=>x.id===id); if(idx === -1) return showToast('Archived product not found');
    archived.splice(idx,1); saveArchivedProducts(archived); renderArchivedProducts(); showToast('Archived product permanently deleted');
  }

function renderSales(){
  const el = document.getElementById('salesList');
  if(!el) return;
  const sales = loadSales().slice().reverse();

  if(sales.length === 0){
    el.innerHTML = '<div class="muted">No sales yet</div>';
    return;
  }

  el.innerHTML = '';
  sales.forEach(sale => {
    const d = new Date(sale.timestamp).toLocaleString('en-PH', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
    const pillsHtml = sale.items
      .map(i => `<span class="sale-pill">${i.name} ×${i.qty}</span>`)
      .join('');

    const node = document.createElement('div');
    node.className = 'sale-card';
    node.innerHTML = `
      <div class="sale-header">
        <div>
          <div class="sale-id">Sale #${sale.id}</div>
          <div class="sale-time">${d}</div>
        </div>
        <div class="sale-total">PHP ${Number(sale.total).toFixed(2)}</div>
      </div>
      <div class="sale-items">${pillsHtml}</div>
    `;
    el.appendChild(node);
  });
}

function startEditProduct(id){
  const user = getCurrentUser(); if(!user || !user.isAdmin) return showToast('Admin only');
  const products = loadProducts();
  const p = products.find(x=>x.id===id); if(!p) return showToast('Product not found');
  const pill = document.getElementById('editingPill');
  if(pill){ pill.textContent = 'Editing: ' + p.name; pill.style.display = 'inline-block'; }
  const lbl = document.getElementById('formModeLabel');
  if(lbl) lbl.textContent = 'Edit product';
  document.getElementById('pId').value = p.id;
  document.getElementById('pName').value = p.name;
  document.getElementById('pPrice').value = p.price;
  document.getElementById('pStock').value = p.stock;
  document.getElementById('pImageUrl').value = (p.image && p.image.startsWith('data:'))? '' : (p.image||'');
  // show preview
  const preview = document.getElementById('pPreview'); if(preview){ preview.src = p.image || ''; preview.style.display = p.image? 'block' : 'none'; }
  // indicate editing
  const submit = document.getElementById('pSubmit'); if(submit) submit.textContent = 'Update Product';
  const cancel = document.getElementById('pCancel'); if(cancel) cancel.style.display = 'inline-block';
}

function updateProduct({id,name,price,stock,image,keepImage=false}){
  const user = getCurrentUser(); if(!user || !user.isAdmin) return showToast('Admin only');
  const err = validateProductInput({id,name,price,stock}); if(err) return showToast(err);
  const products = loadProducts();
  const p = products.find(x=>x.id===id); if(!p) return showToast('Product not found');
  p.name = name; p.price = Number(price); p.stock = Number(stock);
  if(!keepImage) p.image = image || p.image;
  saveProducts(products); renderProducts(); renderAdminProducts(); showToast('Product updated');
  resetProductForm();
}

function resetProductForm(){
  const pill = document.getElementById('editingPill');
if(pill){ pill.textContent = ''; pill.style.display = 'none'; }
  const lbl = document.getElementById('formModeLabel');
if(lbl) lbl.textContent = 'Add product';
  const form = document.getElementById('productForm'); if(form) form.reset();
  const submit = document.getElementById('pSubmit'); if(submit) submit.textContent = 'Add Product';
  const cancel = document.getElementById('pCancel'); if(cancel) cancel.style.display = 'none';
  const hid = document.getElementById('pId'); if(hid) hid.value = '';
  const preview = document.getElementById('pPreview'); if(preview){ preview.src=''; preview.style.display='none'; }
  const ferr = document.getElementById('productFormError'); if(ferr){ ferr.textContent=''; ferr.style.display='none'; }
}

let pendingDeleteId = null;
function showDeleteConfirm(id, name){
  const user = getCurrentUser(); if(!user || !user.isAdmin) return showToast('Admin only');
  pendingDeleteId = id;
  const modal = document.getElementById('confirmModal');
  const msg = document.getElementById('confirmMessage');
  if(msg) msg.textContent = `Delete product "${name}"? This will move it to the archive.`;
  if(modal){ modal.style.display = 'flex'; modal.setAttribute('aria-hidden','false'); }
}

function hideConfirm(){
  pendingDeleteId = null;
  const modal = document.getElementById('confirmModal'); if(modal){ modal.style.display = 'none'; modal.setAttribute('aria-hidden','true'); }
}

function performDeletion(id){
  const products = loadProducts();
  const idx = products.findIndex(p=>p.id===id);
  if(idx === -1){ showToast('Product not found'); hideConfirm(); return; }
  const [removed] = products.splice(idx,1);
  saveProducts(products);
  const archived = loadArchivedProducts();
  archived.push(Object.assign({}, removed, {deletedAt: new Date().toISOString()}));
  saveArchivedProducts(archived);
  renderProducts(); renderAdminProducts(); renderArchivedProducts(); showToast('Product deleted and archived');
  hideConfirm();
}

// Navigation
function showPanel(name){
  const user = getCurrentUser();
  if(name === 'admin' && (!user || !user.isAdmin)) name = 'products';
  ['products','cart','admin'].forEach(p=>{
    const panel = document.getElementById('panel'+capitalize(p));
    if(panel) panel.style.display = (p===name)?'block':'none';
    const btn = document.querySelector(`#nav${capitalize(p)}`);
    if(btn) btn.classList.toggle('active', p===name);
  });
  localStorage.setItem('pos_activePanel', name);
}
function capitalize(s){ return s.charAt(0).toUpperCase() + s.slice(1); }

// Sidebar collapse toggle
function toggleSidebar(){
  const sb = document.querySelector('.sidebar');
  if(!sb) return;
  const collapsed = sb.classList.toggle('collapsed');
  localStorage.setItem('pos_sidebarCollapsed', collapsed);
}

// Keyboard shortcuts: P = Products, C = Cart, A = Admin, L = Logout
function navShortcutHandler(e){
  const activeTag = document.activeElement && document.activeElement.tagName;
  if(activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') return; // don't interfere while typing
  const k = (e.key || '').toLowerCase();
  if(k === 'p'){ showPanel('products'); }
  else if(k === 'c'){ showPanel('cart'); }
  else if(k === 'a'){ const adminBtn = document.getElementById('navAdmin'); if(adminBtn && adminBtn.style.display !== 'none') showPanel('admin'); }
  else if(k === 'l'){ logoutUser(); window.location.href='login.html'; }
}

// Wire up events on load
document.addEventListener('DOMContentLoaded', ()=>{
  // Initial render
  renderProducts(); renderCart(); renderAdminProducts(); renderArchivedProducts(); updateCartBadge(); renderSales();

  // Restore active panel
  const active = localStorage.getItem('pos_activePanel') || 'products'; showPanel(active);

  // Restore sidebar collapsed state
  const sb = document.querySelector('.sidebar');
  if(sb && localStorage.getItem('pos_sidebarCollapsed') === 'true') sb.classList.add('collapsed');

  // Nav buttons
  const navProductsEl = document.getElementById('navProducts'); if(navProductsEl) navProductsEl.addEventListener('click', ()=>showPanel('products'));
  const navCartEl = document.getElementById('navCart'); if(navCartEl) navCartEl.addEventListener('click', ()=>showPanel('cart'));
  const adminBtn = document.getElementById('navAdmin'); if(adminBtn) adminBtn.addEventListener('click', ()=>showPanel('admin'));
  const navLogoutEl = document.getElementById('navLogout'); if(navLogoutEl) navLogoutEl.addEventListener('click', ()=>{ showLogoutConfirmToast(); });

  // Collapse toggle
  const toggle = document.getElementById('toggleSidebar'); if(toggle) toggle.addEventListener('click', toggleSidebar);

  // Keyboard shortcuts
  document.addEventListener('keydown', navShortcutHandler);

  // Checkout
  const checkoutBtnEl = document.getElementById('checkoutBtn'); if(checkoutBtnEl) checkoutBtnEl.addEventListener('click', checkout);

  // Cash input change -> update change display
  const cashInputEl = document.getElementById('cashInput'); if(cashInputEl) cashInputEl.addEventListener('input', calcChange);

  // Admin form submit (with validation)
  const productFormEl = document.getElementById('productForm'); if(productFormEl) productFormEl.addEventListener('submit', async function(e){
    e.preventDefault();
    const id = document.getElementById('pId').value;
    const name = document.getElementById('pName').value.trim();
    const price = document.getElementById('pPrice').value;
    const stock = document.getElementById('pStock').value;
    const url = document.getElementById('pImageUrl').value.trim();
    const file = document.getElementById('pImageFile').files[0];
    // validation
    const vErr = validateProductInput({id,name,price,stock});
    if(vErr){ const ferr = document.getElementById('productFormError'); if(ferr){ ferr.textContent = vErr; ferr.style.display = 'block'; } return; }
    // image handling
    let image = '';
    if(file){
      if(file.size > 2 * 1024 * 1024) showToast('File is larger than 2MB. Consider a smaller image.');
      image = await fileToBase64(file);
    } else if(url){ image = url; }
    if(id){
      const keepImage = (!file && !url);
      updateProduct({id,name,price,stock,image,keepImage});
    } else {
      addProduct({name,price,stock,image});
      this.reset();
      resetProductForm();
    }
    renderSales();
  });

  // Image preview handlers
  const imgUrl = document.getElementById('pImageUrl');
  const imgFile = document.getElementById('pImageFile');
  const preview = document.getElementById('pPreview');
  if(imgUrl && preview){ imgUrl.addEventListener('input', ()=>{ const val = imgUrl.value.trim(); if(val){ preview.src = val; preview.style.display = 'block'; } else { preview.src=''; preview.style.display='none'; } }); }
  if(imgFile && preview){ imgFile.addEventListener('change', async ()=>{ const f = imgFile.files[0]; if(!f){ preview.src=''; preview.style.display='none'; return; } if(f.size > 2 * 1024 * 1024) showToast('File is larger than 2MB.'); const data = await fileToBase64(f); preview.src = data; preview.style.display = 'block'; }); }

  // Cancel edit
  const pCancelBtn = document.getElementById('pCancel'); if(pCancelBtn) pCancelBtn.addEventListener('click', ()=>{ resetProductForm(); });

  // Confirm modal handlers
  const confirmYes = document.getElementById('confirmYes');
  const confirmNo = document.getElementById('confirmNo');
  if(confirmYes) confirmYes.addEventListener('click', ()=>{ if(pendingDeleteId) performDeletion(pendingDeleteId); });
  if(confirmNo) confirmNo.addEventListener('click', hideConfirm);
  // Close modal on Escape
  document.addEventListener('keydown', (ev)=>{ if(ev.key === 'Escape') hideConfirm(); });
});

function fileToBase64(file){
  return new Promise((resolve)=>{
    const reader = new FileReader(); reader.onload = ()=>resolve(reader.result); reader.readAsDataURL(file);
  });
}
