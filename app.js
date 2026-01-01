document.addEventListener("DOMContentLoaded", function() {
    console.log("System initializing...");

    const SUPABASE_URL = 'https://lznqmpuofpedlljnamtl.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx6bnFtcHVvZnBlZGxsam5hbXRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMTc3ODAsImV4cCI6MjA4MjU5Mzc4MH0.LIR7bN7_Ds1-fe0LUoPjKAm-QMN3_OcJDx7wwRs5mwM';

    if (typeof window.supabase === 'undefined') {
        console.error("Supabase missing");
        return;
    }
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    
    // GLOBAL VARIABLES
    let currentUser = null;
    let currentProfile = null; 

    // --- 0. CUSTOM MODAL HELPERS ---
    window.showAlert = function(title, msg) {
        document.getElementById('alert-title').innerText = title;
        document.getElementById('alert-msg').innerText = msg;
        document.getElementById('custom-alert').classList.add('active');
    };

    window.showConfirm = function(msg, callback) {
        document.getElementById('confirm-msg').innerText = msg;
        const confirmModal = document.getElementById('custom-confirm');
        const yesBtn = document.getElementById('confirm-yes-btn');
        
        const newBtn = yesBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newBtn, yesBtn);

        newBtn.addEventListener('click', () => {
            confirmModal.classList.remove('active');
            callback();
        });

        confirmModal.classList.add('active');
    };

    // --- 1. SESSION & AUTH ---
    async function handleSession() {
        const { data: { session } } = await supabase.auth.getSession();
        const path = window.location.pathname;
        const isDash = path.includes('dashboard.html');
        const isLogin = path.includes('index.html') || path.endsWith('/');
        const isReg = path.includes('register.html');
        
        if (!session) {
            if (isDash || isReg) window.location.href = 'index.html';
            return;
        }

        currentUser = session.user;
        
        // Fetch full profile to check for ADMIN role
        const { data: profile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = profile; 

        if (profile) {
            if (isLogin || isReg) window.location.href = 'dashboard.html';
            if (isDash) loadDashboardData(profile);
        } else {
            if (!isReg) window.location.href = 'register.html';
        }
    }
    handleSession();

    // --- 2. LOGIN BUTTON ---
    const loginBtn = document.getElementById('login-btn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            if (window.location.protocol === 'file:') {
                window.showAlert("Error", "Use Live Server!"); return;
            }
            const { error } = await supabase.auth.signInWithOAuth({
                provider: 'google', options: { redirectTo: window.location.href }
            });
            if (error) window.showAlert("Login Error", error.message);
        });
    }

    // --- 3. DASHBOARD DATA ---
    function loadDashboardData(profile) {
        const nameEl = document.getElementById('nav-name');
        if (nameEl) {
            nameEl.innerText = profile.full_name || "User";
            if (profile.avatar_url) document.getElementById('nav-avatar').src = profile.avatar_url;
            updateStats();
            fetchItems('ALL');
            fetchNotifications();
        }
    }

    // --- 4. FETCH ITEMS ---
    async function fetchItems(filterType, searchQuery = '') {
        const container = document.getElementById('feed-container');
        if(!container) return;
        
        container.innerHTML = '<div class="loading-state">Loading items...</div>';

        let query = supabase.from('items').select('*')
            .neq('status', 'SOLVED') 
            .order('created_at', { ascending: false });

        if (filterType !== 'ALL') query = query.eq('type', filterType);

        const { data: items, error } = await query;
        if (error) { console.error(error); return; }

        container.innerHTML = '';

        const filteredItems = items.filter(item => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            const inTags = item.tags ? item.tags.some(t => t.toLowerCase().includes(q)) : false;
            return item.title.toLowerCase().includes(q) || item.location.toLowerCase().includes(q) || inTags;
        });

        if (filteredItems.length === 0) {
            container.innerHTML = '<p style="text-align:center; color:#888; grid-column:span 2;">No active items found.</p>';
            return;
        }

        filteredItems.forEach(item => {
            const card = document.createElement('div');
            card.className = 'item-card';
            card.onclick = () => openDetailModal(item);
            
            const imgUrl = item.image_url || 'https://placehold.co/400x300/e0e0e0/888?text=No+Image';
            let tagsHtml = (item.tags || []).map(t => `<span class="mini-tag">#${t}</span>`).join('');

            card.innerHTML = `
                <img src="${imgUrl}" class="card-img">
                <div class="card-body">
                    <span class="tag ${item.type}">${item.type}</span>
                    <h4 class="card-title">${item.title}</h4>
                    <div class="card-meta"><i class="ri-map-pin-line"></i> ${item.location}</div>
                    <div class="card-meta"><i class="ri-calendar-line"></i> ${item.date_incident}</div>
                    <div class="tags-row">${tagsHtml}</div>
                </div>
            `;
            container.appendChild(card);
        });
    }

    // --- 5. DETAIL MODAL (UPDATED FOR ADMIN) ---
    window.openDetailModal = async function(item) {
        const modal = document.getElementById('detail-modal');
        modal.classList.add('active');

        document.getElementById('detail-img').src = item.image_url || 'https://placehold.co/600x400';
            document.getElementById('detail-img').style.cursor = 'zoom-in';
                document.getElementById('detail-img').onclick = function() {
                document.getElementById('lightbox-img').src = this.src;
                document.getElementById('lightbox-modal').classList.add('active');
                    };
        document.getElementById('detail-type').className = `detail-type tag ${item.type}`;
        document.getElementById('detail-type').innerText = item.type;
        document.getElementById('detail-title').innerText = item.title;
        document.getElementById('detail-location').innerText = item.location;
        document.getElementById('detail-date').innerText = item.date_incident;
        document.getElementById('detail-desc').innerText = item.description;
        document.getElementById('detail-tags').innerHTML = (item.tags || []).map(t => `<span class="mini-tag">#${t}</span>`).join('');

        const actionContainer = document.getElementById('detail-actions');
        actionContainer.innerHTML = ''; 

        let fbLink = null;
        const { data: uploader } = await supabase.from('profiles').select('facebook_link').eq('id', item.user_id).single();
        if (uploader) fbLink = uploader.facebook_link;

        const isOwner = currentUser.id === item.user_id;
        const isAdmin = currentProfile && currentProfile.role === 'ADMIN';

        // IF OWNER -> SHOW EDIT/SOLVED
        if (isOwner) {
            const row = document.createElement('div');
            row.className = 'btn-row';

            const editBtn = document.createElement('button');
            editBtn.className = 'btn-submit btn-warning';
            editBtn.style.marginTop = '0';
            editBtn.innerHTML = '<i class="ri-pencil-line"></i> Edit';
            editBtn.onclick = () => fillEditForm(item);

            const solveBtn = document.createElement('button');
            solveBtn.className = 'btn-submit';
            solveBtn.style.marginTop = '0';
            solveBtn.innerHTML = '✅ Solved';
            solveBtn.onclick = () => markAsSolved(item.id);

            row.appendChild(editBtn);
            row.appendChild(solveBtn);
            actionContainer.appendChild(row);
        } 
        
        // IF NOT OWNER -> SHOW CONTACT BTN
        if (!isOwner) {
            const btnText = item.type === 'FOUND' ? 'Claim This Item' : 'I Found This';
            
            const notifBtn = document.createElement('button');
            notifBtn.className = 'btn-submit';
            notifBtn.innerHTML = `👋 ${btnText}`;
            notifBtn.onclick = () => openMessageModal(item.user_id, item.id);
            actionContainer.appendChild(notifBtn);

            if (fbLink) {
                const fbBtn = document.createElement('a');
                fbBtn.className = 'btn-facebook';
                fbBtn.href = fbLink;
                fbBtn.target = '_blank';
                fbBtn.innerHTML = '<i class="ri-facebook-circle-fill"></i> Contact on Facebook';
                actionContainer.appendChild(fbBtn);
            }
        }

        // --- ADMIN BUTTON (Appears for both Owner and Non-Owner) ---
        if (isAdmin) {
            const adminBtn = document.createElement('button');
            adminBtn.className = 'btn-submit';
            adminBtn.style.backgroundColor = '#ff4757'; 
            adminBtn.style.marginTop = '10px';
            adminBtn.innerHTML = '<i class="ri-delete-bin-line"></i> FORCE DELETE (Admin)';
            adminBtn.onclick = () => adminForceDelete(item.id);
            actionContainer.appendChild(adminBtn);
        }
    };

    window.adminForceDelete = function(itemId) {
        window.showConfirm("ADMIN WARNING: This will permanently delete this item. Are you sure?", async () => {
            const { error } = await supabase.from('items').delete().eq('id', itemId);

            if (error) {
                window.showAlert("Error", "Delete failed: " + error.message);
            } else {
                closeModal('detail-modal');
                fetchItems('ALL');
                updateStats();
                window.showAlert("Success", "Item permanently deleted by Admin.");
            }
        });
    };

    window.fillEditForm = function(item) {
        closeModal('detail-modal');
        document.getElementById('report-modal').classList.add('active');

        document.getElementById('modal-title').innerText = "Edit Item";
        document.getElementById('form-submit-btn').innerText = "Update Item";
        document.getElementById('photo-label-extra').innerText = "(Leave empty to keep current photo)";

        document.getElementById('post-type').value = item.type;
        document.getElementById('edit-item-id').value = item.id; 
        document.getElementById('existing-image-url').value = item.image_url || ''; 

        document.getElementById('item-title').value = item.title;
        document.getElementById('item-location').value = item.location;
        document.getElementById('item-date').value = item.date_incident;
        document.getElementById('item-tags').value = (item.tags || []).join(', ');
        document.getElementById('item-desc').value = item.description;
        document.getElementById('item-image').value = ""; 
    };

    // --- 6. MESSAGING & SOLVED LOGIC ---
    window.openMessageModal = function(ownerId, itemId) {
        const msgModal = document.getElementById('message-modal');
        const sendBtn = document.getElementById('send-msg-btn');
        const msgInput = document.getElementById('message-input');
        
        msgInput.value = ""; 
        msgModal.classList.add('active');

        const newBtn = sendBtn.cloneNode(true);
        sendBtn.parentNode.replaceChild(newBtn, sendBtn);

        newBtn.addEventListener('click', async () => {
            const message = msgInput.value;
            if(!message) {
                window.showAlert("Error", "Please write a message.");
                return;
            }

            const { data: existing } = await supabase.from('notifications')
                .select('id')
                .eq('item_id', itemId)
                .eq('from_user_id', currentUser.id)
                .single();

            if (existing) {
                window.showAlert("Notice", "You have already sent a message for this item.");
                msgModal.classList.remove('active');
                return;
            }

            newBtn.innerText = "Sending...";
            newBtn.disabled = true;

            const { error } = await supabase.from('notifications').insert({
                item_id: itemId, from_user_id: currentUser.id, to_user_id: ownerId, message: message
            });

            newBtn.innerText = "Send Message";
            newBtn.disabled = false;

            if (error) {
                window.showAlert("Error", error.message);
            } else {
                msgModal.classList.remove('active');
                window.showAlert("Success", "Message sent to the user!");
            }
        });
    };

    window.markAsSolved = function(itemId) {
        window.showConfirm("Mark this item as solved? It will be removed from the feed.", async () => {
            const { error } = await supabase.from('items').update({ 
                status: 'SOLVED',
                solved_at: new Date().toISOString() 
            }).eq('id', itemId);

            if (error) {
                console.error(error);
                window.showAlert("Error", "Could not update item.");
                return;
            }

            closeModal('detail-modal');
            fetchItems('ALL');
            updateStats();
            window.showAlert("Success", "Item solved! It will be deleted in 60 days.");
        });
    };

    // --- 7. NOTIFICATIONS ---
    window.toggleNotifications = function() {
        document.getElementById('notif-modal').classList.add('active');
        fetchNotifications();
    };

    async function fetchNotifications() {
        const list = document.getElementById('notif-list');
        const badge = document.getElementById('notif-badge');
        
        const { data: notifs, error } = await supabase.from('notifications')
            .select('*, items(*)')
            .eq('to_user_id', currentUser.id)
            .order('created_at', {ascending:false});

        if(error || !notifs || notifs.length === 0) {
            list.innerHTML = '<p style="color:#888">No notifications yet.</p>';
            return;
        }

        const senderIds = [...new Set(notifs.map(n => n.from_user_id))];
        const { data: senders } = await supabase.from('profiles').select('*').in('id', senderIds);
        const senderMap = {};
        if(senders) senders.forEach(s => senderMap[s.id] = s);

        const unreadCount = notifs.filter(n => !n.is_read).length;
        badge.style.display = unreadCount > 0 ? 'inline-block' : 'none';
        badge.innerText = unreadCount;

        list.innerHTML = notifs.map(n => {
            const sender = senderMap[n.from_user_id] || { full_name: 'Unknown User' };
            const senderName = sender.full_name || "Unknown";
            const nameHtml = `<span class="notif-user-link" onclick="openUserProfile('${n.from_user_id}')">${senderName}</span>`;
            
            return `
                <div class="notif-item ${n.is_read ? 'read' : 'unread'}">
                    <div class="notif-msg">${nameHtml} says: "${n.message}"</div>
                    <small class="notif-time">${new Date(n.created_at).toLocaleDateString()}</small>
                    <div class="notif-actions">
                        <button class="btn-small btn-go" onclick="viewNotifItem('${n.item_id}', '${n.id}')">View Item</button>
                        ${!n.is_read ? `<button class="btn-small btn-read" onclick="markRead('${n.id}')">Mark Read</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // --- NEW: PROFILE SETTINGS LOGIC ---
    window.openProfileSettings = function() {
        if (!currentProfile) return;
        document.getElementById('set-name').value = currentProfile.full_name || '';
        document.getElementById('set-id').value = currentProfile.id_number || '';
        document.getElementById('set-address').value = currentProfile.address || '';
        document.getElementById('set-fb').value = currentProfile.facebook_link || '';
        document.getElementById('settings-modal').classList.add('active');
    };

    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const updates = {
            full_name: document.getElementById('set-name').value,
            id_number: document.getElementById('set-id').value,
            address: document.getElementById('set-address').value,
            facebook_link: document.getElementById('set-fb').value,
            updated_at: new Date()
        };

        const { error } = await supabase.from('profiles').update(updates).eq('id', currentUser.id);

        if (error) {
            window.showAlert("Error", "Could not update profile: " + error.message);
        } else {
            closeModal('settings-modal');
            window.showAlert("Success", "Profile updated successfully!");
            // Refresh local profile data
            const { data: updatedProfile } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
            currentProfile = updatedProfile;
            document.getElementById('nav-name').innerText = currentProfile.full_name;
        }
    });

    window.openUserProfile = async function(userId) {
        const { data: user, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
        if(error || !user) { window.showAlert("Error", "User details could not be loaded."); return; }

        const modal = document.getElementById('user-profile-modal');
        document.getElementById('popup-avatar').src = user.avatar_url || 'https://via.placeholder.com/100';
        document.getElementById('popup-name').innerText = user.full_name || "Unknown User";
        document.getElementById('popup-role').innerText = user.role || "User"; 
        document.getElementById('popup-id').innerText = `ID: ${user.id_number || 'N/A'}`; 
        document.getElementById('popup-address').innerText = user.address || 'Address Hidden'; 
        
        const fbBtn = document.getElementById('popup-fb');
        if (user.facebook_link) {
            fbBtn.href = user.facebook_link;
            fbBtn.style.display = 'flex';
        } else {
            fbBtn.style.display = 'none';
        }
        modal.classList.add('active');
    };

    window.viewNotifItem = async function(itemId, notifId) {
        await markRead(notifId);
        const { data: item } = await supabase.from('items').select('*').eq('id', itemId).single();
        if(item) {
            closeModal('notif-modal');
            openDetailModal(item);
        } else {
            window.showAlert("Info", "This item has been deleted or solved.");
        }
    };

    window.markRead = async function(notifId) {
        await supabase.from('notifications').update({ is_read: true }).eq('id', notifId);
        fetchNotifications();
    };

    // --- 8. POST FORM ---
    const reportForm = document.getElementById('report-form');
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('form-submit-btn');
            const originalBtnText = btn.innerText; 
            
            const editId = document.getElementById('edit-item-id').value;
            const isEdit = !!editId;

            btn.innerText = isEdit ? "Updating..." : "Uploading..."; 
            btn.disabled = true;

            try {
                const fileInput = document.getElementById('item-image');
                const file = fileInput.files[0];
                let imgUrl = isEdit ? document.getElementById('existing-image-url').value : null; 

                if (file) {
                    const limit = 2 * 1024 * 1024; // 2MB
                    if (file.size > limit) throw new Error("File is too big! Max 2MB.");
                    
                    const fileName = `img_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
                    const { error: uploadError } = await supabase.storage.from('item_images').upload(fileName, file);
                    if (uploadError) throw uploadError;

                    const { data } = supabase.storage.from('item_images').getPublicUrl(fileName);
                    imgUrl = data.publicUrl;
                }

                const tagsArr = document.getElementById('item-tags').value.split(',').map(t=>t.trim()).filter(t=>t);
                
                const itemData = {
                    title: document.getElementById('item-title').value,
                    location: document.getElementById('item-location').value,
                    date_incident: document.getElementById('item-date').value,
                    description: document.getElementById('item-desc').value,
                    type: document.getElementById('post-type').value,
                    tags: tagsArr,
                    image_url: imgUrl
                };

                let error;
                if (isEdit) {
                    const { error: updateError } = await supabase.from('items').update(itemData).eq('id', editId);
                    error = updateError;
                } else {
                    itemData.user_id = currentUser.id;
                    itemData.status = 'OPEN';
                    const { error: insertError } = await supabase.from('items').insert(itemData);
                    error = insertError;
                }

                if (error) throw error;
                
                closeModal('report-modal');
                reportForm.reset();
                window.showAlert("Success", isEdit ? "Item Updated Successfully!" : "Item Posted Successfully!");
                fetchItems('ALL');
                updateStats();

            } catch (err) { 
                window.showAlert("Error", err.message); 
            } finally { 
                btn.innerText = originalBtnText;
                btn.disabled = false; 
            }
        });
    }

    // UTILS
    window.openModal = function(type) {
        document.getElementById('report-form').reset();
        document.getElementById('edit-item-id').value = ""; 
        document.getElementById('existing-image-url').value = "";
        document.getElementById('modal-title').innerText = type === 'LOST' ? 'Report Lost Item' : 'Report Found Item';
        document.getElementById('form-submit-btn').innerText = "Submit Report";
        document.getElementById('photo-label-extra').innerText = "";
        
        document.getElementById('report-modal').classList.add('active');
        document.getElementById('post-type').value = type;
    };
    
    window.closeModal = function(id) { document.getElementById(id).classList.remove('active'); };

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