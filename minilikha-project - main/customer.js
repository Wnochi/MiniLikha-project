// Customer storefront module using Firestore for live crochet products and pre-orders.
import { collection, getDoc, onSnapshot, doc, runTransaction, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
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
let latestAdminCheckId = 0;

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

window.showCustomerView = function(targetViewKey) {
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

    window.scrollTo({ top: 0, behavior: 'smooth' });
};

function renderCatalogCardsGrid(productsList) {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;

    const filteredProducts = activeCategoryFilter === 'All'
        ? productsList
        : productsList.filter(item => (item.category || 'Uncategorized') === activeCategoryFilter);

    if (!filteredProducts || filteredProducts.length === 0) {
        grid.innerHTML = `<div class="col-span-full text-center py-8 text-black">No crochet products available at the moment.</div>`;
        return;
    }

    grid.innerHTML = filteredProducts.map(item => {
        const soldOut = globalPreorderLoaded && getSlotCount(item) <= 0;
        const imageUrl = getProductImages(item)[0] || '';

        return `
            <button type="button" class="catalog-product-card group bg-white rounded-xl overflow-hidden shadow-sm transition cursor-pointer text-left" data-action="select" data-id="${escapeHtml(item.id)}">
                <div class="aspect-square bg-[#EEF5F5] relative overflow-hidden">
                    ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name || 'MiniLikha crochet product')}" class="absolute inset-0 w-full h-full object-cover ${soldOut ? 'grayscale opacity-60' : ''}">` : `<div class="absolute inset-0 flex items-center justify-center text-xs font-semibold text-black">Product Image</div>`}
                </div>
                <div class="p-4 space-y-1">
                    <h3 class="font-bold text-sm text-black transition">${escapeHtml(item.name)}</h3>
                    <div class="flex justify-between items-center pt-1">
                        <span class="font-black text-base text-black">${formatCurrency(item.price)}</span>
                        <span class="text-xs text-black font-medium">${escapeHtml(item.category || 'Crochet')}</span>
                    </div>
                </div>
            </button>
        `;
    }).join('');

    grid.querySelectorAll('[data-action="select"]').forEach(btn => {
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
    if (goToCheckout) window.showCustomerView('checkout');
    else showCartToast('Item added to basket.');
    return true;
}

window.addToCartTrigger = function() {
    addSelectedProductToBasket(false);
};

window.preOrderNowTrigger = function() {
    addSelectedProductToBasket(true);
};

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
                <div class="p-6 flex gap-4 items-center justify-between bg-white text-black">
                    <div class="flex items-center gap-4">
                        <div class="w-16 h-16 bg-[#EEF5F5] rounded overflow-hidden flex items-center justify-center text-[10px] text-black font-bold">
                            ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" class="w-full h-full object-cover">` : 'Preview'}
                        </div>
                        <div>
                            <h4 class="font-bold text-black text-sm">${escapeHtml(item.name)}</h4>
                            <p class="text-xs text-black mt-0.5">Quantity: ${item.quantity}</p>
                            <p class="text-xs text-black mt-0.5">Variation: ${escapeHtml(item.variation)}</p>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="font-bold text-black text-sm">${formatCurrency(item.price * item.quantity)}</span>
                        <div class="mt-2"><button class="text-xs font-bold text-black bg-[#FF8DA4] hover:bg-[#FED8E3] rounded px-2 py-1" data-action="remove" data-id="${escapeHtml(item.id)}">Remove</button></div>
                    </div>
                </div>
            `).join('');

            cartRow.querySelectorAll('[data-action="remove"]').forEach(btn => {
                btn.addEventListener('click', onRemoveCartItem);
            });
        }
    }

    if (subtotalEl) subtotalEl.innerText = formatCurrency(grandTotal);
    if (totalEl) totalEl.innerText = formatCurrency(grandTotal);
    if (checkoutName) checkoutName.innerText = localCartState[0]?.name || 'No item selected';
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
    localCartState = localCartState.filter(i => i.id !== e.currentTarget.dataset.id);
    updateCartUI();
}

document.addEventListener('DOMContentLoaded', () => {
    updateCartUI();

    function loadSavedDeliveryInfo() {
        try {
            const profile = JSON.parse(localStorage.getItem('minilikhaDeliveryInfo') || '{}');
            if (profile.name) document.getElementById('checkout-name').value = profile.name;
            if (profile.phone || profile.contactInfo) document.getElementById('checkout-phone').value = profile.phone || profile.contactInfo;
            if (profile.address) document.getElementById('checkout-address').value = profile.address;
            if (profile.name) document.getElementById('account-name').value = profile.name;
            if (profile.phone || profile.contactInfo) document.getElementById('account-phone').value = profile.phone || profile.contactInfo;
            if (profile.address) document.getElementById('account-address').value = profile.address;
        } catch (err) {
            console.warn('Could not load saved delivery info:', err);
        }
    }

    async function loadFirebaseCustomerProfile(user) {
        if (!db || !user) return;
        try {
            const customerSnap = await getDoc(doc(db, 'customers', user.uid));
            if (!customerSnap.exists()) return;

            const data = customerSnap.data();
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
            loadSavedDeliveryInfo();
        } catch (err) {
            console.warn('Could not load customer profile:', err);
        }
    }

    const originalShowCustomerView = window.showCustomerView;
    window.showCustomerView = function(targetViewKey) {
        originalShowCustomerView(targetViewKey);
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
        saveAccountBtn.addEventListener('click', () => {
            const profile = {
                name: document.getElementById('account-name')?.value?.trim() || '',
                phone: document.getElementById('account-phone')?.value?.trim() || '',
                address: document.getElementById('account-address')?.value?.trim() || ''
            };
            localStorage.setItem('minilikhaDeliveryInfo', JSON.stringify(profile));
            loadSavedDeliveryInfo();
            alert('Account delivery profile saved.');
        });
    }

    const openRegistrationPanelBtn = document.getElementById('open-registration-panel-btn');
    const registrationBackBtn = document.getElementById('registration-back-btn');
    const registrationForm = document.getElementById('customer-registration-form');
    const registrationContactList = document.getElementById('registration-contact-list');
    const addRegistrationContactBtn = document.getElementById('add-registration-contact-btn');

    if (registrationContactList && !registrationContactList.children.length) {
        registrationContactList.innerHTML = createRegistrationContactRow({ label: 'Email', value: '' });
    }

    if (openRegistrationPanelBtn) {
        openRegistrationPanelBtn.addEventListener('click', () => window.showCustomerView('register'));
    }

    if (registrationBackBtn) {
        registrationBackBtn.addEventListener('click', () => window.showCustomerView('account'));
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
                    customerUid: credential.user.uid,
                    customerEmail: credential.user.email || email,
                    recipientName,
                    name: recipientName,
                    deliveryAddress,
                    address: deliveryAddress,
                    contactInfo: primaryContact.value || email,
                    phone: primaryContact.value || '',
                    contacts,
                    photoUrl,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                };

                await setDoc(doc(db, 'customers', credential.user.uid), profile, { merge: true });
                localStorage.setItem('minilikhaDeliveryInfo', JSON.stringify({
                    name: recipientName,
                    address: deliveryAddress,
                    phone: profile.phone || profile.contactInfo,
                    contactInfo: profile.contactInfo,
                    contacts,
                    photoUrl
                }));
                registrationForm.reset();
                if (registrationContactList) registrationContactList.innerHTML = createRegistrationContactRow({ label: 'Email', value: '' });
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
                return;
            }

            await loadFirebaseCustomerProfile(user);
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

            const descEls = [document.getElementById('business-profile-desc'), document.getElementById('business-profile-account-desc')].filter(Boolean);
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
            renderCatalogCardsGrid(liveCatalogData);
        }, (err) => {
            console.error('Failed to load pre-order settings:', err);
            globalPreorderLoaded = false;
            globalPreorderSlotsLeft = null;
            const banner = document.getElementById('preorder-slots-banner');
            if (banner) banner.innerText = 'Pre-Order Slots: Not set';
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

        const orderPayload = {
            customerUid: currentCustomerUser.uid,
            customerEmail: currentCustomerUser.email || '',
            customerName: document.getElementById('checkout-name')?.value?.trim() || 'Anonymous',
            customerPhone: document.getElementById('checkout-phone')?.value?.trim() || '',
            customerAddress: document.getElementById('checkout-address')?.value?.trim() || '',
            paymentMethod: document.querySelector('input[name="payment-method"]:checked')?.value || 'Unknown',
            items: localCartState.map(i => ({ id: i.id, name: i.name, qty: i.quantity, price: i.price, variation: i.variation, color: i.variation })),
            totalPaid: localCartState.reduce((sum, item) => sum + (item.price * item.quantity), 0),
            timestamp: new Date().toISOString(),
            orderStatus: 'Pending',
            orderType: 'Pre-Order'
        };
        const confirmed = confirm(`Confirm delivery details?\n\nName: ${orderPayload.customerName}\nMobile: ${orderPayload.customerPhone}\nAddress: ${orderPayload.customerAddress}\n\nTotal: ${formatCurrency(orderPayload.totalPaid)}`);
        if (!confirmed) return;

        localStorage.setItem('minilikhaDeliveryInfo', JSON.stringify({
            name: orderPayload.customerName,
            phone: orderPayload.customerPhone,
            address: orderPayload.customerAddress
        }));

        try {
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
                transaction.set(orderRef, orderPayload);
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
