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

    // EDIT VARIABLES
    let editingItemId = null; 
    let editingItemUrl = null;

    // MAP VARIABLES
    let pickerMap = null;
    let pickerMarker = null;
    let viewerMap = null;
    let viewerMarker = null;
    let selectedLat = null;
    let selectedLng = null;

    // --- 3. LOGIN LOGIC ---
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
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
            loadDashboard(); 
        } else {
            if (window.location.pathname.indexOf('register.html') === -1) {
                window.location.href = 'register.html';
            }
        }
    }

    function updateUserUI(profile) {
        if(document.getElementById('nav-name')) document.getElementById('nav-name').innerText = profile.full_name;
        if(document.getElementById('nav-role')) document.getElementById('nav-role').innerText = (profile.role || 'Student').toUpperCase();
        if(document.getElementById('user-first-name')) document.getElementById('user-first-name').innerText = profile.full_name.split(' ')[0];
        if(document.getElementById('nav-avatar') && profile.avatar_url) document.getElementById('nav-avatar').src = profile.avatar_url;
    }

    // --- 5. DASHBOARD LOGIC ---
    function loadDashboard() {
        console.log("Loading Dashboard...");
        
        fetchItems('ALL');
        updateStats();
        setupRealtime();
        checkNotifications();

        const reportBtn = document.getElementById('report-btn');
        if (reportBtn) {
            reportBtn.addEventListener('click', () => {
                resetReportForm(); 
                openModal('report-modal'); 
                setTimeout(initPickerMap, 200); 
            });
        }

        const settingsBtn = document.getElementById('settings-btn');
        if(settingsBtn) {
            settingsBtn.addEventListener('click', openSettings);
        }

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

        document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', (e) => {
            document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
            e.target.classList.add('active');
            fetchItems(e.target.dataset.tab.toUpperCase(), searchInput ? searchInput.value : '');
        }));

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
            pickerMap = L.map('map-picker').setView([7.116, 124.835], 16); 
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(pickerMap);

            pickerMap.on('click', function(e) {
                const { lat, lng } = e.latlng;
                selectedLat = lat;
                selectedLng = lng;

                if (pickerMarker) pickerMap.removeLayer(pickerMarker);
                pickerMarker = L.marker([lat, lng]).addTo(pickerMap);
                document.getElementById('picker-status').innerText = `Selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
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

    // --- 7. FETCH ITEMS ---
    async function fetchItems(filterType = 'ALL', searchQuery = '') {
        const container = document.getElementById('items-container');
        if (!container) return;
        
        container.innerHTML = '<div style="grid-column:span 3; text-align:center;">Loading...</div>';

        let query = supabase.from('items').select('*').order('created_at', { ascending: false });

        if (filterType !== 'ALL') {
            query = query.eq('type', filterType);
        }
        if (searchQuery) {
            query = query.ilike('title', `%${searchQuery}%`); 
        }

        const { data: items, error } = await query;
        
        if (error) {
            console.error("Fetch Error:", error);
            container.innerHTML = `<p style="color:red; grid-column:span 3; text-align:center;">Error: ${error.message}</p>`;
            return;
        }

        if (!items || items.length === 0) {
            container.innerHTML = '<p style="grid-column:span 3; text-align:center; color:#888;">No items found.</p>';
            return;
        }

        const userIds = [...new Set(items.map(i => i.user_id))];
        const { data: profiles } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds);
        
        const profileMap = {};
        if (profiles) {
            profiles.forEach(p => profileMap[p.id] = p);
        }

        items.forEach(item => {
            item.profiles = profileMap[item.user_id] || { full_name: 'Unknown User', avatar_url: null };
        });

        renderItems(items);
    }

    function renderItems(items) {
        const container = document.getElementById('items-container');
        container.innerHTML = '';

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.onclick = () => openDetailModal(item);

            const imgUrl = item.image_url || 'https://via.placeholder.com/400x300?text=No+Image';
            const badgeClass = item.type === 'LOST' ? 'LOST' : 'FOUND';
            const dateStr = item.date_incident || new Date(item.created_at).toLocaleDateString();
            
            const displayName = item.title || "Unnamed Item";

            card.innerHTML = `
                <img src="${imgUrl}" class="card-img" loading="lazy">
                <div class="card-body">
                    <span class="tag ${badgeClass}">${item.type}</span>
                    <h3 class="card-title">${displayName}</h3> 
                    <div class="card-meta"><i class="ri-calendar-line"></i> ${dateStr}</div>
                    <div class="card-meta"><i class="ri-map-pin-line"></i> ${item.location || 'Unknown'}</div>
                    <div class="card-meta" style="margin-top:10px;">
                        <span class="mini-tag">${item.status}</span>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    // --- 8. REPORT / EDIT FORM SUBMIT ---
    const reportForm = document.getElementById('report-form');
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const oldText = btn.innerText;
            btn.innerText = editingItemId ? "Updating..." : "Posting...";
            btn.disabled = true;

            try {
                const file = document.getElementById('item-photo').files[0];
                let imageUrl = editingItemUrl; 

                if (file) {
                    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`; 
                    
                    const { error: upErr } = await supabase.storage.from('item-images').upload(fileName, file);
                    
                    if (upErr) {
                        if (upErr.message.includes("Bucket not found")) {
                            throw new Error("Missing 'item-images' bucket in Supabase! Please create it.");
                        }
                        throw upErr;
                    }

                    const { data } = supabase.storage.from('item-images').getPublicUrl(fileName);
                    imageUrl = data.publicUrl;
                }

                const itemData = {
                    user_id: currentUser.id,
                    type: document.querySelector('input[name="type"]:checked').value,
                    title: document.getElementById('item-name').value, 
                    date_incident: document.getElementById('item-date').value,
                    location: document.getElementById('item-location').value,
                    description: document.getElementById('item-desc').value,
                    image_url: imageUrl,
                    status: 'OPEN',
                    latitude: selectedLat,
                    longitude: selectedLng
                };

                let error;
                if (editingItemId) {
                    const { error: updateError } = await supabase.from('items').update(itemData).eq('id', editingItemId);
                    error = updateError;
                } else {
                    const { error: insertError } = await supabase.from('items').insert(itemData);
                    error = insertError;
                }

                if (error) throw error;

                window.showAlert("Success", editingItemId ? "Item updated!" : "Item posted!");
                resetReportForm();
                closeModal('report-modal');
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
        
        const imgEl = document.getElementById('detail-img');
        imgEl.style.cursor = 'zoom-in';
        imgEl.onclick = function() {
            const lb = document.getElementById('lightbox-modal');
            if(lb) {
                document.getElementById('lightbox-img').src = this.src;
                openModal('lightbox-modal');
            }
        };

        const typeSpan = document.getElementById('detail-type');
        typeSpan.innerText = item.type;
        typeSpan.className = `detail-type ${item.type === 'LOST' ? 'tag LOST' : 'tag FOUND'}`;
        
        document.getElementById('detail-title').innerText = item.title || "Unnamed Item";
        document.getElementById('detail-date').innerText = item.date_incident || "Unknown Date";
        document.getElementById('detail-location').innerText = item.location || "Unknown Location";
        document.getElementById('detail-desc').innerText = item.description || "No description.";
        
        const userSpan = document.getElementById('detail-user');
        if (item.profiles) {
            userSpan.innerText = item.profiles.full_name;
            userSpan.className = 'clickable-user'; 
            userSpan.onclick = () => viewUserProfile(item.user_id); 
        } else {
             userSpan.innerText = "Unknown";
             userSpan.onclick = null;
             userSpan.classList.remove('clickable-user');
        }

        showViewerMap(item.latitude, item.longitude);

        const actionsContainer = document.querySelector('.detail-actions');
        actionsContainer.innerHTML = ''; 

        // --- CHECK PERMISSIONS ---
        const userRole = (currentProfile.role || '').toUpperCase();
        const isOwner = (currentUser.id === item.user_id);

        if (userRole === 'ADMIN' || userRole === 'Admin' || isOwner) {
            const editBtn = document.createElement('button');
            editBtn.innerHTML = '<i class="ri-edit-line"></i> Edit Item';
            editBtn.className = 'btn-edit';
            editBtn.style.cssText = "width:100%; margin-bottom:10px; background:#f1c40f; color:#333; padding:12px; border:none; border-radius:8px; font-weight:600; cursor:pointer;";
            editBtn.onclick = () => startEditItem(item);
            actionsContainer.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '<i class="ri-delete-bin-line"></i> Delete Item';
            deleteBtn.style.cssText = "width:100%; margin-bottom:10px; background:#ff4757; color:white; padding:12px; border:none; border-radius:8px; font-weight:600; cursor:pointer;";
            deleteBtn.onclick = () => deleteItem(item.id);
            actionsContainer.appendChild(deleteBtn);
        }

        const mainBtn = document.createElement('button');
        mainBtn.style.width = '100%';
        mainBtn.style.padding = '12px';
        mainBtn.style.borderRadius = '8px';
        mainBtn.style.fontWeight = '600';
        mainBtn.style.border = 'none';
        mainBtn.style.cursor = 'pointer';

        if (currentUser.id === item.user_id) {
            mainBtn.innerHTML = '<i class="ri-check-line"></i> Mark as Solved';
            mainBtn.style.backgroundColor = '#004d25'; 
            mainBtn.style.color = 'white';
            mainBtn.onclick = () => markAsSolved(item.id);
        } else {
            mainBtn.innerHTML = '<i class="ri-chat-3-line"></i> Contact Uploader';
            mainBtn.style.backgroundColor = '#1877F2'; 
            mainBtn.style.color = 'white';
            mainBtn.onclick = () => openMessageModal(item);
        }
        actionsContainer.appendChild(mainBtn);

        openModal('detail-modal');
    }

    // --- 10. EDIT ITEM FUNCTIONALITY ---
    window.startEditItem = function(item) {
        editingItemId = item.id;
        editingItemUrl = item.image_url;
        
        closeModal('detail-modal');
        
        document.querySelector(`input[name="type"][value="${item.type}"]`).checked = true;
        document.getElementById('item-name').value = item.title;
        document.getElementById('item-date').value = item.date_incident;
        document.getElementById('item-location').value = item.location;
        document.getElementById('item-desc').value = item.description || "";
        
        document.getElementById('report-modal-title').innerText = "Edit Item";
        document.getElementById('report-submit-btn').innerText = "Update Item";
        document.getElementById('edit-photo-note').style.display = 'block';

        selectedLat = item.latitude;
        selectedLng = item.longitude;
        
        openModal('report-modal');

        setTimeout(() => {
            initPickerMap();
            if(selectedLat && selectedLng) {
                pickerMap.setView([selectedLat, selectedLng], 16);
                if(pickerMarker) pickerMap.removeLayer(pickerMarker);
                pickerMarker = L.marker([selectedLat, selectedLng]).addTo(pickerMap);
                document.getElementById('picker-status').innerText = `Selected: ${selectedLat}, ${selectedLng}`;
            }
        }, 200);
    };

    function resetReportForm() {
        editingItemId = null;
        editingItemUrl = null;
        document.getElementById('report-form').reset();
        document.getElementById('report-modal-title').innerText = "Report an Item";
        document.getElementById('report-submit-btn').innerText = "Post Item";
        document.getElementById('edit-photo-note').style.display = 'none';
        selectedLat = null;
        selectedLng = null;
        if(pickerMarker && pickerMap) pickerMap.removeLayer(pickerMarker);
        document.getElementById('picker-status').innerText = "Click map to select location";
    }

    // --- 11. USER PROFILE VIEW ---
    window.viewUserProfile = async function(userId) {
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if(profile) {
            document.getElementById('view-avatar').src = profile.avatar_url || 'https://via.placeholder.com/100';
            document.getElementById('view-name').innerText = profile.full_name;
            document.getElementById('view-role').innerText = (profile.role || 'STUDENT').toUpperCase();
            document.getElementById('view-mobile').innerText = profile.mobile_number || "Not provided";
            
            const fbLink = document.getElementById('view-fb');
            if (profile.facebook_link) {
                fbLink.href = profile.facebook_link;
                fbLink.innerText = "View Facebook Profile";
                fbLink.style.pointerEvents = "auto";
                fbLink.style.color = "#1877F2";
            } else {
                fbLink.href = "#";
                fbLink.innerText = "No link provided";
                fbLink.style.pointerEvents = "none";
                fbLink.style.color = "#999";
            }

            openModal('profile-view-modal');
        }
    };

    // --- 12. ACCOUNT SETTINGS ---
    window.openSettings = function() {
        document.getElementById('set-name').value = currentProfile.full_name || "";
        document.getElementById('set-mobile').value = currentProfile.mobile_number || "";
        document.getElementById('set-fb').value = currentProfile.facebook_link || "";
        document.getElementById('set-avatar-preview').src = currentProfile.avatar_url || 'https://via.placeholder.com/100';
        openModal('settings-modal');
    }

    const settingsForm = document.getElementById('settings-form');
    if(settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button');
            const oldText = btn.innerText;
            btn.innerText = "Saving...";
            btn.disabled = true;

            try {
                const avatarFile = document.getElementById('set-avatar').files[0];
                let avatarUrl = currentProfile.avatar_url;

                if (avatarFile) {
                    const fileName = `avatar-${currentUser.id}-${Date.now()}`;
                    const { error: upErr } = await supabase.storage.from('item-images').upload(fileName, avatarFile);
                    if(upErr) throw upErr;

                    const { data } = supabase.storage.from('item-images').getPublicUrl(fileName);
                    avatarUrl = data.publicUrl;
                }

                const updates = {
                    full_name: document.getElementById('set-name').value,
                    mobile_number: document.getElementById('set-mobile').value,
                    facebook_link: document.getElementById('set-fb').value,
                    avatar_url: avatarUrl,
                    updated_at: new Date()
                };

                const { error } = await supabase.from('profiles').update(updates).eq('id', currentUser.id);

                if(error) throw error;

                currentProfile = { ...currentProfile, ...updates };
                updateUserUI(currentProfile);
                window.showAlert("Success", "Profile updated!");
                closeModal('settings-modal');

            } catch (err) {
                window.showAlert("Error", err.message);
            } finally {
                btn.innerText = oldText;
                btn.disabled = false;
            }
        });
    }

    // --- 13. ACTION FUNCTIONS ---
    async function deleteItem(itemId) {
        window.showConfirm("Are you sure you want to delete this item?", async () => {
            const { error } = await supabase.from('items').delete().eq('id', itemId);
            if (!error) {
                window.showAlert("Deleted", "Item removed successfully.");
                closeModal('detail-modal');
                fetchItems(); 
                updateStats();
            } else {
                console.error("Delete Error:", error);
                window.showAlert("Error", "Could not delete: " + error.message);
            }
        });
    }

    async function markAsSolved(itemId) {
        window.showConfirm("Mark this item as solved?", async () => {
            const { error } = await supabase.from('items').update({ status: 'SOLVED' }).eq('id', itemId);
            if (!error) {
                window.showAlert("Success", "Item marked as solved!");
                closeModal('detail-modal');
                fetchItems();
                updateStats();
            } else {
                window.showAlert("Error", error.message);
            }
        });
    }

    // --- FIX: MESSAGING LOGIC ---
    function openMessageModal(item) {
        console.log("Opening message modal for item:", item);
        const modal = document.getElementById('message-modal');
        const sendBtn = document.getElementById('send-msg-btn');
        const input = document.getElementById('message-input');
        
        if (!modal || !sendBtn) {
            console.error("Missing modal elements");
            return;
        }

        const header = modal.querySelector('h2');
        if(header && item.profiles) {
            header.innerText = `Contact ${item.profiles.full_name.split(' ')[0]}`;
        }

        openModal('message-modal');
        if(input) input.value = '';

        const newBtn = sendBtn.cloneNode(true); 
        sendBtn.parentNode.replaceChild(newBtn, sendBtn);
        
        newBtn.addEventListener('click', async (e) => {
            e.preventDefault(); 
            const msg = input ? input.value.trim() : "";
            if(!msg) {
                alert("Please enter a message.");
                return;
            }

            const oldText = newBtn.innerText;
            newBtn.innerText = "Sending...";
            newBtn.disabled = true;
            
            try {
                if (!currentUser) throw new Error("You must be logged in.");
                if (!item.user_id) throw new Error("Cannot identify the uploader.");

                const payload = {
                    user_id: item.user_id,     // MATCHES DB COLUMN 'user_id' (Receiver)
                    sender_id: currentUser.id, // MATCHES DB COLUMN 'sender_id' (Sender)
                    item_id: item.id,
                    message: msg,
                    type: 'MESSAGE',
                    is_read: false
                };
                
                console.log("Sending payload:", payload);

                // Using array format for insert is safer
                const { data, error } = await supabase
                    .from('notifications')
                    .insert([payload])
                    .select();

                if(error) {
                    throw new Error(error.message + (error.details ? ` (${error.details})` : ""));
                }

                window.showAlert("Sent", "Message sent successfully!");
                closeModal('message-modal');
            } catch (err) {
                console.error("Message Send Error:", err);
                window.showAlert("Error", "Failed to send: " + err.message);
            } finally {
                newBtn.innerText = oldText;
                newBtn.disabled = false;
            }
        });
    }

    // --- 14. REALTIME & HELPERS ---
    function setupRealtime() {
        supabase.channel('public:items')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
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
            closeModal('notif-modal');
        } else {
            openModal('notif-modal');
            const list = document.getElementById('notif-list');
            list.innerHTML = 'Loading...';
            
            await supabase.from('notifications').update({ is_read: true }).eq('user_id', currentUser.id);
            document.getElementById('notif-badge').style.display = 'none';

            const { data: notifs } = await supabase.from('notifications').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
            
            list.innerHTML = '';
            if (!notifs || notifs.length === 0) {
                list.innerHTML = '<p style="padding:20px; text-align:center; color:#888;">No notifications.</p>';
            } else {
                const senderIds = [...new Set(notifs.map(n => n.sender_id))];
                const { data: senders } = await supabase.from('profiles').select('id, full_name').in('id', senderIds);
                const senderMap = {};
                senders?.forEach(s => senderMap[s.id] = s);

                notifs.forEach(n => {
                    const senderName = senderMap[n.sender_id]?.full_name || 'Someone';
                    const div = document.createElement('div');
                    div.className = 'notif-item';
                    div.innerHTML = `
                        <div class="notif-msg"><b>${senderName}</b>: ${n.message}</div>
                        <div class="notif-time">${new Date(n.created_at).toLocaleString()}</div>
                    `;
                    list.appendChild(div);
                });
            }
        }
    };

    window.showAlert = function(title, msg) {
        const al = document.getElementById('custom-alert');
        if(al) {
            document.getElementById('alert-title').innerText = title;
            document.getElementById('alert-msg').innerText = msg;
            openModal('custom-alert');
        } else {
            alert(msg);
        }
    };
    
    window.showConfirm = function(msg, callback) {
        const cm = document.getElementById('custom-confirm');
        if(cm) {
            document.getElementById('confirm-msg').innerText = msg;
            openModal('custom-confirm');
            const yesBtn = document.getElementById('confirm-yes-btn');
            const newBtn = yesBtn.cloneNode(true);
            yesBtn.parentNode.replaceChild(newBtn, yesBtn);
            newBtn.addEventListener('click', () => {
                closeModal('custom-confirm');
                callback();
            });
        } else {
            if(confirm(msg)) callback();
        }
    };
    
    window.openModal = function(id) {
        const el = document.getElementById(id);
        if(el) {
            el.classList.add('active');
            document.body.classList.add('modal-open'); 
        }
    }

    window.closeModal = function(id) {
        const el = document.getElementById(id);
        if(el) {
            el.classList.remove('active');
            document.body.classList.remove('modal-open');
        }
    };
});