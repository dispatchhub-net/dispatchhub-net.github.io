import { appState } from '../state.js';
import { calculateMedian, getPayrollWeekDateRange } from '../utils.js';
import { hasPermission, PERMISSIONS } from '../permissions.js';

/**
 * Sorts stubs chronologically and fills in missing dispatcher/team info 
 * using the last known values for each driver.
 */
export function getEnrichedStubs(stubs) {
    // 1. Sort ascending by date so history propagates forward
    const sorted = [...stubs].sort((a, b) => new Date(a.pay_date) - new Date(b.pay_date));
    const driverMap = new Map();

    return sorted.map(stub => {
        const driver = stub.driver_name;
        let info = driverMap.get(driver) || {};

        // 2. Check current row for data (prefer stub_, fallback to current_)
        const rowDisp = stub.stub_dispatcher || stub.current_dispatcher;
        const rowTeam = stub.stub_team || stub.current_team;
        const rowComp = stub.company_name;

        // 3. Update history if current row has data
        if (rowDisp) info.disp = rowDisp;
        if (rowTeam) info.team = rowTeam;
        if (rowComp) info.comp = rowComp;
        
        driverMap.set(driver, info);

        // 4. Return stub with gaps filled from history
        return {
            ...stub,
            stub_dispatcher: rowDisp || info.disp,
            stub_team: rowTeam || info.team,
            company_name: rowComp || info.comp
        };
    });
}

/**
 * Finds the corresponding Thursday rankings date for a given profiles payroll week.
 */
export function getRankingDateForProfileWeek(weeksAgo, allHistoricalDates) {
    const { end } = getPayrollWeekDateRange(weeksAgo); // Gets the Monday (end of the period)
    
    // The corresponding rankings pay date is the Thursday after the period ends.
    const rankingsDate = new Date(end);
    rankingsDate.setUTCDate(end.getUTCDate() + 3); // Monday + 3 days = Thursday

    const targetDateString = rankingsDate.toISOString().split('T')[0];

    // Return the date string only if it exists in the historical data
    if (allHistoricalDates.includes(targetDateString)) {
        return targetDateString;
    }
    
    return null;
}

/**
 * Helper to calculate retention percentage based on historical 'retention_status'.
 */
export function calculateHistoricalRetention(stubsInWeek) {
    const activeDrivers = new Set();
    const terminatedDrivers = new Set();

    stubsInWeek.forEach(stub => {
        const status = (stub.retention_status || '').trim();
        const driver = stub.driver_name;
        
        if (status === 'Active') {
            activeDrivers.add(driver);
        } else if (status === 'Terminated') {
            terminatedDrivers.add(driver);
        }
    });

    const activeCount = activeDrivers.size;
    const terminatedCount = terminatedDrivers.size;
    const totalPool = activeCount + terminatedCount;

    return {
        percentage: totalPool > 0 ? (activeCount / totalPool) * 100 : 0,
        active: activeCount,
        terminated: terminatedCount,
        transferred: 0, // Historical stubs don't explicitly track transfers this way yet
        total: totalPool
    };
}

/**
 * Helper to calculate LIVE retention.
 */
export function calculateLiveRetention(historicalStubs, liveContractStatus, liveDriverCounts, isDriverValidForViewFn) {
    // 1. Identify the Previous Week's Pay Date
    const { end: prevEnd } = getPayrollWeekDateRange(1); // 1 week ago
    const prevWeekPayDateTarget = new Date(prevEnd);
    prevWeekPayDateTarget.setUTCDate(prevEnd.getUTCDate() + 3); // Thursday
    const targetDateString = prevWeekPayDateTarget.toISOString().split('T')[0];

    // 2. Build the Pool from Previous Week Stubs
    const poolDrivers = new Set();
    historicalStubs.forEach(stub => {
        if (!stub.pay_date) return;
        const stubPayDateString = new Date(stub.pay_date).toISOString().split('T')[0];
        
        if (stubPayDateString === targetDateString) {
            const status = (stub.retention_status || '').trim();
            // Include 'Start' so new drivers from last week are tracked for transfers this week
            if (status === 'Active' || status === 'Start') {
                poolDrivers.add(stub.driver_name);
            }
        }
    });

    let poolCount = 0;
    let terminatedCount = 0;
    let transferredCount = 0;

    poolDrivers.forEach(driverName => {
        poolCount++;
        
        // 3. Check for Termination
        const statusInfo = liveContractStatus.find(c => c.driver_name === driverName);
        if (statusInfo && statusInfo.contract_status === 'Terminated') {
            terminatedCount++;
            return;
        }

        // 4. Check for Transfer (Context-Aware)
        // Only counts as a "Loss" if they moved to a team/company/franchise outside the current filter.
        if (isDriverValidForViewFn && liveDriverCounts) {
            const liveRecord = liveDriverCounts.find(d => d.driver_name === driverName);
            if (liveRecord) {
                const stillInView = isDriverValidForViewFn(liveRecord);
                if (!stillInView) {
                    transferredCount++; // Driver exists but moved outside current view (Transfer)
                }
            }
        }
    });

    const retainedCount = poolCount - (terminatedCount + transferredCount);

    return {
        percentage: poolCount > 0 ? (retainedCount / poolCount) * 100 : 0,
        active: retainedCount,
        terminated: terminatedCount,
        transferred: transferredCount,
        total: poolCount
    };
}

export function calculateKpiData(baseData, isLiveData, allDrivers, historicalStubs, contractFilter, currentTeamData, weeksAgo) {
    // 'allDrivers' is already pre-filtered by the UI.
    const driversForKpi = allDrivers;

    // 'baseData' is the raw, unfiltered load/stub data for the period.
    let activeData = isLiveData
    ? baseData.filter(l => l.status !== 'Canceled')
    : baseData.filter(s => s.stub_team && s.total_miles > 0);

    // Apply the contract filter.
    if (contractFilter !== 'all') {
        const contractKey = isLiveData ? 'contract_type' : 'contract_type';
        activeData = activeData.filter(d => {
            const rawContract = String(d[contractKey] || '').trim().toUpperCase();
            const normalizedContract = rawContract === 'OO' ? 'OO' : 'LOO';
            if (contractFilter === 'loo') return normalizedContract !== 'OO';
            return normalizedContract === contractFilter.toUpperCase();
        });
    }

    const dispatchersWithScores = currentTeamData.dispatchers;

    const totalGross = isLiveData ? activeData.reduce((sum, l) => sum + (l.price || 0), 0) : activeData.reduce((sum, s) => sum + (s.driver_gross || 0) + (s.margin || 0), 0);
    const totalMiles = isLiveData ? activeData.reduce((sum, l) => sum + (l.trip_miles || 0) + (l.deadhead_miles || 0), 0) : activeData.reduce((sum, s) => sum + (s.total_miles || 0), 0);
    const totalMargin = isLiveData ? activeData.reduce((sum, l) => sum + (parseFloat(String(l.cut).replace(/,/g, '')) || 0), 0) : activeData.reduce((sum, s) => sum + (parseFloat(String(s.margin).replace(/,/g, '')) || 0), 0);
    
    const activeTrucks = new Set(activeData.map(d => isLiveData ? d.driver : d.driver_name)).size;
    
    const riskScores = driversForKpi.map(d => d.risk).filter(r => typeof r === 'number');
    const medianDropRisk = riskScores.length > 0 ? Math.round(calculateMedian(riskScores)) : 0;

    const stubSourceForBalance = isLiveData ? historicalStubs : baseData;

    const totalBalance = driversForKpi.reduce((sum, driver) => {
        const driverStubs = stubSourceForBalance.filter(s => s.driver_name === driver.name).sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
        if (driverStubs.length > 0) {
            const mostRecentStub = driverStubs[0]; 
            const finalBalance = (mostRecentStub.balance || 0) + (mostRecentStub.balance_settle || 0);
            const finalPo = (mostRecentStub.po_deductions || 0) - (mostRecentStub.po_settle || 0);
            return sum + Math.abs(finalBalance) + finalPo;
        }
        return sum;
    }, 0);

    const canceledLoads = baseData.filter(l => l.status === 'Canceled').length;

    const wellnessScores = dispatchersWithScores.map(d => parseFloat(d.wellness)).filter(w => !isNaN(w));
    const medianWellness = wellnessScores.length > 0 ? calculateMedian(wellnessScores) : 0;
    
    const complianceScores = dispatchersWithScores.map(d => d.complianceScore).filter(c => isFinite(c) && c !== null);
   const medianCompliance = complianceScores.length > 0 ? calculateMedian(complianceScores) : 0;

    const { start: kpiStart, end: kpiEnd } = getPayrollWeekDateRange(weeksAgo);
    const validDispNames = new Set(dispatchersWithScores.map(d => d.name));
    
    const trailerDrops = (appState.profiles.trailerDropsData || []).filter(d => {
        if (!d.dropTime) return false;
        const dDate = new Date(d.dropTime);
        if (dDate < kpiStart || dDate > kpiEnd) return false;
        if (validDispNames.size > 0 && !validDispNames.has(d.droppedByDispatcher)) return false;
        return true;
    }).length;
    
    // --- UPDATED RETENTION LOGIC START ---
    let retentionData;
    
    const { selectedTeam, selectedCompany, selectedFranchise } = appState.profiles;
    const user = appState.auth.user;
    const isDispatcherRole = user && user.role === 'Dispatcher';
    let dispatcherNameFromAccess = isDispatcherRole ? (user.access || [])[0] : null;

    // Enrich stubs first to handle Terminated rows with missing info
    const enrichedStubs = getEnrichedStubs(historicalStubs);

    const filteredStubsForRetention = enrichedStubs.filter(s => {
        // s.stub_dispatcher is now populated from history if missing
        if (dispatcherNameFromAccess && (s.stub_dispatcher || '').toLowerCase() !== dispatcherNameFromAccess.toLowerCase()) return false;
        
        const stubTeam = s.stub_team; // Enriched
        const stubCompany = s.company_name; // Enriched
        
        if (selectedTeam !== 'ALL_TEAMS') {
             const teamLower = selectedTeam.toLowerCase();
             const specialPrefixes = ['agnius', 'uros', 'miles', 'wayne', 'mubeen', 'vito'];
             
             if (specialPrefixes.includes(teamLower)) {
                 if (!stubTeam || !stubTeam.toLowerCase().startsWith(teamLower)) return false;
             } else if (stubTeam !== selectedTeam) return false;
        }
        
        if (selectedCompany !== 'All Companies' && stubCompany !== selectedCompany) return false;
        if (selectedFranchise !== 'All Franchises' && s.franchise_name !== selectedFranchise) return false;
        
        if (contractFilter !== 'all') {
             const raw = String(s.contract_type || '').toUpperCase();
             const norm = raw === 'OO' ? 'OO' : 'LOO';
             if (contractFilter === 'loo' && norm === 'OO') return false;
             if (contractFilter !== 'loo' && norm !== contractFilter.toUpperCase()) return false;
        }
        return true;
    });

    if (isLiveData) {
        // Validator: Returns true if the driver's LIVE assignment matches current filters.
        const isDriverValidForView = (liveRecord) => {
            if (dispatcherNameFromAccess && (liveRecord.dispatcher_name || '').toLowerCase() !== dispatcherNameFromAccess.toLowerCase()) return false;
            
            const recTeam = liveRecord.dispatcher_team;
            const recComp = liveRecord.company_name;
            
            // CHECK 1: Team Filter
            if (selectedTeam !== 'ALL_TEAMS') {
                const teamLower = selectedTeam.toLowerCase();
                const specialPrefixes = ['agnius', 'uros', 'miles', 'wayne', 'mubeen', 'vito'];
                if (specialPrefixes.includes(teamLower)) {
                    if (!recTeam || !recTeam.toLowerCase().startsWith(teamLower)) return false;
                } else if (recTeam !== selectedTeam) return false;
            }
            
            // CHECK 2: Company Filter
            if (selectedCompany !== 'All Companies' && recComp !== selectedCompany) return false;

            // CHECK 3: Franchise Filter (Look up load for franchise info)
            if (selectedFranchise !== 'All Franchises') {
                 const driverLoad = appState.profiles.liveData.find(l => l.driver === liveRecord.driver_name);
                 if (driverLoad && driverLoad.franchise_name !== selectedFranchise) return false;
            }
            
            return true;
        };

        retentionData = calculateLiveRetention(
            filteredStubsForRetention, 
            appState.profiles.contractStatusData || [],
            appState.profiles.liveDriverCountData || [],
            isDriverValidForView
        );
    } else {
        // For historical, we now look ONLY at the specific week
        const { end } = getPayrollWeekDateRange(weeksAgo);
        const targetPayDate = new Date(end);
        targetPayDate.setUTCDate(end.getUTCDate() + 3);
        targetPayDate.setUTCHours(0,0,0,0);
        const targetDateString = targetPayDate.toISOString().split('T')[0];

        const stubsInWeek = filteredStubsForRetention.filter(s => {
            if (!s.pay_date) return false;
            return new Date(s.pay_date).toISOString().split('T')[0] === targetDateString;
        });

        retentionData = calculateHistoricalRetention(stubsInWeek);
    }
    // --- UPDATED RETENTION LOGIC END ---

    return {
        totalGross, teamRpm: totalMiles > 0 ? totalGross / totalMiles : 0, teamMargin: totalMargin,
        activeTrucks, dispatchers: dispatchersWithScores.length, medianDropRisk,
        balance: totalBalance, canceledLoads, medianWellness, medianCompliance, trailerDrops,
        medianRetentionOptimistic: retentionData.percentage,
        retentionCounts: { 
            active: retentionData.active, 
            terminated: retentionData.terminated, 
            transferred: retentionData.transferred, 
            total: retentionData.total 
        }
    };
}

export function getChangeDisplay_Profiles(current, previous, isCurrency = false, isRpm = false, isPercentage = false, lowerIsBetter = false) {
    if (previous === null || current === null || previous === undefined || current === undefined || isNaN(previous) || isNaN(current)) {
        return '<span class="kpi-trend text-gray-500">-</span>';
    }

    const change = current - previous;
    
    // Use a much smaller threshold for percentages to detect small changes
    const threshold = isPercentage ? 0.05 : (isRpm ? 0.005 : 0.5);

    if (Math.abs(change) < threshold) {
        return `<span class="kpi-trend text-gray-400">No Change</span>`;
    }

    const isGood = lowerIsBetter ? change < 0 : change > 0;
    const colorClass = isGood ? 'text-green-400' : 'text-red-400';
    const arrowSvg = isGood 
        ? `<svg class="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>`
        : `<svg class="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>`;
    const sign = isGood ? '+' : '';

    let changeText;
    if (isCurrency) {
        changeText = `${sign}$${Math.round(change).toLocaleString()}`;
    } else if (isRpm) {
        changeText = `${sign}$${change.toFixed(2)}`;
    } else if (isPercentage) {
        // Correctly format percentage changes with one decimal place
        changeText = `${sign}${change.toFixed(1)}%`;
    } else {
        changeText = `${sign}${Math.round(change).toLocaleString()}`;
    }

    return `<span class="kpi-trend ${colorClass} flex items-center gap-1">${arrowSvg} ${changeText}</span>`;
}

/**
 * Calculates the start (Tuesday) and end (Monday) of a payroll week for the Profiles section.
 * @param {number} weeksAgo - 0 for current, 1 for last week, etc.
 * @returns {{label: string, id: string}}
 */
export function getProfilePayrollWeek(weeksAgo = 0) {
    // This function now uses the corrected getPayrollWeekDateRange
    const { start, end } = getPayrollWeekDateRange(weeksAgo);

    const formatDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

    let label;
    // --- FIX: Show the date range for the live week to avoid confusion ---
    if (weeksAgo === 0) {
        label = `LIVE (${formatDate(start)} - ${formatDate(end)})`;
    } else {
        label = `${formatDate(start)} - ${formatDate(end)}`;
    }

    return {
        label: label,
        id: weeksAgo === 0 ? 'live' : `week_${weeksAgo}`,
    };
}

export function renderProfileWeekSelector() {
    const headerActionsContainer = document.querySelector('#profiles-header .flex.items-center.gap-2');
    if (!headerActionsContainer) return;
    const oldButton = document.getElementById('profile-date-range-btn');
    const oldDropdown = document.getElementById('profile-week-selector-container');
    const elementToReplace = oldDropdown || oldButton;
    if (!elementToReplace) return;

    const options = Array.from({ length: 9 }, (_, i) => getProfilePayrollWeek(i));
    const selectedWeekId = appState.profiles.selectedWeek;
    const selectedOption = options.find(opt => opt.id === selectedWeekId) || options[0];

    const newDropdown = document.createElement('div');
    newDropdown.id = 'profile-week-selector-container';
    newDropdown.className = 'relative';
    newDropdown.innerHTML = `
        <button id="profile-week-selector-btn" class="toolbar-btn flex items-center" title="Select Week">
            <span class="text-sm font-semibold whitespace-nowrap">${selectedOption.label}</span>
        </button>
        <div id="profile-week-selector-panel" class="absolute right-0 mt-2 w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2 ${appState.profiles.isWeekSelectorOpen ? '' : 'hidden'}">
            <div class="text-xs uppercase text-gray-400 font-bold mb-2">Select Week</div>
            ${options.map(opt => `
                <a href="#" data-week-id="${opt.id}" class="profile-week-option block px-3 py-2 text-sm rounded-md hover:bg-gray-600 ${opt.id === selectedWeekId ? 'font-bold text-teal-400' : 'text-gray-200'}">
                    ${opt.label}
                </a>
            `).join('')}
        </div>
    `;
    elementToReplace.replaceWith(newDropdown);
}

/**
 * Renders the new week selector dropdown for the Profiles header.
 */
export function renderProfileHeader(teamData, allTeams, kpis, prevWeekKpis) {
    const headerContainer = document.getElementById('profiles-header');
    if (!headerContainer) return;
    const user = appState.auth.user; // Get user object

    // --- START: Active filter check logic ---
    const isContractFilterActive = appState.profiles.contractTypeFilter !== 'all';
    const isCompanyFilterActive = appState.profiles.selectedCompany !== 'All Companies';
    const isFranchiseFilterActive = appState.profiles.selectedFranchise !== 'All Franchises';
    // --- END: Active filter check logic ---

    // Ensure the new metric is available in settings
    if (!appState.profiles.kpiSettings.allKpis.find(k => k.id === 'medianRetentionOptimistic')) {
        appState.profiles.kpiSettings.allKpis.push({ id: 'medianRetentionOptimistic', label: '1W Retention' });
        // Automatically show it if not present in visible list
        if (!appState.profiles.kpiSettings.visibleKpiIds.includes('medianRetentionOptimistic')) {
            appState.profiles.kpiSettings.visibleKpiIds.push('medianRetentionOptimistic');
        }
    }
    // Ensure Trailer Drops is available in settings
    if (!appState.profiles.kpiSettings.allKpis.find(k => k.id === 'trailerDrops')) {
        appState.profiles.kpiSettings.allKpis.push({ id: 'trailerDrops', label: 'Trailer Drops' });
        // Automatically show it if not present in visible list
        if (!appState.profiles.kpiSettings.visibleKpiIds.includes('trailerDrops')) {
            appState.profiles.kpiSettings.visibleKpiIds.push('trailerDrops');
        }
    }

    const { visibleKpiIds } = appState.profiles.kpiSettings;
    
    const allKpiCards = [
        { id: 'totalGross', label: 'Total Weekly Gross', value: `$${Math.round(kpis.totalGross).toLocaleString()}`, trend: getChangeDisplay_Profiles(kpis.totalGross, prevWeekKpis.totalGross, true), isGeneralCard: true },
        { id: 'teamRpm', label: 'Team RPM (All)', value: `$${kpis.teamRpm.toFixed(2)}`, trend: getChangeDisplay_Profiles(kpis.teamRpm, prevWeekKpis.teamRpm, false, true), isGeneralCard: true },
        { id: 'teamMargin', label: 'Team Margin ($)', value: `$${Math.round(kpis.teamMargin).toLocaleString()}`, trend: getChangeDisplay_Profiles(kpis.teamMargin, prevWeekKpis.teamMargin, true), isGeneralCard: true },
        { id: 'activeTrucks', label: 'Active Trucks', value: kpis.activeTrucks.toLocaleString(), trend: getChangeDisplay_Profiles(kpis.activeTrucks, prevWeekKpis.activeTrucks), isGeneralCard: true },
        { id: 'dispatchers', label: 'Dispatchers', value: kpis.dispatchers.toLocaleString(), trend: getChangeDisplay_Profiles(kpis.dispatchers, prevWeekKpis.dispatchers) },
        { id: 'medianDropRisk', label: 'Median Drop Risk', value: `${kpis.medianDropRisk}%`, trend: `<span class="kpi-trend text-gray-500">-</span>` },
        { id: 'balance', label: 'Balance + PO', value: `$${Math.round(kpis.balance).toLocaleString()}`, trend: getChangeDisplay_Profiles(kpis.balance, prevWeekKpis.balance, true, false, false, true), isGeneralCard: true },
        { 
            id: 'trailerDrops', 
            label: 'Trailer Drops', 
            value: kpis.trailerDrops.toLocaleString(), 
            trend: getChangeDisplay_Profiles(kpis.trailerDrops, prevWeekKpis.trailerDrops, false, false, false, true),
            isTrailerDropsCard: true
        },        
        { id: 'canceledLoads', label: 'Canceled', value: kpis.canceledLoads.toLocaleString(), trend: getChangeDisplay_Profiles(kpis.canceledLoads, prevWeekKpis.canceledLoads, false, false, false, true) },
        { id: 'medianWellness', label: 'Median Wellness %', value: `${kpis.medianWellness.toFixed(1)}%`, trend: getChangeDisplay_Profiles(kpis.medianWellness, prevWeekKpis.medianWellness, false, false, true) },
        { 
            id: 'medianCompliance', 
            label: 'Median Compliance %', 
            value: `${kpis.medianCompliance.toFixed(1)}%`, 
            trend: getChangeDisplay_Profiles(kpis.medianCompliance, prevWeekKpis.medianCompliance, false, false, true),
            isComplianceCard: true 
        },
        { 
            id: 'medianRetentionOptimistic', 
            label: '1W Retention', 
            value: `${kpis.medianRetentionOptimistic.toFixed(1)}%`, 
            trend: getChangeDisplay_Profiles(kpis.medianRetentionOptimistic, prevWeekKpis.medianRetentionOptimistic, false, false, true),
            tooltipHtml: kpis.retentionCounts ? 
                `<div class='text-left'><div class='font-bold mb-1 text-gray-200'>Retention Breakdown</div><div>Active: <span class='text-green-400 font-mono font-bold'>${kpis.retentionCounts.active}</span></div><div>Terminated: <span class='text-red-400 font-mono font-bold'>${kpis.retentionCounts.terminated}</span></div>${kpis.retentionCounts.transferred > 0 ? `<div>Transferred: <span class='text-yellow-400 font-mono font-bold'>${kpis.retentionCounts.transferred}</span></div>` : ''}<div class='mt-1 text-[10px] text-gray-400 italic'>Click for history</div></div>` 
                : null,
            isRetentionCard: true
        },
    ];
    
    const visibleKpiCards = allKpiCards.filter(card => visibleKpiIds.includes(card.id));

    const weekOptions = Array.from({ length: 9 }, (_, i) => getProfilePayrollWeek(i));
    const selectedWeekId = appState.profiles.selectedWeek;
    const selectedOption = weekOptions.find(opt => opt.id === selectedWeekId) || weekOptions[0];

    const weekSelectorHTML = `
        <div id="profile-week-selector-container" class="relative">
            <button id="profile-week-selector-btn" class="toolbar-btn flex items-center" title="Select Week">
                <span class="text-sm font-semibold whitespace-nowrap">${selectedOption.label}</span>
            </button>
            <div id="profile-week-selector-panel" class="absolute right-0 mt-2 w-56 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 p-2 ${appState.profiles.isWeekSelectorOpen ? '' : 'hidden'}">
                ${weekOptions.map(opt => `
                    <a href="#" data-week-id="${opt.id}" class="profile-week-option block px-3 py-2 text-sm rounded-md hover:bg-gray-600 ${opt.id === selectedWeekId ? 'font-bold text-teal-400' : 'text-gray-200'}">
                        ${opt.label}
                    </a>
                `).join('')}
            </div>
        </div>
    `;

    const isDispatcherRole = user && user.role === 'Dispatcher';

    headerContainer.innerHTML = `
        <div class="grid grid-flow-col auto-cols-fr gap-3">
            ${visibleKpiCards.map(kpi => {
                let idAttr = '';
                let cursorClass = '';
                if (kpi.isRetentionCard) { idAttr = 'id="kpi-card-retention"'; cursorClass = '!cursor-pointer hover:bg-gray-700 transition-colors ring-1 ring-transparent hover:ring-teal-500'; }
                if (kpi.isComplianceCard) { idAttr = 'id="kpi-card-compliance"'; cursorClass = '!cursor-pointer hover:bg-gray-700 transition-colors ring-1 ring-transparent hover:ring-teal-500'; }
                if (kpi.isTrailerDropsCard) { idAttr = 'id="kpi-card-trailer-drops"'; cursorClass = '!cursor-pointer hover:bg-gray-700 transition-colors ring-1 ring-transparent hover:ring-teal-500'; }
                if (kpi.isGeneralCard) {
                     idAttr = `id="kpi-card-${kpi.id}"`; 
                     cursorClass = '!cursor-pointer hover:bg-gray-700 transition-colors ring-1 ring-transparent hover:ring-teal-500'; 
                }

                return `
                <div ${idAttr} class="profile-kpi-card-ranking ${kpi.tooltipHtml ? 'dispatch-tooltip-trigger cursor-help' : ''} ${cursorClass}" ${kpi.tooltipHtml ? `data-tooltip-html="${kpi.tooltipHtml}"` : ''}>
                    <h4 class="kpi-title-ranking">${kpi.label}</h4>
                    <p class="kpi-value-ranking">${kpi.value}</p>
                    ${kpi.trend}
                </div>
            `}).join('')}
        </div>
        <div class="flex items-center gap-2 flex-shrink-0 ml-auto pl-6">
            <div id="kpi-settings-container" class="relative">
                <button id="kpi-settings-btn" class="toolbar-btn !p-2" title="Select KPIs">
                    <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm0 4.5h.007v.008H3.75V12zm0 4.5h.007v.008H3.75v-.008z" /></svg>
                </button>
            </div>
            <div id="contract-type-filter-container" class="relative">
                <button id="contract-type-filter-btn" class="toolbar-btn !p-2 ${isContractFilterActive ? 'filter-active' : ''}" title="Filter by Contract Type">
                    <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
                </button>
            </div>
            <div id="company-filter-container" class="relative">
                <button id="company-filter-btn" class="toolbar-btn !p-2 ${isCompanyFilterActive ? 'filter-active' : ''}" title="Filter by Company">
                    <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h6M9 11.25h6m-6 4.5h6M6.75 21v-2.25a2.25 2.25 0 012.25-2.25h6a2.25 2.25 0 012.25 2.25V21M6.75 3v2.25a2.25 2.25 0 002.25 2.25h6a2.25 2.25 0 002.25-2.25V3" /></svg>
                </button>
            </div>
            <div id="franchise-filter-container" class="relative">
                <button id="franchise-filter-btn" class="toolbar-btn !p-2 !w-10 !h-10 flex items-center justify-center ${isFranchiseFilterActive ? 'filter-active' : ''}" title="Filter by Franchise">
                    <span class="text-lg font-bold">F</span>
                </button>
            </div>
            ${weekSelectorHTML}
            <div class="w-56">
                <select id="team-selector" class="w-full bg-gray-900 text-gray-100 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent transition duration-200" ${isDispatcherRole || (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) && allTeams.length <= 1) ? 'disabled' : ''}>
                    ${(hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) || allTeams.length > 1) && !isDispatcherRole ? `<option value="ALL_TEAMS" ${teamData.teamName === 'All Teams' ? 'selected' : ''}>All Teams</option>` : ''}
                    ${(allTeams).map(team => `<option value="${team}" ${team === teamData.teamName ? 'selected' : ''}>${team}</option>`).join('')}
                </select>
            </div>
        </div>
    `;
}

export function renderKpiSettingsDropdown() {
    const container = document.getElementById('kpi-settings-container');
    if (!container) return;

    const existingDropdown = document.getElementById('kpi-settings-dropdown');
    if (existingDropdown) existingDropdown.remove();

    if (!appState.profiles.isKpiSettingsOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'kpi-settings-dropdown';
    // ** THIS IS THE FIX **
    dropdown.className = 'absolute right-0 mt-2 w-72 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

    let dropdownHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Visible KPIs</div>`;
    
    const { allKpis, visibleKpiIds } = appState.profiles.kpiSettings;

    allKpis.forEach(kpi => {
        const isVisible = visibleKpiIds.includes(kpi.id);
        dropdownHTML += `
            <label class="flex items-center p-1.5 hover:bg-gray-600 rounded-md text-sm text-gray-200 cursor-pointer">
                <input type="checkbox" data-kpi-id="${kpi.id}" ${isVisible ? 'checked' : ''} class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 focus:ring-teal-500 mr-2 bg-gray-800">
                <span>${kpi.label}</span>
            </label>
        `;
    });
    
    dropdown.innerHTML = dropdownHTML;
    container.appendChild(dropdown);

    dropdown.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation(); 
            const kpiId = e.target.dataset.kpiId;
            const visibleSet = new Set(appState.profiles.kpiSettings.visibleKpiIds);
            
            if (e.target.checked) {
                visibleSet.add(kpiId);
            } else {
                visibleSet.delete(kpiId);
            }
            
            appState.profiles.kpiSettings.visibleKpiIds = appState.profiles.kpiSettings.allKpis
                .map(k => k.id)
                .filter(id => visibleSet.has(id));

            // Force a re-render of the header by calling the main UI render logic.
            // Since we can't easily circular import renderTeamProfileUI here without restructuring more,
            // we rely on the event listener in profiles_ui.js to handle this or dispatch a custom event if needed.
            // However, profiles_ui.js handles the 'change' event for this? 
            // Actually, renderKpiSettingsDropdown attaches this listener.
            // We need to trigger a UI refresh.
            
            // To properly refresh, we can dispatch a custom event that profiles_ui listens to,
            // or simply assume the user interactions in profiles_ui will pick this up if refactored correctly.
            // For now, let's dispatch a custom event on document.
            document.dispatchEvent(new CustomEvent('kpi-settings-changed'));
        });
    });
}
export function renderComplianceHistoryChart(datasets, metricKey) {
    const container = d3.select("#compliance-chart-container");
    container.html("");
    d3.selectAll(".compliance-tooltip").remove();

    // 1. Filter out specific teams completely
    const excludedTeams = ["Cletus Spuckler", "Ralph Wiggum", "Seymour Skinner", "Spotter"];
    const currentTeam = appState.profiles.selectedTeam === 'ALL_TEAMS' ? "All Teams" : appState.profiles.selectedTeam;

    const user = appState.auth.user;
    let dispatcherNameFromAccess = null;
    if (user && user.role === 'Dispatcher') {
         if (Array.isArray(user.access) && user.access.length > 0) {
            dispatcherNameFromAccess = String(user.access[0]).trim();
        } else if (typeof user.access === 'string' && user.access.trim()) {
            dispatcherNameFromAccess = user.access.split(',')[0].trim();
        }
    }

    const hasViewAllPermission = hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS);

    datasets = datasets.filter(ds => {
        if (excludedTeams.includes(ds.name)) return false;
        
        if (hasViewAllPermission) return true;

        if (currentTeam !== "All Teams") {
            return ds.name === currentTeam || ds.name === "All Teams" || (dispatcherNameFromAccess && ds.name === dispatcherNameFromAccess);
        }
        return true;
    });

    // 2. Initialize hidden state
    datasets.forEach(ds => {
        if (ds.hidden === undefined) {
            if (currentTeam === "All Teams") {
                ds.hidden = ds.name !== "All Teams";
            } else {
                const isRelevant = ds.name === "All Teams" || ds.name === currentTeam || (dispatcherNameFromAccess && ds.name === dispatcherNameFromAccess);
                ds.hidden = !isRelevant;
            }
        }
    });

    const margin = { top: 20, right: 40, bottom: 30, left: 50 }; 
    const width = container.node().clientWidth - margin.left - margin.right;
    const height = container.node().clientHeight - margin.top - margin.bottom - 80; 
    
    const svg = container.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    svg.append("defs").append("clipPath").attr("id", "comp-clip").append("rect").attr("width", width).attr("height", height);

    // --- Helper to Calculate Trimmed X Domain ---
    const calculateXDomain = () => {
        const visibleDatasets = datasets.filter(ds => !ds.hidden);
        let trimmedStartDate = null;
        
        if (visibleDatasets.length > 0 && visibleDatasets[0].data.length > 0) {
            const numWeeks = visibleDatasets[0].data.length;
            for (let i = 0; i < numWeeks; i++) {
                const hasData = visibleDatasets.some(ds => {
                    const point = ds.data[i];
                    return point && point[metricKey] !== null && point[metricKey] > 0;
                });
                if (hasData) {
                    trimmedStartDate = visibleDatasets[0].data[i].weekDate;
                    break;
                }
            }
        }
        
        const allPoints = datasets.flatMap(ds => ds.data);
        const maxDate = d3.max(allPoints, d => d.weekDate);
        const minDate = trimmedStartDate || d3.min(allPoints, d => d.weekDate);
        
        return [minDate, maxDate];
    };

    const x = d3.scaleTime().domain(calculateXDomain()).range([0, width]);
    const y = d3.scaleLinear().range([height, 0]);

    const formatY = (d) => {
        if (metricKey === 'compliance' || metricKey === 'wellness') return d + "%";
        if (['badMoves', 'canceled', 'tuesdayOpen', 'calculatorActivity', 'missingPaperwork', 'rcEntry'].includes(metricKey)) return Math.round(d);
        return d;
    };

    const xAxisGroup = svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(12).tickFormat(d3.timeFormat("%b %d"))).attr("color", "#9ca3af");
    const yAxisGroup = svg.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(formatY)).attr("color", "#9ca3af");
    
    const gridGroup = svg.append("g").attr("class", "grid").call(d3.axisLeft(y).tickSize(-width).tickFormat("").ticks(5)).style("stroke-dasharray", "3, 3").style("stroke-opacity", 0.1);
    gridGroup.select(".domain").remove();

    const chartBody = svg.append("g").attr("clip-path", "url(#comp-clip)");
    const line = d3.line().x(d => x(d.weekDate)).y(d => y(d[metricKey])).defined(d => d[metricKey] !== null).curve(d3.curveMonotoneX);
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10); 

    const updateChart = () => {
        x.domain(calculateXDomain());
        
        const [xMin, xMax] = x.domain();
        const visibleDataPoints = datasets
            .filter(ds => !ds.hidden)
            .flatMap(ds => ds.data.filter(d => d[metricKey] !== null && d.weekDate >= xMin && d.weekDate <= xMax));
        
        if (visibleDataPoints.length > 0) {
            const vals = visibleDataPoints.map(d => d[metricKey]);
            if (['badMoves', 'overdue', 'canceled', 'tuesdayOpen', 'calculatorActivity', 'missingPaperwork'].includes(metricKey)) {
                 y.domain([0, Math.max(5, Math.max(...vals) + 1)]);
            } else {
                 y.domain([Math.max(0, Math.min(...vals) - 10), Math.min(100, Math.max(...vals) + 5)]);
            }
        } else {
             y.domain([0, 100]);
        }

        const t = svg.transition().duration(750);
        
  const tickValues = Array.from(new Set(
            datasets.filter(ds => !ds.hidden)
            .flatMap(ds => ds.data)
            .filter(d => d.weekDate >= x.domain()[0] && d.weekDate <= x.domain()[1])
            .map(d => d.weekDate.getTime())
        )).sort((a, b) => a - b).map(t => new Date(t));

        xAxisGroup.transition(t).call(d3.axisBottom(x).tickValues(tickValues).tickFormat(d3.timeFormat("%b %d")));    
        yAxisGroup.transition(t).call(d3.axisLeft(y).ticks(5).tickFormat(formatY));
        gridGroup.transition(t).call(d3.axisLeft(y).tickSize(-width).tickFormat(""));
        gridGroup.select(".domain").remove();

        datasets.forEach((ds, i) => {
            // Line
            const path = chartBody.selectAll(`.line-${i}`).data([ds.data]);
            path.enter().append("path").attr("class", `line-series line-${i}`)
                .attr("fill", "none")
                .attr("stroke", colorScale(i))
                .attr("stroke-width", ds.name === "All Teams" ? 4 : 2)
                .style("opacity", ds.hidden ? 0 : 1)
                .attr("d", line)
                .merge(path).transition(t)
                .attr("d", line)
                .attr("stroke", colorScale(i))
                .style("opacity", ds.hidden ? 0 : 1);
            
            // Dots
            const dots = chartBody.selectAll(`.dot-${i}`).data(ds.data.filter(d => d[metricKey] !== null));
            dots.enter().append("circle").attr("class", `dot-series dot-${i}`)
                .attr("r", 4)
                .attr("fill", "#1f2937")
                .attr("stroke", colorScale(i))
                .attr("stroke-width", 2)
                .attr("cx", d => x(d.weekDate))
                .attr("cy", d => y(d[metricKey]))
                .style("opacity", ds.hidden ? 0 : 1)
                .merge(dots).transition(t)
                .attr("cx", d => x(d.weekDate))
                .attr("cy", d => y(d[metricKey]))
                .style("opacity", ds.hidden ? 0 : 1);
            dots.exit().remove();
        });
    };

    updateChart();

    // --- Legend ---
    const legendContainer = container.append("div").attr("class", "chart-legend flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2 px-4 overflow-y-auto").style("max-height", "80px");
    
    datasets.forEach((ds, i) => {
        const color = colorScale(i);
        legendContainer.append("div")
            .attr("class", `chart-legend-item cursor-pointer flex items-center gap-2 text-xs select-none ${ds.hidden ? 'opacity-40 grayscale' : 'opacity-100'}`)
            .style("text-decoration", ds.hidden ? "line-through" : "none")
            .html(`<div class="w-3 h-3 rounded-full" style="background-color: ${color}"></div><span>${ds.name}</span>`)
            .on("click", function() {
                ds.hidden = !ds.hidden;
                const el = d3.select(this);
                el.classed("opacity-40 grayscale", ds.hidden).classed("opacity-100", !ds.hidden).style("text-decoration", ds.hidden ? "line-through" : "none");
                updateChart();
            });
    });

    // --- Tooltip ---
    const tooltip = d3.select("body").append("div").attr("class", "d3-tooltip compliance-tooltip").style("opacity", 0);
    const focus = svg.append("g").style("display", "none");
    focus.append("line").attr("y1", 0).attr("y2", height).style("stroke", "#4b5563").style("stroke-dasharray", "3,3");

    svg.append("rect").attr("width", width).attr("height", height).style("fill", "none").style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); })
        .on("mousemove", (event) => {
            const x0 = x.invert(d3.pointer(event)[0]);
            
            // Need to find reference data within visible range
            const visibleDatasets = datasets.filter(ds => !ds.hidden);
            if (visibleDatasets.length === 0) return;
            const refData = visibleDatasets[0].data;
            
            const bisect = d3.bisector(d => d.weekDate).left;
            const i = bisect(refData, x0, 1);
            const d0 = refData[i - 1], d1 = refData[i];
            const d = (d0 && d1) ? (x0 - d0.weekDate > d1.weekDate - x0 ? d1 : d0) : (d0 || d1);

            if (d) {
                focus.attr("transform", `translate(${x(d.weekDate)},0)`);
                
                const headerText = d.dateLabel 
                    ? `<div class="text-[10px] text-gray-400 font-normal">Pay Date: ${d3.timeFormat("%b %d")(d.weekDate)}</div>${d.dateLabel}`
                    : d3.timeFormat("%b %d")(d.weekDate);

                let html = `<div class="font-bold text-white border-b border-gray-600 pb-1 mb-1 text-center">${headerText}</div>`;
                
                const points = datasets.map((ds, idx) => {
                    const pt = ds.data.find(p => p.weekDate.getTime() === d.weekDate.getTime());
                    return pt && !ds.hidden ? { name: ds.name, val: pt[metricKey], pointData: pt, color: colorScale(idx) } : null;
                }).filter(Boolean).sort((a, b) => b.val - a.val);

                points.forEach(p => {
                    let valStr = p.val === null ? '-' : (
                        ['compliance','wellness'].includes(metricKey) ? p.val.toFixed(1) + '%' : 
                        ['badMoves', 'canceled', 'tuesdayOpen', 'calculatorActivity', 'missingPaperwork', 'rcEntry'].includes(metricKey) ? p.val.toFixed(0) :
                        p.val.toFixed(1)
                    );
                    
                    if (metricKey === 'wellness' && p.pointData.wellnessBreakdown) {
                         const wb = p.pointData.wellnessBreakdown;
                         html += `
                            <div class="mb-2 border-b border-gray-700 pb-1 last:border-0">
                                <div class="flex justify-between gap-4 text-xs font-semibold mb-0.5">
                                    <span style="color:${p.color}">${p.name}</span>
                                    <span class="font-mono text-white">${valStr}</span>
                                </div>
                                <div class="grid grid-cols-3 gap-2 text-[10px] text-gray-400">
                                    <div class="text-green-400">Passed: ${wb.passed || 0}</div>
                                    <div class="text-blue-300">Good: ${wb.good || 0}</div>
                                    <div class="text-red-400">Failed: ${wb.failed || 0}</div>
                                </div>
                            </div>
                         `;
                    } else {
                        html += `<div class="flex justify-between gap-4 text-xs"><span style="color:${p.color}">${p.name}</span><span class="font-mono text-white">${valStr}</span></div>`;
                    }
                });
                
                tooltip.html(html).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
            }
        });
}

export function renderRetentionHistoryChart(datasets) {
    const container = d3.select("#retention-chart-container");
    container.html("");
    d3.selectAll(".retention-tooltip").remove();

    // 1. Filter out specific teams completely
    const excludedTeams = ["Cletus Spuckler", "Ralph Wiggum", "Seymour Skinner", "Spotter"];
    const currentTeam = appState.profiles.selectedTeam === 'ALL_TEAMS' ? "All Teams" : appState.profiles.selectedTeam;

    const user = appState.auth.user;
    let dispatcherNameFromAccess = null;
    if (user && user.role === 'Dispatcher') {
         if (Array.isArray(user.access) && user.access.length > 0) {
            dispatcherNameFromAccess = String(user.access[0]).trim();
        } else if (typeof user.access === 'string' && user.access.trim()) {
            dispatcherNameFromAccess = user.access.split(',')[0].trim();
        }
    }

    const hasViewAllPermission = hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS);

    datasets = datasets.filter(ds => {
        if (excludedTeams.includes(ds.name)) return false;
        if (hasViewAllPermission) return true;
        if (currentTeam !== "All Teams") {
            return ds.name === currentTeam || ds.name === "All Teams" || (dispatcherNameFromAccess && ds.name === dispatcherNameFromAccess);
        }
        return true;
    });

    // 2. Initialize hidden state with CONTEXT-AWARE MEMORY
    // We must track WHICH team context the memory belongs to.
    // If context changes (e.g. from "Team A" to "All Teams"), we must RESET the memory to defaults.
    
    if (!appState.profiles.retentionMemory) {
        appState.profiles.retentionMemory = { context: null, hiddenTeams: [] };
    }

    // Check if context changed (User switched from All Teams to a specific team, or vice versa)
    if (appState.profiles.retentionMemory.context !== currentTeam) {
        // Context mismatch! Reset to defaults for this new view.
        appState.profiles.retentionMemory.context = currentTeam;
        appState.profiles.retentionMemory.hiddenTeams = null; // Signal to calculate defaults below
    }

    const hiddenList = appState.profiles.retentionMemory.hiddenTeams;

    datasets.forEach(ds => {
        if (hiddenList !== null) {
            // CASE A: We have valid history for THIS context, use it.
            ds.hidden = hiddenList.includes(ds.name);
        } else {
            // CASE B: First load (or reset) for this context. Apply smart defaults.
            if (currentTeam === "All Teams") {
                // In All Teams view, default is: ONLY "All Teams" visible, everything else hidden.
                ds.hidden = ds.name !== "All Teams";
            } else {
                // In specific team view, default is: Show relevant lines.
                const isRelevant = ds.name === "All Teams" || ds.name === currentTeam || (dispatcherNameFromAccess && ds.name === dispatcherNameFromAccess);
                ds.hidden = !isRelevant;
            }
        }
    });

    // Save the initial state to memory if it was just calculated (was null)
    if (hiddenList === null) {
        appState.profiles.retentionMemory.hiddenTeams = datasets.filter(ds => ds.hidden).map(ds => ds.name);
    }

    const margin = { top: 20, right: 40, bottom: 30, left: 50 }; 
    const width = container.node().clientWidth - margin.left - margin.right;
    const height = container.node().clientHeight - margin.top - margin.bottom - 80; 
    
    const svg = container.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    svg.append("defs").append("clipPath").attr("id", "ret-clip").append("rect").attr("width", width).attr("height", height);

    // --- Helper to Calculate Trimmed X Domain ---
    const calculateXDomain = () => {
        const visibleDatasets = datasets.filter(ds => !ds.hidden);
        let trimmedStartDate = null;
        
        if (visibleDatasets.length > 0 && visibleDatasets[0].data.length > 0) {
            const numWeeks = visibleDatasets[0].data.length;
            for (let i = 0; i < numWeeks; i++) {
                const hasData = visibleDatasets.some(ds => {
                    const point = ds.data[i];
                    return point && point.retention !== null && point.retention > 0;
                });
                if (hasData) {
                    trimmedStartDate = visibleDatasets[0].data[i].weekDate;
                    break;
                }
            }
        }
        
        const allPoints = datasets.flatMap(ds => ds.data);
        const maxDate = d3.max(allPoints, d => d.weekDate);
        const minDate = trimmedStartDate || d3.min(allPoints, d => d.weekDate);
        
        return [minDate, maxDate];
    };

    const x = d3.scaleTime().domain(calculateXDomain()).range([0, width]);
    const y = d3.scaleLinear().range([height, 0]);

    const formatY = (d) => d + "%";

    const xAxisGroup = svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(12).tickFormat(d3.timeFormat("%b %d"))).attr("color", "#9ca3af");
    const yAxisGroup = svg.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(formatY)).attr("color", "#9ca3af");
    
    const gridGroup = svg.append("g").attr("class", "grid").call(d3.axisLeft(y).tickSize(-width).tickFormat("").ticks(5)).style("stroke-dasharray", "3, 3").style("stroke-opacity", 0.1);
    gridGroup.select(".domain").remove();

    const chartBody = svg.append("g").attr("clip-path", "url(#ret-clip)");
    const line = d3.line().x(d => x(d.weekDate)).y(d => y(d.retention)).defined(d => d.retention !== null).curve(d3.curveMonotoneX);
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10); 

    const updateChart = () => {
        x.domain(calculateXDomain());
        
        const [xMin, xMax] = x.domain();
        const visibleDataPoints = datasets
            .filter(ds => !ds.hidden)
            .flatMap(ds => ds.data.filter(d => d.retention !== null && d.weekDate >= xMin && d.weekDate <= xMax));
        
        if (visibleDataPoints.length > 0) {
            const vals = visibleDataPoints.map(d => d.retention);
            y.domain([Math.max(0, Math.min(...vals) - 10), Math.min(100, Math.max(...vals) + 5)]);
        } else {
             y.domain([0, 100]);
        }

        const t = svg.transition().duration(750);
        
       const tickValues = Array.from(new Set(
            datasets.filter(ds => !ds.hidden)
            .flatMap(ds => ds.data)
            .filter(d => d.weekDate >= x.domain()[0] && d.weekDate <= x.domain()[1])
            .map(d => d.weekDate.getTime())
        )).sort((a, b) => a - b).map(t => new Date(t));

        xAxisGroup.transition(t).call(d3.axisBottom(x).tickValues(tickValues).tickFormat(d3.timeFormat("%b %d")));
        yAxisGroup.transition(t).call(d3.axisLeft(y).ticks(5).tickFormat(formatY));
        gridGroup.transition(t).call(d3.axisLeft(y).tickSize(-width).tickFormat(""));
        gridGroup.select(".domain").remove();

        datasets.forEach((ds, i) => {
            // Line
            const path = chartBody.selectAll(`.line-${i}`).data([ds.data]);
            path.enter().append("path").attr("class", `line-series line-${i}`)
                .attr("fill", "none")
                .attr("stroke", colorScale(i))
                .attr("stroke-width", ds.name === "All Teams" ? 4 : 2)
                .style("opacity", ds.hidden ? 0 : 1)
                .attr("d", line)
                .merge(path).transition(t)
                .attr("d", line)
                .attr("stroke", colorScale(i))
                .style("opacity", ds.hidden ? 0 : 1);
            
            // Dots
            const dots = chartBody.selectAll(`.dot-${i}`).data(ds.data.filter(d => d.retention !== null));
            dots.enter().append("circle").attr("class", `dot-series dot-${i}`)
                .attr("r", 4)
                .attr("fill", "#1f2937")
                .attr("stroke", colorScale(i))
                .attr("stroke-width", 2)
                .attr("cx", d => x(d.weekDate))
                .attr("cy", d => y(d.retention))
                .style("opacity", ds.hidden ? 0 : 1)
                .merge(dots).transition(t)
                .attr("cx", d => x(d.weekDate))
                .attr("cy", d => y(d.retention))
                .style("opacity", ds.hidden ? 0 : 1);
            dots.exit().remove();
        });
    };

    updateChart();

    // --- Legend ---
    const legendContainer = container.append("div").attr("class", "chart-legend flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2 px-4 overflow-y-auto").style("max-height", "80px");
    
    datasets.forEach((ds, i) => {
        const color = colorScale(i);
        legendContainer.append("div")
            .attr("class", `chart-legend-item cursor-pointer flex items-center gap-2 text-xs select-none ${ds.hidden ? 'opacity-40 grayscale' : 'opacity-100'}`)
            .style("text-decoration", ds.hidden ? "line-through" : "none")
            .html(`<div class="w-3 h-3 rounded-full" style="background-color: ${color}"></div><span>${ds.name}</span>`)
            .on("click", function() {
                ds.hidden = !ds.hidden;
                
                // --- UPDATE STATE MEMORY ---
                // We update the memory for the CURRENT context
                if (appState.profiles.retentionMemory && appState.profiles.retentionMemory.hiddenTeams) {
                    if (ds.hidden) {
                        if (!appState.profiles.retentionMemory.hiddenTeams.includes(ds.name)) {
                            appState.profiles.retentionMemory.hiddenTeams.push(ds.name);
                        }
                    } else {
                        appState.profiles.retentionMemory.hiddenTeams = appState.profiles.retentionMemory.hiddenTeams.filter(t => t !== ds.name);
                    }
                }

                const el = d3.select(this);
                el.classed("opacity-40 grayscale", ds.hidden).classed("opacity-100", !ds.hidden).style("text-decoration", ds.hidden ? "line-through" : "none");
                updateChart();
            });
    });

    // --- Tooltip ---
    const tooltip = d3.select("body").append("div").attr("class", "d3-tooltip retention-tooltip").style("opacity", 0);
    const focus = svg.append("g").style("display", "none");
    focus.append("line").attr("y1", 0).attr("y2", height).style("stroke", "#4b5563").style("stroke-dasharray", "3,3");

    svg.append("rect").attr("width", width).attr("height", height).style("fill", "none").style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); })
        .on("mousemove", (event) => {
            const x0 = x.invert(d3.pointer(event)[0]);
            const visibleDatasets = datasets.filter(ds => !ds.hidden);
            if (visibleDatasets.length === 0) return;
            const refData = visibleDatasets[0].data;
            const bisect = d3.bisector(d => d.weekDate).left;
            const i = bisect(refData, x0, 1);
            const d0 = refData[i - 1], d1 = refData[i];
            const d = (d0 && d1) ? (x0 - d0.weekDate > d1.weekDate - x0 ? d1 : d0) : (d0 || d1);

            if (d) {
                focus.attr("transform", `translate(${x(d.weekDate)},0)`);
                const headerText = d3.timeFormat("%b %d")(d.weekDate);
                let html = `<div class="font-bold text-white border-b border-gray-600 pb-1 mb-1 text-center">${headerText}</div>`;
                
                const points = datasets.map((ds, idx) => {
                    const pt = ds.data.find(p => p.weekDate.getTime() === d.weekDate.getTime());
                    return pt && !ds.hidden ? { name: ds.name, val: pt.retention, color: colorScale(idx) } : null;
                }).filter(Boolean).sort((a, b) => b.val - a.val);

                points.forEach(p => {
                    let valStr = p.val === null ? '-' : p.val.toFixed(1) + '%';
                    html += `<div class="flex justify-between gap-4 text-xs"><span style="color:${p.color}">${p.name}</span><span class="font-mono text-white">${valStr}</span></div>`;
                });
                tooltip.html(html).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
            }
        });
}
export function renderTrailerDropsHistoryChart(datasets, metricKey) {
    const container = d3.select("#trailer-drops-chart-container");
    container.html("");
    d3.selectAll(".drops-tooltip").remove();

    const excludedTeams = ["Cletus Spuckler", "Ralph Wiggum", "Seymour Skinner", "Spotter"];
    const currentTeam = appState.profiles.selectedTeam === 'ALL_TEAMS' ? "All Teams" : appState.profiles.selectedTeam;

    const user = appState.auth.user;
    let dispatcherNameFromAccess = null;
    if (user && user.role === 'Dispatcher') {
         if (Array.isArray(user.access) && user.access.length > 0) {
            dispatcherNameFromAccess = String(user.access[0]).trim();
        } else if (typeof user.access === 'string' && user.access.trim()) {
            dispatcherNameFromAccess = user.access.split(',')[0].trim();
        }
    }

    const hasViewAllPermission = hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS);

    datasets = datasets.filter(ds => {
        if (excludedTeams.includes(ds.name)) return false;
        if (hasViewAllPermission) return true;
        if (currentTeam !== "All Teams") {
            return ds.name === currentTeam || ds.name === "All Teams" || (dispatcherNameFromAccess && ds.name === dispatcherNameFromAccess);
        }
        return true;
    });

    datasets.forEach(ds => {
        if (ds.hidden === undefined) {
            if (currentTeam === "All Teams") {
                ds.hidden = ds.name !== "All Teams";
            } else {
                const isRelevant = ds.name === "All Teams" || ds.name === currentTeam || (dispatcherNameFromAccess && ds.name === dispatcherNameFromAccess);
                ds.hidden = !isRelevant;
            }
        }
    });

    const margin = { top: 20, right: 40, bottom: 30, left: 50 }; 
    const width = container.node().clientWidth - margin.left - margin.right;
    const height = container.node().clientHeight - margin.top - margin.bottom - 80; 
    
    const svg = container.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    svg.append("defs").append("clipPath").attr("id", "drops-clip").append("rect").attr("width", width).attr("height", height);

    const calculateXDomain = () => {
        const visibleDatasets = datasets.filter(ds => !ds.hidden);
        const setsToCheck = visibleDatasets.length > 0 ? visibleDatasets : datasets;
        
        const allPoints = setsToCheck.flatMap(ds => ds.data);
        if (allPoints.length === 0) return [new Date(), new Date()];

        const maxDate = d3.max(allPoints, d => d.weekDate);
        const minDate = d3.min(allPoints, d => d.weekDate);
        return [minDate, maxDate];
    };

    // Smart tick count based on number of data points
    const getTickCount = () => {
        const visibleDatasets = datasets.filter(ds => !ds.hidden);
        const setsToCheck = visibleDatasets.length > 0 ? visibleDatasets : datasets;
        if (setsToCheck.length > 0 && setsToCheck[0].data) {
             const pointCount = setsToCheck[0].data.length;
             return Math.min(pointCount, 12);
        }
        return 5;
    };

    const x = d3.scaleTime().domain(calculateXDomain()).range([0, width]);
    const y = d3.scaleLinear().range([height, 0]);

    const xAxisGroup = svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(getTickCount()).tickFormat(d3.timeFormat("%b %d"))).attr("color", "#9ca3af");
    const yAxisGroup = svg.append("g").call(d3.axisLeft(y).ticks(5)).attr("color", "#9ca3af");
    
    const gridGroup = svg.append("g").attr("class", "grid").call(d3.axisLeft(y).tickSize(-width).tickFormat("").ticks(5)).style("stroke-dasharray", "3, 3").style("stroke-opacity", 0.1);
    gridGroup.select(".domain").remove();

    const chartBody = svg.append("g").attr("clip-path", "url(#drops-clip)");
    const line = d3.line().x(d => x(d.weekDate)).y(d => y(d[metricKey])).defined(d => d[metricKey] !== null).curve(d3.curveMonotoneX);
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10); 

    const updateChart = () => {
        x.domain(calculateXDomain());
        
        const [xMin, xMax] = x.domain();
        const visibleDataPoints = datasets
            .filter(ds => !ds.hidden)
            .flatMap(ds => ds.data.filter(d => d[metricKey] !== null && d.weekDate >= xMin && d.weekDate <= xMax));
        
        if (visibleDataPoints.length > 0) {
            const vals = visibleDataPoints.map(d => d[metricKey]);
            y.domain([0, Math.max(...vals) + 1]);
        } else {
             y.domain([0, 10]);
        }

        const t = svg.transition().duration(750);
        
        const tickValues = Array.from(new Set(
            datasets.filter(ds => !ds.hidden)
            .flatMap(ds => ds.data)
            .filter(d => d.weekDate >= x.domain()[0] && d.weekDate <= x.domain()[1])
            .map(d => d.weekDate.getTime())
        )).sort((a, b) => a - b).map(t => new Date(t));

        xAxisGroup.transition(t).call(d3.axisBottom(x).tickValues(tickValues).tickFormat(d3.timeFormat("%b %d")));
        yAxisGroup.transition(t).call(d3.axisLeft(y).ticks(5));
        gridGroup.transition(t).call(d3.axisLeft(y).tickSize(-width).tickFormat(""));
        gridGroup.select(".domain").remove();

        datasets.forEach((ds, i) => {
            const path = chartBody.selectAll(`.line-${i}`).data([ds.data]);
            path.enter().append("path").attr("class", `line-series line-${i}`)
                .attr("fill", "none")
                .attr("stroke", colorScale(i))
                .attr("stroke-width", ds.name === "All Teams" ? 4 : 2)
                .style("opacity", ds.hidden ? 0 : 1)
                .attr("d", line)
                .merge(path).transition(t)
                .attr("d", line)
                .attr("stroke", colorScale(i))
                .style("opacity", ds.hidden ? 0 : 1);
            
            const dots = chartBody.selectAll(`.dot-${i}`).data(ds.data.filter(d => d[metricKey] !== null));
            dots.enter().append("circle").attr("class", `dot-series dot-${i}`)
                .attr("r", 4)
                .attr("fill", "#1f2937")
                .attr("stroke", colorScale(i))
                .attr("stroke-width", 2)
                .attr("cx", d => x(d.weekDate))
                .attr("cy", d => y(d[metricKey]))
                .style("opacity", ds.hidden ? 0 : 1)
                .merge(dots).transition(t)
                .attr("cx", d => x(d.weekDate))
                .attr("cy", d => y(d[metricKey]))
                .style("opacity", ds.hidden ? 0 : 1);
            dots.exit().remove();
        });
    };

    updateChart();

    const legendContainer = container.append("div").attr("class", "chart-legend flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2 px-4 overflow-y-auto").style("max-height", "80px");
    
    datasets.forEach((ds, i) => {
        const color = colorScale(i);
        legendContainer.append("div")
            .attr("class", `chart-legend-item cursor-pointer flex items-center gap-2 text-xs select-none ${ds.hidden ? 'opacity-40 grayscale' : 'opacity-100'}`)
            .style("text-decoration", ds.hidden ? "line-through" : "none")
            .html(`<div class="w-3 h-3 rounded-full" style="background-color: ${color}"></div><span>${ds.name}</span>`)
            .on("click", function() {
                ds.hidden = !ds.hidden;
                const el = d3.select(this);
                el.classed("opacity-40 grayscale", ds.hidden).classed("opacity-100", !ds.hidden).style("text-decoration", ds.hidden ? "line-through" : "none");
                updateChart();
            });
    });

    const tooltip = d3.select("body").append("div").attr("class", "d3-tooltip drops-tooltip").style("opacity", 0);
    const focus = svg.append("g").style("display", "none");
    focus.append("line").attr("y1", 0).attr("y2", height).style("stroke", "#4b5563").style("stroke-dasharray", "3,3");

    svg.append("rect").attr("width", width).attr("height", height).style("fill", "none").style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); })
        .on("mousemove", (event) => {
            const x0 = x.invert(d3.pointer(event)[0]);
            const visibleDatasets = datasets.filter(ds => !ds.hidden);
            if (visibleDatasets.length === 0) return;
            const refData = visibleDatasets[0].data;
            const bisect = d3.bisector(d => d.weekDate).left;
            const i = bisect(refData, x0, 1);
            const d0 = refData[i - 1], d1 = refData[i];
            const d = (d0 && d1) ? (x0 - d0.weekDate > d1.weekDate - x0 ? d1 : d0) : (d0 || d1);

            if (d) {
                focus.attr("transform", `translate(${x(d.weekDate)},0)`);
                const headerText = d3.timeFormat("%b %d")(d.weekDate);
                let html = `<div class="font-bold text-white border-b border-gray-600 pb-1 mb-1 text-center">${headerText}</div>`;
                
                const points = datasets.map((ds, idx) => {
                    const pt = ds.data.find(p => p.weekDate.getTime() === d.weekDate.getTime());
                    return pt && !ds.hidden ? { name: ds.name, val: pt[metricKey], color: colorScale(idx) } : null;
                }).filter(Boolean).sort((a, b) => b.val - a.val);

                points.forEach(p => {
                    html += `<div class="flex justify-between gap-4 text-xs"><span style="color:${p.color}">${p.name}</span><span class="font-mono text-white">${p.val}</span></div>`;
                });
                tooltip.html(html).style("left", (event.pageX + 15) + "px").style("top", (event.pageY - 28) + "px");
            }
        });
}