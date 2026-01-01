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

    // --- 3. CUSTOM MODAL HELPERS ---
    window.showAlert = function(title, msg) {
        document.getElementById('alert-title').innerText = title;
        document.getElementById('alert-msg').innerText = msg;
        document.getElementById('custom-alert').classList.add('active');
    };

    window.showConfirm = function(msg, callback) {
        document.getElementById('confirm-msg').innerText = msg;
        const confirmModal = document.getElementById('custom-confirm');
        confirmModal.classList.add('active');
        
        // Clone button to remove old listeners
        const yesBtn = document.getElementById('confirm-yes-btn');
        const newYes = yesBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYes, yesBtn);
        
        newYes.addEventListener('click', () => {
            confirmModal.classList.remove('active');
            callback();
        });
    };

    window.closeModal = function(id) { document.getElementById(id).classList.remove('active'); };

    // --- 4. INITIALIZATION ---
    async function init() {
        // Check session
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            window.location.href = 'index.html';
            return;
        }

        currentUser = session.user;
        
        // Get Profile
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();

        if (profile) {
            currentProfile = profile;
            document.getElementById('nav-name').innerText = profile.full_name || currentUser.email;
            document.getElementById('nav-role').innerText = (profile.role || 'Student').toUpperCase();
            document.getElementById('user-first-name').innerText = (profile.full_name || 'Student').split(' ')[0];
            if (profile.avatar_url) {
                document.getElementById('nav-avatar').src = profile.avatar_url;
            }
        }

        // Load Initial Data
        fetchItems('ALL');
        updateStats();
        setupRealtime();
        checkNotifications();
    }
    init();

    // --- 5. MAP LOGIC ---
    
    // A. Picker Map (For Reporting Items)
    function initPickerMap() {
        // Initialize only once
        if (!pickerMap) {
            // Center on Kabacan, Cotabato (7.116, 124.835)
            pickerMap = L.map('map-picker').setView([7.116, 124.835], 16);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap'
            }).addTo(pickerMap);

            // Handle Click
            pickerMap.on('click', function(e) {
                const { lat, lng } = e.latlng;
                selectedLat = lat;
                selectedLng = lng;

                // Move Marker
                if (pickerMarker) pickerMap.removeLayer(pickerMarker);
                pickerMarker = L.marker([lat, lng]).addTo(pickerMap);
                
                document.getElementById('picker-status').innerText = `Selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            });
        }
        
        // FIX: Leaflet needs a resize trigger when shown in a modal
        setTimeout(() => { pickerMap.invalidateSize(); }, 300);
    }

    // B. Viewer Map (For Details)
    function showViewerMap(lat, lng) {
        const viewerEl = document.getElementById('map-viewer');
        
        // If no coords, hide map
        if (!lat || !lng) {
            viewerEl.style.display = 'none';
            return;
        }
        viewerEl.style.display = 'block';

        if (!viewerMap) {
            viewerMap = L.map('map-viewer');
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(viewerMap);
        }

        // Update View
        viewerMap.setView([lat, lng], 16);
        
        if (viewerMarker) viewerMap.removeLayer(viewerMarker);
        viewerMarker = L.marker([lat, lng]).addTo(viewerMap)
            .bindPopup("Item location")
            .openPopup();
            
        setTimeout(() => { viewerMap.invalidateSize(); }, 300);
    }

    // --- 6. CORE FUNCTIONALITY (FETCH ITEMS) ---
    async function fetchItems(filterType = 'ALL', searchQuery = '') {
        const container = document.getElementById('items-container');
        container.innerHTML = '<div style="text-align:center; width:100%; grid-column:span 3;">Loading...</div>';

        let query = supabase.from('items').select(`*, profiles(full_name, avatar_url)`).order('created_at', { ascending: false });

        if (filterType !== 'ALL') {
            query = query.eq('type', filterType);
        }
        if (searchQuery) {
            query = query.ilike('item_name', `%${searchQuery}%`);
        }

        const { data: items, error } = await query;
        if (error) {
            console.error(error);
            return;
        }

        renderItems(items);
    }

    function renderItems(items) {
        const container = document.getElementById('items-container');
        container.innerHTML = '';

        if (items.length === 0) {
            container.innerHTML = '<p style="text-align:center; width:100%; grid-column:span 3; color:#888;">No items found.</p>';
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.onclick = () => openDetailModal(item);

            const imgUrl = item.image_url || 'https://via.placeholder.com/400x300?text=No+Image';
            const badgeClass = item.type === 'LOST' ? 'LOST' : 'FOUND';

            card.innerHTML = `
                <img src="${imgUrl}" class="card-img" loading="lazy">
                <div class="card-body">
                    <span class="tag ${badgeClass}">${item.type}</span>
                    <h3 class="card-title">${item.item_name}</h3>
                    <div class="card-meta"><i class="ri-calendar-line"></i> ${item.date_incident}</div>
                    <div class="card-meta"><i class="ri-map-pin-line"></i> ${item.location}</div>
                    <div class="card-meta" style="margin-top:10px;">
                        <span class="mini-tag">${item.status}</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    // --- 7. REPORT ITEM LOGIC ---
    document.getElementById('report-btn').addEventListener('click', () => {
        document.getElementById('report-modal').classList.add('active');
        
        // Reset Map & Form
        selectedLat = null;
        selectedLng = null;
        if (pickerMarker && pickerMap) pickerMap.removeLayer(pickerMarker);
        document.getElementById('picker-status').innerText = "Click the map to pin location";
        
        // Init Map
        initPickerMap();
    });

    document.getElementById('report-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.innerText = "Posting...";
        btn.disabled = true;

        const file = document.getElementById('item-photo').files[0];
        let imageUrl = null;

        try {
            // Upload Image
            if (file) {
                const fileName = `${Date.now()}-${file.name}`;
                const { error: upErr } = await supabase.storage.from('item-images').upload(fileName, file);
                if (upErr) throw upErr;
                const { data } = supabase.storage.from('item-images').getPublicUrl(fileName);
                imageUrl = data.publicUrl;
            }

            // Insert Data (WITH LAT/LNG)
            const { error } = await supabase.from('items').insert({
                user_id: currentUser.id,
                type: document.querySelector('input[name="type"]:checked').value,
                item_name: document.getElementById('item-name').value,
                date_incident: document.getElementById('item-date').value,
                location: document.getElementById('item-location').value,
                description: document.getElementById('item-desc').value,
                image_url: imageUrl,
                status: 'OPEN',
                latitude: selectedLat, // <--- SAVING COORDINATES
                longitude: selectedLng // <--- SAVING COORDINATES
            });

            if (error) throw error;

            window.showAlert("Success", "Item posted successfully!");
            document.getElementById('report-modal').classList.remove('active');
            document.getElementById('report-form').reset();
            fetchItems(document.querySelector('.tab.active').dataset.tab);
            updateStats();

        } catch (err) {
            console.error(err);
            window.showAlert("Error", err.message);
        } finally {
            btn.innerText = "Post Item";
            btn.disabled = false;
        }
    });

    // --- 8. DETAILS & CONTACT ---
    function openDetailModal(item) {
        document.getElementById('detail-img').src = item.image_url || 'https://via.placeholder.com/400x300?text=No+Image';
        
        // Lightbox Feature
        const imgEl = document.getElementById('detail-img');
        imgEl.style.cursor = 'zoom-in';
        imgEl.onclick = function() {
            document.getElementById('lightbox-img').src = this.src;
            document.getElementById('lightbox-modal').classList.add('active');
        };

        // Text Data
        const typeSpan = document.getElementById('detail-type');
        typeSpan.innerText = item.type;
        typeSpan.className = `detail-type ${item.type === 'LOST' ? 'tag LOST' : 'tag FOUND'}`;
        
        document.getElementById('detail-title').innerText = item.item_name;
        document.getElementById('detail-date').innerText = item.date_incident;
        document.getElementById('detail-location').innerText = item.location;
        document.getElementById('detail-desc').innerText = item.description || "No description provided.";
        
        const profile = item.profiles;
        document.getElementById('detail-user').innerText = profile ? profile.full_name : 'Unknown';

        // SHOW MAP (NEW)
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
        window.showConfirm("Mark this item as solved/returned?", async () => {
            const { error } = await supabase.from('items').update({ status: 'SOLVED' }).eq('id', itemId);
            if (error) window.showAlert("Error", error.message);
            else {
                window.showAlert("Success", "Item marked as solved!");
                document.getElementById('detail-modal').classList.remove('active');
                fetchItems();
                updateStats();
            }
        });
    }

    function openMessageModal(item) {
        document.getElementById('message-modal').classList.add('active');
        document.getElementById('send-msg-btn').onclick = async () => {
            const msg = document.getElementById('message-input').value;
            if(!msg) return window.showAlert("Error", "Please write a message");
            
            const { error } = await supabase.from('notifications').insert({
                user_id: item.user_id, 
                sender_id: currentUser.id,
                item_id: item.id,
                message: msg,
                type: 'MESSAGE',
                is_read: false
            });

            if(error) window.showAlert("Error", error.message);
            else {
                window.showAlert("Sent", "Message sent to uploader!");
                document.getElementById('message-modal').classList.remove('active');
            }
        };
    }

    // --- 9. REALTIME & NOTIFICATIONS ---
    function setupRealtime() {
        supabase.channel('public:items')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'items' }, payload => {
                fetchItems(document.querySelector('.tab.active').dataset.tab);
                updateStats();
            })
            .subscribe();
            
        supabase.channel('public:notifications')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` }, () => {
                checkNotifications();
                const badge = document.getElementById('notif-badge');
                badge.style.display = 'inline-block';
                badge.innerText = parseInt(badge.innerText || 0) + 1;
            })
            .subscribe();
    }

    async function checkNotifications() {
        const { count } = await supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id).eq('is_read', false);
        const badge = document.getElementById('notif-badge');
        if (count > 0) {
            badge.style.display = 'inline-block';
            badge.innerText = count;
        } else {
            badge.style.display = 'none';
        }
    }

    window.toggleNotifications = async function() {
        const modal = document.getElementById('notif-modal');
        if (modal.classList.contains('active')) {
            modal.classList.remove('active');
        } else {
            modal.classList.add('active');
            const list = document.getElementById('notif-list');
            list.innerHTML = 'Loading...';
            
            // Mark Read
            await supabase.from('notifications').update({ is_read: true }).eq('user_id', currentUser.id);
            document.getElementById('notif-badge').style.display = 'none';

            // Fetch
            const { data: notifs } = await supabase.from('notifications').select(`*, sender:profiles!sender_id(full_name, avatar_url)`).eq('user_id', currentUser.id).order('created_at', { ascending: false });
            
            list.innerHTML = '';
            if (!notifs || notifs.length === 0) {
                list.innerHTML = '<p style="padding:20px; text-align:center; color:#888;">No notifications yet.</p>';
                return;
            }

            notifs.forEach(n => {
                const div = document.createElement('div');
                div.className = 'notif-item';
                div.innerHTML = `
                    <div class="notif-msg">
                        <span class="notif-user-link" onclick="showUserProfile('${n.sender_id}')">${n.sender?.full_name || 'Someone'}</span>
                        ${n.message}
                    </div>
                    <div class="notif-time">${new Date(n.created_at).toLocaleString()}</div>
                    <div class="notif-actions">
                        <button class="btn-small btn-read">Read</button> 
                        ${n.item_id ? `<button class="btn-small btn-go" onclick="viewItem('${n.item_id}')">View Item</button>` : ''}
                    </div>
                `;
                list.appendChild(div);
            });
        }
    };

    window.viewItem = async function(itemId) {
        document.getElementById('notif-modal').classList.remove('active');
        const { data: item } = await supabase.from('items').select(`*, profiles(full_name, avatar_url)`).eq('id', itemId).single();
        if (item) openDetailModal(item);
    };

    window.showUserProfile = async function(userId) {
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if(!profile) return;

        const box = document.querySelector('#custom-alert .modal-box');
        const oldContent = box.innerHTML;
        
        box.innerHTML = `
            <img src="${profile.avatar_url || 'https://via.placeholder.com/100'}" class="popup-avatar">
            <h3>${profile.full_name}</h3>
            <span class="popup-role">${(profile.role || 'Student').toUpperCase()}</span>
            <div class="profile-details">
                <div class="p-row"><i class="ri-map-pin-user-line"></i> ${profile.address || 'No Address'}</div>
                <div class="p-row"><i class="ri-phone-line"></i> ${profile.mobile_number || 'N/A'}</div>
                <div class="p-row"><i class="ri-facebook-circle-line"></i> <a href="${profile.facebook_link || '#'}" target="_blank">Facebook</a></div>
            </div>
            <button class="btn-submit" onclick="closeModal('custom-alert'); this.parentElement.innerHTML = \`${oldContent.replace(/`/g, '\\`')}\`">Close</button>
        `;
        document.getElementById('custom-alert').classList.add('active');
    };

    // --- 10. UTILS (SEARCH & STATS) ---
    const searchInput = document.getElementById('search-input');
    if(searchInput) {
        let timer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                const tab = document.querySelector('.tab.active').dataset.tab.toUpperCase();
                fetchItems(tab === 'ALL' ? 'ALL' : tab, e.target.value);
            }, 300);
        });
    }

    async function updateStats() {
        const { count: lost } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('type', 'LOST').neq('status', 'SOLVED');
        const { count: found } = await supabase.from('items').select('*', { count: 'exact', head: true }).eq('type', 'FOUND').neq('status', 'SOLVED');
        document.getElementById('count-lost').innerText = lost || 0;
        document.getElementById('count-found').innerText = found || 0;
    }

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', (e) => {
        document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        e.target.classList.add('active');
        fetchItems(e.target.dataset.tab.toUpperCase(), searchInput.value);
    }));

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
    });
});