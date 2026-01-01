document.addEventListener("DOMContentLoaded", function() {
    console.log("System initializing...");

    // 1. SUPABASE CONFIGURATION
    const SUPABASE_URL = 'https://lznqmpuofpedlljnamtl.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6bnFtcHVvZnBlZGxsam5hbXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMTc3ODAsImV4cCI6MjA4MjU5Mzc4MH0.LIR7bN7_Ds1-fe0LUoPjKAm-QMN3_OcJDx7wwRs5mwM';

    if (typeof window.supabase === 'undefined') {
        console.error("Supabase missing");
        return;
    }
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // 2. GLOBAL VARIABLES
    let currentUser = null;
    let currentProfile = null; 

    // MAP VARIABLES
    let pickerMap = null;
    let pickerMarker = null;
    let viewerMap = null;
    let viewerMarker = null;
    let selectedLat = null;
    let selectedLng = null;

    // --- 3. LOGIN LOGIC (Must be safe for index.html) ---
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        console.log("Login button found. Attaching listener.");
        loginBtn.addEventListener('click', async () => {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent',
                    },
                    redirectTo: window.location.origin + '/dashboard.html' // Redirects to dashboard after login
                }
            });
            if (error) console.error('Login error:', error.message);
        });
    }

    // --- 4. CUSTOM MODAL HELPERS ---
    window.showAlert = function(title, msg) {
        // Safety check: ensure alert modal exists (it might not on index.html)
        const alertModal = document.getElementById('custom-alert');
        if(alertModal) {
            document.getElementById('alert-title').innerText = title;
            document.getElementById('alert-msg').innerText = msg;
            alertModal.classList.add('active');
        } else {
            alert(title + ": " + msg);
        }
    };

    window.showConfirm = function(msg, callback) {
        const confirmModal = document.getElementById('custom-confirm');
        if(confirmModal) {
            document.getElementById('confirm-msg').innerText = msg;
            confirmModal.classList.add('active');
            
            const yesBtn = document.getElementById('confirm-yes-btn');
            // Remove old listeners to prevent stacking
            const newYesBtn = yesBtn.cloneNode(true);
            yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
            
            newYesBtn.addEventListener('click', () => {
                closeModal('custom-confirm');
                callback();
            });
        } else {
            if(confirm(msg)) callback();
        }
    };

    window.closeModal = function(id) { 
        const m = document.getElementById(id);
        if(m) m.classList.remove('active'); 
    };

    // --- 5. DASHBOARD AUTH CHECK ---
    // We only run this check if we are NOT on index.html (no login button)
    if (!loginBtn && window.location.pathname.indexOf('index.html') === -1) {
        checkAuth();
    }

    async function checkAuth() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            // No session, redirect to login
            if (window.location.pathname.indexOf('index.html') === -1) {
                window.location.href = 'index.html';
            }
            return;
        }

        currentUser = session.user;
        console.log("User Logged In:", currentUser.email);
        
        // Fetch Profile
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (error || !profile) {
            // If logged in but no profile, go to register
            if (window.location.pathname.indexOf('register.html') === -1) {
                window.location.href = 'register.html';
            }
        } else {
            currentProfile = profile;
            // Update UI with user info
            updateUserUI(profile);
            
            // If we are on dashboard, load items and stats
            if(document.getElementById('items-container')) {
                loadDashboard();
            }
        }
    }

    function updateUserUI(profile) {
        // Update Sidebar/Top Bar info
        const nameEls = document.querySelectorAll('.user-name-display');
        const roleEls = document.querySelectorAll('.user-role-display');
        const avatarEls = document.querySelectorAll('.nav-avatar');

        nameEls.forEach(el => el.innerText = profile.full_name || 'User');
        roleEls.forEach(el => el.innerText = profile.role || 'Student');
        if (profile.avatar_url) {
            avatarEls.forEach(img => img.src = profile.avatar_url);
        }

        // Hide admin-only elements if not admin
        if (profile.role !== 'ADMIN') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        }
    }

    // --- 6. DASHBOARD LOGIC (WRAPPED SAFELY) ---
    async function loadDashboard() {
        // Load initial data
        fetchItems('ALL');
        updateStats();
        setupRealtimeSubscription();

        // 6a. Setup Search Listener
        const searchInput = document.getElementById('search-input');
        if(searchInput) {
            let timer;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    const activeTab = document.querySelector('.tab.active');
                    const tab = activeTab ? activeTab.dataset.tab.toUpperCase() : 'ALL';
                    fetchItems(tab, e.target.value);
                }, 300);
            });
        }

        // 6b. Setup Tab Listeners
        document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', (e) => {
            document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
            e.target.classList.add('active');
            fetchItems(e.target.dataset.tab.toUpperCase(), searchInput ? searchInput.value : '');
        }));

        // 6c. Setup Logout
        const logoutBtn = document.getElementById('logout-btn');
        if(logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                await supabase.auth.signOut();
                window.location.href = 'index.html';
            });
        }

        // 6d. Initialize Map (Only if modal exists)
        if(document.getElementById('map-picker')) {
            initPickerMap();
        }
    }

    // --- 7. ITEM FETCHING & RENDERING ---
    async function fetchItems(type = 'ALL', search = '') {
        const container = document.getElementById('items-container');
        if(!container) return; // Safety check

        container.innerHTML = '<div class="loading-spinner"></div>';

        let query = supabase
            .from('items')
            .select('*, profiles(full_name, role, avatar_url, student_id_number)')
            .order('created_at', { ascending: false });

        if (type !== 'ALL') {
            query = query.eq('type', type);
        }

        if (search.trim() !== '') {
            query = query.ilike('name', `%${search}%`);
        }

        const { data, error } = await query;

        if (error) {
            container.innerHTML = `<p class="error-msg">Error loading items.</p>`;
            return;
        }

        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = `<div class="empty-state"><i class="ri-inbox-archive-line"></i><p>No items found.</p></div>`;
            return;
        }

        data.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            const isLost = item.type === 'LOST';
            const statusClass = item.status === 'SOLVED' ? 'status-solved' : (isLost ? 'status-lost' : 'status-found');
            
            // Handle location display
            let locationDisplay = item.location;
            let mapBtn = '';
            if (item.lat && item.lng) {
                mapBtn = `<button class="btn-icon-small" onclick="window.openMapViewer(${item.lat}, ${item.lng}, '${item.location}')" title="View on Map"><i class="ri-map-pin-2-fill"></i></button>`;
            }

            card.innerHTML = `
                <div class="card-header">
                    <span class="badge ${statusClass}">${item.type}</span>
                    <span class="date">${new Date(item.created_at).toLocaleDateString()}</span>
                </div>
                <div class="card-img-container" onclick="openLightbox('${item.image_url || 'https://via.placeholder.com/300?text=No+Image'}')">
                    <img src="${item.image_url || 'https://via.placeholder.com/300?text=No+Image'}" alt="Item Image">
                </div>
                <div class="card-body">
                    <h3>${item.name}</h3>
                    <p class="location"><i class="ri-map-pin-line"></i> ${locationDisplay} ${mapBtn}</p>
                    <p class="desc">${item.description}</p>
                    
                    <div class="user-row">
                        <img src="${item.profiles?.avatar_url || 'https://via.placeholder.com/40'}" class="user-avatar" alt="User">
                        <div class="user-info-text">
                            <span class="u-name" onclick="showUserProfile('${item.user_id}')">${item.profiles?.full_name || 'Unknown'}</span>
                            <span class="u-role">${item.profiles?.role || 'Student'}</span>
                        </div>
                    </div>

                    ${item.status !== 'SOLVED' ? `
                    <button class="btn-contact" onclick="openMessageModal('${item.user_id}', '${item.name}')">
                        <i class="ri-chat-1-line"></i> Contact ${isLost ? 'Owner' : 'Finder'}
                    </button>
                    ` : '<button class="btn-contact disabled" disabled>Solved</button>'}
                    
                    ${(currentUser && currentUser.id === item.user_id && item.status !== 'SOLVED') ? `
                    <button class="btn-solve" onclick="markAsSolved(${item.id})">
                        <i class="ri-checkbox-circle-line"></i> Mark as Solved
                    </button>
                    ` : ''}
                </div>
            `;
            container.appendChild(card);
        });
    }

    // --- 8. STATS & REALTIME ---
    async function updateStats() {
        const countLost = document.getElementById('count-lost');
        const countFound = document.getElementById('count-found');
        if(!countLost || !countFound) return;

        const { count: lost } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('type', 'LOST').neq('status', 'SOLVED');
        const { count: found } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('type', 'FOUND').neq('status', 'SOLVED');
        
        countLost.innerText = lost || 0;
        countFound.innerText = found || 0;
    }

    function setupRealtimeSubscription() {
        supabase
            .channel('items_channel')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, (payload) => {
                console.log('Realtime update:', payload);
                const activeTab = document.querySelector('.tab.active');
                const searchInput = document.getElementById('search-input');
                fetchItems(
                    activeTab ? activeTab.dataset.tab.toUpperCase() : 'ALL', 
                    searchInput ? searchInput.value : ''
                );
                updateStats();
                showNotification(payload);
            })
            .subscribe();
    }

    function showNotification(payload) {
        const badge = document.getElementById('notif-badge');
        if (badge) {
            let count = parseInt(badge.innerText) || 0;
            badge.innerText = count + 1;
            badge.style.display = 'inline-block';
        }
    }

    // --- 9. MAP INITIALIZATION (SAFE) ---
    function initPickerMap() {
        const pickerEl = document.getElementById('map-picker');
        if (!pickerEl) return;

        // Default: USM Coordinates (Kabacan)
        const usmLat = 7.116;
        const usmLng = 124.836;

        // Initialize Leaflet Map
        // We use a check to prevent re-initialization errors if called multiple times
        if (pickerMap) {
            pickerMap.remove(); // Clean up existing instance
        }

        pickerMap = L.map('map-picker').setView([usmLat, usmLng], 16);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(pickerMap);

        // Click event to place marker
        pickerMap.on('click', function(e) {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;
            
            selectedLat = lat;
            selectedLng = lng;

            if (pickerMarker) {
                pickerMarker.setLatLng(e.latlng);
            } else {
                pickerMarker = L.marker(e.latlng).addTo(pickerMap);
            }

            // Optional: Reverse Geocoding could go here to auto-fill text input
            console.log(`Selected Location: ${lat}, ${lng}`);
        });

        // Invalidate size when modal opens to fix grey tiles
        setTimeout(() => {
            pickerMap.invalidateSize();
        }, 300);
    }

    // GLOBAL FUNCTION: Open Viewer Map
    window.openMapViewer = function(lat, lng, locName) {
        const modal = document.getElementById('map-viewer-modal');
        if(!modal) return;
        
        modal.classList.add('active');
        document.getElementById('map-viewer-title').innerText = locName || "Item Location";

        if (viewerMap) {
            viewerMap.remove();
        }

        // Delay slighty to allow modal to render
        setTimeout(() => {
            viewerMap = L.map('map-viewer').setView([lat, lng], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap'
            }).addTo(viewerMap);

            L.marker([lat, lng]).addTo(viewerMap)
                .bindPopup(locName || "Item Here")
                .openPopup();
        }, 100);
    };

    // --- 10. FORM SUBMISSION (WITH MAP DATA) ---
    window.openReportModal = function() {
        const modal = document.getElementById('report-modal');
        if (modal) {
            modal.classList.add('active');
            // Trigger map resize so it renders correctly
            setTimeout(() => {
                if (pickerMap) pickerMap.invalidateSize();
                else initPickerMap();
            }, 200);
        }
    };

    const reportForm = document.getElementById('report-form');
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const btn = e.target.querySelector('button[type="submit"]');
            const originalText = btn.innerText;
            btn.innerText = "Posting...";
            btn.disabled = true;

            try {
                // 1. Upload Image
                const fileInput = document.getElementById('item-image');
                const file = fileInput.files[0];
                let imageUrl = null;

                if (file) {
                    const fileExt = file.name.split('.').pop();
                    const fileName = `${Date.now()}.${fileExt}`;
                    const { error: uploadError } = await supabase.storage
                        .from('items')
                        .upload(fileName, file);

                    if (uploadError) throw uploadError;

                    const { data: { publicUrl } } = supabase.storage
                        .from('items')
                        .getPublicUrl(fileName);
                    
                    imageUrl = publicUrl;
                }

                // 2. Insert Data
                const { error } = await supabase.from('items').insert({
                    name: document.getElementById('item-name').value,
                    description: document.getElementById('item-desc').value,
                    location: document.getElementById('item-location').value,
                    lat: selectedLat, // SAVE LATITUDE
                    lng: selectedLng, // SAVE LONGITUDE
                    type: document.getElementById('item-type').value,
                    image_url: imageUrl,
                    user_id: currentUser.id,
                    status: 'OPEN'
                });

                if (error) throw error;

                // Success
                window.showAlert('Success', 'Item posted successfully!');
                closeModal('report-modal');
                reportForm.reset();
                if(pickerMarker) pickerMap.removeLayer(pickerMarker);
                selectedLat = null;
                selectedLng = null;
                fetchItems(); // Refresh grid

            } catch (err) {
                console.error(err);
                window.showAlert('Error', err.message);
            } finally {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        });
    }

    // --- 11. OTHER ACTIONS (Solved, Contact, Profile) ---
    window.markAsSolved = async function(itemId) {
        showConfirm("Mark this item as solved/returned?", async () => {
            const { error } = await supabase
                .from('items')
                .update({ status: 'SOLVED' })
                .eq('id', itemId);

            if (error) window.showAlert('Error', error.message);
            else {
                fetchItems();
                updateStats();
            }
        });
    };

    window.openMessageModal = function(receiverId, itemName) {
        if(currentUser.id === receiverId) {
            window.showAlert('Oops', 'You cannot message yourself!');
            return;
        }
        document.getElementById('message-modal').classList.add('active');
        
        // Setup send button
        const sendBtn = document.getElementById('send-msg-btn');
        // prevent stacking listeners by cloning
        const newBtn = sendBtn.cloneNode(true);
        sendBtn.parentNode.replaceChild(newBtn, sendBtn);

        newBtn.addEventListener('click', async () => {
            const msg = document.getElementById('message-input').value;
            if(!msg) return;

            // Here you would implement real chat logic (insert into a 'messages' table)
            // For now, we mock it:
            window.showAlert('Sent', `Message sent to owner about ${itemName}!`);
            closeModal('message-modal');
            document.getElementById('message-input').value = '';
        });
    };

    window.showUserProfile = async function(userId) {
        // Fetch user details
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if(profile) {
            const modal = document.getElementById('profile-popup');
            if(modal) {
                document.getElementById('popup-avatar').src = profile.avatar_url || 'https://via.placeholder.com/90';
                document.getElementById('popup-name').innerText = profile.full_name;
                document.getElementById('popup-role').innerText = profile.role;
                document.getElementById('popup-email').innerText = "Contact via FindItFast"; // Privacy
                document.getElementById('popup-fb').href = profile.facebook_link || "#";
                modal.classList.add('active');
            }
        }
    };

    // --- 12. UTILS ---
    window.openLightbox = function(url) {
        const lb = document.getElementById('lightbox-modal');
        if(lb) {
            document.getElementById('lightbox-img').src = url;
            lb.classList.add('active');
        }
    };
});