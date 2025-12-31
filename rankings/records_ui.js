import { appState } from '../state.js';

// --- ICONS (Defined at top to prevent ReferenceError) ---
const iMoney = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05 1.18 1.42 2.61 1.42 1.62 0 2.93-.59 2.93-1.83 0-1.01-.96-1.6-2.45-1.95l-1.06-.25c-1.94-.46-3.26-1.49-3.26-3.21 0-1.72 1.34-2.87 2.89-3.28V4h2.67v1.88c1.71.39 2.91 1.49 2.96 3.12h-1.95c-.15-.81-1.12-1.39-2.67-1.39-1.48 0-2.61.59-2.61 1.67 0 .96 1.02 1.5 2.51 1.85l1.09.26c2.08.5 3.32 1.52 3.32 3.25 0 1.91-1.67 3.06-3.22 3.35z"/></svg>`;
const iTruck = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5-1.5-.67 1.5-1.5 1.5z"/></svg>`;
const iChart = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>`;
const iMap = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z"/></svg>`;


// --- NOTIFICATION POPUP (Small Toast) ---
export const renderNewRecordPopup = () => {
    let popup = document.getElementById('hof-notification-popup');
    if (popup) popup.remove(); 

    const { isFirstTime, newRecordKeys } = appState.hallOfFameUpdates;
    if (!isFirstTime && newRecordKeys.length === 0) return;

    popup = document.createElement('div');
    popup.id = 'hof-notification-popup';
    
    // Removed scale transform, kept full size container
    popup.className = 'fixed bottom-6 right-6 z-[400] w-96 bg-gray-900/95 backdrop-blur-xl border border-yellow-500/20 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden transform transition-all duration-500 hover:-translate-y-1 animate-fade-in-up group ring-1 ring-white/10';

    let title, message, btnText, subtext;

    if (isFirstTime) {
        title = "Hall of Fame Unlocked";
        message = "Now tracking all-time company records for gross, margins, and regional highs.";
        subtext = "Who holds the crown?";
        btnText = "Explore Records";
    } else {
        const count = newRecordKeys.length;
        title = "New Record Set!";
        message = `${count} new record${count > 1 ? 's' : ''} broken since your last visit.`;
        subtext = "History rewritten.";
        btnText = "See Who Won";
    }

    popup.innerHTML = `
        <div class="absolute top-0 right-0 -mt-12 -mr-12 w-40 h-40 bg-yellow-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-yellow-500/20 transition-colors duration-700"></div>
        <div class="relative p-5">
            <div class="flex items-start gap-4">
                <div class="flex-shrink-0 pt-1">
                    <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-400 to-yellow-600 flex items-center justify-center shadow-lg shadow-yellow-500/20 border border-yellow-300/20 text-black">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 00-.584.859 6.753 6.753 0 006.138 5.6 6.73 6.73 0 002.743 1.346A6.707 6.707 0 019.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 00-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 00.75-.75 2.25 2.25 0 00-2.25-2.25h-.75v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 01-1.112-3.173 6.73 6.73 0 002.743-1.347 6.753 6.753 0 006.139-5.6.75.75 0 00-.585-.858 47.077 47.077 0 00-3.07-.543V2.62a.75.75 0 00-.658-.744 49.22 49.22 0 00-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 00-.657.744zm0 2.629c0 1.196.312 2.32.857 3.294A5.266 5.266 0 013.16 5.337a45.6 45.6 0 012.006-.343v.256zm13.5 0v-.256c.674.1 1.343.214 2.006.343a5.265 5.265 0 01-2.863 3.207 6.72 6.72 0 00.857-3.294z" clip-rule="evenodd" /></svg>
                    </div>
                </div>
                <div class="flex-grow min-w-0">
                    <h3 class="text-white font-bold text-lg leading-tight tracking-tight">${title}</h3>
                    <p class="text-yellow-400/90 text-xs font-bold uppercase tracking-wide mt-1">${subtext}</p>
                    <p class="text-gray-400 text-sm mt-2 leading-relaxed">${message}</p>
                </div>
                <button id="hof-popup-close" class="text-gray-500 hover:text-white transition-colors -mt-1 -mr-1 p-1"><svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            <div class="mt-5 pt-4 border-t border-white/5 flex justify-end">
                <button id="hof-popup-action" class="group relative px-5 py-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 text-gray-900 text-sm font-bold rounded-lg transition-all shadow-lg hover:shadow-yellow-500/25 flex items-center gap-2 overflow-hidden ring-1 ring-white/20">
                    <span class="relative z-10">${btnText}</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 relative z-10 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(popup);
    document.getElementById('hof-popup-action').onclick = () => { popup.remove(); appState.isRecordsModalOpen = true; import('../rankings/records_api.js').then(mod => mod.commitSeenRecords()); renderRecordsModal(); };
    document.getElementById('hof-popup-close').onclick = () => { popup.remove(); import('../rankings/records_api.js').then(mod => mod.commitSeenRecords()); };
};

// --- MAIN HALL OF FAME MODAL ---
export const renderRecordsModal = () => {
    let modal = document.getElementById('records-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'records-modal';
        modal.className = 'fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[300] p-4 hidden transition-opacity duration-300';
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) window.closeRecordsModal(); });
    }
    
    if (appState.isRecordsModalOpen) modal.classList.remove('hidden');
    else { modal.classList.add('hidden'); return; }

    const activeTab = appState.recordsFilter || 'ALL';
    const records = appState.hallOfFameData || {};

    const formatValue = (key, val) => {
        if (val === undefined || val === null) return '-';
        if (key.includes('RPM')) return `$${val.toFixed(2)}`;
        if (key.includes('MILEAGE') || key.includes('MILES')) return `${Math.round(val).toLocaleString()} mi`;
        return `$${Math.round(val).toLocaleString()}`;
    };

    const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString);
        return isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    };

    // --- CARD COMPONENT (Compact Luxury) ---
    const getRecordCard = (title, keySuffix, iconSVG) => {
        let rec = null;
        if (activeTab === 'ALL') {
            const ooRec = records[`OO_${keySuffix}`];
            const looRec = records[`LOO_${keySuffix}`];
            if (ooRec && looRec) rec = (parseFloat(ooRec.record_value) >= parseFloat(looRec.record_value)) ? ooRec : looRec;
            else rec = ooRec || looRec;
        } else {
            rec = records[`${activeTab}_${keySuffix}`];
        }
        
        const valueDisplay = rec ? formatValue(keySuffix, rec.record_value) : '-';
        const holder = (rec && rec.holder_name) ? rec.holder_name : '---';
        const disp = (rec && rec.dispatcher_name) ? rec.dispatcher_name : '---';
        const date = (rec && rec.record_date) ? formatDate(rec.record_date) : '';
        const isNew = rec && appState.hallOfFameUpdates.newRecordKeys.includes(rec.record_key);
        
        const glowColor = isNew ? 'shadow-[0_0_15px_rgba(234,179,8,0.3)] ring-1 ring-yellow-400 border-yellow-500/50' : 'shadow-lg shadow-black/30 border-white/5 hover:border-white/10 hover:shadow-xl hover:-translate-y-0.5';
        const bgGradient = isNew ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gray-800';
        const iconColor = isNew ? 'text-yellow-500' : 'text-gray-700 group-hover:text-gray-600';
        const valueColor = isNew ? 'text-transparent bg-clip-text bg-gradient-to-r from-yellow-200 to-yellow-500 drop-shadow-sm' : 'text-white';
        const labelColor = isNew ? 'text-yellow-500/80' : 'text-gray-500 group-hover:text-gray-400';

        return `
            <div class="relative group ${bgGradient} border rounded-xl p-3 transition-all duration-300 ${glowColor} overflow-hidden h-full flex flex-col justify-between">
                <div class="absolute -right-3 -top-3 ${iconColor} opacity-10 group-hover:opacity-20 transition-opacity duration-500 scale-[2.2] transform rotate-12 origin-top-right pointer-events-none">
                    ${iconSVG}
                </div>
                
                <div class="relative z-10 w-full">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[9px] font-bold uppercase tracking-widest ${labelColor} transition-colors truncate max-w-[85%]">${title}</span>
                        ${isNew ? '<span class="flex h-1.5 w-1.5 rounded-full bg-yellow-500 animate-pulse shadow-[0_0_6px_1px_rgba(234,179,8,0.5)]"></span>' : ''}
                    </div>

                    <div class="text-xl font-black ${valueColor} tracking-tight font-mono mb-0.5">
                        ${valueDisplay}
                    </div>
                    
                    <div class="text-xs text-gray-300 font-bold truncate w-full" title="${holder}">${holder}</div>
                </div>

                <div class="relative z-10 mt-3 pt-2 border-t border-white/5 flex flex-col gap-0.5">
                    <div class="flex justify-between items-center text-[9px] text-gray-500 font-medium">
                         <span class="truncate pr-2 uppercase tracking-wide opacity-70">Driver</span>
                         <span class="text-gray-400 truncate max-w-[60%] text-right" title="${disp}">${disp}</span>
                    </div>
                    <div class="flex justify-between items-center text-[9px] text-gray-500 font-medium">
                         <span class="truncate pr-2 uppercase tracking-wide opacity-70">Date</span>
                         <span class="text-gray-400 whitespace-nowrap">${date}</span>
                    </div>
                </div>
            </div>
        `;
    };

    // --- 3. RENDER MODAL HTML ---
    // Removed scale transform, kept pure layout sizing
    modal.innerHTML = `
        <div class="bg-gray-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-7xl h-[90vh] flex flex-col overflow-hidden relative">
            <div class="absolute top-0 left-0 w-full h-40 bg-gradient-to-b from-gray-800 to-transparent pointer-events-none"></div>

            <div class="relative z-10 flex flex-col md:flex-row justify-between items-center px-8 py-6 border-b border-white/5 backdrop-blur-sm bg-gray-900/50">
                <div class="flex items-center gap-5 mb-4 md:mb-0">
                    <div class="p-3 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-2xl shadow-lg shadow-yellow-500/20 text-black transform rotate-3">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-8 h-8" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 00-.584.859 6.753 6.753 0 006.138 5.6 6.73 6.73 0 002.743 1.346A6.707 6.707 0 019.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 00-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 00.75-.75 2.25 2.25 0 00-2.25-2.25h-.75v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 01-1.112-3.173 6.73 6.73 0 002.743-1.347 6.753 6.753 0 006.139-5.6.75.75 0 00-.585-.858 47.077 47.077 0 00-3.07-.543V2.62a.75.75 0 00-.658-.744 49.22 49.22 0 00-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 00-.657.744zm0 2.629c0 1.196.312 2.32.857 3.294A5.266 5.266 0 013.16 5.337a45.6 45.6 0 012.006-.343v.256zm13.5 0v-.256c.674.1 1.343.214 2.006.343a5.265 5.265 0 01-2.863 3.207 6.72 6.72 0 00.857-3.294z" clip-rule="evenodd" /></svg>
                    </div>
                    <div>
                        <h2 class="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-gray-200 to-gray-500 tracking-tight drop-shadow-sm">Hall of Fame</h2>
                        <p class="text-yellow-500 font-bold text-xs uppercase tracking-[0.2em] mt-1">All-Time Company Records</p>
                    </div>
                </div>
                
                <div class="flex items-center gap-6">
                    <div class="flex bg-black/40 p-1 rounded-xl ring-1 ring-white/10 backdrop-blur-md">
                        <button onclick="window.setRecordsFilter('ALL')" class="px-6 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'ALL' ? 'bg-gray-700 text-white shadow-lg ring-1 ring-white/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}">ALL</button>
                        <div class="w-px h-6 bg-white/10 my-auto mx-1"></div>
                        <button onclick="window.setRecordsFilter('OO')" class="px-6 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'OO' ? 'bg-gray-700 text-white shadow-lg ring-1 ring-white/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}">OO</button>
                        <div class="w-px h-6 bg-white/10 my-auto mx-1"></div>
                        <button onclick="window.setRecordsFilter('LOO')" class="px-6 py-2 text-xs font-bold rounded-lg transition-all ${activeTab === 'LOO' ? 'bg-gray-700 text-white shadow-lg ring-1 ring-white/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}">LOO</button>
                    </div>
                    
                    <button onclick="window.closeRecordsModal()" class="text-gray-500 hover:text-white transition-colors p-3 bg-gray-800 hover:bg-gray-700 rounded-full border border-white/5 hover:border-white/20 shadow-lg">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>

            <div class="overflow-y-auto p-8 md:p-10 flex-grow custom-scrollbar space-y-12 bg-gray-900/50">
                
                <section>
                    <h3 class="text-sm font-bold text-white mb-6 flex items-center gap-3 uppercase tracking-wider opacity-90">
                        <span class="w-1.5 h-6 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.6)]"></span>
                        Per Driver Records (Single Stub)
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                        ${getRecordCard('Highest Driver Gross', 'DRIVER_GROSS', iMoney)}
                        ${getRecordCard('Highest Total Gross', 'TOTAL_GROSS', iMoney)}
                        ${getRecordCard('Highest Margin', 'MARGIN', iMoney)}
                        ${getRecordCard('Highest Mileage', 'MILEAGE', iTruck)}
                        ${getRecordCard('Highest RPM (All)', 'RPM_ALL', iChart)}
                    </div>
                </section>

                <section>
                    <h3 class="text-sm font-bold text-white mb-6 flex items-center gap-3 uppercase tracking-wider opacity-90">
                        <div class="w-8 h-1 bg-gradient-to-r from-purple-500 to-transparent rounded-full"></div>
                        Weekly Team Records (Dispatcher Agg.)
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        ${getRecordCard('Highest Weekly Gross', 'WEEKLY_GROSS', iMoney)}
                        ${getRecordCard('Highest Weekly Margin', 'WEEKLY_MARGIN', iMoney)}
                        ${getRecordCard('Highest Weekly Miles', 'WEEKLY_MILEAGE', iTruck)}
                        ${getRecordCard('Best Weekly RPM (All)', 'WEEKLY_RPM_ALL', iChart)}
                    </div>
                </section>

                <section>
                    <h3 class="text-sm font-bold text-white mb-6 flex items-center gap-3 uppercase tracking-wider opacity-90">
                        <span class="w-1.5 h-6 bg-green-500 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.6)]"></span>
                        Individual Load Records
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-10">
                        ${getRecordCard('Highest Rate Load', 'LOAD_RATE', iMoney)}
                        ${getRecordCard('Highest Margin Load', 'LOAD_MARGIN', iMoney)}
                    </div>
                    
                    <div class="grid grid-cols-1 xl:grid-cols-2 gap-10">
                        <div>
                            <h4 class="text-[10px] font-bold text-gray-500 uppercase mb-4 tracking-widest pl-1 border-b border-white/5 pb-2">Regional Highs (Rate)</h4>
                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                ${getRecordCard('Northeast', 'REGION_RATE_NORTHEAST', iMap)}
                                ${getRecordCard('Southeast', 'REGION_RATE_SOUTHEAST', iMap)}
                                ${getRecordCard('Midwest', 'REGION_RATE_MIDWEST', iMap)}
                                ${getRecordCard('South', 'REGION_RATE_SOUTH', iMap)}
                                ${getRecordCard('West', 'REGION_RATE_WEST', iMap)}
                                ${getRecordCard('Mtn West', 'REGION_RATE_MOUNTAIN_WEST', iMap)}
                            </div>
                        </div>
                        
                        <div>
                            <h4 class="text-[10px] font-bold text-gray-500 uppercase mb-4 tracking-widest pl-1 border-b border-white/5 pb-2">Regional Highs (Margin)</h4>
                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                ${getRecordCard('Northeast', 'REGION_MARGIN_NORTHEAST', iMap)}
                                ${getRecordCard('Southeast', 'REGION_MARGIN_SOUTHEAST', iMap)}
                                ${getRecordCard('Midwest', 'REGION_MARGIN_MIDWEST', iMap)}
                                ${getRecordCard('South', 'REGION_MARGIN_SOUTH', iMap)}
                                ${getRecordCard('West', 'REGION_MARGIN_WEST', iMap)}
                                ${getRecordCard('Mtn West', 'REGION_MARGIN_MOUNTAIN_WEST', iMap)}
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    `;
};

window.closeRecordsModal = () => {
    appState.isRecordsModalOpen = false;
    import('../rankings/records_api.js').then(mod => mod.commitSeenRecords());
    renderRecordsModal();
};

window.setRecordsFilter = (filter) => {
    appState.recordsFilter = filter;
    renderRecordsModal();
};
