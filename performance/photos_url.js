export const SettingsUI = {
    apiUrl: 'https://script.google.com/macros/s/AKfycbyYZUIxt7bVFdOkeBWGzxeloIGK0uOkCtlnn9f0RxAT4ZgJEiVDthT7wW4qKa6yZDw3yw/exec', 
    
    cache: { dispatchers: {}, teams: {} },

    init: async function() {
        try {
            const refreshUrl = this.apiUrl + (this.apiUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
            const res = await fetch(refreshUrl);
            const data = await res.json();
            this.cache = data || { dispatchers: {}, teams: {} };
        } catch(e) {
            console.error("Error loading photos settings:", e);
            this.cache = { dispatchers: {}, teams: {} };
        }
    },

    getDispatcherPhoto: function(name) {
        if (!name) return null;
        const key = name.trim().toLowerCase();
        return this.cache.dispatchers ? this.cache.dispatchers[key] : null;
    },

    getTeamLogo: function(team) {
        if (!team) return null;
        const key = team.trim().toLowerCase();
        return this.cache.teams ? this.cache.teams[key] : null;
    },

    saveDispatcherPhoto: async function(name, url) {
        const key = name.trim().toLowerCase();
        if(!this.cache.dispatchers) this.cache.dispatchers = {};
        this.cache.dispatchers[key] = url; 
        await this.sendToSheet(key, url, 'dispatcher');
    },

    saveTeamLogo: async function(team, url) {
        const key = team.trim().toLowerCase();
        if(!this.cache.teams) this.cache.teams = {};
        this.cache.teams[key] = url;
        await this.sendToSheet(key, url, 'team');
    },

    sendToSheet: async function(key, value, type) {
        try {
            await fetch(this.apiUrl, {
                method: 'POST',
                mode: 'no-cors', 
                headers: { 'Content-Type': 'text/plain' }, 
                body: JSON.stringify({ key: key, value: value, type: type })
            });
        } catch(e) {
            console.error("Error saving to sheet:", e);
        }
    },

    openSettingsModal: function(allDispatcherNames, allTeamNames, callback) {
        let existing = document.getElementById('settings-ui-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'settings-ui-modal';
        modal.className = 'dsp-modal-overlay open';
        modal.innerHTML = `
            <div class="dsp-modal-content" style="width: 500px; height: auto; max-height: 90vh; padding: 25px; overflow: visible; background: #111827; border: 1px solid #374151;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:25px; border-bottom:1px solid #374151; padding-bottom:10px;">
                    <h2 style="color:#fff; font-size:18px; font-weight:800; text-transform:uppercase;">Photos Settings</h2>
                    <button id="close-settings-ui" style="background:none; border:none; color:#9ca3af; font-size:24px; cursor:pointer;">&times;</button>
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display:block; color:#9ca3af; font-size:11px; font-weight:700; text-transform:uppercase; margin-bottom:5px;">1. Select Type</label>
                    <select id="settings-type-select" style="width:100%; background:#1f2937; border:1px solid #4b5563; color:#fff; padding:10px; border-radius:4px; font-weight:600;">
                        <option value="dispatcher">Dispatcher Photo</option>
                        <option value="team">Team Logo</option>
                    </select>
                </div>

                <div style="margin-bottom: 20px; position: relative;">
                    <label style="display:block; color:#9ca3af; font-size:11px; font-weight:700; text-transform:uppercase; margin-bottom:5px;">2. Name / Team</label>
                    <input type="text" id="settings-search-input" placeholder="Start typing name..." style="width:100%; background:#1f2937; border:1px solid #4b5563; color:#fff; padding:10px; border-radius:4px; font-weight:600;" autocomplete="off">
                    <div id="settings-search-results" style="position:absolute; top:100%; left:0; width:100%; background:#1f2937; border:1px solid #4b5563; max-height:150px; overflow-y:auto; z-index:100; display:none;"></div>
                </div>

                <div id="settings-url-group" style="margin-bottom: 25px;">
                    <label style="display:block; color:#9ca3af; font-size:11px; font-weight:700; text-transform:uppercase; margin-bottom:5px;">3. Image URL</label>
                    <input type="text" id="settings-url-input" placeholder="Paste image URL here..." style="width:100%; background:#1f2937; border:1px solid #4b5563; color:#fff; padding:10px; border-radius:4px; font-family:monospace;">
                    <div style="font-size:10px; color:#6b7280; margin-top:5px;">Leave empty to reset to default.</div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #374151; padding-top:20px;">
                    <button id="settings-save-btn" style="background:#009088; color:#fff; border:none; padding:10px 20px; border-radius:4px; font-weight:700; cursor:pointer; text-transform:uppercase; opacity:0.5; pointer-events:none; transition:all 0.2s;">Save Changes</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const typeSelect = document.getElementById('settings-type-select');
        const searchInput = document.getElementById('settings-search-input');
        const resultsDiv = document.getElementById('settings-search-results');
        const urlInput = document.getElementById('settings-url-input');
        const saveBtn = document.getElementById('settings-save-btn');
        const closeBtn = document.getElementById('close-settings-ui');

        let selectedItem = null;

        closeBtn.onclick = () => modal.remove();
        modal.onclick = (e) => { if(e.target === modal) modal.remove(); };

        const checkSave = () => {
            if (searchInput.value.trim().length > 0) {
                saveBtn.style.opacity = '1';
                saveBtn.style.pointerEvents = 'auto';
            } else {
                saveBtn.style.opacity = '0.5';
                saveBtn.style.pointerEvents = 'none';
            }
        };

        typeSelect.onchange = () => {
            selectedItem = null;
            searchInput.value = '';
            urlInput.value = '';
            resultsDiv.style.display = 'none';
            checkSave();
        };

        searchInput.oninput = (e) => {
            const val = e.target.value;
            selectedItem = val;
            
            resultsDiv.innerHTML = '';
            if (val.length < 1) {
                resultsDiv.style.display = 'none';
                checkSave();
                return;
            }

            const list = typeSelect.value === 'dispatcher' ? allDispatcherNames : allTeamNames;
            const matches = list.filter(item => item.toLowerCase().includes(val.toLowerCase()));

            if (matches.length > 0) {
                resultsDiv.style.display = 'block';
                matches.forEach(item => {
                    const div = document.createElement('div');
                    div.style.padding = '8px 12px';
                    div.style.cursor = 'pointer';
                    div.style.color = '#d1d5db';
                    div.style.borderBottom = '1px solid #374151';
                    div.onmouseover = () => div.style.background = '#374151';
                    div.onmouseout = () => div.style.background = 'transparent';
                    div.textContent = item;
                    div.onclick = () => {
                        selectedItem = item;
                        searchInput.value = item;
                        resultsDiv.style.display = 'none';
                        const existing = typeSelect.value === 'dispatcher' ? this.getDispatcherPhoto(item) : this.getTeamLogo(item);
                        urlInput.value = existing || '';
                        checkSave();
                    };
                    resultsDiv.appendChild(div);
                });
            } else {
                resultsDiv.style.display = 'none';
            }
            checkSave();
        };

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !resultsDiv.contains(e.target)) {
                resultsDiv.style.display = 'none';
            }
        });

        urlInput.oninput = () => {
            checkSave();
        };

        saveBtn.onclick = async () => {
            if (!selectedItem) selectedItem = searchInput.value.trim();
            if (!selectedItem) return;
            
            const url = urlInput.value.trim();
            
            const originalText = saveBtn.textContent;
            saveBtn.textContent = 'SAVING...';
            saveBtn.style.opacity = '0.7';
            
            if (typeSelect.value === 'dispatcher') {
                await this.saveDispatcherPhoto(selectedItem, url);
            } else {
                await this.saveTeamLogo(selectedItem, url);
            }
            
            saveBtn.textContent = 'SAVED!';
            setTimeout(() => {
                modal.remove();
                if (callback) callback();
            }, 500);
        };
    }
};