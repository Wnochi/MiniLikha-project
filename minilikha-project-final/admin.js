import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { db, auth } from "./firebase-config.js";

document.addEventListener('DOMContentLoaded', () => {
    const productCache = new Map();
    let ordersUnsubscribe = null;
    let latestProducts = [];
    let latestOrders = [];
    let activeOrderFilter = 'All';
    let preorderSlotsLeft = null;

    const views = {
        'nav-dashboard': { panel: document.getElementById('panel-dashboard'), title: 'Dashboard Overview' },
        'nav-inventory': { panel: document.getElementById('panel-inventory'), title: 'Product Inventory Management' },
        'nav-orders': { panel: document.getElementById('panel-orders'), title: 'Customer Transactions / Pre-Orders' },
        'nav-reports': { panel: document.getElementById('panel-reports'), title: 'Reports Analytics' },
        'nav-settings': { panel: document.getElementById('panel-settings'), title: 'Global System Settings' }
    };

    const inventoryTbody = document.getElementById('inventory-table-body');
    const ordersTbody = document.getElementById('orders-table-body');
    const productForm = document.getElementById('add-product-form');
    const addProductBtn = document.getElementById('add-product-btn');
    const productModalCloseBtn = document.getElementById('product-modal-close-btn');
    const productModalCancelBtn = document.getElementById('product-modal-cancel-btn');
    const orderFilterBtns = document.querySelectorAll('[data-order-filter]');
    const preorderSlotsInput = document.getElementById('preorder-slots-input');
    const savePreorderSlotsBtn = document.getElementById('save-preorder-slots-btn');
    const toDeliverList = document.getElementById('to-deliver-list');
    const reportMonthSelect = document.getElementById('report-month');
    const reportYearSelect = document.getElementById('report-year');
    const requestReportBtn = document.getElementById('request-report-btn');
    const reportBreakdownBody = document.getElementById('report-breakdown-body');
    const reportDailyBody = document.getElementById('report-daily-body');
    const settingsBusinessName = document.getElementById('settings-business-name');
    const settingsBusinessDesc = document.getElementById('settings-business-desc');
    const settingsProfileImageFile = document.getElementById('settings-profile-image-file');
    const settingsProfileImageLabel = document.getElementById('settings-profile-image-label');
    const settingsContactList = document.getElementById('settings-contact-list');
    const settingsAddContactBtn = document.getElementById('settings-add-contact-btn');
    const settingsSaveProfileBtn = document.getElementById('settings-save-profile-btn');
    const sidebarLogoImage = document.getElementById('sidebar-logo-image');
    const sidebarLogoFallback = document.getElementById('sidebar-logo-fallback');
    const loginOverlay = document.getElementById('admin-login-overlay');
    const guardOverlay = document.getElementById('admin-guard-overlay');
    const adminSidebar = document.getElementById('admin-sidebar');
    const adminShell = document.getElementById('admin-shell');
    const loginForm = document.getElementById('admin-login-form');
    const loginError = document.getElementById('login-error');
    const logoutBtn = document.getElementById('admin-logout-btn');
    const adminUserEmail = document.getElementById('admin-user-email');
    let productUnsubscribe = null;
    let preorderUnsubscribe = null;
    let businessProfileUnsubscribe = null;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[char]));
    }

    function formatCurrency(value) {
        return `PHP ${Number(value || 0).toFixed(2)}`;
    }

    function getOrderItems(order) {
        return Array.isArray(order.items) && order.items.length ? order.items : [{
            name: order.productName || 'Direct Package',
            variation: order.variation || order.color || 'Default',
            qty: order.quantity || 1,
            price: order.totalPaid || order.total || 0
        }];
    }

    function getOrderDate(order) {
        const source = order.timestamp || order.createdAt || order.updatedAt || order.deliveredAt;
        if (source && typeof source.toDate === 'function') return source.toDate();

        const parsed = new Date(source || Date.now());
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const maxSize = 1000;
                    const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.width * scale));
                    canvas.height = Math.max(1, Math.round(img.height * scale));
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/jpeg', 0.78));
                };
                img.onerror = () => reject(new Error('Could not process selected image.'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(reader.error || new Error('Could not read selected image.'));
            reader.readAsDataURL(file);
        });
    }

    async function readImageFiles(inputEl) {
        const files = [...(inputEl?.files || [])].filter(file => file.type.startsWith('image/'));
        if (files.length === 0) return [];
        return Promise.all(files.map(readFileAsDataUrl));
    }

    function parseVariations(value) {
        if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
        return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
    }

    function getProductStatus(item) {
        if (item.status === 'Published') return 'Active';
        return item.status || 'Active';
    }

    function showMessageRow(tbody, colspan, message) {
        if (!tbody) return;
        tbody.innerHTML = `
            <tr>
                <td colspan="${colspan}" class="p-4 text-center text-xs text-black">${escapeHtml(message)}</td>
            </tr>
        `;
    }

    function showAdminShell() {
        if (adminSidebar) adminSidebar.classList.remove('hidden');
        if (adminShell) adminShell.classList.remove('hidden');
        if (adminSidebar) adminSidebar.style.display = 'flex';
        if (adminShell) adminShell.style.display = 'flex';
    }

    function hideAdminShell() {
        if (adminSidebar) adminSidebar.classList.add('hidden');
        if (adminShell) adminShell.classList.add('hidden');
        if (adminSidebar) adminSidebar.style.display = 'none';
        if (adminShell) adminShell.style.display = 'none';
    }

    function showGuardOverlay(message = 'Checking admin access...') {
        if (!guardOverlay) return;
        const messageEl = guardOverlay.querySelector('p');
        if (messageEl) messageEl.innerText = message;
        guardOverlay.classList.remove('hidden');
        guardOverlay.style.display = 'flex';
    }

    function hideGuardOverlay() {
        if (!guardOverlay) return;
        guardOverlay.classList.add('hidden');
        guardOverlay.style.display = 'none';
    }

    function showLoginOverlay() {
        if (loginOverlay) {
            loginOverlay.classList.remove('hidden');
            loginOverlay.style.display = 'flex';
        }
    }

    function hideLoginOverlay() {
        if (loginOverlay) {
            loginOverlay.classList.add('hidden');
            loginOverlay.style.display = 'none';
        }
    }

    function navigateToView(activeKey) {
        Object.keys(views).forEach(key => {
            const item = views[key];
            if (!item.panel) return;

            const btn = document.getElementById(key);
            if (key === activeKey) {
                item.panel.classList.remove('hidden');
                if (btn) btn.className = "nav-btn w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg text-black bg-[#FF8DA4] transition";
                const titleEl = document.getElementById('panel-title');
                if (titleEl) titleEl.innerText = item.title;
            } else {
                item.panel.classList.add('hidden');
                if (btn) btn.className = "nav-btn w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-lg text-black hover:bg-[#FED8E3] transition";
            }
        });
    }

    function updateDashboardMetrics() {
        const visibleOrders = latestOrders.filter(order => order.orderStatus !== 'Cancelled');
        const grossIncome = visibleOrders.reduce((sum, order) => sum + Number(order.totalPaid || order.total || 0), 0);
        const pendingOrders = latestOrders.filter(order => !order.isDelivered && (order.orderStatus || 'Pending') === 'Pending').length;

        const grossEl = document.getElementById('metric-gross-income');
        const slotsEl = document.getElementById('metric-active-slots');
        const pendingEl = document.getElementById('metric-pending-orders');

        if (grossEl) grossEl.innerText = formatCurrency(grossIncome);
        if (slotsEl) slotsEl.innerText = preorderSlotsLeft === null ? 'Not set' : `${preorderSlotsLeft} Slots`;
        if (pendingEl) pendingEl.innerText = `${pendingOrders} Pending`;
    }

    function renderToDeliver(orders = latestOrders) {
        if (!toDeliverList) return;

        const readyOrders = orders.filter(order => {
            const status = order.orderStatus || 'Pending';
            return status === 'Done' && !order.isDelivered && !order.deliveredAt;
        });

        if (readyOrders.length === 0) {
            toDeliverList.innerHTML = '<div class="p-5 text-center text-xs text-black">No orders ready for delivery yet.</div>';
            return;
        }

        toDeliverList.innerHTML = readyOrders.map(order => {
            const items = getOrderItems(order);
            const qty = items.reduce((sum, item) => sum + Number(item.qty || item.quantity || 0), 0) || 1;
            const names = items.map(item => item.name || 'Product').join(', ');
            return `
                <label class="p-5 flex items-start gap-4 hover:bg-[#FED8E3] transition cursor-pointer">
                    <input type="checkbox" data-action="mark-delivered" data-id="${escapeHtml(order.id)}" class="mt-1 h-4 w-4 accent-[#FF8DA4]">
                    <span class="flex-1 min-w-0">
                        <span class="block font-semibold text-sm text-black">${escapeHtml(order.customerName || 'Anonymous User')}</span>
                        <span class="block text-xs text-black mt-1">${escapeHtml(names)} - Qty ${escapeHtml(qty)}</span>
                        <span class="block text-xs text-black mt-1">${escapeHtml(order.customerAddress || 'No delivery address saved')}</span>
                    </span>
                    <span class="text-xs font-semibold text-black whitespace-nowrap">${formatCurrency(order.totalPaid || order.total)}</span>
                </label>
            `;
        }).join('');
    }

    function renderProducts(products) {
        latestProducts = products;
        productCache.clear();
        products.forEach(item => productCache.set(item.id, item));
        updateDashboardMetrics();

        if (!inventoryTbody) return;
        if (products.length === 0) {
            showMessageRow(inventoryTbody, 5, 'No products yet. Add your first product after signing in.');
            return;
        }

        inventoryTbody.innerHTML = products.map(item => {
            const status = getProductStatus(item);
            const variations = parseVariations(item.variations).join(', ') || 'Default';
            const statusClass = 'bg-white text-black border-[#F0CAD5]';
            return `
                <tr class="border-b border-[#F0CAD5] transition text-sm text-black">
                    <td class="p-4">
                        <div class="font-semibold text-black">${escapeHtml(item.name || 'Unnamed Item')}</div>
                        <div class="text-xs text-black mt-1 line-clamp-1">${escapeHtml(item.category || item.description || 'No category')}</div>
                    </td>
                    <td class="p-4 text-black">${escapeHtml(variations)}</td>
                    <td class="p-4 text-black">${formatCurrency(item.price)}</td>
                    <td class="p-4">
                        <select data-action="update-product-status" data-id="${escapeHtml(item.id)}" class="border rounded-lg px-2 py-1 text-xs font-semibold ${statusClass}">
                            ${['Active', 'Unavailable', 'Draft'].map(option => `<option value="${option}" ${option === status ? 'selected' : ''}>${option}</option>`).join('')}
                        </select>
                    </td>
                    <td class="p-4 text-right">
                        <button data-action="edit-product" data-id="${escapeHtml(item.id)}" class="text-xs font-semibold text-black hover:bg-[#FED8E3] rounded px-2 py-1 mr-1">Edit</button>
                        ${status !== 'Active' ? `<button data-action="publish-product" data-id="${escapeHtml(item.id)}" class="text-xs font-semibold text-black hover:bg-[#FED8E3] rounded px-2 py-1 mr-1">Publish</button>` : ''}
                        <button data-action="delete-product" data-id="${escapeHtml(item.id)}" class="text-xs font-semibold text-black hover:bg-[#FED8E3] rounded px-2 py-1">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function renderOrders(orders) {
        latestOrders = orders;
        updateDashboardMetrics();
        renderToDeliver(orders);
        renderSalesReport();

        if (!ordersTbody) return;
        const activeOrders = orders.filter(order => {
            const status = order.orderStatus || 'Pending';
            return !order.isDelivered && !order.deliveredAt && status !== 'Completed' && status !== 'Cancelled';
        });
        const filteredOrders = activeOrderFilter === 'All'
            ? activeOrders
            : activeOrders.filter(order => (order.orderStatus || 'Pending') === activeOrderFilter);

        if (filteredOrders.length === 0) {
            showMessageRow(ordersTbody, 7, activeOrderFilter === 'All' ? 'No customer orders yet.' : `No ${activeOrderFilter} orders yet.`);
            return;
        }

        ordersTbody.innerHTML = filteredOrders.map(order => {
            const status = order.orderStatus || 'Pending';
            const items = getOrderItems(order);
            const firstItem = items[0] || {};
            const itemName = firstItem.name || order.productName || 'Direct Package';
            const variation = firstItem.variation || firstItem.color || order.variation || 'Default';
            const qty = items.reduce((sum, item) => sum + Number(item.qty || item.quantity || 0), 0) || order.quantity || 1;

            return `
                <tr class="border-b border-[#F0CAD5] transition text-sm text-black">
                    <td class="p-4">
                        <div class="font-semibold text-black">${escapeHtml(order.customerName || 'Anonymous User')}</div>
                        <div class="text-xs text-black mt-1">${escapeHtml(order.customerPhone || '')}</div>
                    </td>
                    <td class="p-4 text-black">${escapeHtml(itemName)}</td>
                    <td class="p-4 text-black">${escapeHtml(variation)}</td>
                    <td class="p-4 font-medium text-black">${escapeHtml(qty)}</td>
                    <td class="p-4 font-medium text-black">${formatCurrency(order.totalPaid || order.total)}</td>
                    <td class="p-4">
                        <select data-action="update-order-status" data-id="${escapeHtml(order.id)}" class="border border-[#F0CAD5] rounded-lg px-2 py-1 text-xs font-semibold bg-white text-black">
                            ${['Pending', 'Making', 'Done'].map(option => `<option value="${option}" ${option === status ? 'selected' : ''}>${option}</option>`).join('')}
                        </select>
                    </td>
                    <td class="p-4 text-right">
                        <button data-action="delete-order" data-id="${escapeHtml(order.id)}" class="text-xs font-semibold text-black hover:bg-[#FED8E3] rounded px-2 py-1">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function setupReportControls() {
        if (!reportMonthSelect || !reportYearSelect) return;

        const now = new Date();
        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        reportMonthSelect.innerHTML = months.map((month, index) => `<option value="${index}" ${index === now.getMonth() ? 'selected' : ''}>${month}</option>`).join('');

        const currentYear = now.getFullYear();
        const startYear = Math.max(2024, currentYear - 2);
        const years = Array.from({ length: 8 }, (_, index) => startYear + index);
        reportYearSelect.innerHTML = years.map(year => `<option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}</option>`).join('');
    }

    function renderSalesReport() {
        if (!reportMonthSelect || !reportYearSelect) return;

        const selectedMonth = Number(reportMonthSelect.value || new Date().getMonth());
        const selectedYear = Number(reportYearSelect.value || new Date().getFullYear());
        const reportOrders = latestOrders.filter(order => {
            const status = order.orderStatus || 'Pending';
            if (status === 'Cancelled') return false;
            const date = getOrderDate(order);
            return date.getMonth() === selectedMonth && date.getFullYear() === selectedYear;
        });

        const revenue = reportOrders.reduce((sum, order) => sum + Number(order.totalPaid || order.total || 0), 0);
        let itemsSold = 0;
        const productTotals = new Map();
        const dailyTotals = new Map();

        reportOrders.forEach(order => {
            const date = getOrderDate(order);
            const dayKey = date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
            const orderRevenue = Number(order.totalPaid || order.total || 0);
            const currentDay = dailyTotals.get(dayKey) || { orders: 0, revenue: 0 };
            dailyTotals.set(dayKey, {
                orders: currentDay.orders + 1,
                revenue: currentDay.revenue + orderRevenue
            });

            getOrderItems(order).forEach(item => {
                const qty = Number(item.qty || item.quantity || 0) || 1;
                const itemRevenue = Number(item.price || 0) * qty || orderRevenue;
                const label = `${item.name || 'Product'}${item.variation || item.color ? ` (${item.variation || item.color})` : ''}`;
                const current = productTotals.get(label) || { qty: 0, revenue: 0 };
                productTotals.set(label, {
                    qty: current.qty + qty,
                    revenue: current.revenue + itemRevenue
                });
                itemsSold += qty;
            });
        });

        const sortedProducts = [...productTotals.entries()].sort((a, b) => b[1].qty - a[1].qty);
        const revenueEl = document.getElementById('report-sales-revenue');
        const itemsEl = document.getElementById('report-items-sold');
        const topProductEl = document.getElementById('report-top-product');

        if (revenueEl) revenueEl.innerText = formatCurrency(revenue);
        if (itemsEl) itemsEl.innerText = String(itemsSold);
        if (topProductEl) topProductEl.innerText = sortedProducts[0]?.[0] || 'None yet';

        if (reportBreakdownBody) {
            reportBreakdownBody.innerHTML = sortedProducts.length
                ? sortedProducts.map(([label, total]) => `
                    <tr class="border-b border-[#F0CAD5] text-sm text-black">
                        <td class="p-4 text-black">${escapeHtml(label)}</td>
                        <td class="p-4 font-semibold text-black">${escapeHtml(total.qty)}</td>
                        <td class="p-4 text-right font-semibold text-black">${formatCurrency(total.revenue)}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="3" class="p-4 text-center text-xs text-black">No sales found for this month.</td></tr>';
        }

        if (reportDailyBody) {
            const sortedDays = [...dailyTotals.entries()];
            reportDailyBody.innerHTML = sortedDays.length
                ? sortedDays.map(([day, total]) => `
                    <tr class="border-b border-[#F0CAD5] text-sm text-black">
                        <td class="p-4 text-black">${escapeHtml(day)}</td>
                        <td class="p-4 font-semibold text-black">${escapeHtml(total.orders)}</td>
                        <td class="p-4 text-right font-semibold text-black">${formatCurrency(total.revenue)}</td>
                    </tr>
                `).join('')
                : '<tr><td colspan="3" class="p-4 text-center text-xs text-black">No daily sales found for this month.</td></tr>';
        }
    }

    function createContactRow(contact = {}) {
        return `
            <div class="settings-contact-row grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
                <input type="text" data-contact-field="label" value="${escapeHtml(contact.label || '')}" placeholder="Label, e.g. Facebook" class="bg-[#FED8E3] border border-[#FED8E3] rounded-lg px-3 py-2 text-sm text-black focus:outline-hidden focus:ring-2 focus:ring-[#FF8DA4] focus:border-transparent transition">
                <input type="text" data-contact-field="value" value="${escapeHtml(contact.value || '')}" placeholder="Contact detail" class="bg-white border border-[#F0CAD5] rounded-lg px-3 py-2 text-sm text-black focus:outline-hidden focus:ring-2 focus:ring-[#FF8DA4] focus:border-transparent transition">
                <button type="button" data-action="remove-contact" class="px-3 py-2 bg-[#FF8DA4] border border-[#FF8DA4] rounded-lg text-xs font-semibold text-black hover:bg-[#FED8E3] transition">Remove</button>
            </div>
        `;
    }

    function collectContacts() {
        if (!settingsContactList) return [];
        return [...settingsContactList.querySelectorAll('.settings-contact-row')].map(row => ({
            label: row.querySelector('[data-contact-field="label"]')?.value?.trim() || '',
            value: row.querySelector('[data-contact-field="value"]')?.value?.trim() || ''
        })).filter(contact => contact.label || contact.value);
    }

    function renderBusinessProfile(data = {}) {
        if (settingsBusinessName) settingsBusinessName.value = data.businessName || '';
        if (settingsBusinessDesc) settingsBusinessDesc.value = data.description || '';
        if (settingsProfileImageLabel) settingsProfileImageLabel.innerText = data.profileImageUrl ? 'Saved profile picture found. Choose a new file only if replacing.' : 'No saved profile picture yet.';
        if (sidebarLogoImage && sidebarLogoFallback) {
            if (data.profileImageUrl) {
                sidebarLogoImage.src = data.profileImageUrl;
                sidebarLogoImage.classList.remove('hidden');
                sidebarLogoFallback.classList.add('hidden');
            } else {
                sidebarLogoImage.removeAttribute('src');
                sidebarLogoImage.classList.add('hidden');
                sidebarLogoFallback.classList.remove('hidden');
            }
        }
        if (settingsContactList) {
            const contacts = Array.isArray(data.contacts) && data.contacts.length ? data.contacts : [{ label: '', value: '' }];
            settingsContactList.innerHTML = contacts.map(contact => createContactRow(contact)).join('');
        }
    }

    function resetProductForm() {
        if (!productForm) return;
        productForm.reset();
        document.getElementById('product-doc-id').value = '';
        const imageLabel = document.getElementById('product-image-file-label');
        if (imageLabel) imageLabel.innerText = 'Select one or more local product photos. The first photo becomes the main photo.';
        document.getElementById('product-modal-title').innerText = 'Add New Creation to Store Registry';
        document.getElementById('product-submit-btn').innerText = 'Add Product';
    }

    function fillProductForm(item) {
        document.getElementById('product-doc-id').value = item.id;
        document.getElementById('product-name').value = item.name || '';
        document.getElementById('product-desc').value = item.description || '';
        document.getElementById('product-price').value = item.price ?? '';
        document.getElementById('product-variations').value = parseVariations(item.variations).join(', ');
        document.getElementById('product-category').value = item.category || '';
        const imageLabel = document.getElementById('product-image-file-label');
        const imageCount = Array.isArray(item.imageUrls) ? item.imageUrls.length : (item.imageUrl ? 1 : 0);
        if (imageLabel) imageLabel.innerText = imageCount ? `${imageCount} saved photo${imageCount === 1 ? '' : 's'}. Choose new files only if replacing.` : 'No saved photos yet.';
        document.getElementById('product-modal-title').innerText = 'Edit Product';
        document.getElementById('product-submit-btn').innerText = 'Add Product';
    }

    function openProductModal(productId = null) {
        resetProductForm();
        if (productId) {
            const item = productCache.get(productId);
            if (item) fillProductForm(item);
        }
        const modal = document.getElementById('modal-add-product');
        if (modal) modal.classList.remove('hidden');
    }

    function closeProductModal() {
        const modal = document.getElementById('modal-add-product');
        if (modal) modal.classList.add('hidden');
    }

    function requireSignedInAdmin() {
        if (!auth || !auth.currentUser) {
            throw new Error('Please sign in as an admin first.');
        }
    }

    async function verifyAdminUser(user) {
        if (!db || !user) return false;
        try {
            const adminSnap = await getDoc(doc(db, 'admins', user.uid));
            return adminSnap.exists();
        } catch (err) {
            console.error('Could not verify admin account:', err);
            return false;
        }
    }

    function startProductListener() {
        if (!db) {
            showMessageRow(inventoryTbody, 5, 'Firestore is not initialized.');
            return;
        }
        if (productUnsubscribe) return;

        productUnsubscribe = onSnapshot(collection(db, 'products'), (snapshot) => {
            const products = [];
            snapshot.forEach(docSnap => products.push({ id: docSnap.id, ...docSnap.data() }));
            renderProducts(products);
        }, (err) => {
            console.error('Failed to load products:', err);
            showMessageRow(inventoryTbody, 5, 'Could not load products.');
        });
    }

    function startPreorderSettingsListener() {
        if (!db) return;
        if (preorderUnsubscribe) return;

        preorderUnsubscribe = onSnapshot(doc(db, 'settings', 'preorder'), (snapshot) => {
            const data = snapshot.exists() ? snapshot.data() : {};
            preorderSlotsLeft = snapshot.exists() ? Number(data.slotsLeft ?? data.totalSlots ?? 0) : null;
            if (preorderSlotsInput) preorderSlotsInput.value = snapshot.exists() ? Number(data.totalSlots ?? preorderSlotsLeft ?? 0) : '';
            updateDashboardMetrics();
        }, (err) => {
            console.error('Failed to load pre-order settings:', err);
            preorderSlotsLeft = null;
            const slotsEl = document.getElementById('metric-active-slots');
            if (slotsEl) slotsEl.innerText = 'Check rules';
        });
    }

    function startBusinessProfileListener() {
        if (!db) return;
        if (businessProfileUnsubscribe) return;

        businessProfileUnsubscribe = onSnapshot(doc(db, 'settings', 'businessProfile'), (snapshot) => {
            renderBusinessProfile(snapshot.exists() ? snapshot.data() : {});
        }, (err) => {
            console.error('Failed to load business profile:', err);
        });
    }

    function startAdminListeners() {
        startProductListener();
        startPreorderSettingsListener();
        startBusinessProfileListener();
        startOrdersListener();
    }

    function startOrdersListener() {
        if (!db || ordersUnsubscribe) return;
        ordersUnsubscribe = onSnapshot(collection(db, 'orders'), (snapshot) => {
            const orders = [];
            snapshot.forEach(docSnap => orders.push({ id: docSnap.id, ...docSnap.data() }));
            renderOrders(orders);
        }, (err) => {
            console.error('Failed to load orders:', err);
            showMessageRow(ordersTbody, 7, 'Could not load orders. Check admin permissions.');
        });
    }

    function stopOrdersListener() {
        if (ordersUnsubscribe) {
            ordersUnsubscribe();
            ordersUnsubscribe = null;
        }
        latestOrders = [];
        updateDashboardMetrics();
        renderToDeliver([]);
        renderSalesReport();
        showMessageRow(ordersTbody, 7, 'Sign in as an admin to view customer orders.');
    }

    window.navigateAdminToView = navigateToView;
    window.openAddProductModal = () => openProductModal();
    window.closeAddProductModal = closeProductModal;

    Object.keys(views).forEach(key => {
        const el = document.getElementById(key);
        if (el) el.addEventListener('click', () => navigateToView(key));
    });

    if (addProductBtn) addProductBtn.addEventListener('click', () => openProductModal());
    if (productModalCloseBtn) productModalCloseBtn.addEventListener('click', closeProductModal);
    if (productModalCancelBtn) productModalCancelBtn.addEventListener('click', closeProductModal);
    if (savePreorderSlotsBtn) {
        savePreorderSlotsBtn.addEventListener('click', async () => {
            try {
                requireSignedInAdmin();
                const totalSlots = Number.parseInt(preorderSlotsInput?.value || '0', 10);
                await setDoc(doc(db, 'settings', 'preorder'), {
                    totalSlots,
                    slotsLeft: totalSlots,
                    updatedAt: serverTimestamp()
                }, { merge: true });
                alert('Pre-order slots saved.');
            } catch (err) {
                alert(err.message || 'Could not save pre-order slots.');
            }
        });
    }
    if (requestReportBtn) requestReportBtn.addEventListener('click', renderSalesReport);
    if (reportMonthSelect) reportMonthSelect.addEventListener('change', renderSalesReport);
    if (reportYearSelect) reportYearSelect.addEventListener('change', renderSalesReport);

    if (settingsAddContactBtn && settingsContactList) {
        settingsAddContactBtn.addEventListener('click', () => {
            settingsContactList.insertAdjacentHTML('beforeend', createContactRow());
        });
    }

    if (settingsContactList) {
        settingsContactList.addEventListener('click', (event) => {
            const target = event.target.closest('button[data-action="remove-contact"]');
            if (!target) return;
            target.closest('.settings-contact-row')?.remove();
            if (!settingsContactList.querySelector('.settings-contact-row')) {
                settingsContactList.innerHTML = createContactRow();
            }
        });
    }

    if (settingsSaveProfileBtn) {
        settingsSaveProfileBtn.addEventListener('click', async () => {
            try {
                requireSignedInAdmin();
                const selectedProfileImages = await readImageFiles(settingsProfileImageFile);
                const payload = {
                    businessName: settingsBusinessName?.value?.trim() || '',
                    description: settingsBusinessDesc?.value?.trim() || '',
                    contacts: collectContacts(),
                    updatedAt: serverTimestamp()
                };
                if (selectedProfileImages[0]) payload.profileImageUrl = selectedProfileImages[0];

                await setDoc(doc(db, 'settings', 'businessProfile'), payload, { merge: true });
                if (settingsProfileImageFile) settingsProfileImageFile.value = '';
                alert('Business settings saved.');
            } catch (err) {
                alert(err.message || 'Could not save business settings.');
            }
        });
    }
    orderFilterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            activeOrderFilter = btn.dataset.orderFilter || 'All';
            orderFilterBtns.forEach(item => {
                const isActive = item === btn;
                item.className = isActive
                    ? 'order-filter-btn px-4 py-2 rounded-lg text-sm font-semibold bg-[#FF8DA4] text-black border border-[#FF8DA4] hover:bg-[#FED8E3] transition'
                    : 'order-filter-btn px-4 py-2 rounded-lg text-sm font-semibold bg-white text-black border border-[#F0CAD5] hover:bg-[#FED8E3] transition';
            });
            renderOrders(latestOrders);
        });
    });

    if (inventoryTbody) {
        inventoryTbody.addEventListener('click', async (event) => {
            const target = event.target.closest('button[data-action]');
            if (!target) return;

            const productId = target.dataset.id;
            if (target.dataset.action === 'edit-product') {
                openProductModal(productId);
                return;
            }

            if (target.dataset.action === 'delete-product') {
                try {
                    requireSignedInAdmin();
                    const item = productCache.get(productId);
                    if (!confirm(`Delete "${item?.name || 'this product'}"?`)) return;
                    await deleteDoc(doc(db, 'products', productId));
                } catch (err) {
                    alert(err.message || 'Could not delete product.');
                }
            }

            if (target.dataset.action === 'publish-product') {
                try {
                    requireSignedInAdmin();
                    await updateDoc(doc(db, 'products', productId), {
                        status: 'Active',
                        updatedAt: serverTimestamp()
                    });
                } catch (err) {
                    alert(err.message || 'Could not publish product.');
                }
            }
        });

        inventoryTbody.addEventListener('change', async (event) => {
            const target = event.target.closest('select[data-action="update-product-status"]');
            if (!target) return;

            try {
                requireSignedInAdmin();
                await updateDoc(doc(db, 'products', target.dataset.id), {
                    status: target.value,
                    updatedAt: serverTimestamp()
                });
            } catch (err) {
                alert(err.message || 'Could not update product status.');
            }
        });
    }

    if (ordersTbody) {
        ordersTbody.addEventListener('change', async (event) => {
            const target = event.target.closest('select[data-action="update-order-status"]');
            if (!target) return;

            try {
                requireSignedInAdmin();
                await updateDoc(doc(db, 'orders', target.dataset.id), {
                    orderStatus: target.value,
                    updatedAt: serverTimestamp()
                });
            } catch (err) {
                alert(err.message || 'Could not update order status.');
            }
        });

        ordersTbody.addEventListener('click', async (event) => {
            const target = event.target.closest('button[data-action="delete-order"]');
            if (!target) return;

            try {
                requireSignedInAdmin();
                if (!confirm('Delete this order record?')) return;
                await deleteDoc(doc(db, 'orders', target.dataset.id));
            } catch (err) {
                alert(err.message || 'Could not delete order.');
            }
        });
    }

    if (toDeliverList) {
        toDeliverList.addEventListener('change', async (event) => {
            const target = event.target.closest('input[data-action="mark-delivered"]');
            if (!target || !target.checked) return;

            try {
                requireSignedInAdmin();
                if (!confirm('Mark this order as delivered?')) {
                    target.checked = false;
                    return;
                }
                await updateDoc(doc(db, 'orders', target.dataset.id), {
                    isDelivered: true,
                    orderStatus: 'Completed',
                    deliveredAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            } catch (err) {
                target.checked = false;
                alert(err.message || 'Could not mark order as delivered.');
            }
        });
    }

    if (productForm) {
        productForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const submitBtn = event.submitter || document.getElementById('product-submit-btn');
            const productId = document.getElementById('product-doc-id')?.value;
            const selectedImages = await readImageFiles(document.getElementById('product-image-files'));
            const existingProduct = productId ? productCache.get(productId) : null;
            const imageUrls = selectedImages.length
                ? selectedImages
                : (Array.isArray(existingProduct?.imageUrls) && existingProduct.imageUrls.length ? existingProduct.imageUrls : (existingProduct?.imageUrl ? [existingProduct.imageUrl] : []));
            const status = submitBtn?.dataset?.productStatus === 'Draft' ? 'Draft' : 'Active';
            const payload = {
                name: document.getElementById('product-name')?.value?.trim() || 'Untitled Product',
                description: document.getElementById('product-desc')?.value?.trim() || '',
                variations: parseVariations(document.getElementById('product-variations')?.value),
                category: document.getElementById('product-category')?.value?.trim() || '',
                price: Number(document.getElementById('product-price')?.value || 0),
                imageUrl: imageUrls[0] || '',
                imageUrls,
                status,
                updatedAt: serverTimestamp()
            };

            try {
                requireSignedInAdmin();
                if (submitBtn) submitBtn.disabled = true;

                if (productId) {
                    await updateDoc(doc(db, 'products', productId), payload);
                } else {
                    await addDoc(collection(db, 'products'), {
                        ...payload,
                        createdAt: serverTimestamp()
                    });
                }

                resetProductForm();
                closeProductModal();
            } catch (err) {
                alert('Could not save product: ' + (err.message || err));
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (loginError) {
                loginError.classList.add('hidden');
                loginError.innerText = '';
            }

            const email = document.getElementById('login-email')?.value || '';
            const password = document.getElementById('login-password')?.value || '';

            try {
                if (!auth) throw new Error('Authentication is not initialized.');
                hideLoginOverlay();
                showGuardOverlay('Checking admin access...');
                const credential = await signInWithEmailAndPassword(auth, email, password);
                const isAdminUser = await verifyAdminUser(credential.user);
                if (!isAdminUser) {
                    await signOut(auth);
                    alert('This account is not registered as an admin.');
                    window.location.replace('./index.html');
                    return;
                }
                sessionStorage.setItem('minilikhaAdminVerified', credential.user.uid);
                loginForm.reset();
            } catch (err) {
                hideGuardOverlay();
                showLoginOverlay();
                if (loginError) {
                    loginError.innerText = err.message || 'Invalid administrative credentials.';
                    loginError.classList.remove('hidden');
                }
            }
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (!auth) return;
            try {
                sessionStorage.removeItem('minilikhaAdminVerified');
                await signOut(auth);
                window.location.replace('./index.html');
            } catch (err) {
                alert(err.message || 'Could not sign out.');
            }
        });
    }

    if (auth) {
        onAuthStateChanged(auth, async (user) => {
            hideAdminShell();
            hideLoginOverlay();
            showGuardOverlay('Checking admin access...');
            if (user) {
                const isAdminUser = await verifyAdminUser(user);
                if (!isAdminUser) {
                    sessionStorage.removeItem('minilikhaAdminVerified');
                    await signOut(auth);
                    window.location.replace('./index.html');
                    return;
                }
                sessionStorage.setItem('minilikhaAdminVerified', user.uid);
                hideGuardOverlay();
                hideLoginOverlay();
                showAdminShell();
                if (logoutBtn) logoutBtn.classList.remove('hidden');
                if (adminUserEmail) adminUserEmail.innerText = user.email || 'Administrator Access';
                startAdminListeners();
                return;
            }

            sessionStorage.removeItem('minilikhaAdminVerified');
            hideGuardOverlay();
            showLoginOverlay();
            if (logoutBtn) logoutBtn.classList.add('hidden');
            if (adminUserEmail) adminUserEmail.innerText = 'Sign in required';
            stopOrdersListener();
        });
    } else {
        hideGuardOverlay();
        hideAdminShell();
        showLoginOverlay();
        showMessageRow(ordersTbody, 7, 'Firebase Authentication is not initialized.');
    }

    setupReportControls();
});
