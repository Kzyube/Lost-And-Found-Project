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

    // --- 3. LOGIN LOGIC (Safe for index.html) ---
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        console.log("Login button found.");
        loginBtn.addEventListener('click', async () => {
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    queryParams: { access_type: 'offline', prompt: 'consent' },
                    redirectTo: window.location.origin + '/dashboard.html'
                }
            });
            if (error) alert('Login error: ' + error.message);
        });
    }

    // --- 4. AUTH CHECK & ROUTING ---
    // If we are NOT on index.html, check auth immediately
    if (!loginBtn && window.location.pathname.indexOf('index.html') === -1) {
        checkAuth();
    }

    async function checkAuth() {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            window.location.href = 'index.html';
            return;
        }

        currentUser = session.user;
        
        // Fetch Profile
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();

        if (profile) {
            currentProfile = profile;
            updateUserUI(profile);
            
            // LOAD DASHBOARD LOGIC ONLY IF LOGGED IN
            loadDashboard();
        } else {
            // If no profile, go to register
            if (window.location.pathname.indexOf('register.html') === -1) {
                window.location.href = 'register.html';
            }
        }
    }

    function updateUserUI(profile) {
        // Safe check for elements before trying to update them
        if(document.getElementById('nav-name')) document.getElementById('nav-name').innerText = profile.full_name;
        if(document.getElementById('nav-role')) document.getElementById('nav-role').innerText = (profile.role || 'Student').toUpperCase();
        if(document.getElementById('user-first-name')) document.getElementById('user-first-name').innerText = profile.full_name.split(' ')[0];
        if(document.getElementById('nav-avatar') && profile.avatar_url) document.getElementById('nav-avatar').src = profile.avatar_url;
    }

    // --- 5. DASHBOARD LOGIC ---
    function loadDashboard() {
        console.log("Loading Dashboard...");
        
        // Load Data
        fetchItems('ALL');
        updateStats();
        setupRealtime();
        checkNotifications();

        // A. Setup Report Button
        const reportBtn = document.getElementById('report-btn');
        if (reportBtn) {
            reportBtn.addEventListener('click', () => {
                document.getElementById('report-modal').classList.add('active');
                // Reset Map vars
                selectedLat = null;
                selectedLng = null;
                if (pickerMarker && pickerMap) pickerMap.removeLayer(pickerMarker);
                
                // Initialize Map (Delay slightly to ensure modal is visible)
                setTimeout(initPickerMap, 100);
            });
        }

        // B. Setup Search
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

        // C. Setup Tabs
        document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', (e) => {
            document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
            e.target.classList.add('active');
            fetchItems(e.target.dataset.tab.toUpperCase(), searchInput ? searchInput.value : '');
        }));

        // D. Logout
        const logoutBtn = document.getElementById('logout-btn');
        if(logoutBtn) {
            logoutBtn.addEventListener('click', async () => {
                await supabase.auth.signOut();
                window.location.href = 'index.html';
            });
        }
    }

    // --- 6. MAP LOGIC ---
    function initPickerMap() {
        const pickerEl = document.getElementById('map-picker');
        if (!pickerEl) return;

        if (!pickerMap) {
            pickerMap = L.map('map-picker').setView([7.116, 124.835], 16); // Kabacan
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(pickerMap);

            pickerMap.on('click', function(e) {
                const { lat, lng } = e.latlng;
                selectedLat = lat;
                selectedLng = lng;

                if (pickerMarker) pickerMap.removeLayer(pickerMarker);
                pickerMarker = L.marker([lat, lng]).addTo(pickerMap);
                
                const statusEl = document.getElementById('picker-status');
                if(statusEl) statusEl.innerText = `Selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            });
        }
        setTimeout(() => { pickerMap.invalidateSize(); }, 200);
    }

    function showViewerMap(lat, lng) {
        const viewerEl = document.getElementById('map-viewer');
        if (!viewerEl) return;
        
        if (!lat || !lng) {
            viewerEl.style.display = 'none';
            return;
        }
        viewerEl.style.display = 'block';

        if (!viewerMap) {
            viewerMap = L.map('map-viewer');
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(viewerMap);
        }
        
        viewerMap.setView([lat, lng], 16);
        if (viewerMarker) viewerMap.removeLayer(viewerMarker);
        
        viewerMarker = L.marker([lat, lng]).addTo(viewerMap)
            .bindPopup("Item Location")
            .openPopup();

        setTimeout(() => { viewerMap.invalidateSize(); }, 200);
    }

    // --- 7. FETCH ITEMS (Fixed Columns) ---
    async function fetchItems(filterType = 'ALL', searchQuery = '') {
        const container = document.getElementById('items-container');
        if (!container) return;
        
        container.innerHTML = '<div style="grid-column:span 3; text-align:center;">Loading...</div>';

        // FIXED: Using correct column names (item_name, date_incident, etc.)
        let query = supabase.from('items')
            .select(`*, profiles(full_name, avatar_url)`)
            .order('created_at', { ascending: false });

        if (filterType !== 'ALL') {
            query = query.eq('type', filterType);
        }
        if (searchQuery) {
            // FIXED: Using 'item_name' not 'name'
            query = query.ilike('item_name', `%${searchQuery}%`);
        }

        const { data: items, error } = await query;
        if (error) {
            console.error("Fetch Error:", error);
            container.innerHTML = '<p style="color:red; grid-column:span 3; text-align:center;">Error loading items.</p>';
            return;
        }

        renderItems(items);
    }

    function renderItems(items) {
        const container = document.getElementById('items-container');
        container.innerHTML = '';

        if (items.length === 0) {
            container.innerHTML = '<p style="grid-column:span 3; text-align:center; color:#888;">No items found.</p>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.onclick = () => openDetailModal(item);

            const imgUrl = item.image_url || 'https://via.placeholder.com/400x300?text=No+Image';
            const badgeClass = item.type === 'LOST' ? 'LOST' : 'FOUND';

            // FIXED: Using correct fields (date_incident, location, item_name)
            card.innerHTML = `
                <img src="${imgUrl}" class="card-img" loading="lazy">
                <div class="card-body">
                    <span class="tag ${badgeClass}">${item.type}</span>
                    <h3 class="card-title">${item.item_name}</h3>
                    <div class="card-meta"><i class="ri-calendar-line"></i> ${item.date_incident || 'Unknown Date'}</div>
                    <div class="card-meta"><i class="ri-map-pin-line"></i> ${item.location || 'Unknown Loc'}</div>
                    <div class="card-meta" style="margin-top:10px;">
                        <span class="mini-tag">${item.status}</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    // --- 8. REPORT FORM SUBMIT (Fixed Columns) ---
    const reportForm = document.getElementById('report-form');
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const oldText = btn.innerText;
            btn.innerText = "Posting...";
            btn.disabled = true;

            try {
                const file = document.getElementById('item-photo').files[0];
                let imageUrl = null;

                if (file) {
                    const fileName = `${Date.now()}-${file.name}`;
                    const { error: upErr } = await supabase.storage.from('item-images').upload(fileName, file);
                    if (upErr) throw upErr;
                    const { data } = supabase.storage.from('item-images').getPublicUrl(fileName);
                    imageUrl = data.publicUrl;
                }

                // FIXED: Insert using correct column names
                const { error } = await supabase.from('items').insert({
                    user_id: currentUser.id,
                    type: document.querySelector('input[name="type"]:checked').value,
                    item_name: document.getElementById('item-name').value,
                    date_incident: document.getElementById('item-date').value,
                    location: document.getElementById('item-location').value,
                    description: document.getElementById('item-desc').value,
                    image_url: imageUrl,
                    status: 'OPEN',
                    latitude: selectedLat,  // Correct column
                    longitude: selectedLng  // Correct column
                });

                if (error) throw error;

                window.showAlert("Success", "Item posted!");
                document.getElementById('report-modal').classList.remove('active');
                reportForm.reset();
                fetchItems();
                updateStats();

            } catch (err) {
                console.error(err);
                window.showAlert("Error", err.message);
            } finally {
                btn.innerText = oldText;
                btn.disabled = false;
            }
        });
    }

    // --- 9. DETAILS & ACTIONS ---
    function openDetailModal(item) {
        document.getElementById('detail-img').src = item.image_url || 'https://via.placeholder.com/400x300';
        
        // Zoom
        const imgEl = document.getElementById('detail-img');
        imgEl.style.cursor = 'zoom-in';
        imgEl.onclick = function() {
            const lb = document.getElementById('lightbox-modal');
            if(lb) {
                document.getElementById('lightbox-img').src = this.src;
                lb.classList.add('active');
            }
        };

        const typeSpan = document.getElementById('detail-type');
        typeSpan.innerText = item.type;
        typeSpan.className = `detail-type ${item.type === 'LOST' ? 'tag LOST' : 'tag FOUND'}`;
        
        document.getElementById('detail-title').innerText = item.item_name;
        document.getElementById('detail-date').innerText = item.date_incident;
        document.getElementById('detail-location').innerText = item.location;
        document.getElementById('detail-desc').innerText = item.description;
        
        if (item.profiles) {
            document.getElementById('detail-user').innerText = item.profiles.full_name;
        }

        // Show Map
        showViewerMap(item.latitude, item.longitude);

        // Buttons
        const contactBtn = document.getElementById('contact-btn');
        if (currentUser.id === item.user_id) {
            contactBtn.innerHTML = '<i class="ri-check-line"></i> Mark as Solved';
            contactBtn.className = "btn-submit"; 
            contactBtn.onclick = () => markAsSolved(item.id);
        } else {
            contactBtn.innerHTML = '<i class="ri-chat-3-line"></i> Contact Uploader';
            contactBtn.className = "btn-facebook";
            contactBtn.onclick = () => openMessageModal(item);
        }

        document.getElementById('detail-modal').classList.add('active');
    }

    async function markAsSolved(itemId) {
        window.showConfirm("Mark this item as solved?", async () => {
            const { error } = await supabase.from('items').update({ status: 'SOLVED' }).eq('id', itemId);
            if (!error) {
                window.showAlert("Success", "Item marked as solved!");
                document.getElementById('detail-modal').classList.remove('active');
                fetchItems();
                updateStats();
            }
        });
    }

    function openMessageModal(item) {
        document.getElementById('message-modal').classList.add('active');
        const sendBtn = document.getElementById('send-msg-btn');
        // Prevent stacking listeners
        const newBtn = sendBtn.cloneNode(true);
        sendBtn.parentNode.replaceChild(newBtn, sendBtn);
        
        newBtn.addEventListener('click', async () => {
            const msg = document.getElementById('message-input').value;
            if(!msg) return;
            
            const { error } = await supabase.from('notifications').insert({
                user_id: item.user_id,
                sender_id: currentUser.id,
                item_id: item.id,
                message: msg,
                type: 'MESSAGE',
                is_read: false
            });

            if(!error) {
                window.showAlert("Sent", "Message sent!");
                document.getElementById('message-modal').classList.remove('active');
            }
        });
    }

    // --- 10. REALTIME & HELPERS ---
    function setupRealtime() {
        supabase.channel('public:items')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items' }, () => {
                fetchItems(document.querySelector('.tab.active')?.dataset.tab.toUpperCase() || 'ALL');
                updateStats();
            })
            .subscribe();
            
        supabase.channel('public:notifications')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, () => {
                checkNotifications();
            })
            .subscribe();
    }

    async function checkNotifications() {
        const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('is_read', false);
        const badge = document.getElementById('notif-badge');
        if (badge) {
            badge.style.display = count > 0 ? 'inline-block' : 'none';
            badge.innerText = count || 0;
        }
    }

    async function updateStats() {
        const { count: lost } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('type', 'LOST').neq('status', 'SOLVED');
        const { count: found } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('type', 'FOUND').neq('status', 'SOLVED');
        if(document.getElementById('count-lost')) document.getElementById('count-lost').innerText = lost || 0;
        if(document.getElementById('count-found')) document.getElementById('count-found').innerText = found || 0;
    }

    window.toggleNotifications = async function() {
        const modal = document.getElementById('notif-modal');
        if (modal.classList.contains('active')) {
            modal.classList.remove('active');
        } else {
            modal.classList.add('active');
            const list = document.getElementById('notif-list');
            list.innerHTML = 'Loading...';
            
            await supabase.from('notifications').update({ is_read: true }).eq('user_id', currentUser.id);
            document.getElementById('notif-badge').style.display = 'none';

            const { data: notifs } = await supabase.from('notifications').select(`*, sender:profiles!sender_id(full_name)`).eq('user_id', currentUser.id).order('created_at', { ascending: false });
            
            list.innerHTML = '';
            if (!notifs || notifs.length === 0) {
                list.innerHTML = '<p style="padding:20px; text-align:center; color:#888;">No notifications.</p>';
            } else {
                notifs.forEach(n => {
                    const div = document.createElement('div');
                    div.className = 'notif-item';
                    div.innerHTML = `
                        <div class="notif-msg"><b>${n.sender?.full_name || 'Someone'}</b>: ${n.message}</div>
                        <div class="notif-time">${new Date(n.created_at).toLocaleString()}</div>
                    `;
                    list.appendChild(div);
                });
            }
        }
    };

    // Global Modal Helpers
    window.showAlert = function(title, msg) {
        const al = document.getElementById('custom-alert');
        if(al) {
            document.getElementById('alert-title').innerText = title;
            document.getElementById('alert-msg').innerText = msg;
            al.classList.add('active');
        } else {
            alert(msg);
        }
    };
    
    window.showConfirm = function(msg, callback) {
        const cm = document.getElementById('custom-confirm');
        if(cm) {
            document.getElementById('confirm-msg').innerText = msg;
            cm.classList.add('active');
            const yesBtn = document.getElementById('confirm-yes-btn');
            const newBtn = yesBtn.cloneNode(true);
            yesBtn.parentNode.replaceChild(newBtn, yesBtn);
            newBtn.addEventListener('click', () => {
                document.getElementById('custom-confirm').classList.remove('active');
                callback();
            });
        } else {
            if(confirm(msg)) callback();
        }
    };
    
    window.closeModal = function(id) {
        document.getElementById(id).classList.remove('active');
    };
});