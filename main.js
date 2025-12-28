import { startTimer, fetchWithRetry } from './utils.js';
import { HISTORICAL_STUBS_URLS, DRIVER_COUNT_LIVE_URL, CONTRACT_STATUS_URL, SETTINGS_APPS_SCRIPT_URL, OVERDUE_LOADS_URL } from './config.js';
import { renderLoadsAnalyticsUI, initializeAnalyticsEventListeners } from './loads/loads_ui.js';
import { appState, allColumns, setDraggedColumnId, setDraggedViewName } from './state.js';
import { generateAllColumns } from './config.js';
import { renderTeamProfileUI, precomputeGlobalDriverStats } from './profiles/profiles_ui.js';
import { fetchProfileData } from './profiles/profiles_api.js';
import { hasPermission, PERMISSIONS } from './permissions.js';
import {
    fetchAllHistoricalData,
    processDataForMode,
    getOrComputeHistoricalMetrics
} from './rankings/rankings_api.js';
import {
    renderUI,
    renderRefreshStatus,
    renderViewDropdown,
    populateDateDropdown,
    handleCloseEntityModal,
    handleCloseMainCriteriaModal,
    handleCloseDisplaySettingsModal,
    handleClosePerformanceTrackerSettingsModal,
    saveView,
    loadDefaultView,
    updateDynamicTitles,
    updateDriverTypeSwitcherUI,
    requestStubsSort,
    renderModalContent,
    handleHistoricalMovementRowClick
} from './rankings/rankings_ui.js';
import { updateHallOfFameFromSession, fetchHallOfFame, checkForNewRecords } from './rankings/records_api.js';
import { renderRecordsModal, renderNewRecordPopup } from './rankings/records_ui.js';
import { login, validateSession, logout, isAdmin, hasLoadsAccess, canViewSnapshot } from './auth.js';
import { renderAdminPanel } from './admin.js';
import { renderDelegationUI } from './delegation/delegation_ui.js'; // Only one occurrence

let dataPromise;

async function fetchFleetHealthSettings() {
    try {
        const response = await fetchWithRetry(SETTINGS_APPS_SCRIPT_URL);
        const settings = await response.json();
        if (settings.error) {
            throw new Error(settings.error);
        }

        // Deep merge the rules from the sheet into the flag designs
        const mergedFlags = { ...appState.profiles.driverHealthSettings.flags };
        for (const flagKey in settings.driverHealthSettings.rules) {
            if (mergedFlags[flagKey]) {
                // This combines the design from the frontend with the rules from the sheet
                mergedFlags[flagKey] = { ...mergedFlags[flagKey], ...settings.driverHealthSettings.rules[flagKey] };
            }
        }

        // Update the app state with the merged and fetched data
        appState.profiles.complianceSettings = settings.complianceSettings;
        appState.profiles.driverHealthSettings.weights = settings.driverHealthSettings.weights;
        appState.profiles.driverHealthSettings.flags = mergedFlags; // <-- Use the merged flags
        appState.profiles.thresholdSettings = settings.thresholdSettings;

        console.log('[REFRESH] ✅ Fleet Health Settings loaded and merged.');
    } catch (e) {
        console.error("Could not fetch/merge fleet health settings, using frontend defaults:", e);
    }
}


const updateProgressBar = (percentage) => {
    const progressBar = document.getElementById('loading-progress-bar');
    const finalPercentage = Math.min(100, Math.round(percentage));

    if (progressBar) {
        progressBar.style.width = `${finalPercentage}%`;
    }
};

document.getElementById('historical-movement-container')?.addEventListener('click', (e) => {
    const row = e.target.closest('tr');
    if (row && row.parentElement.tagName === 'TBODY') { // ensure it's a body row
        const dateCell = row.querySelector('.hm-date-cell');
        if (dateCell) {
            const date = new Date(dateCell.textContent).toISOString().split('T')[0];
            // We use the globally selected dispatchers for the bump chart
            handleHistoricalMovementRowClick(appState.selectedBumpEntities.slice(0, 3), date);
        }
    }
});

const refreshData = async (isInitialLoad = false) => {
    console.log(`%c[REFRESH] Starting data refresh (Initial Load: ${isInitialLoad})...`, 'color: cyan');
    if (isInitialLoad) {
        updateProgressBar(5); // Start with a small amount of progress
    }
    if (!isInitialLoad) {
        appState.isRefreshing = true;
        renderRefreshStatus();
    }

    try {
        console.log('[REFRESH] Kicking off parallel data fetches...');
        const dataFetchTimer = startTimer('All Data Fetching (Parallel)');
        
        let loadedCount = 0;
        const totalFetches = 7; // Updated count
        const updateProgress = () => {
            loadedCount++;
            const percentage = 5 + (loadedCount / totalFetches) * 90;
            updateProgressBar(percentage);
        };

        const historicalTimer = startTimer('fetchAllHistoricalData');
        const profileTimer = startTimer('fetchProfileData');
        const stubsTimer = startTimer('fetchHistoricalStubs');
        const countsTimer = startTimer('fetchLiveDriverCounts');
        const statusTimer = startTimer('fetchContractStatus');
        const settingsTimer = startTimer('fetchFleetHealthSettings'); // Renamed for clarity
        const overdueTimer = startTimer('fetchOverdueLoads');

        const fetchPromises = [
            fetchProfileData().then(res => { profileTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchProfileData finished.'); return res; }),
            fetchAllHistoricalData().then(res => { historicalTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchAllHistoricalData finished.'); return res; }),
            fetchHistoricalStubs().then(res => { stubsTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchHistoricalStubs finished.'); return res; }),
            fetchLiveDriverCounts().then(res => { countsTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchLiveDriverCounts finished.'); return res; }),
            fetchContractStatus().then(res => { statusTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchContractStatus finished.'); return res; }),
            fetchFleetHealthSettings().then(() => { settingsTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchFleetHealthSettings finished.'); }),
            fetchOverdueLoads().then(() => { overdueTimer.stop(); updateProgress(); console.log('[REFRESH] ✅ fetchOverdueLoads finished.'); }),
            fetchHallOfFame().then(() => { console.log('[REFRESH] ✅ fetchHallOfFame finished.'); }) 
        ];

        await Promise.all(fetchPromises);

        console.log('[REFRESH] All parallel data fetches have completed.');
        dataFetchTimer.stop();

        if (appState.allHistoricalData.length === 0) {
            console.warn("No historical data for the RANKINGS view was found. The Rankings dashboard may be empty, but other sections will work.");
        }

        console.log('[REFRESH] Starting data processing...');
        const processingTimer = startTimer('Data Processing and UI Setup');
        appState.profiles.fleetHealthCache = {};
        appState.precomputationCache = { dispatcher: {}, team: {} };

        if (isInitialLoad) {
            loadDefaultView();
        }
        
        processDataForMode();
        getOrComputeHistoricalMetrics();
        
        // Precompute driver stats (Risk, Contract) for global access
        precomputeGlobalDriverStats();

        const excludedNames = [
            'cletus spuckler',
            'ralph wiggum',
            'seymour skinner',
            'med disp disp'
        ];

        appState.allDispatcherNames = [...new Set(appState.allHistoricalData.map(d => d.dispatcherName).filter(Boolean))]
            .filter(name => !excludedNames.includes(name.toLowerCase()))
            .sort();

        appState.allTeamNames = [...new Set(appState.allHistoricalData.map(d => d.dispatcherTeam).filter(Boolean))]
            .filter(name => !excludedNames.includes(name.toLowerCase()))
            .sort();
        
      
            console.log('[REFRESH] Data processing finished.');
            processingTimer.stop();
            
            // Check for new records after all data is processed
            await updateHallOfFameFromSession(); // Ensure this is awaited if possible, or run check after
            
            // --- NEW: Check for Hall of Fame Updates ---
            checkForNewRecords();
            if (appState.hallOfFameUpdates.hasUnseenChanges) {
                renderNewRecordPopup();
                const btn = document.getElementById('hall-of-fame-btn');
                if (btn) btn.classList.add('animate-glow-gold');
            }
            // -------------------------------------------
    
            appState.lastRefreshed = new Date();
    
        } catch (e) {
        console.error("%c[REFRESH] 🛑 ERROR during data refresh:", 'color: red; font-weight: bold;', e);
        appState.error = "Failed to refresh application data. " + e.message;
        throw e; // Re-throw the error to be caught by initializeApp
    } finally {
        if (isInitialLoad) {
            updateProgressBar(100);
        }
        if (!isInitialLoad) {
            appState.isRefreshing = false;
            renderRefreshStatus();
        }
        
        console.log(`%c[REFRESH] Refresh cycle finished. Re-rendering UI for view: ${appState.currentView}.`, 'color: cyan');
        switch (appState.currentView) {
            case 'rankings':
                renderUI();
                break;
            case 'loads':
                renderLoadsAnalyticsUI();
                initializeAnalyticsEventListeners();
                break;
            case 'fleet-health':
                renderTeamProfileUI();
                break;
        }
    }
};

// --- NEW/MODIFIED: Main Application Flow ---

// --- NEW: Centralized UI Re-rendering ---
function reRenderCurrentView() {
    switch (appState.currentView) {
        case 'rankings':
            renderUI();
            break;
        case 'loads':
            if (hasLoadsAccess()) {
                renderLoadsAnalyticsUI();
                initializeAnalyticsEventListeners();
            }
            break;
        case 'fleet-health':
            renderTeamProfileUI();
            break;
    }
}

// --- MODIFIED: Application Initialization Flow ---
const initializeApp = async () => {
    const appLoadTimer = startTimer('Total App Initialization');
    const fullPageLoader = document.getElementById('full-page-loader');
    const loginCard = document.getElementById('login-card');
    const loaderCard = document.getElementById('loader-card');

    fullPageLoader.classList.remove('hidden');
    initializeParticles(); // <-- ADD THIS LINE BACK
    
    // Start fetching data immediately in the background and store the promise
    dataPromise = refreshData(true);

    // Concurrently, handle authentication
    const user = await validateSession();

    if (user) {
        // User has a valid session
        loaderCard.classList.remove('hidden'); // Show loader card
        loaderCard.style.opacity = '1';
        try {
            await dataPromise; // Wait for the initial data fetch to complete
            finalizeSetup();
        } catch (e) {
            appState.error = "Failed to initialize application data. " + e.message;
            renderUI(); // This will show the main error message inside the app
        }
    } else {
        // No valid session, show login form
        loginCard.classList.remove('hidden');
        // We don't wait for dataPromise here. Let it continue in the background.
    }

    appLoadTimer.stop();
};

function finalizeSetup() {
    const loaderCard = document.getElementById('loader-card');
    const appWrapper = document.getElementById('app-wrapper');

    // Hide loader and show main app
    loaderCard.style.opacity = '0';
    setTimeout(() => {
        appState.loading = false;
        document.getElementById('full-page-loader').classList.add('hidden');
        appWrapper.classList.remove('hidden');

        // Initial setup that happens only once after login
        populateDateDropdown();
        addEventListeners();
        configureUIAccess(); // NEW: Configure UI based on permissions
        renderUI(); // Initial render of the default view
        
        // --- NEW: Trigger Hall of Fame Popup on App Load ---
        checkForNewRecords();
        if (appState.hallOfFameUpdates.hasUnseenChanges) {
            renderNewRecordPopup();
            const btn = document.getElementById('hall-of-fame-btn');
            if (btn) btn.classList.add('animate-glow-gold');
        }
        // ---------------------------------------------------

        window.requestStubsSort = requestStubsSort;
        
        // Set up hourly refresh
        const SIX_HOURS = 6 * 60 * 60 * 1000;
        setInterval(() => refreshData(false), SIX_HOURS);

    }, 500); // Wait for fade-out transition
}


// --- NEW: UI Configuration based on Permissions ---
function configureUIAccess() {
    const user = appState.auth.user;

    // Show/Hide "Loads" menu item
    const loadsMenuItem = document.getElementById('loads-menu-item');
    if (loadsMenuItem) {
        loadsMenuItem.style.display = hasLoadsAccess() ? 'flex' : 'none';
    }

    // Show/Hide "Delegation" menu item
    const delegationMenuItem = document.getElementById('delegation-menu-item');
    if (delegationMenuItem) {
        const hasDelegation = (user?.role === 'Admin') || (user?.permissions?.hasDelegationAccess === true);
        delegationMenuItem.style.display = hasDelegation ? 'flex' : 'none';
    }

    // Show/Hide "Settings" menu item for Admins
    const settingsMenuItem = document.getElementById('settings-menu-item');
    if (settingsMenuItem) {
        settingsMenuItem.style.display = hasPermission(user, PERMISSIONS.MANAGE_USERS) ? 'flex' : 'none';
    }

    // NEW: Show/Hide snapshot button based on role
    const snapshotBtn = document.getElementById('title-snapshot-btn');
    if(snapshotBtn) {
        if (!canViewSnapshot()) {
            snapshotBtn.style.display = 'none';
        }
    }
    
    // Ensure logout button is visible for any logged-in user
    const logoutBtn = document.getElementById('logout-btn');
    if(logoutBtn) {
        logoutBtn.classList.remove('force-hidden');
    }
}


const showForceRefreshPopup = () => {
    const modal = document.getElementById('force-refresh-modal');
    const popupText = document.getElementById('force-refresh-text');
    if (!modal || !popupText) return;

    const nextRefreshDate = new Date(appState.lastRefreshed.getTime() + 6 * 60 * 60 * 1000);
    const timeString = nextRefreshDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    popupText.innerHTML = `
        Next automatic refresh is scheduled for <span class="font-semibold text-teal-400">${timeString}</span>.
        <br><br>
        <span class="text-xs text-yellow-400">Note: Data updates occur twice daily. A force refresh will only pull the latest available data and may not reflect real-time changes.</span>
    `;

    modal.classList.remove('hidden');
    document.getElementById('confirm-force-refresh-btn').onclick = () => { modal.classList.add('hidden'); refreshData(); };
    document.getElementById('cancel-force-refresh-btn').onclick = () => { modal.classList.add('hidden'); };
};

const fetchDataAndRender = () => {
    const renderTimer = startTimer('fetchDataAndRender');
    processDataForMode();
    getOrComputeHistoricalMetrics();
    updateDynamicTitles();
    updateDriverTypeSwitcherUI();
    renderUI();
    renderTimer.stop();
};

const handleSnapshotClick = () => {
    const snapshotBtn = document.getElementById('title-snapshot-btn');
    const tableContainer = document.getElementById('main-table-container');

    if (!tableContainer || !snapshotBtn) {
        console.error('Snapshot target or button not found.');
        return;
    }

    const snapshotWrapper = document.createElement('div');
    snapshotWrapper.style.backgroundColor = '#1f2937'; // gray-800
    snapshotWrapper.style.padding = '40px';
    snapshotWrapper.style.display = 'inline-block'; // Shrink to content

    const titleEl = document.createElement('h2');
    const rankingModeText = appState.rankingMode.charAt(0).toUpperCase() + appState.rankingMode.slice(1);
    const driverTypeText = appState.driverTypeFilter === 'all' ? '' : ` (${appState.driverTypeFilter.toUpperCase()})`;
    titleEl.textContent = `${rankingModeText} Rankings${driverTypeText} for ${appState.selectedDate}`;
    titleEl.style.color = '#e2e8f0';
    titleEl.style.fontSize = '28px';
    titleEl.style.fontWeight = 'bold';
    titleEl.style.textAlign = 'center';
    titleEl.style.marginBottom = '25px';
    snapshotWrapper.appendChild(titleEl);

    const clonedTable = tableContainer.querySelector('table').cloneNode(true);

    if (clonedTable) {
        clonedTable.style.width = 'auto';
        clonedTable.style.borderCollapse = 'collapse';

        // --- Header Styling ---
        clonedTable.querySelectorAll('thead th').forEach(th => {
            th.className = ''; // Remove Tailwind classes
            Object.assign(th.style, {
                padding: '8px 10px', // Reduced from 12px
                borderBottom: '2px solid #4a5568',
                color: '#cbd5e1',
                fontWeight: 'bold',
                textAlign: 'center',
                verticalAlign: 'middle',
                whiteSpace: 'nowrap',
            });
        });

        // --- Body Cell Styling ---
        clonedTable.querySelectorAll('tbody td').forEach(td => {
            td.className = ''; // Remove Tailwind classes
            Object.assign(td.style, {
                padding: '5px 1px', // Reduced from 10px
                borderBottom: '1px solid #374151',
                textAlign: 'center',
                verticalAlign: 'middle',
                whiteSpace: 'nowrap',
                fontSize: '14px',
            });
        });
        
        // --- Alignment Overrides & Zebra Striping ---
        clonedTable.querySelectorAll('tr').forEach((row, rowIndex) => {
            // Left-align the first two columns
            if (row.children[0]) row.children[0].style.textAlign = 'left';
            if (row.children[1]) row.children[1].style.textAlign = 'left';

            // Apply zebra striping to body rows
            if (row.closest('tbody') && rowIndex % 2 === 1) {
                Array.from(row.children).forEach(cell => {
                    cell.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
                });
            }
        });
    }

    snapshotWrapper.appendChild(clonedTable);
    snapshotWrapper.style.position = 'absolute';
    snapshotWrapper.style.left = '-9999px';
    document.body.appendChild(snapshotWrapper);

    const originalContent = snapshotBtn.innerHTML;
    snapshotBtn.innerHTML = `
        <svg class="animate-spin h-6 w-6 text-sky-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
    `;
    snapshotBtn.disabled = true;

    html2canvas(snapshotWrapper, { scale: 2, useCORS: true }).then(canvas => {
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/jpeg', 0.9);
        const today = new Date().toISOString().split('T')[0];
        link.download = `table-snapshot-${today}.jpg`;
        link.click();
    }).catch(err => {
        console.error('Error generating snapshot:', err);
        alert('Sorry, there was an error creating the snapshot.');
    }).finally(() => {
        snapshotBtn.innerHTML = originalContent;
        snapshotBtn.disabled = false;
        document.body.removeChild(snapshotWrapper);
    });
};

// --- Event Listeners and Observers Setup ---

const updateNavActiveState = () => {
    const sidebar = document.getElementById('sidebar');
    const isMinimized = sidebar.classList.contains('minimized');

    document.querySelectorAll('.nav-item.active, .sub-nav-item.active').forEach(item => {
        item.classList.remove('active');
    });

    const currentView = appState.currentView;
    let parentMenuItem = null;

    if (currentView.startsWith('profiles-')) {
        parentMenuItem = document.getElementById('profiles-menu-item');
    } else {
        parentMenuItem = document.getElementById(`${currentView}-menu-item`);
    }
    
    if (parentMenuItem) {
        parentMenuItem.querySelector('.nav-item').classList.add('active');
    }
};


const addEventListeners = () => {
    const sidebar = document.getElementById('sidebar');
    const rankingsMenuItem = document.getElementById('rankings-menu-item');
    const loadsMenuItem = document.getElementById('loads-menu-item');
    const fleetHealthMenuItem = document.getElementById('fleet-health-menu-item');
    const delegationMenuItem = document.getElementById('delegation-menu-item'); 

    const switchView = async (view) => {
        if (view === 'loads' && !hasLoadsAccess()) {
            console.warn("Access to Loads denied.");
            return;
        }
        appState.currentView = view;
        
        // Hide all existing views
        document.getElementById('main-content').classList.add('hidden');
        document.getElementById('key-metrics-overview').classList.add('hidden');
        document.getElementById('loads-analytics-content').classList.add('hidden');
        document.getElementById('profiles-content').classList.add('hidden');
        document.getElementById('delegation-content')?.classList.add('hidden'); // Hide delegation if it exists

        // Snapshot button logic
        const snapshotTrigger = document.getElementById('snapshot-trigger');
        if (snapshotTrigger) { snapshotTrigger.style.display = view === 'fleet-health' ? 'flex' : 'none'; }

        // Render the selected view
        if (view === 'rankings') { 
            document.getElementById('main-content').classList.remove('hidden'); 
            document.getElementById('key-metrics-overview').classList.remove('hidden'); 
            renderUI(); 
        }
        else if (view === 'loads') { 
            document.getElementById('loads-analytics-content').classList.remove('hidden'); 
            setTimeout(() => { renderLoadsAnalyticsUI(); initializeAnalyticsEventListeners(); }, 0); 
        }
        else if (view === 'fleet-health') { 
            document.getElementById('profiles-content').classList.remove('hidden'); 
            renderTeamProfileUI(); 
        }
        else if (view === 'delegation') {
            // Lazy create the container if it doesn't exist yet
            let container = document.getElementById('delegation-content');
            if (!container) {
                container = document.createElement('div');
                container.id = 'delegation-content';
                container.className = 'h-full flex flex-col p-4 overflow-y-auto';
                document.getElementById('app').appendChild(container);
            }
            container.classList.remove('hidden');
            renderDelegationUI();
        }
        
        updateNavActiveState();
        renderRefreshStatus();
    };

    rankingsMenuItem.addEventListener('click', (e) => { e.preventDefault(); switchView('rankings'); });
    loadsMenuItem.addEventListener('click', (e) => { e.preventDefault(); switchView('loads'); });
    fleetHealthMenuItem.addEventListener('click', (e) => { e.preventDefault(); switchView('fleet-health'); });
    if(delegationMenuItem) delegationMenuItem.addEventListener('click', (e) => { e.preventDefault(); switchView('delegation'); }); 

    // NEW: Listeners for Admin Settings and Logout
    const settingsMenuItem = document.getElementById('settings-menu-item');
    const adminModal = document.getElementById('admin-settings-modal');
    if (settingsMenuItem && adminModal) {
        settingsMenuItem.addEventListener('click', (e) => {
            e.preventDefault();
            renderAdminPanel(); // Render the content
            adminModal.classList.remove('hidden'); // Show the modal
        });
    }

    const closeAdminModalBtn = document.getElementById('close-admin-settings-modal-btn');
    if (closeAdminModalBtn && adminModal) {
        closeAdminModalBtn.addEventListener('click', () => {
            adminModal.classList.add('hidden');
        });
    }

    const logoutBtn = document.getElementById('logout-btn');
    const logoutModal = document.getElementById('logout-confirm-modal');
    if (logoutBtn && logoutModal) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logoutModal.classList.remove('hidden');
        });

        document.getElementById('logout-cancel-btn').addEventListener('click', () => {
            logoutModal.classList.add('hidden');
        });

        document.getElementById('logout-confirm-btn').addEventListener('click', async () => {
            // Hide the confirmation modal
            logoutModal.classList.add('hidden');

            // Show the new dedicated logout loader
            document.getElementById('logout-loader').classList.remove('hidden');

            // Call the logout function to clear the session
            await logout();

            // Wait a moment for the UI to update, then reload the page
            setTimeout(() => {
                window.location.reload();
            }, 750); // 750ms delay
        });
    }

    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const redrawAllCharts = async () => {
        const { renderD3BumpChart, renderModalContent } = await import('./rankings/rankings_ui.js');
        const { calculateBumpChartData, getFilteredBumpChartEntityNames } = await import('./rankings/rankings_api.js');

        renderD3BumpChart(calculateBumpChartData(), getFilteredBumpChartEntityNames());
        if (appState.isEntityModalOpen) {
            renderModalContent();
        }
    };
    const debouncedRedraw = debounce(redrawAllCharts, 25);

    const mainContentArea = document.getElementById('main-content-area');
    if (mainContentArea) {
        const resizeObserver = new ResizeObserver(debouncedRedraw);
        resizeObserver.observe(mainContentArea);
    }

    document.getElementById('dispatcher-trend-modal')?.addEventListener('click', (e) => {
        const prevBtn = e.target.closest('#historical-prev-btn');
        const nextBtn = e.target.closest('#historical-next-btn');
        
        if (prevBtn || nextBtn) {
            const direction = prevBtn ? 'prev' : 'next';
            const navState = appState.historicalNavigation;
            if (!navState) return;

            const newIndex = direction === 'prev' ? navState.currentIndex + 1 : navState.currentIndex - 1;
            if (newIndex >= 0 && newIndex < navState.availableDates.length) {
                const newDate = navState.availableDates[newIndex];
                handleHistoricalMovementRowClick(navState.dispatcherNames, newDate);
            }
        }
    });

    document.querySelectorAll('.ranking-mode-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.preventDefault();
            const newMode = e.currentTarget.dataset.mode;
            if (newMode && newMode !== appState.rankingMode) {
                appState.rankingMode = newMode;
                appState.selectedBumpEntities = [];
                appState.sortConfig = { key: 'rank', direction: 'ascending' };
                if (newMode === 'team') {
                    appState.visibleColumns.set('numDispatchers', true);
                }
                fetchDataAndRender();
            }
        });
    });

    document.getElementById('date-selector')?.addEventListener('change', (e) => {
        appState.selectedDate = e.target.value;
        fetchDataAndRender();
    });

    document.getElementById('driver-type-switcher')?.addEventListener('click', (e) => {
        const type = e.target.dataset.type;
        if (type) {
            appState.driverTypeFilter = type;
            fetchDataAndRender();
        }
    });

    document.getElementById('show-low-performers')?.addEventListener('click', () => {
        appState.performanceTrackerView = 'lowPerformers';
        renderUI();
    });

    document.getElementById('show-performance-drops')?.addEventListener('click', () => {
        appState.performanceTrackerView = 'performanceDrops';
        renderUI();
    });

    document.getElementById('show-trending')?.addEventListener('click', () => {
        appState.performanceTrackerView = 'trending';
        renderUI();
    });

    // ⬇️ ADD THIS EVENT LISTENER ⬇️
    document.getElementById('show-historical-movement')?.addEventListener('click', () => {
        appState.performanceTrackerView = 'historicalMovement';
        renderUI();
    });

    document.getElementById('show-alerts')?.addEventListener('click', () => {
        appState.performanceTrackerView = 'alerts';
        renderUI();
    });

    document.getElementById('min-drivers-filter-type')?.addEventListener('change', (e) => {
        appState.minDriverSetting.type = e.target.value;
        renderUI();
    });

    document.getElementById('min-drivers-filter-value')?.addEventListener('input', (e) => {
        appState.minDriverSetting.value = Math.max(0, parseInt(e.target.value, 10) || 0);
    });

    document.getElementById('apply-min-drivers-filter-btn')?.addEventListener('click', () => {
        appState.minDriverSetting.value = Math.max(0, parseInt(document.getElementById('min-drivers-filter-value').value, 10) || 0);
        renderUI();
    });

    document.getElementById('close-dispatcher-modal-btn')?.addEventListener('click', handleCloseEntityModal);
    document.getElementById('close-main-criteria-modal-btn')?.addEventListener('click', handleCloseMainCriteriaModal);
    document.getElementById('close-performance-tracker-modal-btn')?.addEventListener('click', handleClosePerformanceTrackerSettingsModal);
    document.getElementById('toggle-display-settings-btn')?.addEventListener('click', () => {
        appState.isDisplaySettingsModalOpen = true;
        renderUI();
    });
    document.getElementById('close-display-settings-modal-btn')?.addEventListener('click', handleCloseDisplaySettingsModal);

    document.getElementById('performance-tracker-settings-btn')?.addEventListener('click', () => {
        appState.isPerformanceTrackerModalOpen = true;
        renderUI();
    });

    document.getElementById('add-filter-btn')?.addEventListener('click', () => {
        const columnId = document.getElementById('filter-column-select').value;
        const operator = document.getElementById('filter-operator-select').value;
        const value = document.getElementById('filter-value-input').value;
        if (columnId && operator && value) {
            appState.filters.push({ columnId, operator, value });
            document.getElementById('filter-column-select').value = ''; 
            document.getElementById('filter-operator-select').innerHTML = '<option value="">Select Operator</option>'; 
            document.getElementById('filter-value-input').value = ''; 
            renderUI();
        }
    });

    document.getElementById('bump-metric-select')?.addEventListener('change', (e) => {
        appState.bumpMetric = e.target.value;
        renderUI();
    });

    document.getElementById('weeks-back-input')?.addEventListener('input', (e) => {
        appState.weeksBack = Math.max(1, parseInt(e.target.value, 10) || 12);
        renderUI();
    });

    document.getElementById('modal-chart-switcher')?.addEventListener('click', (e) => {
        const view = e.target.dataset.view;
        if (view) {
            appState.entityModalChartView = view;
            renderUI();
        }
    });

    document.getElementById('save-view-btn')?.addEventListener('click', () => {
        const viewNameInput = document.getElementById('save-view-name-input');
        saveView(viewNameInput.value.trim());
        viewNameInput.value = '';
    });

    document.getElementById('title-snapshot-btn')?.addEventListener('click', handleSnapshotClick);

    document.getElementById('sidebar-refresh-status')?.addEventListener('click', () => {
        if (!appState.isRefreshing) {
            showForceRefreshPopup();
        }
    });

    document.getElementById('hall-of-fame-btn')?.addEventListener('click', () => {
        appState.isRecordsModalOpen = true;
        renderRecordsModal();
    });
};


// In 1. DISP TEST/main.js

const initializeParticles = () => {
    if (typeof particlesJS !== 'undefined') {
        particlesJS('particles-js', {
            "particles": {
                "number": { "value": 60, "density": { "enable": true, "value_area": 800 } },
                "color": { "value": "#38bdf8" }, // A nice bluish color
                "shape": { "type": "circle" },
                "opacity": { "value": 0.5, "random": true },
                "size": { "value": 2, "random": true },
                "line_linked": { "enable": false },
                "move": {
                    "enable": true, "speed": 0.4, "direction": "none",
                    "random": true, "straight": false, "out_mode": "out", "bounce": false
                }
            },
            "interactivity": { "detect_on": "canvas", "events": { "onhover": { "enable": false }, "onclick": { "enable": false } } },
            "retina_detect": true
        });
    }
};


// --- UI Interaction Logic ---

const initializeUIEventListeners = () => {
    const loader = document.getElementById('full-page-loader');
    if (loader && !loader.classList.contains('hidden')) {
        const background = document.getElementById('loader-background');
        const cursorDot = document.getElementById('cursor-dot');
        const cursorOutline = document.getElementById('cursor-outline');
        const onMouseMove = (e) => { const { clientX, clientY } = e; if (background) { background.style.setProperty('--mouse-x', `${clientX}px`); background.style.setProperty('--mouse-y', `${clientY}px`); } if (cursorDot) { cursorDot.style.transform = `translate(${clientX}px, ${clientY}px)`; } if (cursorOutline) { cursorOutline.style.transform = `translate(${clientX}px, ${clientY}px)`; } };
        window.addEventListener('mousemove', onMouseMove);
    }

    // --- NEW: Login Form Submission ---
    const loginForm = document.getElementById('login-form');
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const loginButton = document.getElementById('login-button');
        const errorMessage = document.getElementById('login-error-message');

        loginButton.disabled = true;
        loginButton.textContent = 'Signing In...';
        errorMessage.classList.add('hidden');

        try {
            await login(email, password);
            // On successful login, hide login card, show loader, and finalize setup
            document.getElementById('login-card').classList.add('hidden');
            const loaderCard = document.getElementById('loader-card');
            loaderCard.classList.remove('hidden');
            loaderCard.style.opacity = '1';
            
            // FIX: Wait for the ORIGINAL data promise that was started on page load
            await dataPromise;
            finalizeSetup();

        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.classList.remove('hidden');
        } finally {
            loginButton.disabled = false;
            loginButton.textContent = 'Sign In';
        }
    });
    // --- END: New Loader-Specific Logic ---

    // --- NEW: Password Visibility Toggle ---
    const togglePasswordButton = document.getElementById('toggle-password-visibility');
    const passwordInput = document.getElementById('login-password');
    const eyeIcon = document.getElementById('eye-icon');
    const eyeSlashIcon = document.getElementById('eye-slash-icon');

    if (togglePasswordButton && passwordInput && eyeIcon && eyeSlashIcon) {
        // Check if the listener is already attached to prevent duplicates
        if (!togglePasswordButton.listenerAttached) {
            togglePasswordButton.addEventListener('click', () => {
                // Toggle the type attribute
                const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
                passwordInput.setAttribute('type', type);

                // Toggle the icon visibility
                eyeIcon.classList.toggle('hidden');
                eyeSlashIcon.classList.toggle('hidden');
            });
            // Mark the button to indicate listener is attached
            togglePasswordButton.listenerAttached = true;
        }
    }
    // --- END: Password Visibility Toggle ---

    const sidebar = document.getElementById('sidebar');
    const toggleButton = document.getElementById('sidebar-toggle');
    
    if (toggleButton && sidebar) {
        toggleButton.addEventListener('click', () => {
            const isOpen = !sidebar.classList.contains('minimized');
            if (isOpen) {
                document.querySelectorAll('#sidebar li.open').forEach(li => li.classList.remove('open'));
            }
            sidebar.classList.toggle('minimized');
            updateNavActiveState();
        });
    }

    const tips = [
        "'Driver Happiness' combines Net Pay and Miles Driven to reward balance.",
        "Use '4W' columns to track long-term trends, not just weekly changes.",
        "'Company Happiness' tracks cash flow and truck depreciation; high miles don’t always mean better ranking.",
        "Save filters, column visibility, and sorting as a 'View' for quick access.",
        "'Low Performers' spots consistent underperformance, not single bad weeks.",
        "Drag column headers to reorder the table.",
        "'Performance Drops' shows dispatchers falling vs their historical average.",
        "In 'Historical Rank Changes', select dispatchers to compare performance."
    ];
    
    let currentTipIndex = 0;
    const tipTextElement = document.getElementById('loading-tip-text');
    
    // --- NEW: Cursor handling for login card ---
    const loginCardForCursor = document.getElementById('login-card');
    const cursorDot = document.getElementById('cursor-dot');
    const cursorOutline = document.getElementById('cursor-outline');

    if (loginCardForCursor && cursorDot && cursorOutline) {
        loginCardForCursor.addEventListener('mouseenter', () => {
            cursorDot.style.display = 'none';
            cursorOutline.style.display = 'none';
        });

        loginCardForCursor.addEventListener('mouseleave', () => {
            cursorDot.style.display = 'block';
            cursorOutline.style.display = 'block';
        });
    }

    function showNextTip() {
        if (!tipTextElement) return;
        
        tipTextElement.classList.add('tip-fade-exit', 'tip-fade-exit-active');
        
        setTimeout(() => {
            currentTipIndex = (currentTipIndex + 1) % tips.length;
            tipTextElement.textContent = tips[currentTipIndex];
            
            tipTextElement.classList.remove('tip-fade-exit', 'tip-fade-exit-active');
            tipTextElement.classList.add('tip-fade-enter');
            
            requestAnimationFrame(() => {
                tipTextElement.classList.remove('tip-fade-enter');
            });
        }, 450);
    }

    if (tipTextElement) {
        tipTextElement.textContent = tips[currentTipIndex];
        setInterval(showNextTip, 5000);
    }
    
    updateNavActiveState();
};

const fetchHistoricalStubs = async () => {
    try {
        // Use the new fetchWithRetry function for each URL
        const fetchPromises = HISTORICAL_STUBS_URLS.map(url => 
            fetchWithRetry(url).then(res => res.json()) // Use it here
        );

        const results = await Promise.all(fetchPromises);
        let combinedHistoricalData = [];

        for (const result of results) {
            if (result.error) throw new Error(result.error);
            if (result.historicalData) combinedHistoricalData.push(...result.historicalData);
        }
        appState.loads.historicalStubsData = combinedHistoricalData;
    } catch (e) {
        console.error("Error fetching historical stubs from multiple sources:", e);
        appState.error = (appState.error || "") + " Failed to load Historical Stubs. " + e.message;
        throw e; // Re-throw the error
    }
};

const fetchLiveDriverCounts = async () => {
    try {
        // Use the new fetchWithRetry for the single URL
        const response = await fetchWithRetry(DRIVER_COUNT_LIVE_URL); // Use it here
        const result = await response.json();

        if (result.error) {
            throw new Error(result.error);
        }
        appState.profiles.liveDriverCountData = result || [];
    } catch (e) {
        console.error("Error fetching live driver counts:", e);
        appState.error = (appState.error || "") + " Failed to load Live Driver Counts. " + e.message;
        throw e; // Re-throw the error
    }
};

const fetchOverdueLoads = async () => {
    try {
        // Use action=getOverdueLoads to match the doGet in your new script
        const response = await fetchWithRetry(`${OVERDUE_LOADS_URL}?action=getOverdueLoads`);
        const result = await response.json();
        if (result.status === 'error') {
            throw new Error(result.message);
        }
        appState.profiles.overdueLoadsData = result.overdueLoads || [];
        console.log('[REFRESH] ✅ fetchOverdueLoads finished.');
    } catch (e) {
        console.error("Error fetching overdue loads:", e);
        // Decide if this is critical. If not, don't throw, just log.
    }
};

const fetchContractStatus = async () => {
    try {
        const response = await fetchWithRetry(CONTRACT_STATUS_URL);
        const result = await response.json();
        if (result.error) {
            throw new Error(result.error);
        }
        appState.profiles.contractStatusData = result || [];
    } catch (e) {
        console.error("Error fetching contract status:", e);
        appState.error = (appState.error || "") + " Failed to load Contract Status. " + e.message;
        // We don't throw an error here to allow the app to load without this non-critical data
    }
};

// --- Initial Load ---
document.addEventListener('DOMContentLoaded', () => {
    initializeUIEventListeners(); 
    initializeApp();
});


document.addEventListener('click', (e) => {
    const comparisonContainer = document.getElementById('comparison-container');
    if (comparisonContainer && !comparisonContainer.contains(e.target)) {
        if (appState.isCompareDropdownOpen) {
            appState.isCompareDropdownOpen = false;
            renderModalContent();
        }
    }
    
    if (e.target.closest('#add-comparison-btn')) {
        e.stopPropagation();
        appState.isCompareDropdownOpen = !appState.isCompareDropdownOpen;
        renderModalContent();
    }

    if (e.target.closest('#remove-comparison-btn')) {
        appState.comparisonEntity = null;
        renderModalContent();
    }
});