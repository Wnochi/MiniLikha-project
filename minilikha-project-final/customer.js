// Customer storefront module using Firestore for live crochet products and pre-orders.
import { collection, getDoc, onSnapshot, doc, query, runTransaction, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.13.0/firebase-auth.js";
import { db, auth } from "./firebase-config.js";

let localCartState = [];
let activeSelectedProduct = null;
let liveCatalogData = [];
let globalPreorderSlotsLeft = null;
let globalPreorderLoaded = false;
let activeCategoryFilter = 'All';
let currentCustomerUser = null;
let customerOrdersUnsubscribe = null;
let latestAdminCheckId = 0;
let catalogReturnScrollY = 0;

function formatCurrency(value) {
    return `PHP ${Number(value || 0).toFixed(2)}`;
}

function getSlotCount(product) {
    if (globalPreorderSlotsLeft !== null) return Number(globalPreorderSlotsLeft || 0);
    return Number(product?.slots ?? 999);
}

function getProductImages(product) {
    const images = [];
    if (product?.imageUrl) images.push(product.imageUrl);
    if (Array.isArray(product?.imageUrls)) {
        product.imageUrls.forEach(url => {
            if (url && !images.includes(url)) images.push(url);
        });
    }
    return images;
}

function getVariations(product) {
    if (Array.isArray(product?.variations)) {
        const values = product.variations.map(item => String(item).trim()).filter(Boolean);
        return values.length ? values : ['Default'];
    }

    if (typeof product?.variations === 'string') {
        const values = product.variations.split(',').map(item => item.trim()).filter(Boolean);
        return values.length ? values : ['Default'];
    }

    return ['Default'];
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            resolve('');
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const maxSize = 900;
                const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.78));
            };
            img.onerror = () => reject(new Error('Could not process selected photo.'));
            img.src = reader.result;
        };
        reader.onerror = () => reject(reader.error || new Error('Could not read selected photo.'));
        reader.readAsDataURL(file);
    });
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }[char]));
}

function getOrderItems(order) {
    return Array.isArray(order.items) && order.items.length ? order.items : [{
        name: order.productName || 'Pre-order item',
        variation: order.variation || order.color || 'Default',
        qty: order.quantity || 1,
        price: order.totalPaid || order.total || 0
    }];
}

function getOrderDate(order) {
    const source = order.createdAt || order.timestamp || order.updatedAt || order.deliveredAt;
    if (source && typeof source.toDate === 'function') return source.toDate();

    const parsed = new Date(source || Date.now());
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatOrderDate(order) {
    return getOrderDate(order).toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function getStoredDeliveryProfile() {
    try {
        return JSON.parse(localStorage.getItem('minilikhaDeliveryInfo') || '{}');
    } catch (err) {
        console.warn('Could not read saved delivery info:', err);
        return {};
    }
}

function mergeProfileContacts(contacts = [], email = '', phone = '') {
    const cleaned = (Array.isArray(contacts) ? contacts : [])
        .map(contact => ({
            label: String(contact.label || '').trim(),
            value: String(contact.value || '').trim()
        }))
        .filter(contact => contact.label || contact.value);

    if (email) {
        const emailIndex = cleaned.findIndex(contact => contact.label.toLowerCase() === 'email');
        if (emailIndex >= 0) cleaned[emailIndex] = { ...cleaned[emailIndex], label: 'Email', value: cleaned[emailIndex].value || email };
        else cleaned.unshift({ label: 'Email', value: email });
    }

    for (let index = cleaned.length - 1; index >= 0; index -= 1) {
        const isBlankDuplicateEmail = cleaned[index].label.toLowerCase() === 'email' && !cleaned[index].value;
        if (isBlankDuplicateEmail) cleaned.splice(index, 1);
    }

    const primaryIndex = cleaned.findIndex(contact => contact.label.toLowerCase() !== 'email');
    if (phone) {
        if (primaryIndex >= 0) cleaned[primaryIndex] = { ...cleaned[primaryIndex], value: phone };
        else cleaned.push({ label: 'Mobile', value: phone });
    } else if (primaryIndex >= 0) {
        cleaned.splice(primaryIndex, 1);
    }

    return cleaned;
}

function buildCustomerProfilePayload(user, profile = {}, options = {}) {
    const email = user?.email || profile.customerEmail || profile.email || '';
    const name = profile.name || profile.recipientName || '';
    const address = profile.address || profile.deliveryAddress || '';
    const phone = profile.phone || profile.contactInfo || '';
    const contacts = mergeProfileContacts(profile.contacts, email, phone);
    const contactInfo = phone || contacts.find(contact => contact.label.toLowerCase() !== 'email')?.value || email;
    const payload = {
        accountUid: user.uid,
        customerUid: user.uid,
        uid: user.uid,
        customerEmail: email,
        email,
        recipientName: name,
        name,
        deliveryAddress: address,
        address,
        phone,
        contactInfo,
        contacts,
        updatedAt: serverTimestamp()
    };

    if (Object.prototype.hasOwnProperty.call(profile, 'photoUrl')) payload.photoUrl = profile.photoUrl || '';
    if (options.includeCreatedAt) payload.createdAt = serverTimestamp();

    return payload;
}

async function saveCustomerProfileDocuments(user, profile = {}, options = {}) {
    if (!db || !user) throw new Error('Please sign in before saving your account.');

    const payload = buildCustomerProfilePayload(user, profile, options);
    await Promise.all([
        setDoc(doc(db, 'customers', user.uid), payload, { merge: true }),
        setDoc(doc(db, 'accounts', user.uid), payload, { merge: true })
    ]);
    return payload;
}

function resetRegistrationForm() {
    const registrationForm = document.getElementById('customer-registration-form');
    const registrationContactList = document.getElementById('registration-contact-list');
    if (registrationForm) registrationForm.reset();
    if (registrationContactList) registrationContactList.innerHTML = createRegistrationContactRow({ label: 'Email', value: '' });
}

function setCustomerOrdersMessage(message) {
    const list = document.getElementById('customer-orders-list');
    if (!list) return;

    const normalized = String(message || '').toLowerCase();
    const isLoading = normalized.includes('loading');
    const isError = normalized.includes('could not') || normalized.includes('check');
    const icon = isLoading ? 'fa-spinner' : (isError ? 'fa-circle-exclamation' : (normalized.includes('sign in') ? 'fa-right-to-bracket' : 'fa-box-open'));
    const title = isLoading ? 'Loading your orders...' : message;
    const body = isLoading
        ? 'Checking your latest pre-order updates.'
        : (isError
            ? 'Please try again later or contact MiniLikha if the issue continues.'
            : (normalized.includes('sign in')
                ? 'Your order history and delivery updates will appear here after login.'
                : 'Once you place a pre-order, its progress will show up in this tracker.'));

    list.innerHTML = `
        <div class="orders-empty-state ${isError ? 'is-error' : ''} ${isLoading ? 'is-loading' : ''}">
            <span><i class="fa-solid ${icon}" aria-hidden="true"></i></span>
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(body)}</p>
        </div>
    `;
}

function getOrderTrackingMeta(order = {}) {
    const rawStatus = order.orderStatus || 'Pending';
    const status = String(rawStatus).toLowerCase();
    const isDelivered = Boolean(order.isDelivered || order.deliveredAt || status === 'completed');

    if (status === 'cancelled') {
        return {
            label: 'Cancelled',
            tone: 'cancelled',
            icon: 'fa-ban',
            currentStep: 0,
            note: 'This order is no longer active.'
        };
    }

    if (isDelivered) {
        return {
            label: 'Delivered',
            tone: 'delivered',
            icon: 'fa-circle-check',
            currentStep: 3,
            note: 'Your order has been marked as delivered.'
        };
    }

    if (status === 'done' || status === 'to deliver') {
        return {
            label: 'Ready for Delivery',
            tone: 'ready',
            icon: 'fa-truck-fast',
            currentStep: 2,
            note: 'Your handmade order is finished and ready for delivery.'
        };
    }

    if (status === 'making') {
        return {
            label: 'Being Made',
            tone: 'making',
            icon: 'fa-scissors',
            currentStep: 1,
            note: 'MiniLikha is currently crafting your order.'
        };
    }

    return {
        label: 'Order Received',
        tone: 'pending',
        icon: 'fa-clock',
        currentStep: 0,
        note: 'Your pre-order is confirmed and waiting to be made.'
    };
}

function renderOrderSteps(currentStep) {
    const steps = ['Received', 'Making', 'Ready', 'Delivered'];
    return `
        <ol class="order-progress" aria-label="Order progress">
            ${steps.map((step, index) => `
                <li class="${index <= currentStep ? 'is-complete' : ''} ${index === currentStep ? 'is-current' : ''}">
                    <span>${index + 1}</span>
                    <strong>${escapeHtml(step)}</strong>
                </li>
            `).join('')}
        </ol>
    `;
}

function renderCustomerOrders(orders = []) {
    const list = document.getElementById('customer-orders-list');
    if (!list) return;

    if (!currentCustomerUser) {
        setCustomerOrdersMessage('Sign in to track your orders.');
        return;
    }

    if (orders.length === 0) {
        setCustomerOrdersMessage('No orders yet.');
        return;
    }

    const totalOrders = orders.length;
    const activeOrders = orders.filter(order => {
        const status = String(order.orderStatus || 'Pending').toLowerCase();
        return status !== 'completed' && status !== 'cancelled' && !order.isDelivered && !order.deliveredAt;
    }).length;

    const orderCards = orders.map(order => {
        const items = getOrderItems(order);
        const itemRows = items.map(item => {
            const qty = Number(item.qty || item.quantity || 1);
            const variation = item.variation || item.color || 'Default';
            const itemTotal = Number(item.lineTotal || 0) || (Number(item.price || 0) * qty);

            return `
                <div class="order-item-row">
                    <div class="order-item-preview">
                        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name || 'Pre-order item')}">` : '<i class="fa-solid fa-gift" aria-hidden="true"></i>'}
                    </div>
                    <div>
                        <strong>${escapeHtml(item.name || 'Pre-order item')}</strong>
                        <span>${escapeHtml(variation && variation !== 'Default' ? `${variation} - Qty ${qty}` : `Qty ${qty}`)}</span>
                    </div>
                    <em>${formatCurrency(itemTotal || item.price || 0)}</em>
                </div>
            `;
        }).join('');
        const meta = getOrderTrackingMeta(order);
        const trackingCode = order.trackingCode || order.orderNumber || order.id || 'Pending';
        const orderTotal = order.totalPaid || order.total || items.reduce((sum, item) => {
            const qty = Number(item.qty || item.quantity || 1);
            return sum + (Number(item.price || 0) * qty);
        }, 0);

        return `
            <article class="order-card">
                <div class="order-card-top">
                    <div>
                        <span class="order-code">Tracking #${escapeHtml(trackingCode)}</span>
                        <h4>${escapeHtml(meta.label)}</h4>
                        <p>${escapeHtml(meta.note)}</p>
                    </div>
                    <span class="order-status-badge is-${escapeHtml(meta.tone)}">
                        <i class="fa-solid ${escapeHtml(meta.icon)}" aria-hidden="true"></i>
                        ${escapeHtml(meta.label)}
                    </span>
                </div>

                ${renderOrderSteps(meta.currentStep)}

                <div class="order-card-details">
                    <div class="order-items-list">
                        ${itemRows}
                    </div>

                    <div class="order-summary-mini">
                        <div>
                            <span>Placed</span>
                            <strong>${escapeHtml(formatOrderDate(order))}</strong>
                        </div>
                        <div>
                            <span>Delivery Address</span>
                            <strong>${escapeHtml(order.customerAddress || 'Delivery address saved')}</strong>
                        </div>
                        <div>
                            <span>Total</span>
                            <strong>${formatCurrency(orderTotal)}</strong>
                        </div>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    list.innerHTML = `
        <div class="orders-overview">
            <div>
                <span>Total orders</span>
                <strong>${escapeHtml(totalOrders)}</strong>
            </div>
            <div>
                <span>Active tracking</span>
                <strong>${escapeHtml(activeOrders)}</strong>
            </div>
            <div>
                <span>Latest update</span>
                <strong>${escapeHtml(formatOrderDate(orders[0]))}</strong>
            </div>
        </div>
        <div class="orders-stack">
            ${orderCards}
        </div>
    `;
}

function stopCustomerOrdersListener(message = 'Sign in to track your orders.') {
    if (customerOrdersUnsubscribe) {
        customerOrdersUnsubscribe();
        customerOrdersUnsubscribe = null;
    }
    renderCustomerOrders([]);
    if (!currentCustomerUser) setCustomerOrdersMessage(message);
}

function startCustomerOrdersListener(user) {
    stopCustomerOrdersListener('Loading orders...');
    if (!db || !user) return;

    setCustomerOrdersMessage('Loading orders...');
    const ordersQuery = query(collection(db, 'orders'), where('customerUid', '==', user.uid));
    customerOrdersUnsubscribe = onSnapshot(ordersQuery, (snapshot) => {
        const orders = [];
        snapshot.forEach(docSnap => orders.push({ id: docSnap.id, ...docSnap.data() }));
        orders.sort((a, b) => getOrderDate(b).getTime() - getOrderDate(a).getTime());
        renderCustomerOrders(orders);
    }, (err) => {
        console.error('Could not load customer orders:', err);
        setCustomerOrdersMessage('Could not load orders. Please check your account permissions.');
    });
}

function positionCustomerFlyout(targetViewKey) {
    if (targetViewKey !== 'account' && targetViewKey !== 'cart') return;

    const trigger = document.getElementById(targetViewKey === 'account' ? 'customer-account-trigger' : 'customer-cart-trigger');
    const root = document.documentElement;
    if (!trigger || !root) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const top = Math.max(72, Math.round(rect.bottom + 12));
    const right = Math.max(12, Math.round(viewportWidth - rect.right));

    root.style.setProperty('--customer-flyout-top', `${top}px`);
    root.style.setProperty('--customer-flyout-right', `${right}px`);
}

window.showCustomerView = function(targetViewKey, options = {}) {
    const customerViews = {
        catalog: document.getElementById('cust-view-catalog'),
        select: document.getElementById('cust-view-select'),
        cart: document.getElementById('cust-view-cart'),
        checkout: document.getElementById('cust-view-checkout'),
        register: document.getElementById('cust-view-register'),
        account: document.getElementById('cust-view-account')
    };

    Object.keys(customerViews).forEach(key => {
        const el = customerViews[key];
        if (!el) return;
        if (key === targetViewKey) el.classList.remove('hidden');
        else el.classList.add('hidden');
    });

    const isFlyout = targetViewKey === 'account' || targetViewKey === 'cart';
    const backdrop = document.getElementById('customer-flyout-backdrop');
    document.body.classList.toggle('customer-flyout-open', isFlyout);
    if (backdrop) backdrop.classList.toggle('hidden', !isFlyout);

    if (isFlyout) {
        positionCustomerFlyout(targetViewKey);
        return;
    }

    window.requestAnimationFrame(() => {
        const shouldRestoreCatalogScroll = targetViewKey === 'catalog' && options.restoreScroll;
        const nextTop = shouldRestoreCatalogScroll ? catalogReturnScrollY : 0;
        window.scrollTo({ top: nextTop, behavior: 'smooth' });
    });
};

function renderCatalogCardsGrid(productsList) {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;

    const filteredProducts = activeCategoryFilter === 'All'
        ? productsList
        : productsList.filter(item => (item.category || 'Uncategorized') === activeCategoryFilter);

    if (!filteredProducts || filteredProducts.length === 0) {
        grid.innerHTML = `<div class="catalog-empty-state">No crochet products available at the moment.</div>`;
        return;
    }

    grid.innerHTML = filteredProducts.map((item, index) => {
        const soldOut = globalPreorderLoaded && getSlotCount(item) <= 0;
        const imageUrl = getProductImages(item)[0] || '';
        const category = item.category || 'Crochet';
        const description = item.description || 'A small-batch crochet creation crafted with care.';

        return `
            <button type="button" class="catalog-product-card" style="--card-index: ${index};" data-action="select" data-id="${escapeHtml(item.id)}">
                <div class="product-image-wrap">
                    <span class="product-badge">${escapeHtml(category)}</span>
                    ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name || 'MiniLikha crochet product')}" class="product-image ${soldOut ? 'grayscale opacity-60' : ''}">` : `<div class="product-image-placeholder">Product Image</div>`}
                    ${soldOut ? '<span class="sold-out-badge">Closed</span>' : ''}
                </div>
                <div class="product-card-body">
                    <span class="product-card-kicker">Handmade piece</span>
                    <h3>${escapeHtml(item.name)}</h3>
                    <p class="product-card-description">${escapeHtml(description)}</p>
                    <div class="product-card-footer">
                        <span class="product-price">${formatCurrency(item.price)}</span>
                        <span class="card-action">View</span>
                    </div>
                </div>
            </button>
        `;
    }).join('');

    grid.querySelectorAll('[data-action="select"]').forEach(btn => {
        btn.addEventListener('click', onSelectClick);
    });
}

function renderFeaturedProducts(productsList) {
    const track = document.getElementById('featured-products-track');
    if (!track) return;

    const activeProducts = [...(productsList || [])].filter(item => {
        const status = item.status === 'Published' ? 'Active' : (item.status || 'Active');
        return status === 'Active';
    });

    if (activeProducts.length === 0) {
        track.innerHTML = `<div class="featured-empty-state">Featured products will appear once crochet items are published.</div>`;
        return;
    }

    const picks = [];
    const bestSeller = activeProducts[0];
    const newArrival = activeProducts.find(item => item.id !== bestSeller.id);
    if (bestSeller) picks.push({ label: 'Best seller', item: bestSeller });
    if (newArrival) picks.push({ label: 'New arrival', item: newArrival });

    track.innerHTML = picks.map(({ label, item }) => {
        const imageUrl = getProductImages(item)[0] || '';
        const category = item.category || 'Crochet';

        return `
            <button type="button" class="featured-product-card" data-action="select" data-id="${escapeHtml(item.id)}">
                <div class="featured-image">
                    ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name || 'MiniLikha featured product')}">` : '<span class="featured-image-placeholder">Product Image</span>'}
                </div>
                <div class="featured-copy">
                    <span class="featured-label">${escapeHtml(label)}</span>
                    <h3>${escapeHtml(item.name || 'MiniLikha crochet product')}</h3>
                    <div class="featured-meta">
                        <span>${escapeHtml(category)}</span>
                        <span aria-hidden="true">-</span>
                        <span class="featured-price">${formatCurrency(item.price)}</span>
                    </div>
                </div>
            </button>
        `;
    }).join('');

    track.querySelectorAll('[data-action="select"]').forEach(btn => {
        btn.addEventListener('click', onSelectClick);
    });
}

function renderCategoryFilter(productsList) {
    const filter = document.getElementById('category-filter');
    if (!filter) return;

    const categories = [...new Set(productsList.map(item => item.category || 'Uncategorized'))].sort();
    const currentValue = categories.includes(activeCategoryFilter) ? activeCategoryFilter : 'All';
    activeCategoryFilter = currentValue;
    filter.innerHTML = [
        '<option value="All">All Categories</option>',
        ...categories.map(category => `<option value="${escapeHtml(category)}" ${category === currentValue ? 'selected' : ''}>${escapeHtml(category)}</option>`)
    ].join('');
}

function showCartToast(message = 'Item added to basket.') {
    const toast = document.getElementById('cart-toast');
    if (!toast) return;
    toast.innerText = message;
    toast.classList.remove('hidden');
    window.clearTimeout(showCartToast.timer);
    showCartToast.timer = window.setTimeout(() => toast.classList.add('hidden'), 1800);
}

function onSelectClick(e) {
    catalogReturnScrollY = window.scrollY || window.pageYOffset || 0;
    window.selectProduct(e.currentTarget.dataset.id);
}

window.selectProduct = function(arg1, arg2, arg3, arg4) {
    if (arguments.length === 1) {
        const prod = liveCatalogData.find(p => p.id === arg1);
        if (!prod) return;

        activeSelectedProduct = prod;
        const slots = getSlotCount(prod);
        const imageEl = document.getElementById('detail-image');
        const imagePlaceholder = document.getElementById('detail-image-placeholder');
        const thumbnailsEl = document.getElementById('detail-thumbnails');
        const productImages = getProductImages(prod);

        document.getElementById('detail-title').innerText = prod.name || '';
        document.getElementById('detail-price').innerText = formatCurrency(prod.price);
        document.getElementById('detail-desc').innerText = prod.description || '';
        const quantityInput = document.getElementById('detail-quantity');
        const variationSelect = document.getElementById('detail-color');
        if (quantityInput) {
            quantityInput.value = '1';
            if (globalPreorderLoaded) quantityInput.max = String(Math.max(slots, 1));
            else quantityInput.removeAttribute('max');
        }
        if (variationSelect) {
            variationSelect.innerHTML = getVariations(prod)
                .map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
                .join('');
        }

        if (imageEl && imagePlaceholder) {
            if (productImages.length > 0) {
                imageEl.src = productImages[0];
                imageEl.alt = prod.name || 'MiniLikha crochet product';
                imageEl.classList.remove('hidden');
                imagePlaceholder.classList.add('hidden');
            } else {
                imageEl.classList.add('hidden');
                imagePlaceholder.classList.remove('hidden');
            }
        }
        if (thumbnailsEl) {
            thumbnailsEl.innerHTML = productImages.map((url, index) => `
                <button type="button" data-image-url="${escapeHtml(url)}" class="aspect-square rounded-lg overflow-hidden bg-[#EEF5F5]">
                    <img src="${escapeHtml(url)}" alt="${escapeHtml(prod.name || 'Product image')}" class="w-full h-full object-cover">
                </button>
            `).join('');

            thumbnailsEl.querySelectorAll('[data-image-url]').forEach(button => {
                button.addEventListener('click', () => {
                    if (imageEl) imageEl.src = button.dataset.imageUrl;
                    thumbnailsEl.querySelectorAll('button').forEach(item => {
                        item.classList.remove('ring-2', 'ring-[#FF8DA4]');
                    });
                    button.classList.add('ring-2', 'ring-[#FF8DA4]');
                });
            });
        }

        window.showCustomerView('select');
        return;
    }

    activeSelectedProduct = { title: arg1, price: arg2, description: arg3, slots: arg4 };
    document.getElementById('detail-title').innerText = arg1 || '';
    document.getElementById('detail-price').innerText = formatCurrency(arg2);
    document.getElementById('detail-desc').innerText = arg3 || '';
    const legacyQuantityInput = document.getElementById('detail-quantity');
    const legacyColorInput = document.getElementById('detail-color');
    if (legacyQuantityInput) legacyQuantityInput.value = '1';
    if (legacyColorInput) legacyColorInput.innerHTML = '<option value="Default">Default</option>';
    window.showCustomerView('select');
};

function addSelectedProductToBasket(goToCheckout = false) {
    if (!activeSelectedProduct) {
        alert('No product selected');
        return false;
    }

    const slots = getSlotCount(activeSelectedProduct);
    if (globalPreorderLoaded && slots <= 0) {
        alert('Pre-order slots are closed for this product.');
        return false;
    }

    const requestedQuantity = Math.max(1, Number.parseInt(document.getElementById('detail-quantity')?.value || '1', 10));
    const selectedVariation = document.getElementById('detail-color')?.value?.trim() || 'Default';
    const id = activeSelectedProduct.id || String(Date.now());
    const existing = localCartState.find(i => i.id === id && i.variation === selectedVariation);

    if (existing) {
        if (!globalPreorderLoaded || (existing.quantity || 0) + requestedQuantity <= slots) existing.quantity += requestedQuantity;
        else {
            alert('No more pre-order slots left for this product.');
            return false;
        }
    } else {
        if (globalPreorderLoaded && requestedQuantity > slots) {
            alert(`Only ${slots} pre-order slot${slots === 1 ? '' : 's'} left for this product.`);
            return false;
        }

        localCartState.push({
            id,
            name: activeSelectedProduct.name || activeSelectedProduct.title,
            price: Number(activeSelectedProduct.price || 0),
            quantity: requestedQuantity,
            variation: selectedVariation,
            imageUrl: getProductImages(activeSelectedProduct)[0] || ''
        });
    }

    updateCartUI();
    if (goToCheckout && window.goToCheckoutFromCart) window.goToCheckoutFromCart();
    else showCartToast('Item added to basket.');
    return true;
}

window.addToCartTrigger = function() {
    addSelectedProductToBasket(false);
};

window.preOrderNowTrigger = function() {
    addSelectedProductToBasket(true);
};

window.goToCheckoutFromCart = function() {
    if (localCartState.length === 0) {
        alert('Your basket is empty.');
        return;
    }

    if (!currentCustomerUser) {
        alert('Please login or register before checkout.');
        window.showCustomerView('account');
        return;
    }

    window.showCustomerView('checkout');
};

function getCartTotalCount() {
    return localCartState.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function findCartItem(id, variation = 'Default') {
    return localCartState.find(item => item.id === id && item.variation === variation);
}

function canIncreaseCartQuantity() {
    if (!globalPreorderLoaded) return true;
    const slotsLeft = Number(globalPreorderSlotsLeft ?? 0);
    if (getCartTotalCount() + 1 <= slotsLeft) return true;
    alert(`Only ${slotsLeft} shop pre-order slot${slotsLeft === 1 ? '' : 's'} left.`);
    return false;
}

function updateCartUI() {
    const badge = document.getElementById('cart-badge');
    const cartRow = document.getElementById('cart-item-row');
    const subtotalEl = document.getElementById('summary-subtotal');
    const totalEl = document.getElementById('summary-total');
    const checkoutName = document.getElementById('checkout-summary-item-name');
    const checkoutPrice = document.getElementById('checkout-summary-item-price');
    const checkoutQty = document.getElementById('checkout-summary-item-qty');

    const totalCount = localCartState.reduce((sum, item) => sum + item.quantity, 0);
    const grandTotal = localCartState.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    if (badge) badge.innerText = totalCount;

    if (cartRow) {
        if (localCartState.length === 0) {
            cartRow.innerHTML = `<div class="p-6 text-center text-black">Your basket is empty.</div>`;
        } else {
            cartRow.innerHTML = localCartState.map(item => `
                <div class="p-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white text-black">
                    <div class="flex items-center gap-4">
                        <div class="w-16 h-16 bg-[#EEF5F5] rounded overflow-hidden flex items-center justify-center text-[10px] text-black font-bold">
                            ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" class="w-full h-full object-cover">` : 'Preview'}
                        </div>
                        <div class="min-w-0">
                            <h4 class="font-bold text-black text-sm">${escapeHtml(item.name)}</h4>
                            <p class="text-xs text-black mt-0.5">Variation: ${escapeHtml(item.variation)}</p>
                            <div class="mt-2 inline-flex items-center border border-[#F0CAD5] rounded-lg overflow-hidden bg-white">
                                <button type="button" aria-label="Decrease quantity" class="w-8 h-8 text-sm font-black hover:bg-[#FED8E3]" data-action="decrease" data-id="${escapeHtml(item.id)}" data-variation="${escapeHtml(item.variation)}">-</button>
                                <span class="w-9 text-center text-xs font-bold border-x border-[#F0CAD5]">${escapeHtml(item.quantity)}</span>
                                <button type="button" aria-label="Increase quantity" class="w-8 h-8 text-sm font-black hover:bg-[#FED8E3]" data-action="increase" data-id="${escapeHtml(item.id)}" data-variation="${escapeHtml(item.variation)}">+</button>
                            </div>
                        </div>
                    </div>
                    <div class="text-left sm:text-right">
                        <span class="font-bold text-black text-sm">${formatCurrency(item.price * item.quantity)}</span>
                        <div class="mt-2"><button class="text-xs font-bold text-black bg-[#FF8DA4] hover:bg-[#FED8E3] rounded px-2 py-1" data-action="remove" data-id="${escapeHtml(item.id)}" data-variation="${escapeHtml(item.variation)}">Remove</button></div>
                    </div>
                </div>
            `).join('');

            cartRow.querySelectorAll('[data-action="remove"]').forEach(btn => {
                btn.addEventListener('click', onRemoveCartItem);
            });
            cartRow.querySelectorAll('[data-action="increase"], [data-action="decrease"]').forEach(btn => {
                btn.addEventListener('click', onAdjustCartItemQuantity);
            });
        }
    }

    if (subtotalEl) subtotalEl.innerText = formatCurrency(grandTotal);
    if (totalEl) totalEl.innerText = formatCurrency(grandTotal);
    if (checkoutName) checkoutName.innerText = localCartState.length > 1 ? `${localCartState.length} items` : (localCartState[0]?.name || 'No item selected');
    if (checkoutPrice) checkoutPrice.innerText = formatCurrency(grandTotal);
    if (checkoutQty) checkoutQty.innerText = String(totalCount);
}

function createRegistrationContactRow(contact = {}) {
    return `
        <div class="registration-contact-row grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
            <input type="text" data-registration-contact-field="label" value="${escapeHtml(contact.label || '')}" placeholder="Facebook" class="bg-[#FED8E3] border border-[#FED8E3] rounded-lg px-3 py-2 text-sm text-black focus:outline-none focus:border-black">
            <input type="text" data-registration-contact-field="value" value="${escapeHtml(contact.value || '')}" placeholder="Contact detail" class="bg-white border border-[#FF8DA4] rounded-lg px-3 py-2 text-sm text-black focus:outline-none focus:border-black">
            <button type="button" data-action="remove-registration-contact" class="bg-[#FF8DA4] border border-[#FF8DA4] rounded-lg px-3 py-2 text-xs font-bold text-black hover:bg-[#FED8E3] transition">Remove</button>
        </div>
    `;
}

function collectRegistrationContacts() {
    const contactList = document.getElementById('registration-contact-list');
    if (!contactList) return [];

    return [...contactList.querySelectorAll('.registration-contact-row')].map(row => ({
        label: row.querySelector('[data-registration-contact-field="label"]')?.value?.trim() || '',
        value: row.querySelector('[data-registration-contact-field="value"]')?.value?.trim() || ''
    })).filter(contact => contact.label || contact.value);
}

function onRemoveCartItem(e) {
    const id = e.currentTarget.dataset.id;
    const variation = e.currentTarget.dataset.variation || 'Default';
    localCartState = localCartState.filter(i => !(i.id === id && i.variation === variation));
    updateCartUI();
}

function onAdjustCartItemQuantity(e) {
    const action = e.currentTarget.dataset.action;
    const item = findCartItem(e.currentTarget.dataset.id, e.currentTarget.dataset.variation || 'Default');
    if (!item) return;

    if (action === 'increase') {
        if (!canIncreaseCartQuantity()) return;
        item.quantity += 1;
    }

    if (action === 'decrease') {
        item.quantity -= 1;
        if (item.quantity <= 0) {
            localCartState = localCartState.filter(cartItem => !(cartItem.id === item.id && cartItem.variation === item.variation));
        }
    }

    updateCartUI();
}

document.addEventListener('DOMContentLoaded', () => {
    updateCartUI();

    const customerFlyoutBackdrop = document.getElementById('customer-flyout-backdrop');
    if (customerFlyoutBackdrop) {
        customerFlyoutBackdrop.addEventListener('click', () => window.showCustomerView('catalog'));
    }

    window.addEventListener('resize', () => {
        if (!document.getElementById('cust-view-account')?.classList.contains('hidden')) positionCustomerFlyout('account');
        if (!document.getElementById('cust-view-cart')?.classList.contains('hidden')) positionCustomerFlyout('cart');
    });

    function loadSavedDeliveryInfo() {
        const profile = getStoredDeliveryProfile();
        if (document.getElementById('checkout-name')) document.getElementById('checkout-name').value = profile.name || '';
        if (document.getElementById('checkout-phone')) document.getElementById('checkout-phone').value = profile.phone || profile.contactInfo || '';
        if (document.getElementById('checkout-address')) document.getElementById('checkout-address').value = profile.address || '';
        if (document.getElementById('account-name')) document.getElementById('account-name').value = profile.name || '';
        if (document.getElementById('account-phone')) document.getElementById('account-phone').value = profile.phone || profile.contactInfo || '';
        if (document.getElementById('account-address')) document.getElementById('account-address').value = profile.address || '';
    }

    async function loadFirebaseCustomerProfile(user) {
        if (!db || !user) return;
        try {
            const accountSnap = await getDoc(doc(db, 'accounts', user.uid));
            const customerSnap = await getDoc(doc(db, 'customers', user.uid));
            if (!accountSnap.exists() && !customerSnap.exists()) return;

            const data = {
                ...(customerSnap.exists() ? customerSnap.data() : {}),
                ...(accountSnap.exists() ? accountSnap.data() : {})
            };
            const emailContact = Array.isArray(data.contacts)
                ? data.contacts.find(contact => String(contact.label || '').toLowerCase() === 'email')
                : null;
            const primaryContact = Array.isArray(data.contacts)
                ? data.contacts.find(contact => String(contact.label || '').toLowerCase() !== 'email')
                : null;
            const profile = {
                name: data.recipientName || data.name || '',
                address: data.deliveryAddress || data.address || '',
                phone: data.phone || primaryContact?.value || emailContact?.value || '',
                contactInfo: primaryContact?.value || emailContact?.value || '',
                contacts: Array.isArray(data.contacts) ? data.contacts : [],
                photoUrl: data.photoUrl || ''
            };
            localStorage.setItem('minilikhaDeliveryInfo', JSON.stringify(profile));
            if (!accountSnap.exists() && customerSnap.exists()) {
                await saveCustomerProfileDocuments(user, profile);
            }
            loadSavedDeliveryInfo();
        } catch (err) {
            console.warn('Could not load customer profile:', err);
        }
    }

    const originalShowCustomerView = window.showCustomerView;
    window.showCustomerView = function(targetViewKey, options = {}) {
        if (targetViewKey === 'checkout' && !currentCustomerUser) {
            alert('Please login or register before checkout.');
            originalShowCustomerView('account');
            return;
        }

        originalShowCustomerView(targetViewKey, options);
        if (targetViewKey === 'checkout') loadSavedDeliveryInfo();
        if (targetViewKey === 'account') loadSavedDeliveryInfo();
    };

    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) {
        categoryFilter.addEventListener('change', () => {
            activeCategoryFilter = categoryFilter.value || 'All';
            renderCatalogCardsGrid(liveCatalogData);
            window.showCustomerView('catalog');
        });
    }

    const saveAccountBtn = document.getElementById('save-account-profile-btn');
    if (saveAccountBtn) {
        saveAccountBtn.addEventListener('click', async () => {
            if (!currentCustomerUser) {
                alert('Please login or register before saving your account.');
                window.showCustomerView('account');
                return;
            }

            const existingProfile = getStoredDeliveryProfile();
            const profile = {
                ...existingProfile,
                name: document.getElementById('account-name')?.value?.trim() || '',
                phone: document.getElementById('account-phone')?.value?.trim() || '',
                address: document.getElementById('account-address')?.value?.trim() || ''
            };

            try {
                saveAccountBtn.disabled = true;
                const savedProfile = await saveCustomerProfileDocuments(currentCustomerUser, profile);
                localStorage.setItem('minilikhaDeliveryInfo', JSON.stringify({
                    name: savedProfile.name,
                    address: savedProfile.address,
                    phone: savedProfile.phone,
                    contactInfo: savedProfile.contactInfo,
                    contacts: savedProfile.contacts,
                    photoUrl: profile.photoUrl || ''
                }));
                loadSavedDeliveryInfo();
                alert('Account delivery profile saved.');
            } catch (err) {
                alert(err.message || 'Could not save account profile.');
            } finally {
                saveAccountBtn.disabled = false;
            }
        });
    }

    const openRegistrationPanelBtn = document.getElementById('open-registration-panel-btn');
    const registrationBackBtn = document.getElementById('registration-back-btn');
    const registrationForm = document.getElementById('customer-registration-form');
    const registrationContactList = document.getElementById('registration-contact-list');
    const addRegistrationContactBtn = document.getElementById('add-registration-contact-btn');

    if (registrationContactList && !registrationContactList.children.length) {
        resetRegistrationForm();
    }

    if (openRegistrationPanelBtn) {
        openRegistrationPanelBtn.addEventListener('click', () => {
            resetRegistrationForm();
            window.showCustomerView('register');
        });
    }

    if (registrationBackBtn) {
        registrationBackBtn.addEventListener('click', () => {
            resetRegistrationForm();
            window.showCustomerView('account');
        });
    }

    if (addRegistrationContactBtn && registrationContactList) {
        addRegistrationContactBtn.addEventListener('click', () => {
            registrationContactList.insertAdjacentHTML('beforeend', createRegistrationContactRow());
        });
    }

    if (registrationContactList) {
        registrationContactList.addEventListener('click', (event) => {
            const target = event.target.closest('button[data-action="remove-registration-contact"]');
            if (!target) return;
            const rows = registrationContactList.querySelectorAll('.registration-contact-row');
            if (rows.length <= 1) return;
            target.closest('.registration-contact-row')?.remove();
        });
    }

    if (registrationForm) {
        registrationForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const submitBtn = event.submitter;
            const email = document.getElementById('register-email')?.value?.trim() || '';
            const password = document.getElementById('register-password')?.value || '';
            const recipientName = document.getElementById('register-recipient-name')?.value?.trim() || '';
            const deliveryAddress = document.getElementById('register-address')?.value?.trim() || '';
            const photoFile = document.getElementById('register-photo-file')?.files?.[0] || null;
            const contacts = collectRegistrationContacts();
            const hasEmailContact = contacts.some(contact => String(contact.label || '').toLowerCase() === 'email' && contact.value);
            if (!hasEmailContact) contacts.unshift({ label: 'Email', value: email });

            try {
                if (!auth || !db) throw new Error('Firebase is not ready yet.');
                if (submitBtn) submitBtn.disabled = true;
                const credential = await createUserWithEmailAndPassword(auth, email, password);
                const photoUrl = await readFileAsDataUrl(photoFile);
                const primaryContact = contacts.find(contact => String(contact.label || '').toLowerCase() !== 'email') || contacts[0] || {};
                const profile = {
                    customerEmail: credential.user.email || email,
                    recipientName,
                    name: recipientName,
                    deliveryAddress,
                    address: deliveryAddress,
                    contactInfo: primaryContact.value || email,
                    phone: primaryContact.value || '',
                    contacts,
                    photoUrl,
                    updatedAt: serverTimestamp()
                };

                const savedProfile = await saveCustomerProfileDocuments(credential.user, profile, { includeCreatedAt: true });
                localStorage.setItem('minilikhaDeliveryInfo', JSON.stringify({
                    name: recipientName,
                    address: deliveryAddress,
                    phone: savedProfile.phone || savedProfile.contactInfo,
                    contactInfo: savedProfile.contactInfo,
                    contacts: savedProfile.contacts,
                    photoUrl
                }));
                resetRegistrationForm();
                loadSavedDeliveryInfo();
                window.showCustomerView('account');
                alert('Account created and delivery profile saved.');
            } catch (err) {
                alert(err.message || 'Could not create account.');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    const customerAuthForm = document.getElementById('customer-auth-form');
    const customerLogoutBtn = document.getElementById('customer-logout-btn');
    const customerAuthStatus = document.getElementById('customer-auth-status');
    const customerAdminPanelBtn = document.getElementById('customer-admin-panel-btn');

    async function isCurrentUserAdmin(user) {
        if (!db || !user) return false;
        try {
            const adminSnap = await getDoc(doc(db, 'admins', user.uid));
            return adminSnap.exists();
        } catch (err) {
            console.error('Could not verify admin account:', err);
            return false;
        }
    }

    if (customerAuthForm) {
        customerAuthForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const email = document.getElementById('customer-auth-email')?.value?.trim() || '';
            const password = document.getElementById('customer-auth-password')?.value || '';

            try {
                await signInWithEmailAndPassword(auth, email, password);
                customerAuthForm.reset();
            } catch (err) {
                alert(err.message || 'Could not sign in.');
            }
        });
    }

    if (customerLogoutBtn) {
        customerLogoutBtn.addEventListener('click', () => {
            sessionStorage.removeItem('minilikhaAdminVerified');
            if (customerAdminPanelBtn) customerAdminPanelBtn.style.display = 'none';
            signOut(auth).catch(err => alert(err.message || 'Could not log out.'));
        });
    }

    if (auth) {
        onAuthStateChanged(auth, async (user) => {
            const checkId = ++latestAdminCheckId;
            currentCustomerUser = user;
            if (customerAdminPanelBtn) customerAdminPanelBtn.style.display = 'none';
            if (customerAuthStatus) {
                customerAuthStatus.innerText = user ? `Signed in as ${user.email || 'customer'}` : 'Sign in or create an account before checkout.';
            }
            if (customerAuthForm) customerAuthForm.classList.toggle('hidden', Boolean(user));
            if (customerLogoutBtn) customerLogoutBtn.classList.toggle('hidden', !user);

            if (!user) {
                sessionStorage.removeItem('minilikhaAdminVerified');
                localStorage.removeItem('minilikhaDeliveryInfo');
                loadSavedDeliveryInfo();
                stopCustomerOrdersListener();
                return;
            }

            await loadFirebaseCustomerProfile(user);
            startCustomerOrdersListener(user);
            if (customerAuthStatus) customerAuthStatus.innerText = `Signed in as ${user.email || 'customer'} - checking access`;
            const isAdminUser = await isCurrentUserAdmin(user);
            if (checkId !== latestAdminCheckId) return;

            if (isAdminUser) {
                sessionStorage.setItem('minilikhaAdminVerified', user.uid);
                if (customerAdminPanelBtn) customerAdminPanelBtn.style.display = 'inline-flex';
                if (customerAuthStatus) customerAuthStatus.innerText = `Signed in as ${user.email || 'admin'}`;
            } else {
                sessionStorage.removeItem('minilikhaAdminVerified');
                if (customerAuthStatus) customerAuthStatus.innerText = `Signed in as ${user.email || 'customer'}`;
            }
        });
    }

    try {
        onSnapshot(doc(db, 'settings', 'businessProfile'), (snapshot) => {
            if (!snapshot.exists()) return;
            const profile = snapshot.data();
            const nameEls = [
                document.getElementById('business-profile-name'),
                document.getElementById('hero-business-name'),
                document.getElementById('nav-business-name')
            ].filter(Boolean);
            nameEls.forEach(el => { el.innerText = profile.businessName || 'MiniLikha'; });

            const descEls = [document.getElementById('business-profile-account-desc')].filter(Boolean);
            descEls.forEach(el => { el.innerText = profile.description || 'Reserve handmade crochet pieces through limited pre-order slots.'; });

            const imageEl = document.getElementById('business-profile-image');
            const placeholderEl = document.getElementById('business-profile-placeholder');
            if (imageEl && placeholderEl && profile.profileImageUrl) {
                imageEl.src = profile.profileImageUrl;
                imageEl.classList.remove('hidden');
                placeholderEl.classList.add('hidden');
            }

            const contactsEl = document.getElementById('business-profile-contacts');
            if (contactsEl) {
                const contacts = Array.isArray(profile.contacts) ? profile.contacts : [];
                contactsEl.innerHTML = contacts.length
                    ? contacts.map(contact => `<div><span class="font-bold text-zinc-900">${escapeHtml(contact.label || 'Contact')}:</span> ${escapeHtml(contact.value || '')}</div>`).join('')
                    : '<div class="text-zinc-400">No contacts posted yet.</div>';
            }
        });
    } catch (err) {
        console.error('Failed to start business profile listener:', err);
    }

    try {
        onSnapshot(doc(db, 'settings', 'preorder'), (snapshot) => {
            const data = snapshot.exists() ? snapshot.data() : {};
            globalPreorderLoaded = snapshot.exists();
            globalPreorderSlotsLeft = snapshot.exists() ? Number(data.slotsLeft ?? data.totalSlots ?? 0) : null;
            const banner = document.getElementById('preorder-slots-banner');
            if (banner) banner.innerText = globalPreorderSlotsLeft === null ? 'Pre-Order Slots: Not set' : `Pre-Order Slots: ${globalPreorderSlotsLeft}`;
            renderFeaturedProducts(liveCatalogData);
            renderCatalogCardsGrid(liveCatalogData);
        }, (err) => {
            console.error('Failed to load pre-order settings:', err);
            globalPreorderLoaded = false;
            globalPreorderSlotsLeft = null;
            const banner = document.getElementById('preorder-slots-banner');
            if (banner) banner.innerText = 'Pre-Order Slots: Not set';
            renderFeaturedProducts(liveCatalogData);
            renderCatalogCardsGrid(liveCatalogData);
        });
    } catch (err) {
        console.error('Failed to start pre-order settings listener:', err);
    }

    try {
        onSnapshot(collection(db, 'products'), (snapshot) => {
            liveCatalogData = [];
            snapshot.forEach(d => {
                const item = { id: d.id, ...d.data() };
                const status = item.status === 'Published' ? 'Active' : (item.status || 'Active');
                if (status === 'Active') liveCatalogData.push(item);
            });
            liveCatalogData.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
            renderCategoryFilter(liveCatalogData);
            renderFeaturedProducts(liveCatalogData);
            renderCatalogCardsGrid(liveCatalogData);
        });
    } catch (err) {
        console.error('Failed to start product listener:', err);
    }

    const checkoutForm = document.getElementById('checkout-submission-form');
    if (!checkoutForm) return;

    checkoutForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (localCartState.length === 0) {
            alert('Your basket is empty.');
            return;
        }
        if (!currentCustomerUser) {
            alert('Please login or register before checkout.');
            window.showCustomerView('account');
            return;
        }

        const deliveryProfile = {
            ...getStoredDeliveryProfile(),
            name: document.getElementById('checkout-name')?.value?.trim() || 'Anonymous',
            phone: document.getElementById('checkout-phone')?.value?.trim() || '',
            address: document.getElementById('checkout-address')?.value?.trim() || ''
        };

        const orderPayload = {
            customerUid: currentCustomerUser.uid,
            customerEmail: currentCustomerUser.email || '',
            customerName: deliveryProfile.name,
            customerPhone: deliveryProfile.phone,
            customerAddress: deliveryProfile.address,
            paymentMethod: document.querySelector('input[name="payment-method"]:checked')?.value || 'Unknown',
            items: localCartState.map(i => ({
                id: i.id,
                name: i.name,
                qty: i.quantity,
                quantity: i.quantity,
                price: i.price,
                variation: i.variation,
                color: i.variation,
                imageUrl: i.imageUrl || '',
                lineTotal: Number(i.price || 0) * Number(i.quantity || 0)
            })),
            totalPaid: localCartState.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            timestamp: new Date().toISOString(),
            orderStatus: 'Pending',
            orderType: 'Pre-Order'
        };
        const confirmed = confirm(`Confirm delivery details?\n\nName: ${orderPayload.customerName}\nMobile: ${orderPayload.customerPhone}\nAddress: ${orderPayload.customerAddress}\n\nTotal: ${formatCurrency(orderPayload.totalPaid)}`);
        if (!confirmed) return;

        try {
            const savedProfile = await saveCustomerProfileDocuments(currentCustomerUser, deliveryProfile);
            localStorage.setItem('minilikhaDeliveryInfo', JSON.stringify({
                name: savedProfile.name,
                phone: savedProfile.phone,
                address: savedProfile.address,
                contactInfo: savedProfile.contactInfo,
                contacts: savedProfile.contacts,
                photoUrl: deliveryProfile.photoUrl || ''
            }));

            await runTransaction(db, async (transaction) => {
                const preorderRef = doc(db, 'settings', 'preorder');
                const productRefs = localCartState.map(item => ({ item, ref: doc(db, 'products', item.id) }));
                const orderRef = doc(collection(db, 'orders'));

                const preorderSnap = await transaction.get(preorderRef);
                const productSnaps = [];
                for (const entry of productRefs) {
                    productSnaps.push({ item: entry.item, snap: await transaction.get(entry.ref) });
                }

                if (!preorderSnap.exists()) {
                    throw new Error('Pre-order slots have not been opened yet.');
                }

                const slotsLeft = Number(preorderSnap.data().slotsLeft ?? preorderSnap.data().totalSlots ?? 0);
                const requestedTotal = localCartState.reduce((sum, item) => sum + item.quantity, 0);
                if (slotsLeft < requestedTotal) {
                    throw new Error(`Only ${slotsLeft} shop pre-order slot${slotsLeft === 1 ? '' : 's'} left.`);
                }

                for (const { item, snap } of productSnaps) {
                    if (!snap.exists()) throw new Error(`${item.name} is no longer available.`);

                    const productData = snap.data();
                    const productStatus = productData.status === 'Published' ? 'Active' : (productData.status || 'Active');
                    if (productStatus !== 'Active') {
                        throw new Error(`${item.name} is not currently available for pre-order.`);
                    }
                }

                transaction.update(preorderRef, { slotsLeft: slotsLeft - requestedTotal });
                transaction.set(orderRef, {
                    ...orderPayload,
                    orderId: orderRef.id,
                    orderNumber: orderRef.id,
                    trackingCode: orderRef.id.slice(-8).toUpperCase(),
                    deliveryProfile: {
                        name: orderPayload.customerName,
                        phone: orderPayload.customerPhone,
                        address: orderPayload.customerAddress
                    },
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            });

            alert('Pre-order successfully placed with MiniLikha. Thank you!');
            localCartState = [];
            updateCartUI();
            checkoutForm.reset();
            window.showCustomerView('catalog');
        } catch (err) {
            console.error('Checkout failed:', err);
            alert(err.message || 'Checkout failed.');
        }
    });
});
