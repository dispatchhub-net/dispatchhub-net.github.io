import { appState } from '../state.js';
import { canViewDispatcher } from '../auth.js';
import { calculateComplianceScores } from '../profiles/profiles_ui.js';
import { getOrComputeHistoricalMetrics } from '../rankings/rankings_api.js';
import { getPayrollWeekDateRange, calculateMedian, showSavingIndicator, hideSavingIndicator } from '../utils.js';
let _cachedDispatcherList = {};
let _lastCacheTime = null;
let _hasLoadedLOO = false;
const debounce = (func, delay) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

// --- HELPER: Enriched Stubs (Sync with Fleet Health) ---
function getEnrichedStubs(stubs) {
    const sorted = [...stubs].sort((a, b) => new Date(a.pay_date) - new Date(b.pay_date));
    const driverMap = new Map();

    return sorted.map(stub => {
        const driver = stub.driver_name;
        let info = driverMap.get(driver) || {};

        const rowDisp = stub.stub_dispatcher || stub.current_dispatcher;
        const rowTeam = stub.stub_team || stub.current_team;
        const rowComp = stub.company_name;

        if (rowDisp) info.disp = rowDisp;
        if (rowTeam) info.team = rowTeam;
        if (rowComp) info.comp = rowComp;
        
        driverMap.set(driver, info);

        return {
            ...stub,
            stub_dispatcher: rowDisp || info.disp,
            stub_team: rowTeam || info.team,
            company_name: rowComp || info.comp
        };
    });
}

// --- ALGORITHM: EFFECTIVE MAX CAPACITY ---
// Helper to get the effective max capacity based on selected mode
function getEffectiveMaxCapacity(dispatcher, mode) {
    let customData = appState.delegation.capacityCustom[dispatcher.name];
    
    // If it's a simple number (legacy override), return it
    if (typeof customData === 'number') {
        return customData;
    }

    // Determine which rule set to use: Custom (if array) or Global Mode
    const rules = Array.isArray(customData) ? customData : (appState.delegation.capacityRules[mode] || []);
    
    // Determine which criteria to compare against. 
    // Note: Even custom rules are evaluated against the currently selected Global Mode criteria (1w or 4w)
    const criteriaKey = (mode === 'rank4w') ? 'criteria4w' : 'criteria1w';
    const criteriaValue = dispatcher[criteriaKey];
    
    if (criteriaValue === null || criteriaValue === undefined) return 5;

    // Find match
    const matchingRule = rules.find(rule => 
        criteriaValue >= rule.min && criteriaValue <= rule.max
    );

    return matchingRule ? matchingRule.cap : 5;
}
// --- ALGORITHM: WEIGHTED SUITABILITY SCORE ---
function calculateDelegationScore(maxCap, stats, assignment) {
    const weights = appState.delegation.weights;
    
    const currentCount = stats.currentTrucks;
    const pendingCount = assignment?.pendingCount || 0;
    
    const vacancy = maxCap - (currentCount + pendingCount);
    
    // 1. "Need" Score (Vacancy)
    const needScore = vacancy > 0 ? Math.min(100, vacancy * 25) : -1000;

    // 2. Rank Scores (Inverted: Rank 1 is better)
    const rank4wScore = stats.rank4w ? Math.max(0, 100 - stats.rank4w) : 0;
    const rank1wScore = stats.rank1w ? Math.max(0, 100 - stats.rank1w) : 0;

    // 3. Compliance Score (0-100)
    const complianceScore = stats.compliance || 0;

    // 4. Final Weighted Calc
    const finalScore = 
        (needScore * (weights.need / 100)) +
        (rank4wScore * (weights.rank4w / 100)) +
        (rank1wScore * (weights.rank1w / 100)) +
        (complianceScore * (weights.compliance / 100));

    return finalScore;
}

// --- HELPER: Get Dispatcher List (Robust Calculation) ---
// --- CACHING OPTIMIZATION ---
function getDispatcherList() {
    const currentFilter = appState.delegation.activeContractFilter || 'all';

    if (_lastCacheTime !== appState.lastRefreshed) {
        _cachedDispatcherList = {};
        _lastCacheTime = appState.lastRefreshed;
    }

    if (_cachedDispatcherList[currentFilter]) {
        return _cachedDispatcherList[currentFilter];
    }

    // 2. If no cache or stale, perform the heavy calculation
    const liveData = appState.profiles.liveData || [];
    const liveDrivers = appState.profiles.liveDriverCountData || [];
    const historicalStubs = appState.loads.historicalStubsData || [];

    const enrichedHistoricalStubs = getEnrichedStubs(historicalStubs);
    
    const { start: liveStart, end: liveEnd } = getPayrollWeekDateRange(0);
    const { start: prevStart, end: prevEnd } = getPayrollWeekDateRange(1);

    const targetPayDateLive = new Date(liveEnd);
    targetPayDateLive.setUTCDate(liveEnd.getUTCDate() + 3); 
    targetPayDateLive.setUTCHours(23, 59, 59, 999);
    const fourWeeksAgoStartLive = new Date(targetPayDateLive);
    fourWeeksAgoStartLive.setDate(fourWeeksAgoStartLive.getDate() - 21);
    fourWeeksAgoStartLive.setUTCHours(0, 0, 0, 0);

    const targetPayDatePrev = new Date(prevEnd);
    targetPayDatePrev.setUTCDate(prevEnd.getUTCDate() + 3);
    targetPayDatePrev.setUTCHours(23, 59, 59, 999);
    const fourWeeksAgoStartPrev = new Date(targetPayDatePrev);
    fourWeeksAgoStartPrev.setDate(fourWeeksAgoStartPrev.getDate() - 21);
    fourWeeksAgoStartPrev.setUTCHours(0, 0, 0, 0);

    const liveDispatcherNames = [...new Set(liveDrivers.map(d => d.dispatcher_name).filter(Boolean))];
    
    const targetPayDateString = targetPayDatePrev.toISOString().split('T')[0];
    const prevWeekStubsPool = enrichedHistoricalStubs.filter(d => 
        d.pay_date && new Date(d.pay_date).toISOString().split('T')[0] === targetPayDateString
    );
    const prevWeekDispatcherNames = [...new Set(prevWeekStubsPool.map(d => d.stub_dispatcher).filter(Boolean))];
    const combinedDispatcherNames = [...new Set([...liveDispatcherNames, ...prevWeekDispatcherNames])].sort();

    console.log("%c[DELEGATION] Universe:", "color: cyan; font-weight: bold;", combinedDispatcherNames);

    // --- OPTIMIZATION: Index Stubs ---
    const stubsByDriver = new Map();
    const stubsByDispatcher = new Map();
    enrichedHistoricalStubs.forEach(s => {
        if (!stubsByDriver.has(s.driver_name)) stubsByDriver.set(s.driver_name, []);
        stubsByDriver.get(s.driver_name).push(s);
        
        if (s.stub_dispatcher) {
            if (!stubsByDispatcher.has(s.stub_dispatcher)) stubsByDispatcher.set(s.stub_dispatcher, []);
            stubsByDispatcher.get(s.stub_dispatcher).push(s);
        }
    });
    // Ensure sorted by date descending
    for (const list of stubsByDriver.values()) list.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
    // --------------------------------

    const getLowRpmThreshold = (contract) => {
        const thresholds = appState.profiles.thresholdSettings.lowRpm;
        return thresholds.by_contract[contract] ?? thresholds.default;
    };
    const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;

    const getLatestRanks = (name, filterOverride) => {
        const key = filterOverride ? filterOverride.toLowerCase() : (appState.delegation.activeContractFilter || 'all').toLowerCase();
        const cache = appState.precomputationCache?.dispatcher?.[key] || appState.precomputationCache?.dispatcher?.['all'];
        if (!cache) return { rank1w: null, rank4w: null, criteria4w: null, criteria1w: null };
        const entityData = cache.get(name);
        if (!entityData || entityData.length === 0) return { rank1w: null, rank4w: null, criteria4w: null, criteria1w: null };
        const latest = [...entityData].sort((a, b) => b.date - a.date)[0];
        return { rank1w: latest.oneWeekRank, rank4w: latest.fourWeekRank, criteria4w: latest.fourWeekCriteria, criteria1w: latest.oneWeekCriteria };
    };

    const calculateRetentionForWindow = (name, startDate, endDate) => {
        const dStubs = stubsByDispatcher.get(name) || [];
        const poolStubs = dStubs.filter(s => {
            const pDate = new Date(s.pay_date);
            return pDate >= startDate && pDate <= endDate &&
                   ['Active', 'Terminated', 'Start'].includes((s.retention_status || '').trim());
        });

        const historicalPool = new Set(poolStubs.map(s => s.driver_name));
        const details = { retained: [], terminated: [], transferred: [] };
        let retainedCount = 0;

        historicalPool.forEach(driverName => {
            let isTerminated = false, isTransferred = false;
            const allDriverStubs = stubsByDriver.get(driverName) || [];
            const driverStubsInWindow = allDriverStubs.filter(s => {
                const pDate = new Date(s.pay_date);
                return pDate >= startDate && pDate <= endDate;
            });

            if (driverStubsInWindow.length > 0) {
                const lastStub = driverStubsInWindow[0];
                if ((lastStub.retention_status || '').trim() === 'Terminated') {
                    if (lastStub.stub_dispatcher === name) isTerminated = true;
                    else { isTransferred = true; details.transferred.push({ name: driverName, to: lastStub.stub_dispatcher }); }
                } else if (lastStub.stub_dispatcher !== name) {
                    isTransferred = true;
                    details.transferred.push({ name: driverName, to: lastStub.stub_dispatcher });
                }
            }
            if (isTerminated) details.terminated.push(driverName);
            else if (isTransferred) {} 
            else { retainedCount++; details.retained.push(driverName); }
        });
        return { percent: historicalPool.size > 0 ? (retainedCount / historicalPool.size) * 100 : null, details };
    };

    const fullDispatcherList = combinedDispatcherNames.map((name, index) => {
        const myLiveDrivers = liveDrivers.filter(d => d.dispatcher_name === name);
        const ooTrucks = myLiveDrivers.filter(d => d.contract_type === 'OO').length;
        const looTrucks = myLiveDrivers.filter(d => d.contract_type !== 'OO').length;

        const liveNewStarts = liveData.filter(d => d.dispatcher === name && d.new_start === 'NEW START' && d.do_date && new Date(d.do_date) >= liveStart);
        const historicalNewStarts = historicalStubs.filter(s => (s.stub_dispatcher === name || s.current_dispatcher === name) && s.retention_status === 'Start' && s.pay_date && new Date(s.pay_date) >= fourWeeksAgoStartLive && new Date(s.pay_date) < liveStart);
        const uniqueNewDrivers = new Set([...liveNewStarts.map(l => l.driver), ...historicalNewStarts.map(s => s.driver_name)]);
        const newStartDetails = Array.from(uniqueNewDrivers).map(driverName => {
            const lLoad = liveNewStarts.find(l => l.driver === driverName);
            const hStub = historicalNewStarts.find(s => s.driver_name === driverName);
            return { name: driverName, date: lLoad ? lLoad.pu_date : (hStub ? hStub.pay_date : new Date()) };
        });

        const myPrevLoads = liveData.filter(d => d.dispatcher === name && d.do_date && new Date(d.do_date) >= prevStart && new Date(d.do_date) <= prevEnd);
        const wellnessLoads = myPrevLoads.filter(d => ['GOOD', 'FAIL', '-'].includes(d.wellness_fail));
        const wellness = wellnessLoads.length > 0 ? (wellnessLoads.filter(l => l.wellness_fail === 'GOOD' || l.wellness_fail === '-').length / wellnessLoads.length) * 100 : 0;
        
        const movedLoads = myPrevLoads.filter(d => d.moved_monday === 'Moved Monday Load');
        const goodMoves = movedLoads.filter(l => (l.driver_gross_without_moved || 0) < (goodMoveThresholds.by_contract[l.contract_type] ?? goodMoveThresholds.default)).length;
        const badMoves = movedLoads.length - goodMoves;
        const hiddenMiles = myPrevLoads.filter(d => d.hidden_miles === 'Hidden Miles Found!').length;
        const lowRpm = myPrevLoads.filter(d => d.rpm_all < getLowRpmThreshold(d.contract_type)).length;
        const canceled = myPrevLoads.filter(d => d.status === 'Canceled').length;
        const overdueLoads = appState.profiles.overdueLoadsData.filter(ol => ol.dispatcher === name && ol.deliveryDate && new Date(ol.deliveryDate) >= prevStart && new Date(ol.deliveryDate) <= prevEnd).reduce((sum, ol) => sum + (ol.daysPastDO || 0), 0);

        // Tuesday Open Logic (with Date Shift)
        const tuesdayOpen = (appState.profiles.tuesdayOpenData || []).filter(d => {
            if (d.dispatch !== name) return false;
            
            const dDate = new Date(d.date);
            // Shift Tuesday back 1 day to count for the previous week
            const shiftBack = dDate.getUTCDay() === 2 ? 1 : 0; 
            dDate.setUTCDate(dDate.getUTCDate() - shiftBack);

            return dDate >= prevStart && dDate <= prevEnd;
        }).length;

        // Missing Paperwork Logic
        const missingPaperwork = (appState.profiles.missingPaperworkData || []).filter(d => {
            if (d.dispatch !== name) return false;
            const dDate = new Date(d.do_date);
            return dDate >= prevStart && dDate <= prevEnd;
        }).length;

        // Calculator Activity (Previous Week)
        let prevDaysVisited = 0;
        const prevActivityData = appState.profiles.calculatorActivityData || [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(prevStart);
            day.setUTCDate(day.getUTCDate() + i);
            const dayString = day.toISOString().split('T')[0];
            
            const record = prevActivityData.find(d => {
                if (d.dispatcher !== name) return false;
                return new Date(d.date).toISOString().split('T')[0] === dayString;
            });
            if (record && (parseFloat(record.minutes) || 0) > 0) prevDaysVisited++;
        }
        const calculatorActivity = (prevDaysVisited / 7) * 100;

        const trailerDrops = (appState.profiles.trailerDropsData || []).filter(d => {
            if (d.droppedByDispatcher !== name) return false;
            if (!d.dropTime) return false;
            const dDate = new Date(d.dropTime);
            return dDate >= prevStart && dDate <= prevEnd;
        }).length;

        const trailerRecoveries = (appState.profiles.trailerDropsData || []).filter(d => {
            if (d.recoveredByDispatcher !== name) return false;
            if (!d.recoveryTime) return false;
            const rDate = new Date(d.recoveryTime);
            return rDate >= prevStart && rDate <= prevEnd;
        }).length;

        const rcEntries = (appState.profiles.rcEntryData || [])
            .filter(d => d.dispatcher === name && d.date && new Date(d.date) >= prevStart && new Date(d.date) <= prevEnd)
            .map(d => parseFloat(d.entry_minutes)).filter(m => !isNaN(m));
        const rcEntry = rcEntries.length > 0 ? calculateMedian(rcEntries) : null;

        const prevRetention = calculateRetentionForWindow(name, fourWeeksAgoStartPrev, targetPayDatePrev, false);

        const calculateTenure = (contractType) => {
            const activeDriverNames = new Set(prevWeekStubsPool.filter(s => s.stub_dispatcher === name && (contractType === 'OO' ? s.contract_type === 'OO' : s.contract_type !== 'OO')).map(s => s.driver_name));
            if (activeDriverNames.size === 0) return null;
            const tenures = Array.from(activeDriverNames).map(driverName => {
                 const dStubs = stubsByDriver.get(driverName) || [];
                 return dStubs.filter(s => s.stub_dispatcher === name && s.total_miles > 0 && new Date(s.pay_date) <= targetPayDatePrev).length;
            }).filter(t => t > 0);
            return tenures.length > 0 ? calculateMedian(tenures) : null;
        };

        const activeRanks = getLatestRanks(name);
        const allRanks = getLatestRanks(name, 'all'); // Fetch 'ALL' criteria for Max Capacity
        
        const validCriteria4w = allRanks.criteria4w !== null ? allRanks.criteria4w : activeRanks.criteria4w;
        const validCriteria1w = allRanks.criteria1w !== null ? allRanks.criteria1w : activeRanks.criteria1w;

        const currentDriversList = myLiveDrivers.map(d => ({ name: d.driver_name, contract: d.contract_type })).sort((a, b) => a.name.localeCompare(b.name));

        return {
            id: index, name: name, team: myLiveDrivers[0]?.dispatcher_team || 'N/A', loads: myPrevLoads,
            ooTrucks, looTrucks, currentDrivers: currentDriversList, newStartsCount: uniqueNewDrivers.size, newStartDetails,
            goodMoves, badMoves, hiddenMiles, lowRpm, overdueLoads, tuesdayOpen, missingPaperwork, calculatorActivity, trailerDrops, trailerRecoveries, rcEntry, newStarts: 0, canceled, wellness,
            retention4w: prevRetention.percent !== null ? prevRetention.percent : 0, retentionDetails: prevRetention.details,
            medianTenureOO: calculateTenure('OO'), medianTenureLOO: calculateTenure('LOO'),
            // Display Ranks from the ACTIVE filter
            rank1w: activeRanks.rank1w, rank4w: activeRanks.rank4w, 
            // Criteria for Max Capacity (Fallback to active if ALL is missing)
            criteria4w: validCriteria4w, criteria1w: validCriteria1w,
            // Criteria for Display (MUST be ACTIVE)
            displayCriteria4w: activeRanks.criteria4w, displayCriteria1w: activeRanks.criteria1w,
        };
    });
    
    const scoredList = calculateComplianceScores(fullDispatcherList, fullDispatcherList);
    
   const finalResult = scoredList.filter(d => liveDispatcherNames.includes(d.name));
    _cachedDispatcherList[currentFilter] = finalResult;

    return finalResult;
}

export const renderDelegationUI = () => {
    const container = document.getElementById('delegation-content');
    if (!container) return;

if (!appState.delegation.capacityMode) {
        appState.delegation.capacityMode = 'rank1w';
    }
    const { activeContractFilter, activeTeamFilter, assignments, capacityCustom, capacityMode, hideFullCapacity } = appState.delegation;    const searchTerm = (appState.delegation.searchTerm || '').toLowerCase();
    const requiredFilter = (activeContractFilter || 'all').toLowerCase();
    if (!appState.precomputationCache.dispatcher || !appState.precomputationCache.dispatcher[requiredFilter]) {
        const originalMode = appState.rankingMode;
        const originalFilter = appState.driverTypeFilter;
        appState.rankingMode = 'dispatcher';
        appState.driverTypeFilter = requiredFilter;
        getOrComputeHistoricalMetrics();
        appState.rankingMode = originalMode;
        appState.driverTypeFilter = originalFilter;
    }
    
    // Always regenerate list to ensure latest/live data usage
    const allDispatchers = getDispatcherList();
    const availableTeams = ['ALL_TEAMS', ...new Set(allDispatchers.map(d => d.team).filter(t => t && t !== 'N/A'))].sort();

    // Filter Logic
    let filteredDispatchers = allDispatchers.filter(d => {
        if (!canViewDispatcher(d.name)) return false;
        if (activeTeamFilter !== 'ALL_TEAMS' && d.team !== activeTeamFilter) return false;
        
       // Changed: using startsWith instead of includes
        if (searchTerm && !d.name.toLowerCase().startsWith(searchTerm)) return false;
        return true;
    });

    // Calculate Scores
    // Calculate Scores
    let tableRows = filteredDispatchers.map(d => {
        const contractSpecificTrucks = activeContractFilter === 'OO' ? d.ooTrucks : d.looTrucks;
        const totalTrucks = d.ooTrucks + d.looTrucks;
        
        const maxCapacity = getEffectiveMaxCapacity(d, capacityMode);
        const assignment = assignments[d.name] || { pendingCount: 0, note: '' };
        
        // Live Reconciliation
        if (assignment.countAtAssignment && contractSpecificTrucks > assignment.countAtAssignment) {
             const diff = contractSpecificTrucks - assignment.countAtAssignment;
             assignment.pendingCount = Math.max(0, assignment.pendingCount - diff);
             if(assignment.pendingCount === 0) delete assignments[d.name]; 
        }

        const stats = {
            currentTrucks: contractSpecificTrucks, 
            totalTrucks: totalTrucks,             
            rank4w: d.rank4w,
            criteria4w: d.criteria4w, // ALL criteria for Max Capacity
            rank1w: d.rank1w,
            criteria1w: d.criteria1w, // ALL criteria for Max Capacity
            compliance: d.complianceScore,
            retention4w: d.retention4w,
            retentionDetails: d.retentionDetails, 
            newStarts: d.newStartsCount, 
            newStartDetails: d.newStartDetails,
            // Active criteria for displaying under Rank columns
            displayCriteria4w: d.displayCriteria4w, 
            displayCriteria1w: d.displayCriteria1w
        };
        const score = calculateDelegationScore(maxCapacity, stats, assignment);

        // Vacancy based on ACTIVE filter (used for Need column in UI)
        const projectedForUI = contractSpecificTrucks + (assignment.pendingCount || 0);
        const visualVacancy = maxCapacity - projectedForUI;

        // Vacancy based on TOTAL trucks (used for the Hide Full Capacity button logic)
        // We use the same pendingCount as a conservative measure, even though it's technically contract-specific.
        const totalProjectedForFilter = totalTrucks + (assignment.pendingCount || 0);
        const totalVacancyForFilter = maxCapacity - totalProjectedForFilter;

        return { ...d, stats, maxCapacity, assignment, delegationScore: score, visualVacancy: visualVacancy, totalVacancyForFilter: totalVacancyForFilter };
    });

    // NEW: Full Capacity Filter - Hides if TOTAL capacity (OO+LOO) is full or over.
    if (hideFullCapacity) {
        tableRows = tableRows.filter(row => row.totalVacancyForFilter > 0);
    }

    tableRows.sort((a, b) => b.delegationScore - a.delegationScore);

const totalCurrent = tableRows.reduce((sum, r) => sum + r.stats.currentTrucks, 0);
    const totalMax = tableRows.reduce((sum, r) => sum + r.maxCapacity, 0);

    // Render
    container.innerHTML = `
        <div class="flex flex-wrap justify-between items-center mb-4 p-4 bg-gray-800 rounded-xl border border-gray-700 shadow-lg gap-4">
            <div class="flex items-center gap-6">
                <h2 class="text-xl font-bold text-white flex items-center gap-2">
                    <svg class="w-6 h-6 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                    Driver Delegation
                </h2>
                
                <div class="relative">
                    <input type="text" id="delegation-search-input" 
                           placeholder="Search dispatcher..." 
                           value="${appState.delegation.searchTerm || ''}" 
                           class="bg-gray-700 text-white text-sm font-semibold py-1.5 px-3 rounded-lg border border-gray-600 focus:outline-none focus:border-teal-500 w-48 transition-colors">
                </div>

               <div class="relative inline-block text-left w-48 z-30">
                    <button onclick="window.toggleDelegationTeamDropdown(event)" id="delegation-team-dropdown-btn" class="flex items-center justify-between w-full bg-gray-700 text-white text-sm font-semibold py-1.5 px-3 rounded-lg border border-gray-600 focus:outline-none focus:border-teal-500 transition-colors">
                        <span class="truncate">${activeTeamFilter === 'ALL_TEAMS' ? 'All Teams' : activeTeamFilter}</span>
                        <svg class="w-4 h-4 ml-2 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div id="delegation-team-dropdown-list" class="hidden absolute right-0 mt-1 w-full bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto custom-scrollbar">
                        ${availableTeams.map(t => `
                            <div onclick="window.selectDelegationTeam('${t}')" class="px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm ${activeTeamFilter === t ? 'text-teal-400 font-bold bg-gray-700/50' : 'text-gray-200'}">
                                ${t === 'ALL_TEAMS' ? 'All Teams' : t}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div id="delegation-contract-container" class="flex items-center bg-gray-700 rounded-lg p-1 border border-gray-600 transition-all duration-300">
                   <button class="px-3 py-1 text-xs font-bold rounded transition-colors ${activeContractFilter === 'OO' ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'}" onclick="window.setDelegationContract('OO')">OO</button>
                   <button class="px-3 py-1 text-xs font-bold rounded transition-colors ${activeContractFilter === 'LOO' ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'}" onclick="window.setDelegationContract('LOO')">LOO</button>
                </div>
            </div>
            
            <div class="flex items-center gap-1">
                <button onclick="window.toggleHideFullCapacity()" class="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-gray-700 ${hideFullCapacity ? 'bg-red-800 hover:bg-red-700 !text-white' : ''}" title="${hideFullCapacity ? 'Reveal Full Capacity Dispatchers' : 'Hide Full Capacity Dispatchers'}">
                    <svg class="w-6 h-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="stroke: ${hideFullCapacity ? 'white' : 'currentColor'}">
                        ${hideFullCapacity ?
    '<path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0112 5.25c4.755 0 8.773 2.942 10.02 7.027A10.48 10.48 0 0112 18.75c-4.755 0-8.773-2.942-10.02-7.027"/><path stroke-linecap="round" stroke-linejoin="round" d="M9.53 14.47a3.75 3.75 0 105.303-5.303"/><path stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18"/>'
    :
    '<path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.647 16.49 16.619 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0Z"/>'
}

                    </svg>
                </button>
            <button onclick="window.openDispatcherSettings()" class="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-gray-700" title="Dispatcher Settings">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
            </button>
            <button onclick="window.toggleDelegationSettings()" class="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-gray-700" title="Algorithm Settings">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"></path></svg>
            </button>
        </div>
        </div>

<div class="overflow-auto rounded-lg border border-gray-700 max-h-[calc(100vh-130px)]">
            <table class="w-full text-sm text-left text-gray-400 relative">
                <thead class="text-xs text-gray-300 uppercase bg-gray-900 sticky top-0 z-10 shadow-md">
                    <tr>
                        <th class="px-4 py-3 text-center">Rank</th>
                        <th class="px-4 py-3">Dispatcher</th>
                       <th class="px-4 py-3 text-center">
                            <div class="flex items-center justify-center gap-1 pr-12">
                                Capacity
                                <button onclick="window.openCapacityBreakdownModal()" class="text-gray-500 hover:text-teal-400 transition-colors" title="View Team Breakdown">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                </button>
                            </div>
                        </th>
                      <th class="px-4 py-3 text-center">
                            <div class="flex items-center justify-center gap-1">
                                Retention (4W)
                                <div class="dispatch-tooltip-trigger text-gray-500 hover:text-teal-400 cursor-help transition-colors" data-tooltip-html="This metric calculates retention for ALL drivers (both Owner Operators & Lease Owner Operators). It represents the percentage of drivers who were active 4 weeks ago and are still active today.">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>
                                </div>
                            </div>
                        </th>
                        <th class="px-4 py-3 text-center">New Starts</th>
                        <th class="px-4 py-3 text-center text-blue-300">1W Rank</th>
                        <th class="px-4 py-3 text-center text-purple-300">4W Rank</th>
                        <th class="px-4 py-3 text-center text-teal-300">Compliance</th>
                        <th class="px-4 py-3 text-center text-orange-300">Need</th>
                        <th class="px-4 py-3 text-right">Action</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-800 bg-gray-800/50">
                    ${tableRows.length > 0 ? tableRows.map((row, index) => renderDelegationRow(row, index + 1)).join('') : `<tr><td colspan="10" class="p-8 text-center text-gray-500">No dispatchers found.</td></tr>`}
                </tbody>
            </table>
        </div>
    `;
    
    renderDelegationSettingsModal();
    renderDispatcherSettingsModal(); 
    renderAssignmentModal();
    attachDelegationTooltips(container);

    const searchInput = document.getElementById('delegation-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', debounce((e) => {
            window.updateDelegationSearch(e.target.value);
        }, 400));
        // Ensure focus is kept if user is typing fast right after a render (though unlikely with debounce)
        const valLength = searchInput.value.length;
        if (document.activeElement === searchInput) {
             searchInput.setSelectionRange(valLength, valLength);
        }
    }
};

function renderDelegationRow(row, rank) {
    const { stats, assignment, currentDrivers } = row;
    
    let capObj = appState.delegation.capacityCustom[row.name];
    if (!capObj || typeof capObj === 'number' || capObj.OO !== undefined) {
        capObj = { max: 5, oo: true, loo: true };
    }

    const activeFilter = appState.delegation.activeContractFilter || 'OO';
    const maxCapacity = row.maxCapacity; 
    const currentCount = stats.totalTrucks;
    
    const totalPending = assignment.pendingCount || 0;
    
    let displayPending = totalPending;

    const totalProjected = currentCount + displayPending;
    const isFull = totalProjected >= maxCapacity;
    
    const fillPercent = maxCapacity > 0 ? Math.min(100, (currentCount / maxCapacity) * 100) : 100;
    const pendingPercent = maxCapacity > 0 ? Math.min(100, (displayPending / maxCapacity) * 100) : 0;
    
    const visualVacancy = maxCapacity - totalProjected;
    const vacancyColor = visualVacancy > 0 ? 'text-green-400' : 'text-red-400';

    const pendingContract = assignment.contractType;
    let totalText = '';
    
    if (activeFilter === 'OO') {
        totalText = `OO: ${row.ooTrucks}`;
        if (totalPending > 0 && pendingContract === 'OO') {
             totalText += ` <span class="text-yellow-400 font-bold">(+${totalPending})</span>`;
        }
    } else {
        totalText = `LOO: ${row.looTrucks}`;
        if (totalPending > 0 && pendingContract === 'LOO') {
             totalText += ` <span class="text-yellow-400 font-bold">(+${totalPending})</span>`;
        }
    }

    const retentionTooltip = generateRetentionTooltip(stats.retentionDetails);
    const newStartsTooltip = generateNewStartsTooltip(stats.newStartDetails);
    
    const rankStyle = rank <= 3 ? 'text-green-400 font-bold text-lg' : 'text-gray-500';
    
    const rVal = stats.retention4w || 0;
    const retentionColor = rVal >= 70 ? 'text-green-400' : rVal >= 40 ? 'text-orange-400' : 'text-red-400';
    
    // --- TOOLTIP GENERATION FOR DRIVERS & NOTES ---
    let driverListHtml = `<div class='text-left min-w-[250px]'>`;
    driverListHtml += `<div class='mb-3'><strong class='text-gray-200 border-b border-gray-600 block mb-1 pb-1'>Active Drivers (${(currentDrivers || []).length})</strong>`;
    if (currentDrivers && currentDrivers.length > 0) {
        driverListHtml += `<ul class='text-xs text-gray-300 list-none pl-0 leading-relaxed max-h-[200px] overflow-y-auto custom-scrollbar'>`;
        currentDrivers.forEach(d => {
            const displayContract = d.contract === 'OO' ? 'OO' : 'LOO';
            const contractColor = displayContract === 'OO' ? 'text-blue-300' : 'text-gray-400';
            driverListHtml += `<li>${d.name} <span class='${contractColor} text-[10px] ml-1 opacity-80'>${displayContract}</span></li>`;
        });
        driverListHtml += `</ul>`;
    } else {
        driverListHtml += `<span class='text-gray-500 italic text-xs'>No active drivers.</span>`;
    }
    driverListHtml += `</div>`;

    if (assignment.pendingCount > 0 && (assignment.driverName || assignment.note)) {
         driverListHtml += `<div><strong class='text-yellow-400 border-b border-gray-600 block mb-1 pb-1'>Pending Assignment</strong>`;
         if (assignment.driverName) driverListHtml += `<div class='text-xs text-white font-semibold mb-0.5'>${assignment.driverName} <span class='text-gray-500 font-normal'>(${assignment.contractType || '?'})</span></div>`;
         if (assignment.note) driverListHtml += `<div class='text-xs text-gray-400 italic'>"${assignment.note}"</div>`;
         driverListHtml += `</div>`;
    }
    driverListHtml += `</div>`;
    const escapedTooltip = driverListHtml.replace(/"/g, '&quot;');

    return `
        <tr class="hover:bg-gray-700 transition-colors group">
            <td class="px-4 py-3 text-center ${rankStyle}">#${rank}</td>
            <td class="px-4 py-3">
                <div class="font-medium text-white flex items-center gap-2">
                    ${row.name}
                    <div class="dispatch-tooltip-trigger text-gray-500 hover:text-teal-400 cursor-help transition-colors" data-tooltip-html="${escapedTooltip}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
                          <path fill-rule="evenodd" d="M4.5 2A1.5 1.5 0 003 3.5v13A1.5 1.5 0 004.5 18h11a1.5 1.5 0 001.5-1.5V7.621a1.5 1.5 0 00-.44-1.06l-4.12-4.122A1.5 1.5 0 0011.378 2H4.5zm2.25 8.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5zm0 3a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5h-6.5z" clip-rule="evenodd" />
                        </svg>
                    </div>
                </div>
                <div class="text-xs text-gray-500">${row.team}</div>
                ${assignment.updatedBy ? `<div class="text-[10px] text-gray-600 mt-0.5">By ${assignment.updatedBy}</div>` : ''}
            </td>
            
            <td class="px-4 py-3 align-middle">
                <div class="flex flex-col w-36 cursor-pointer hover:opacity-90 transition-opacity" onclick="window.openEditCapacityModal('${row.name}', ${maxCapacity})" title="Click to edit Max Capacity">
                    <div class="flex justify-between items-end mb-1">
                        <span class="text-xs font-bold text-white">${currentCount}<span class="text-gray-500 font-normal">/${maxCapacity}</span></span>
                        <span class="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">${totalText}</span>
                    </div>
                    
                    <div class="w-full h-2 bg-gray-700 rounded-full overflow-hidden relative border border-gray-600">
                        <div class="absolute top-0 left-0 h-full bg-teal-500 transition-all duration-500" style="width: ${fillPercent}%"></div>
                        ${displayPending > 0 ? `<div class="absolute top-0 h-full bg-yellow-500 striped-bar" style="left: ${fillPercent}%; width: ${pendingPercent}%"></div>` : ''}
                    </div>
                    
                    ${displayPending > 0 ? `
                    <div class="text-[10px] text-yellow-400 text-right mt-0.5 font-medium">
                        +${displayPending} Pending
                    </div>` : ''}
                </div>
            </td>

            <td class="px-4 py-3 text-center">
                <span class="dispatch-tooltip-trigger cursor-help border-b border-dashed border-gray-600 ${retentionColor}" 
                      data-tooltip-html="${retentionTooltip}">
                    ${stats.retention4w !== null ? stats.retention4w.toFixed(0) + '%' : '-'}
                </span>
            </td>

            <td class="px-4 py-3 text-center">
                <span class="dispatch-tooltip-trigger cursor-help border-b border-dashed border-gray-600 text-blue-300"
                      data-tooltip-html="${newStartsTooltip}">
                    ${stats.newStarts || 0}
                </span>
            </td>

            <td class="px-4 py-3 text-center font-mono text-blue-200 font-semibold">
                ${stats.rank1w ? `<div class="flex flex-col items-center leading-tight"><span>#${stats.rank1w}</span><span class="text-[10px] text-gray-400 font-sans font-normal">(${(stats.displayCriteria1w * 100).toFixed(1)}%)</span></div>` : '-'}
            </td>
            <td class="px-4 py-3 text-center font-mono text-purple-200 font-semibold">
                ${stats.rank4w ? `<div class="flex flex-col items-center leading-tight"><span>#${stats.rank4w}</span><span class="text-[10px] text-gray-400 font-sans font-normal">(${(stats.displayCriteria4w * 100).toFixed(1)}%)</span></div>` : '-'}
            </td>
            <td class="px-4 py-3 text-center text-teal-400 font-bold">${stats.compliance ? stats.compliance.toFixed(0) + '%' : '-'}</td>
            <td class="px-4 py-3 text-center font-bold ${vacancyColor}">${visualVacancy}</td>

            <td class="px-4 py-3 text-right">
                <div class="flex items-center justify-end gap-2">
                    ${assignment.pendingCount > 0 ? `
                        <button onclick="window.updateAssignment('${row.name}', -1)" class="p-1 text-red-400 hover:bg-red-900/50 rounded" title="Remove Assignment">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </button>
                        <button onclick="window.openAssignmentModal('${row.name}')" class="p-1 text-yellow-400 hover:bg-yellow-900/50 rounded" title="Edit Note">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                    ` : ''}
                    
                    <button onclick="window.openAssignmentModal('${row.name}')" class="p-1 bg-teal-600 hover:bg-teal-500 text-white rounded-md shadow transition-colors disabled:opacity-50 disabled:cursor-not-allowed" ${isFull ? 'disabled' : ''} title="Assign Driver">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function renderDelegationSettingsModal() {
    let modal = document.getElementById('delegation-settings-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'delegation-settings-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[200] p-4 hidden';
        document.body.appendChild(modal);
    }

    const weights = appState.delegation.weights;
    const total = weights.need + weights.rank4w + weights.rank1w + weights.compliance;
    const isValid = total === 100;

    modal.innerHTML = `
        <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div class="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                <h3 class="text-lg font-bold text-white">Algorithm Weights</h3>
                <button onclick="window.toggleDelegationSettings()" class="text-gray-400 hover:text-white text-2xl">&times;</button>
            </div>
            <div class="space-y-4">
                ${renderWeightInput('Need (Missing Drivers)', 'need', weights.need)}
                ${renderWeightInput('4W Rank', 'rank4w', weights.rank4w)}
                ${renderWeightInput('1W Rank', 'rank1w', weights.rank1w)}
                ${renderWeightInput('Compliance', 'compliance', weights.compliance)}
                
                <div class="flex justify-between items-center pt-2 border-t border-gray-700 mt-4">
                    <span class="text-sm text-gray-400">Total:</span>
                    <span class="font-bold ${isValid ? 'text-green-400' : 'text-red-400'}">${total}%</span>
                </div>
            </div>
            <div class="mt-6 flex justify-end">
                <button onclick="window.saveDelegationWeights()" class="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-md transition-colors disabled:opacity-50" ${!isValid ? 'disabled' : ''}>Save Changes</button>
            </div>
        </div>
    `;
    
    modal.classList.toggle('hidden', !appState.delegation.isSettingsModalOpen);
}

function renderWeightInput(label, key, value) {
    return `
        <div class="flex justify-between items-center">
            <label class="text-sm text-gray-300">${label}</label>
            <div class="relative w-20">
                <input type="number" value="${value}" oninput="window.updateDelegationWeight('${key}', this.value)" class="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-right text-white focus:outline-none focus:border-teal-500">
                <span class="absolute right-6 top-1 text-gray-500 text-xs">%</span>
            </div>
        </div>
    `;
}

// --- TOOLTIP LOGIC ---
function attachDelegationTooltips(containerElement) {
    const tooltip = document.getElementById('dispatch-tooltip');
    if (!tooltip) return;

    if (containerElement._mouseoverHandler) containerElement.removeEventListener('mouseover', containerElement._mouseoverHandler);
    if (containerElement._mousemoveHandler) containerElement.removeEventListener('mousemove', containerElement._mousemoveHandler);
    if (containerElement._mouseoutHandler) containerElement.removeEventListener('mouseout', containerElement._mouseoutHandler);

    containerElement._mouseoverHandler = (e) => {
        const trigger = e.target.closest('.dispatch-tooltip-trigger');
        if (trigger && trigger.dataset.tooltipHtml) {
            tooltip.innerHTML = trigger.dataset.tooltipHtml;
            tooltip.style.zIndex = '9999'; // Force tooltip to top
            tooltip.classList.add('visible');
        }
    };
    
    containerElement._mousemoveHandler = (e) => {
        if (tooltip.classList.contains('visible')) {
            const tooltipRect = tooltip.getBoundingClientRect();
            let left = e.pageX - tooltipRect.width - 15;
            if (left < 10) left = e.pageX + 15;
            
            let top = e.pageY + 15;
            if (e.clientY + 15 + tooltipRect.height > window.innerHeight) {
                top = e.pageY - tooltipRect.height - 15;
            }

            tooltip.style.left = `${left}px`;
            tooltip.style.top = `${top}px`;
        }
    };
    
    containerElement._mouseoutHandler = (e) => {
        if (e.target.closest('.dispatch-tooltip-trigger')) {
            tooltip.classList.remove('visible');
        }
    };

    containerElement.addEventListener('mouseover', containerElement._mouseoverHandler);
    containerElement.addEventListener('mousemove', containerElement._mousemoveHandler);
    containerElement.addEventListener('mouseout', containerElement._mouseoutHandler);
}

// --- HELPERS & GLOBALS ---
// --- HELPER: Tooltip Generator (Matches Fleet Health) ---
function generateRetentionTooltip(rData) {
    if (!rData || (rData.retained.length === 0 && rData.terminated.length === 0 && rData.transferred.length === 0)) return "No history found.";
    
    let html = `<div class='text-left min-w-[200px]'>`;
    
    if (rData.retained.length > 0) {
        html += `<div class='mb-2'><strong class='text-green-400 block border-b border-gray-600 mb-1'>Retained (${rData.retained.length})</strong><div class='text-xs text-gray-300 leading-relaxed'>${rData.retained.join(', ')}</div></div>`;
    }
    
    if (rData.terminated.length > 0) {
        html += `<div class='mb-2'><strong class='text-red-400 block border-b border-gray-600 mb-1'>Terminated (${rData.terminated.length})</strong><div class='text-xs text-gray-300 leading-relaxed'>${rData.terminated.join(', ')}</div></div>`;
    }
    
    if (rData.transferred.length > 0) {
        html += `<div><strong class='text-yellow-400 block border-b border-gray-600 mb-1'>Transferred (${rData.transferred.length})</strong><ul class='text-xs text-gray-300 list-none pl-0 leading-relaxed'>`;
        rData.transferred.forEach(t => {
            html += `<li>${t.name} <span class='text-gray-500'>→ ${t.to}</span></li>`;
        });
        html += `</ul></div>`;
    }
    
    if (rData.retained.length === 0 && rData.terminated.length === 0 && rData.transferred.length === 0) {
        html += `<span class='text-gray-500 italic'>No historical drivers found in 4W window.</span>`;
    }
    
    html += `</div>`;
    return html.replace(/"/g, '&quot;');
}

function generateNewStartsTooltip(starts) {
    if (!starts || starts.length === 0) return "No new starts in 4 weeks.";
    let html = `<div class='text-left'><strong class='text-blue-300'>New Starts (${starts.length})</strong><ul class='pl-3 list-disc text-xs text-gray-300 mt-1'>`;
    starts.forEach(s => {
        const date = new Date(s.date).toLocaleDateString('en-US', {month:'numeric', day:'numeric'});
        html += `<li>${s.name} <span class='text-gray-500'>(${date})</span></li>`;
    });
    html += `</ul></div>`;
    return html.replace(/"/g, '&quot;');
}

window.setDelegationContract = (type) => {
    if (appState.delegation.activeContractFilter === type) return;

    if (type === 'LOO' && !_hasLoadedLOO) {
        const container = document.getElementById('delegation-contract-container');
        if (container) {
            const spinner = document.createElement('div');
            spinner.className = 'ml-2 w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin';
            container.appendChild(spinner);
        }
        
        setTimeout(() => {
            appState.delegation.activeContractFilter = type;
            renderDelegationUI();
            _hasLoadedLOO = true;
        }, 100); 
    } else {
        appState.delegation.activeContractFilter = type;
        renderDelegationUI();
    }
};


window.setDelegationTeam = (team) => {
    appState.delegation.activeTeamFilter = team;
    renderDelegationUI();
};

window.toggleDelegationSettings = () => {
    appState.delegation.isSettingsModalOpen = !appState.delegation.isSettingsModalOpen;
    renderDelegationUI(); 
};

window.updateDelegationWeight = (key, value) => {
    appState.delegation.weights[key] = parseInt(value) || 0;
    renderDelegationSettingsModal(); 
};

window.saveDelegationWeights = () => {
    window.toggleDelegationSettings();
    renderDelegationUI(); 
};

window.updateAssignment = (dispatcherName, change) => {
    const current = appState.delegation.assignments[dispatcherName] || { pendingCount: 0, note: '' };
    const newCount = Math.max(0, current.pendingCount + change);
    
    if (newCount === 0) {
        delete appState.delegation.assignments[dispatcherName];
    } else {
        const list = getDispatcherList();
        const dispatcherData = list.find(d => d.name === dispatcherName);
        const contract = appState.delegation.activeContractFilter;
        const count = contract === 'OO' ? dispatcherData?.ooTrucks : dispatcherData?.looTrucks;

        appState.delegation.assignments[dispatcherName] = {
            ...current,
            pendingCount: newCount,
            countAtAssignment: appState.delegation.assignments[dispatcherName]?.countAtAssignment || count || 0, 
            updatedBy: appState.auth.user?.email || 'Unknown'
        };
    }
    renderDelegationUI();
};

window.editAssignmentNote = (dispatcherName) => {
    const currentNote = appState.delegation.assignments[dispatcherName]?.note || '';
    const newNote = prompt("Enter note:", currentNote);
    if (newNote !== null) {
        if (!appState.delegation.assignments[dispatcherName]) appState.delegation.assignments[dispatcherName] = { pendingCount: 0 };
        appState.delegation.assignments[dispatcherName].note = newNote;
        renderDelegationUI();
    }
};

window.openEditCapacityModal = (dispatcherName, currentCap) => {
    let modal = document.getElementById('edit-capacity-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'edit-capacity-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[200] p-4 hidden transition-opacity duration-200 opacity-0';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm p-6 transform transition-all scale-95 duration-200">
            <h3 class="text-lg font-bold text-white mb-4">Set Max Capacity for <span class="text-teal-400">${dispatcherName}</span></h3>
            <input type="number" id="edit-capacity-input" value="${currentCap}" min="0" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-teal-500 mb-6 text-center text-xl font-bold">
            <div class="flex justify-end gap-3">
                <button onclick="window.closeEditCapacityModal()" class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg transition-colors font-medium">Cancel</button>
                <button onclick="window.saveEditCapacity('${dispatcherName}')" class="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white font-bold rounded-lg transition-colors shadow-lg">Save</button>
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
    // Simple animation
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.firstElementChild.classList.remove('scale-95');
        modal.firstElementChild.classList.add('scale-100');
    });
    
    setTimeout(() => {
        const input = document.getElementById('edit-capacity-input');
        if(input) {
            input.focus();
            input.select();
        }
    }, 50);

    // Add Enter key listener
    const input = document.getElementById('edit-capacity-input');
    input.onkeydown = (e) => {
        if (e.key === 'Enter') window.saveEditCapacity(dispatcherName);
        if (e.key === 'Escape') window.closeEditCapacityModal();
    };
};

window.closeEditCapacityModal = () => {
    const modal = document.getElementById('edit-capacity-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        modal.firstElementChild.classList.remove('scale-100');
        modal.firstElementChild.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
};

window.saveEditCapacity = (dispatcherName) => {
    const input = document.getElementById('edit-capacity-input');
    const parsed = parseInt(input.value);
    if (!isNaN(parsed) && parsed >= 0) {
        // Update capacityCustom and revert to rank1w mode
        appState.delegation.capacityCustom[dispatcherName] = parsed;
        appState.delegation.capacityMode = 'rank1w';
        renderDelegationUI();
    }
    window.closeEditCapacityModal();
};
window.updateDelegationSearch = (value) => {
    appState.delegation.searchTerm = value;
    renderDelegationUI();
    setTimeout(() => {
        const el = document.getElementById('delegation-search-input');
        if(el) {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, 0);
};
// --- ASSIGNMENT MODAL LOGIC ---

// --- ASSIGNMENT MODAL LOGIC ---

function renderAssignmentModal() {
    let modal = document.getElementById('delegation-assignment-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'delegation-assignment-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[200] p-4 hidden';
        
        // Get contract types from appState or define defaults
        const contractTypes = appState.loads?.contractTypes || [
            { id: 'OO', text: 'Owner Operator (OO)' },
            { id: 'LOO', text: 'Lease Owner Operator (LOO)' },
            { id: 'MCLOO', text: 'MCLOO' },
            { id: 'POG', text: 'POG' },
            { id: 'CPM', text: 'CPM' },
            { id: 'LPOO', text: 'LPOO' }
        ];

        const optionsHTML = contractTypes.map(c => `<option value="${c.id}">${c.text || c.id}</option>`).join('');

        modal.innerHTML = `
            <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-md p-6 transform transition-all scale-100">
                <div class="flex justify-between items-center mb-5 border-b border-gray-700 pb-3">
                    <h3 class="text-xl font-bold text-white flex items-center gap-2">
                        <svg class="w-6 h-6 text-teal-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                        Assign Driver
                    </h3>
                    <button onclick="window.closeAssignmentModal()" class="text-gray-400 hover:text-white text-2xl transition-colors">&times;</button>
                </div>
                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Driver Name</label>
                        <input type="text" id="assign-driver-name" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors" placeholder="Enter driver name...">
                    </div>
                    <div>
                        <div class="relative">
                        <label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Contract Type</label>
                        <input type="hidden" id="assign-contract-type" value="">
                        <button id="assign-contract-btn" onclick="window.toggleAssignContractDropdown(event)" class="flex items-center justify-between w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-white focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors text-left">
                            <span id="assign-contract-display">Select...</span>
                            <svg class="w-4 h-4 ml-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        <div id="assign-contract-list" class="hidden absolute top-full left-0 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 overflow-hidden">
                            </div>
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Note</label>
                        <textarea id="assign-driver-note" rows="3" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-colors" placeholder="Add a note about this assignment..."></textarea>
                    </div>
                </div>
                <div class="mt-8 flex justify-end gap-3">
                    <button onclick="window.closeAssignmentModal()" class="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium transition-colors">Cancel</button>
                    <button onclick="window.saveAssignment()" class="px-5 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg font-bold shadow-lg shadow-teal-900/20 transition-all hover:scale-105">SAVE</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
}

window.openAssignmentModal = (dispatcherName) => {
    appState.delegation.modalDispatcher = dispatcherName;
    const modal = document.getElementById('delegation-assignment-modal');
    const nameInput = document.getElementById('assign-driver-name');
    const contractInput = document.getElementById('assign-contract-type');
    const noteInput = document.getElementById('assign-driver-note');
    
const capConfig = appState.delegation.dispatcherPreferences[dispatcherName] || { oo: true, loo: true };
    const allTypes = [
        { id: 'OO', text: 'Owner Operator (OO)' },
        { id: 'LOO', text: 'Lease Owner Operator (LOO)' }
    ];

    const allowedOptions = allTypes.filter(type => {
        if (type.id === 'OO') return capConfig.oo !== false;
        return capConfig.loo !== false;
    });

   const contractListDiv = document.getElementById('assign-contract-list');
    const contractDisplay = document.getElementById('assign-contract-display');

    // Generate custom dropdown items
    contractListDiv.innerHTML = allowedOptions.map(c => 
        `<div onclick="window.selectAssignContract('${c.id}', '${c.text || c.id}')" class="px-4 py-2 hover:bg-gray-700 cursor-pointer text-sm text-gray-200">
            ${c.text || c.id}
        </div>`
    ).join('');

    const currentAssignment = appState.delegation.assignments[dispatcherName];
    nameInput.value = ''; 
    
    const preferredDefault = appState.delegation.activeContractFilter || 'OO';
    const isPreferredAllowed = allowedOptions.some(o => o.id === preferredDefault);
    const defaultVal = isPreferredAllowed ? preferredDefault : (allowedOptions.length > 0 ? allowedOptions[0].id : '');
    const defaultText = allowedOptions.find(o => o.id === defaultVal)?.text || defaultVal;

    contractInput.value = defaultVal;
    contractDisplay.textContent = defaultText;
    noteInput.value = currentAssignment ? currentAssignment.note : '';
    
    modal.classList.remove('hidden');
    nameInput.focus();
};

window.closeAssignmentModal = () => {
    const modal = document.getElementById('delegation-assignment-modal');
    modal.classList.add('hidden');
    appState.delegation.modalDispatcher = null;
};

window.saveAssignment = async () => {
    const dispatcherName = appState.delegation.modalDispatcher;
    if (!dispatcherName) return;

    const driverName = document.getElementById('assign-driver-name').value.trim();
    const contractType = document.getElementById('assign-contract-type').value;
    const note = document.getElementById('assign-driver-note').value.trim();

    window.closeAssignmentModal();
    
    showSavingIndicator();

    await new Promise(resolve => setTimeout(resolve, 600));

    const current = appState.delegation.assignments[dispatcherName] || { pendingCount: 0, note: '' };
    
    const newCount = current.pendingCount + 1;

    appState.delegation.assignments[dispatcherName] = {
        ...current,
        pendingCount: newCount,
        note: note,
        driverName: driverName, 
        contractType: contractType,
        updatedBy: appState.auth.user?.email || 'Unknown',
        lastUpdated: new Date().toISOString()
    };

    renderDelegationUI();
    
    hideSavingIndicator();
};


window.setRowContract = (dispatcherName, contract) => {
    if (!appState.delegation.rowContractStates) appState.delegation.rowContractStates = {};
    appState.delegation.rowContractStates[dispatcherName] = contract;
    renderDispatcherSettingsModal();
};
// Helper to get the current tab/view for the settings modal
function getSettingsModalView() {
    // We use a property in appState.delegation to store the active view
    return appState.delegation.settingsModalView || 'maxCapacity';
}
// Helper to render the rules table for any context (global mode or specific dispatcher)
function renderRulesTable(rules, context) {
    if (!rules || rules.length === 0) return '<div class="text-gray-500 text-xs italic">No rules defined.</div>';
    
    return rules.map((rule, index) => {
        const isFirst = index === 0;
        const isLast = index === rules.length - 1;
        let rangeContent;

        if (isFirst) {
            rangeContent = `
               <div class="flex items-center justify-start gap-2 flex-1">
                <span class="text-white font-bold text-lg">&lt;</span>
                <input type="number" step="0.01" value="${(rule.max * 100).toFixed(2)}" 
                       data-rule-prop="max" data-context="${context}"
                       onchange="window.handleRuleCriteriaInput(this)"
                       class="rule-input-criteria bg-gray-700 border border-gray-600 rounded-lg text-white text-left pl-3 focus:border-teal-500 outline-none w-20">
                <span class="text-gray-500 font-bold text-sm">%</span>
            </div>`;
        } else if (isLast) {
            rangeContent = `
               <div class="flex items-center justify-start gap-2 flex-1">
                <span class="text-white font-bold text-lg">&gt;</span>
                <input type="number" step="0.01" value="${(rule.min * 100).toFixed(2)}" 
                       data-rule-prop="min" data-context="${context}" 
                       onchange="window.handleRuleCriteriaInput(this)"
                       class="rule-input-criteria bg-gray-700 border border-gray-600 rounded-lg text-white text-left pl-3 focus:border-teal-500 outline-none w-20">
                <span class="text-gray-500 font-bold text-sm">%</span>
            </div>`;
        } else {
            rangeContent = `
                <div class="flex items-center justify-start gap-2 flex-1">
                <input type="number" step="0.01" value="${(rule.min * 100).toFixed(2)}" 
                       data-rule-prop="min" data-context="${context}"
                       onchange="window.handleRuleCriteriaInput(this)"
                       class="rule-input-criteria bg-gray-700 border border-gray-600 rounded-lg text-white text-left pl-3 focus:border-teal-500 outline-none w-20">
                <span class="text-gray-500 font-bold text-sm">%</span>
                <span class="text-gray-400 font-bold text-lg">-</span>
                <input type="number" step="0.01" value="${(rule.max * 100).toFixed(2)}" 
                       data-rule-prop="max" data-context="${context}"
                       onchange="window.handleRuleCriteriaInput(this)"
                       class="rule-input-criteria bg-gray-700 border border-gray-600 rounded-lg text-white text-left pl-3 focus:border-teal-500 outline-none w-20">
                <span class="text-gray-500 font-bold text-sm">%</span>
            </div>`;
        }

        return `
            <div class="flex items-center gap-4 py-1.5 border-b border-gray-700/50 rule-row" data-index="${index}">
                ${rangeContent}
                <div class="flex items-center gap-2 min-w-[80px]">
                    <span class="text-gray-500 text-[10px] font-black uppercase tracking-tighter">Cap</span>
                    <input type="number" value="${rule.cap}" 
                           data-rule-prop="cap" data-context="${context}" 
                           oninput="window.handleRuleCriteriaInput(this)"
                           class="rule-input-cap bg-gray-800 border-2 border-teal-600/30 rounded-lg text-lg font-black text-center text-teal-400 focus:border-teal-500 outline-none w-16">
                </div>
                <div class="w-8 flex justify-center">
                    <button onclick="window.removeCapacityRule('${context}', ${index})" class="p-2 text-red-400 hover:bg-red-900/30 rounded-full transition-all ${isFirst || isLast ? 'invisible' : ''}">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}
function renderCapacityRulesEditor(mode) {
    const settings = appState.delegation.tempSettings || appState.delegation;
    const rules = settings.capacityRules[mode] || [];
    rules.sort((a, b) => a.min - b.min);
    
    const overrides = settings.capacityCustom || {};
    
    const allDispatchers = getDispatcherList().sort((a, b) => a.name.localeCompare(b.name));
    
    const isSearchOpen = appState.delegation.isOverrideSearchOpen;
    const searchTerm = (appState.delegation.overrideSearchTerm || '').toLowerCase();

    const displayList = allDispatchers.filter(d => d.name.toLowerCase().startsWith(searchTerm));

  return `
    <div class="space-y-8 pb-10">
        <div class="bg-gray-800/50 p-4 rounded-xl border border-gray-700 shadow-sm">
            <div class="flex justify-between items-center mb-3">
                <h4 class="text-sm font-bold text-teal-400 uppercase tracking-wider flex items-center gap-2">
                    Global Rules (${mode === 'rank1w' ? '1W' : '4W'})
                </h4>
                <button onclick="window.addCapacityRule('${mode}')" class="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded transition-colors">+ Add Segment</button>
            </div>
            <div id="rules-container-${mode}" class="space-y-1">
                ${renderRulesTable(rules, mode)}
            </div>
        </div>

        <div class="space-y-3">
            <div class="flex justify-between items-center border-b border-gray-700 pb-2">
                <h4 class="text-xs font-bold text-yellow-400 uppercase tracking-wider flex items-center gap-2">
                    Individual Overrides
                </h4>
                <button onclick="window.toggleOverrideSearch()" class="px-3 py-1.5 bg-yellow-500/10 text-yellow-400 border border-yellow-500/30 rounded hover:bg-yellow-500 hover:text-gray-900 transition-all text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                    ${isSearchOpen ? 'Close List' : '+ Edit Individual Capacities'}
                </button>
            </div>
            
            ${isSearchOpen ? `
                <div class="mb-4 bg-gray-700 p-3 rounded-lg border border-gray-600 animate-fade-in-up">
                    <div class="mb-3">
                        <input type="text" id="override-search-input" 
                               placeholder="Filter list (starts with)..." 
                               value="${appState.delegation.overrideSearchTerm || ''}"
                               oninput="window.updateOverrideSearch(this.value)"
                               class="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500">
                    </div>

                    <div id="overrides-list-scroll" class="overflow-y-auto custom-scrollbar max-h-[400px] border border-gray-600 rounded-lg">
                        <table class="w-full text-left text-sm text-gray-400">
                            <thead class="bg-gray-800 text-xs uppercase sticky top-0 z-10">
                                <tr>
                                    <th class="px-4 py-2 font-semibold text-gray-300">Dispatcher</th>
                                    <th class="px-4 py-2 text-center font-semibold text-gray-300">Source</th>
                                    <th class="px-4 py-2 text-center font-semibold text-teal-400">Max Cap</th>
                                    <th class="px-4 py-2 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody id="overrides-table-body" class="divide-y divide-gray-700 bg-gray-800/50">
                                ${renderOverridesTableRows(displayList, overrides, rules, mode)}
                            </tbody>
                        </table>
                    </div>
                </div>
            ` : ''}

            ${!isSearchOpen ? `
                <div class="space-y-2 mt-4">
                    <div class="text-xs text-gray-500 uppercase font-bold mb-2">Active Manual Overrides</div>
                     ${Object.keys(overrides).filter(key => typeof overrides[key] === 'number').map(name => `
                        <div class="flex items-center justify-between bg-gray-700/30 border border-gray-600/50 rounded p-2 px-3">
                            <span class="text-sm text-white font-medium">${name}</span>
                            <div class="flex items-center gap-3">
                                <span class="text-sm font-bold text-yellow-400">${overrides[name]} <span class="text-[10px] text-gray-500 font-normal">MAX</span></span>
                                <button onclick="window.revertToRule('${name.replace(/'/g, "\\'")}')" class="text-gray-500 hover:text-red-400">
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                                </button>
                            </div>
                        </div>
                     `).join('')}
                     ${Object.keys(overrides).filter(key => typeof overrides[key] === 'number').length === 0 ? '<div class="text-xs text-gray-600 italic">No manual overrides active. All dispatchers following global rules.</div>' : ''}
                </div>
            ` : ''}
        </div>
    </div>
    `;
}
function renderDispatcherSettingsTab(dispatchers, activeTab) {
    const settings = appState.delegation.tempSettings || appState.delegation;
    const { capacityCustom } = settings;
    const activeView = getSettingsModalView();

    const getCapacityValue = (d) => {
        if (activeView === 'maxCapacity') {
            const customValue = capacityCustom[d.name];
            const fallbackMode = settings.lastAlgorithmicMode || 'rank1w';
            return (customValue !== undefined && customValue !== null) ? customValue : getEffectiveMaxCapacity(d, fallbackMode);
        } else {
            return getEffectiveMaxCapacity(d, settings.capacityMode);
        }
    };
    
    const showCapacityColumn = activeTab === 'capacity';
    const showContractsColumn = activeTab === 'contracts';
    
    const rowsHTML = dispatchers.map(d => {
        const effectiveCapacity = getCapacityValue(d);
        const preferences = settings.dispatcherPreferences[d.name] || { oo: true, loo: true };
        const capacityCell = showCapacityColumn ? `
            <td class="px-4 py-3 text-center">
                <input type="number" value="${effectiveCapacity}" min="0" 
                       data-dispatcher="${d.name}"
                       oninput="window.handleCapacityInput(this)"
                       class="capacity-input bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-center text-white w-20 focus:outline-none focus:border-teal-500 transition-colors"
                       ${activeView !== 'maxCapacity' ? 'disabled' : ''}>
            </td>
        ` : '';

        const contractsCell = showContractsColumn ? `
            <td class="px-4 py-3 text-center">
                <div class="flex items-center justify-center gap-4">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" 
                               onchange="window.toggleDispatcherContract('${d.name}', 'oo', this.checked)"
                               ${preferences.oo ? 'checked' : ''} 
                               class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 bg-gray-900 focus:ring-teal-500">
                        <span class="text-xs text-gray-300 font-bold">OO</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" 
                               onchange="window.toggleDispatcherContract('${d.name}', 'loo', this.checked)"
                               ${preferences.loo ? 'checked' : ''} 
                               class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 bg-gray-900 focus:ring-teal-500">
                        <span class="text-xs text-gray-300 font-bold">LOO</span>
                    </label>
                </div>
            </td>
        ` : '';

        return `
            <tr class="border-b border-gray-700 hover:bg-gray-700/50">
                <td class="px-4 py-3 text-sm font-medium text-white">${d.name}</td>
                ${capacityCell}
                ${contractsCell}
            </tr>
        `;
    }).join('');

    // Conditional bulk action row
    const bulkActionRow = showCapacityColumn ? `
        <div class="p-4 bg-gray-800/50 border-b border-gray-700 flex justify-end items-center gap-4">
            ${activeView === 'maxCapacity' ? `
                <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-400 uppercase font-semibold">Apply Max Capacity to All:</span>
                    <input type="number" placeholder="5" 
                           oninput="window.handleBulkCapacityInput(this)"
                           class="w-20 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm text-center text-white focus:outline-none focus:border-teal-500 transition-colors">
                </div>
           ` : `
                <div class="text-xs text-gray-400 uppercase font-semibold">
                    Max Capacity is set by criteria: <span class="text-teal-400">${(settings.capacityMode === 'rank1w') ? 'Rankings (1W)' : 'Rankings (4W)'}</span>
                </div>
            `}
        </div>
    ` : '';
    
    // Conditional table headers
    const capacityHeader = showCapacityColumn ? `<th class="px-4 py-3 text-center font-semibold text-teal-400">Max Capacity</th>` : '';
    const contractsHeader = showContractsColumn ? `<th class="px-4 py-3 text-center font-semibold">Allowed Contracts</th>` : '';

    return `
        ${bulkActionRow}
        <div class="overflow-y-auto flex-grow p-0 relative">
            <table class="w-full text-left border-collapse">
                <thead class="bg-gray-900 text-gray-400 text-xs uppercase sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th class="px-4 py-3 font-semibold">Dispatcher</th>
                        ${capacityHeader}
                        ${contractsHeader}
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-800">
                    ${rowsHTML}
                </tbody>
            </table>
        </div>
    `;
}

function renderCapacitySettingsContent() {
    const settings = appState.delegation.tempSettings || appState.delegation;
    const activeMode = settings.capacityMode;
    const dispatchers = getDispatcherList().sort((a, b) => a.name.localeCompare(b.name));

    if (activeMode === 'custom') {
        return `
            <div id="capacity-custom-editor" class="h-full">
                ${renderDispatcherSettingsTab(dispatchers, 'capacity')}
            </div>
        `;
    } else if (activeMode === 'rank1w' || activeMode === 'rank4w') {
        return `
            <div id="capacity-ranking-rules" class="p-4 overflow-y-auto h-full">
                ${renderCapacityRulesEditor(activeMode)}
            </div>
        `;
    }
    return '';
}

function renderDispatcherSettingsModal() {
    let modal = document.getElementById('dispatcher-settings-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'dispatcher-settings-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[200] p-4 hidden';
        document.body.appendChild(modal);
    }
    
    const settings = appState.delegation.tempSettings || appState.delegation;
    const dispatchers = getDispatcherList().sort((a, b) => a.name.localeCompare(b.name));
    const activeTab = appState.delegation.settingsModalTab || 'capacity';
    const activeMode = settings.capacityMode;

    const tooltipText = "Select the criteria used to calculate Max Capacity automatically. <br><br><b>Rankings (1W/4W):</b> Uses the performance rules defined below.<br><b>Manually set:</b> Allows you to manually set limits per dispatcher.";

    const mainScroll = document.getElementById('dispatcher-settings-main-scroll');
    const rulesScroll = document.getElementById('capacity-ranking-rules'); 
    const overrideScroll = document.getElementById('overrides-list-scroll');
    
    const mainScrollPos = mainScroll ? mainScroll.scrollTop : 0;
    const rulesScrollPos = rulesScroll ? rulesScroll.scrollTop : 0;
    const overrideScrollPos = overrideScroll ? overrideScroll.scrollTop : 0;

    modal.innerHTML = `
        <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col h-[85vh] transform transition-all duration-75 scale-100">
            <div class="flex justify-between items-center p-5 border-b border-gray-700 flex-shrink-0">
                <h3 class="text-xl font-bold text-white flex items-center gap-2">
                    <svg class="w-6 h-6 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                    Dispatcher Settings
                </h3>
                <button onclick="window.closeDispatcherSettings()" class="text-gray-400 hover:text-white text-3xl">&times;</button>
            </div>

            <div class="p-4 flex-shrink-0 border-b border-gray-700">
                <div class="flex bg-gray-700 rounded-lg p-1 border border-gray-600">
                    <button class="px-3 py-1 text-sm font-bold rounded transition-colors w-1/2 ${activeTab === 'capacity' ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'}" onclick="window.setSettingsModalTab('capacity')">Max Capacity</button>
                    <button class="px-3 py-1 text-sm font-bold rounded transition-colors w-1/2 ${activeTab === 'contracts' ? 'bg-teal-500 text-white' : 'text-gray-400 hover:text-white'}" onclick="window.setSettingsModalTab('contracts')">Allowed Contracts</button>
                </div>
            </div>

            <div id="dispatcher-settings-main-scroll" class="overflow-y-auto flex-grow p-0 relative">
                ${activeTab === 'capacity' ? `
                    <div class="p-4 flex flex-col h-full">
                        <div class="flex flex-col md:flex-row items-start md:items-center gap-3 mb-4 p-3 bg-gray-700/50 rounded-lg border border-gray-600 flex-shrink-0">
                            <div class="flex items-center gap-2">
                                <label for="capacity-mode-select" class="text-xs font-semibold text-gray-300 uppercase whitespace-nowrap flex items-center gap-1">
                                    Max Capacity Criteria
                                     <div class="dispatch-tooltip-trigger text-gray-500 hover:text-teal-400 cursor-help transition-colors" data-tooltip-html="${tooltipText}">
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>
                                    </div>
                                    :
                                </label>
                            </div>
                            <div class="flex items-center gap-3 w-full">
                                <div class="relative w-48">
                                    <select id="capacity-mode-select" onchange="window.setCapacityMode(this.value)" class="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-teal-500">
                                        <option value="rank1w" ${activeMode === 'rank1w' ? 'selected' : ''}>Rankings (1W)</option>
                                        <option value="rank4w" ${activeMode === 'rank4w' ? 'selected' : ''}>Rankings (4W)</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div class="flex-grow min-h-0 relative">
                            ${renderCapacitySettingsContent()}
                        </div>
                    </div>
                ` : `
                    <div class="p-4 h-full flex flex-col">
                        ${renderDispatcherSettingsTab(dispatchers, activeTab)}
                    </div>
                `}
            </div>
            
            <div class="p-5 border-t border-gray-700 flex justify-end flex-shrink-0 bg-gray-800 rounded-b-2xl">
                <button onclick="window.saveAndCloseDispatcherSettings()" class="px-6 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold rounded-lg transition-colors shadow-lg">Done</button>
            </div>
        </div>
    `;
    
    setTimeout(() => {
        const newMainScroll = document.getElementById('dispatcher-settings-main-scroll');
        if (newMainScroll) newMainScroll.scrollTop = mainScrollPos;

        const newRulesScroll = document.getElementById('capacity-ranking-rules');
        if (newRulesScroll) newRulesScroll.scrollTop = rulesScrollPos;

        const newOverrideScroll = document.getElementById('overrides-list-scroll');
        if (newOverrideScroll) newOverrideScroll.scrollTop = overrideScrollPos;
    }, 0);

    attachDelegationTooltips(modal);
}

window.openDispatcherSettings = () => {
    appState.delegation.tempSettings = JSON.parse(JSON.stringify({
        capacityMode: appState.delegation.capacityMode,
        capacityCustom: appState.delegation.capacityCustom,
        capacityRules: appState.delegation.capacityRules,
        dispatcherPreferences: appState.delegation.dispatcherPreferences,
        lastAlgorithmicMode: appState.delegation.lastAlgorithmicMode,
        capacityGroups: appState.delegation.capacityGroups || [] 
    }));
    
    appState.delegation.isOverrideSearchOpen = false;
    appState.delegation.overrideSearchTerm = '';

    appState.delegation.isDispatcherSettingsModalOpen = true;
    renderDispatcherSettingsModal();
    const modal = document.getElementById('dispatcher-settings-modal');
    if (modal) modal.classList.remove('hidden');
};

window.closeDispatcherSettings = () => {
    delete appState.delegation.tempSettings;
    appState.delegation.isDispatcherSettingsModalOpen = false;
    const modal = document.getElementById('dispatcher-settings-modal');
    if (modal) modal.classList.add('hidden');
};

window.saveAndCloseDispatcherSettings = () => {
    if (appState.delegation.tempSettings) {
        Object.assign(appState.delegation, appState.delegation.tempSettings);
        delete appState.delegation.tempSettings;
    }
    appState.delegation.isDispatcherSettingsModalOpen = false;
    const modal = document.getElementById('dispatcher-settings-modal');
    if (modal) modal.classList.add('hidden');
    renderDelegationUI();
};




window.handleCapacityInput = (input) => {
    const name = input.dataset.dispatcher;
    const value = parseInt(input.value);
    
    if (isNaN(value) || value < 0) return;

    let capObj = appState.delegation.capacities[name];
    if (!capObj || typeof capObj === 'number' || capObj.OO !== undefined) {
        capObj = { max: 5, oo: true, loo: true };
    }

    capObj.max = value;
    appState.delegation.capacities[name] = capObj;
};

window.toggleDispatcherContract = (name, type, isChecked) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    if (!settings.dispatcherPreferences[name]) {
        settings.dispatcherPreferences[name] = { oo: true, loo: true };
    }
    settings.dispatcherPreferences[name][type] = isChecked;
};

    const allInputs = document.querySelectorAll('.capacity-input');
    allInputs.forEach(input => {
        input.value = value;
        input.classList.add('text-teal-400');
        setTimeout(() => input.classList.remove('text-teal-400'), 300);
    });

// --- NEW DROPDOWN HELPERS ---

window.toggleDelegationTeamDropdown = (e) => {
    e.stopPropagation();
    const list = document.getElementById('delegation-team-dropdown-list');
    if(list) list.classList.toggle('hidden');
};

window.selectDelegationTeam = (team) => {
    appState.delegation.activeTeamFilter = team;
    renderDelegationUI();
};

window.toggleAssignContractDropdown = (e) => {
    e.stopPropagation();
    const list = document.getElementById('assign-contract-list');
    if(list) list.classList.toggle('hidden');
};

window.toggleHideFullCapacity = () => {
    appState.delegation.hideFullCapacity = !appState.delegation.hideFullCapacity;
    renderDelegationUI();
};

window.toggleDelegationTeamDropdown = (e) => {
    e.stopPropagation();
    const list = document.getElementById('delegation-team-dropdown-list');
    if(list) list.classList.toggle('hidden');
};

window.selectDelegationTeam = (team) => {
    appState.delegation.activeTeamFilter = team;
    renderDelegationUI();
};

window.toggleAssignContractDropdown = (e) => {
    e.stopPropagation();
    const list = document.getElementById('assign-contract-list');
    if(list) list.classList.toggle('hidden');
};

window.selectAssignContract = (value, text) => {
    document.getElementById('assign-contract-type').value = value;
    document.getElementById('assign-contract-display').textContent = text;
    document.getElementById('assign-contract-list').classList.add('hidden');
};

// Global click listener to close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    const teamDropdown = document.getElementById('delegation-team-dropdown-list');
    const contractDropdown = document.getElementById('assign-contract-list');
    
    // Close Team dropdown if clicked outside
    if (teamDropdown && !teamDropdown.classList.contains('hidden')) {
        if (!e.target.closest('#delegation-team-dropdown-btn') && !e.target.closest('#delegation-team-dropdown-list')) {
            teamDropdown.classList.add('hidden');
        }
    }

    // Close Contract dropdown if clicked outside
    if (contractDropdown && !contractDropdown.classList.contains('hidden')) {
        if (!e.target.closest('#assign-contract-btn') && !e.target.closest('#assign-contract-list')) {
            contractDropdown.classList.add('hidden');
        }
    }
});
window.toggleHideFullCapacity = () => {
    appState.delegation.hideFullCapacity = !appState.delegation.hideFullCapacity;
    renderDelegationUI();
};
window.setSettingsModalTab = (tab) => {
    appState.delegation.settingsModalTab = tab;
    renderDispatcherSettingsModal();
};

window.setCapacityMode = (mode) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    if (mode !== 'custom') {
        settings.lastAlgorithmicMode = mode;
    }
    settings.capacityMode = mode;
    renderDispatcherSettingsModal();
};

window.handleCapacityInput = (input) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    const name = input.dataset.dispatcher;
    const value = parseInt(input.value);
    
    if (isNaN(value) || value < 0) return;

    settings.capacityCustom[name] = value;
    renderDispatcherSettingsModal();
};

window.handleBulkCapacityInput = (bulkInput) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    const value = parseInt(bulkInput.value);
    if (isNaN(value) || value < 0) return;

    const allDispatchers = getDispatcherList(); 
    allDispatchers.forEach(d => {
        settings.capacityCustom[d.name] = value;
    });

    const allInputs = document.querySelectorAll('.capacity-input');
    allInputs.forEach(input => {
        input.value = value;
        input.classList.add('text-teal-400');
        setTimeout(() => input.classList.remove('text-teal-400'), 300);
    });
};




window.toggleOverrideSearch = () => {
    appState.delegation.isOverrideSearchOpen = !appState.delegation.isOverrideSearchOpen;
    appState.delegation.overrideSearchTerm = '';
    renderDispatcherSettingsModal();
    if (appState.delegation.isOverrideSearchOpen) {
        setTimeout(() => {
            const input = document.getElementById('override-search-input');
            if (input) input.focus();
        }, 50);
    }
};

window.updateOverrideSearch = (value) => {
    appState.delegation.overrideSearchTerm = value;
    renderDispatcherSettingsModal();
    setTimeout(() => {
        const input = document.getElementById('override-search-input');
        if (input) {
            input.focus();
            input.setSelectionRange(value.length, value.length);
        }
    }, 0);
};


window.openCapacityBreakdownModal = () => {
    const dispatchers = getDispatcherList();
    const mode = appState.delegation.capacityMode || 'rank1w';
    
    // Group by team
    const teams = {};
    
    dispatchers.forEach(d => {
        if (!canViewDispatcher(d.name)) return;
        
        const team = d.team || 'Unassigned';
        if (!teams[team]) {
            teams[team] = {
                name: team,
                totalMax: 0,
                totalCurrent: 0,
                totalOO: 0,
                totalLOO: 0,
                dispatchers: []
            };
        }
        
        const max = getEffectiveMaxCapacity(d, mode);
        const current = d.ooTrucks + d.looTrucks;
        
        teams[team].totalMax += max;
        teams[team].totalCurrent += current;
        teams[team].totalOO += d.ooTrucks;
        teams[team].totalLOO += d.looTrucks;
        
        teams[team].dispatchers.push({
            name: d.name,
            max: max,
            current: current,
            oo: d.ooTrucks,
            loo: d.looTrucks
        });
    });

    // Create Modal HTML
    let modal = document.getElementById('capacity-breakdown-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'capacity-breakdown-modal';
        modal.className = 'fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-[200] p-4 hidden';
        document.body.appendChild(modal);
    }
    
    const sortedTeams = Object.values(teams).sort((a, b) => a.name.localeCompare(b.name));
    
    let contentHtml = sortedTeams.map(t => {
        const utilization = t.totalMax > 0 ? Math.round((t.totalCurrent / t.totalMax) * 100) : 0;
        
        // Sort dispatchers by name
        t.dispatchers.sort((a, b) => a.name.localeCompare(b.name));

        return `
            <div class="border border-gray-700 rounded-lg bg-gray-800 mb-2 overflow-hidden">
                <div class="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-700 transition-colors" onclick="window.toggleCapacityTeamDetail('${t.name}')">
                    <div class="flex items-center gap-3">
                        <svg id="arrow-${t.name}" class="w-4 h-4 text-gray-400 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                        <div>
                            <div class="font-bold text-white text-sm">${t.name}</div>
                            <div class="text-[10px] text-gray-400">OO: <span class="text-gray-300 font-bold">${t.totalOO}</span> | LOO: <span class="text-gray-300 font-bold">${t.totalLOO}</span></div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-sm font-bold text-white">${t.totalCurrent} <span class="text-gray-500 font-normal">/ ${t.totalMax}</span></div>
                        <div class="text-[10px] text-yellow-400">${utilization}% Full</div>
                    </div>
                </div>
                <div id="details-${t.name}" class="hidden bg-gray-900/50 border-t border-gray-700">
                    ${t.dispatchers.map(d => {
                        const dUtil = d.max > 0 ? Math.round((d.current / d.max) * 100) : 0;
                        
                        return `
                        <div class="flex items-center justify-between px-4 py-2 border-b border-gray-700/50 last:border-0 text-xs">
                            <div class="text-gray-300 font-medium">${d.name}</div>
                            <div class="text-right flex items-center justify-end gap-3">
                                <span class="text-[10px] text-gray-500">OO: <span class="text-gray-300">${d.oo}</span> | LOO: <span class="text-gray-300">${d.loo}</span></span>
                                <span class="w-12 text-right">
                                    <span class="text-gray-200 font-bold">${d.current}</span>
                                    <span class="text-gray-500">/${d.max}</span>
                                </span>
                                <span class="text-yellow-400 font-mono w-8 text-right">${dUtil}%</span>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }).join('');

    modal.innerHTML = `
        <div class="bg-gray-800 border-2 border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]">
            <div class="flex justify-between items-center p-4 border-b border-gray-700">
                <h3 class="text-lg font-bold text-white flex items-center gap-2 -ml-1">
                    <svg class="w-5 h-5 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"></path></svg>
                    Capacity Breakdown
                </h3>
                <button onclick="document.getElementById('capacity-breakdown-modal').classList.add('hidden')" class="text-gray-400 hover:text-white text-2xl">&times;</button>
            </div>
            <div class="p-4 overflow-y-auto custom-scrollbar">
                ${contentHtml}
            </div>
             <div class="p-4 border-t border-gray-700 bg-gray-900/50 rounded-b-2xl">
                <div class="flex justify-between items-center text-sm font-bold text-white">
                    <span>TOTAL</span>
                    <span class="text-right">
                        <div class="text-xs text-gray-400 font-normal">OO: ${sortedTeams.reduce((acc, t) => acc + t.totalOO, 0)} | LOO: ${sortedTeams.reduce((acc, t) => acc + t.totalLOO, 0)}</div>
                        <span class="text-green-400">${sortedTeams.reduce((acc, t) => acc + t.totalCurrent, 0)}</span>
                        <span class="text-gray-500 font-normal">/ ${sortedTeams.reduce((acc, t) => acc + t.totalMax, 0)}</span>
                    </span>
                </div>
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
};

window.toggleCapacityTeamDetail = (teamName) => {
    const detail = document.getElementById(`details-${teamName}`);
    const arrow = document.getElementById(`arrow-${teamName}`);
    if (detail) {
        detail.classList.toggle('hidden');
        if (arrow) arrow.style.transform = detail.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(90deg)';
    }
};
// --- NEW LOGIC FOR MULTI-SELECT & RULES ---

window.toggleOverrideSearch = () => {
    appState.delegation.isOverrideSearchOpen = !appState.delegation.isOverrideSearchOpen;
    appState.delegation.overrideSearchTerm = '';
    appState.delegation.tempSelectedDispatchers = new Set();
    appState.delegation.isConfiguringGroupRules = false; 
    
    renderDispatcherSettingsModal();
    if (appState.delegation.isOverrideSearchOpen) {
        setTimeout(() => {
            const input = document.getElementById('override-search-input');
            const container = document.getElementById('capacity-ranking-rules');
            
            if (input && container) {
                input.focus();
                
                const inputRect = input.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const relativeTop = inputRect.top - containerRect.top;
                
                container.scrollTop = container.scrollTop + relativeTop - 60;
            }
        }, 50);
    }
};

window.updateOverrideSearch = (value) => {
    appState.delegation.overrideSearchTerm = value;
    window.refreshOverridesTable();
};

window.toggleDispatcherSelection = (name) => {
    if (!appState.delegation.tempSelectedDispatchers) appState.delegation.tempSelectedDispatchers = new Set();
    const set = appState.delegation.tempSelectedDispatchers;
    
    const item = document.getElementById(`select-item-${name}`);
    const counter = document.getElementById('selection-counter');
    const configBtn = document.getElementById('config-rules-btn');
    const checkIcon = item ? item.querySelector('.check-icon') : null;
    const nameSpan = item ? item.querySelector('.dispatcher-name') : null;

    if (set.has(name)) {
        set.delete(name);
        if(item) {
            item.classList.remove('bg-teal-900/40');
            item.classList.add('hover:bg-gray-700/50');
        }
        if(nameSpan) nameSpan.classList.remove('text-teal-300', 'font-bold');
        if(checkIcon) {
            checkIcon.innerHTML = '';
            checkIcon.classList.remove('bg-teal-500', 'border-teal-500');
            checkIcon.classList.add('border-gray-500');
        }
    } else {
        set.add(name);
        if(item) {
            item.classList.add('bg-teal-900/40');
            item.classList.remove('hover:bg-gray-700/50');
        }
        if(nameSpan) nameSpan.classList.add('text-teal-300', 'font-bold');
        if(checkIcon) {
            checkIcon.innerHTML = '<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>';
            checkIcon.classList.remove('border-gray-500');
            checkIcon.classList.add('bg-teal-500', 'border-teal-500');
        }
    }
    
    if(counter) counter.innerText = `${set.size} selected`;
    
    if(configBtn) {
        if(set.size === 0) {
            configBtn.disabled = true;
            configBtn.style.opacity = '0.5';
            configBtn.style.cursor = 'not-allowed';
        } else {
            configBtn.disabled = false;
            configBtn.style.opacity = '1';
            configBtn.style.cursor = 'pointer';
        }
    }
};

window.startGroupConfiguration = () => {
    // Save scroll
    const container = document.getElementById('capacity-ranking-rules');
    const scrollPos = container ? container.scrollTop : 0;

    const settings = appState.delegation.tempSettings;
    const activeMode = settings.capacityMode === 'custom' ? 'rank1w' : settings.capacityMode;
    settings.tempGroupRules = JSON.parse(JSON.stringify(settings.capacityRules[activeMode] || []));
    
    appState.delegation.isConfiguringGroupRules = true; 
    renderDispatcherSettingsModal();

    // Restore scroll
    setTimeout(() => {
        const newContainer = document.getElementById('capacity-ranking-rules');
        if(newContainer) newContainer.scrollTop = scrollPos;
    }, 0);
};

window.confirmDispatcherOverrides = () => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    if (!settings.capacityCustom) settings.capacityCustom = {};
    
    // Save scroll position
    const container = document.getElementById('capacity-ranking-rules');
    const scrollPos = container ? container.scrollTop : 0;
    
    const rulesToApply = settings.tempGroupRules || [];
    const groupId = Date.now().toString(); // Simple unique ID

    // Create Group Entry
    if (!settings.capacityGroups) settings.capacityGroups = [];
    settings.capacityGroups.push({
        id: groupId,
        members: Array.from(appState.delegation.tempSelectedDispatchers).sort(),
        rules: JSON.parse(JSON.stringify(rulesToApply))
    });

    // Apply logic to each dispatcher (so backend/calc still works)
    appState.delegation.tempSelectedDispatchers.forEach(name => {
        settings.capacityCustom[name] = JSON.parse(JSON.stringify(rulesToApply));
    });

    // Reset UI
    appState.delegation.isOverrideSearchOpen = false;
    appState.delegation.tempSelectedDispatchers = new Set();
    appState.delegation.overrideSearchTerm = '';
    appState.delegation.isConfiguringGroupRules = false;
    delete settings.tempGroupRules;
    
    renderDispatcherSettingsModal();

    // Restore scroll position
    setTimeout(() => {
        const newContainer = document.getElementById('capacity-ranking-rules');
        if(newContainer) newContainer.scrollTop = scrollPos;
    }, 0);
};

window.removeDispatcherOverride = (idOrName) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;

    // Save scroll
    const container = document.getElementById('capacity-ranking-rules');
    const scrollPos = container ? container.scrollTop : 0;

    // Check if it's a group ID
    if (settings.capacityGroups) {
        const groupIndex = settings.capacityGroups.findIndex(g => g.id === idOrName);
        if (groupIndex > -1) {
            const group = settings.capacityGroups[groupIndex];
            // Remove overrides for all members
            group.members.forEach(m => {
                if(settings.capacityCustom[m]) delete settings.capacityCustom[m];
            });
            settings.capacityGroups.splice(groupIndex, 1);
            renderDispatcherSettingsModal();
             // Restore scroll
            setTimeout(() => {
                const newContainer = document.getElementById('capacity-ranking-rules');
                if(newContainer) newContainer.scrollTop = scrollPos;
            }, 0);
            return;
        }
    }

    // Otherwise it's an individual dispatcher
    if (settings.capacityCustom && settings.capacityCustom[idOrName]) {
        delete settings.capacityCustom[idOrName];
        renderDispatcherSettingsModal();
         // Restore scroll
        setTimeout(() => {
            const newContainer = document.getElementById('capacity-ranking-rules');
            if(newContainer) newContainer.scrollTop = scrollPos;
        }, 0);
    }
};

// Also update rule adding/removing to support groups
window.addCapacityRule = (context) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    
    // Save scroll
    const container = document.getElementById('capacity-ranking-rules');
    const scrollPos = container ? container.scrollTop : 0;

    let rules;
    if (context === 'rank1w' || context === 'rank4w') {
        rules = settings.capacityRules[context];
    } else if (context === 'temp_group') {
        rules = settings.tempGroupRules;
    } else {
        // Check if context is a Group ID
        const group = settings.capacityGroups ? settings.capacityGroups.find(g => g.id === context) : null;
        if (group) {
            rules = group.rules;
        } else {
            rules = settings.capacityCustom[context];
        }
    }

    if (!rules) return;
    if (rules.length >= 10) return alert("Maximum number of rules is 10.");

    const lastRule = rules[rules.length - 1];
    const newRule = { min: lastRule.min, max: lastRule.max, cap: lastRule.cap };
    
    lastRule.max = (lastRule.min + lastRule.max) / 2;
    newRule.min = lastRule.max;
    
    rules.splice(rules.length - 1, 0, newRule);
    
    // If it was a group, update all members
    if (settings.capacityGroups) {
        const group = settings.capacityGroups.find(g => g.id === context);
        if (group) {
            group.members.forEach(m => {
                 settings.capacityCustom[m] = JSON.parse(JSON.stringify(rules));
            });
        }
    }

    renderDispatcherSettingsModal();
    // Restore scroll
    setTimeout(() => {
        const newContainer = document.getElementById('capacity-ranking-rules');
        if(newContainer) newContainer.scrollTop = scrollPos;
    }, 0);
};

window.removeCapacityRule = (context, index) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;

    // Save scroll
    const container = document.getElementById('capacity-ranking-rules');
    const scrollPos = container ? container.scrollTop : 0;

    let rules;
    if (context === 'rank1w' || context === 'rank4w') {
        rules = settings.capacityRules[context];
    } else if (context === 'temp_group') {
        rules = settings.tempGroupRules;
    } else {
        const group = settings.capacityGroups ? settings.capacityGroups.find(g => g.id === context) : null;
        if (group) {
            rules = group.rules;
        } else {
            rules = settings.capacityCustom[context];
        }
    }

    if (!rules || rules.length <= 2) return alert("You must have at least 2 rules.");
    
    if (index > 0 && index < rules.length - 1) {
        rules[index + 1].min = rules[index].min;
        rules.splice(index, 1);
        
        // If it was a group, update all members
        if (settings.capacityGroups) {
            const group = settings.capacityGroups.find(g => g.id === context);
            if (group) {
                group.members.forEach(m => {
                        settings.capacityCustom[m] = JSON.parse(JSON.stringify(rules));
                });
            }
        }

        renderDispatcherSettingsModal();
        // Restore scroll
        setTimeout(() => {
            const newContainer = document.getElementById('capacity-ranking-rules');
            if(newContainer) newContainer.scrollTop = scrollPos;
        }, 0);
    }
};

window.handleRuleCriteriaInput = (input) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    
    const prop = input.dataset.ruleProp;
    const context = input.dataset.context;
    const index = parseInt(input.closest('.rule-row').dataset.index);
    let rawValue = parseFloat(input.value);

    let rules;
    if (context === 'rank1w' || context === 'rank4w') {
        rules = settings.capacityRules[context];
    } else if (context === 'temp_group') {
        rules = settings.tempGroupRules;
    } else {
        const group = settings.capacityGroups ? settings.capacityGroups.find(g => g.id === context) : null;
        if (group) {
            rules = group.rules;
        } else {
            rules = settings.capacityCustom[context];
        }
    }

    if (!rules) return;

    if (prop === 'cap') {
        rules[index].cap = isNaN(rawValue) ? 0 : Math.round(rawValue);
    } else if (prop === 'min') {
        const val = isNaN(rawValue) ? 0 : rawValue / 100;
        rules[index].min = val;
    } else if (prop === 'max') {
        const val = isNaN(rawValue) ? 0 : rawValue / 100;
        rules[index].max = val;
    }

    // If it was a group, update all members
    if (settings.capacityGroups) {
        const group = settings.capacityGroups.find(g => g.id === context);
        if (group) {
            group.members.forEach(m => {
                    settings.capacityCustom[m] = JSON.parse(JSON.stringify(rules));
            });
        }
    }
};

window.toggleRuleAccordion = (name) => {
    if (appState.delegation.expandedOverrideId === name) {
        appState.delegation.expandedOverrideId = null;
    } else {
        appState.delegation.expandedOverrideId = name;
    }
    renderDispatcherSettingsModal();
};

window.addCapacityRule = (context) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    
    // Save scroll position
    const container = document.getElementById('capacity-ranking-rules');
    const scrollPos = container ? container.scrollTop : 0;
    
    let rules;
    if (context === 'rank1w' || context === 'rank4w') {
        rules = settings.capacityRules[context];
    } else if (context === 'temp_group') {
        rules = settings.tempGroupRules;
    } else {
        // Check for Group ID or Individual Dispatcher
        const group = settings.capacityGroups ? settings.capacityGroups.find(g => g.id === context) : null;
        if (group) {
            rules = group.rules;
        } else {
            rules = settings.capacityCustom[context];
        }
    }

    if (!rules) return;
    if (rules.length >= 10) return alert("Maximum number of rules is 10.");

    const lastRule = rules[rules.length - 1];
    const newRule = { min: lastRule.min, max: lastRule.max, cap: lastRule.cap };
    
    lastRule.max = (lastRule.min + lastRule.max) / 2;
    newRule.min = lastRule.max;
    
    rules.splice(rules.length - 1, 0, newRule);
    
    // If it was a group, update all members
   if (settings.capacityGroups) {
        const group = settings.capacityGroups.find(g => g.id === context);
        if (group) {
            group.members.forEach(m => {
                 settings.capacityCustom[m] = JSON.parse(JSON.stringify(rules));
            });
        }
    }

    const containerId = context === 'temp_group' ? 'rules-container-temp_group' : `rules-container-${context}`;
    const rulesContainer = document.getElementById(containerId);

    if (rulesContainer) {
        rulesContainer.innerHTML = renderRulesTable(rules, context);
    } else {
        renderDispatcherSettingsModal();
        setTimeout(() => {
            const newContainer = document.getElementById('capacity-ranking-rules');
            if(newContainer) newContainer.scrollTop = scrollPos;
        }, 0);
    }
};

window.removeCapacityRule = (context, index) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;

    let rules;
    if (context === 'rank1w' || context === 'rank4w') {
        rules = settings.capacityRules[context];
    } else if (context === 'temp_group') {
        rules = settings.tempGroupRules;
    } else {
        const group = settings.capacityGroups ? settings.capacityGroups.find(g => g.id === context) : null;
        if (group) {
            rules = group.rules;
        } else {
            rules = settings.capacityCustom[context];
        }
    }

    if (!rules || rules.length <= 2) return alert("You must have at least 2 rules.");
    
    if (index > 0 && index < rules.length - 1) {
        rules[index + 1].min = rules[index].min;
        rules.splice(index, 1);
        
        // Update Group Members if applicable
        if (settings.capacityGroups) {
            const group = settings.capacityGroups.find(g => g.id === context);
            if (group) {
                group.members.forEach(m => {
                        settings.capacityCustom[m] = JSON.parse(JSON.stringify(rules));
                });
            }
        }

        // Direct DOM Update to prevent flickering
        const containerId = context === 'temp_group' ? 'rules-container-temp_group' : `rules-container-${context}`;
        const container = document.getElementById(containerId);
        
        if (container) {
            container.innerHTML = renderRulesTable(rules, context);
        } else {
            renderDispatcherSettingsModal();
        }
    }
};

window.handleRuleCriteriaInput = (input) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;
    
    const prop = input.dataset.ruleProp;
    const context = input.dataset.context;
    const index = parseInt(input.closest('.rule-row').dataset.index);
    let rawValue = parseFloat(input.value);

    let rules;
    if (context === 'rank1w' || context === 'rank4w') {
        rules = settings.capacityRules[context];
    } else if (context === 'temp_group') {
        rules = settings.tempGroupRules;
    } else {
        rules = settings.capacityCustom[context];
    }

    if (!rules) return;

    if (prop === 'cap') {
        rules[index].cap = isNaN(rawValue) ? 0 : Math.round(rawValue);
    } else if (prop === 'min') {
        const val = isNaN(rawValue) ? 0 : rawValue / 100;
        rules[index].min = val;
    } else if (prop === 'max') {
        const val = isNaN(rawValue) ? 0 : rawValue / 100;
        rules[index].max = val;
    }
};
window.revertToRule = (dispatcherName) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;

    if (settings.capacityCustom && settings.capacityCustom[dispatcherName] !== undefined) {
        delete settings.capacityCustom[dispatcherName];
    }

    if (appState.delegation.isOverrideSearchOpen) {
        window.refreshOverridesTable();
    } else {
        renderDispatcherSettingsModal();
    }
};

window.removeDispatcherFromGroup = (groupId, dispatcherName) => {
    const settings = appState.delegation.tempSettings;
    if (!settings || !settings.capacityGroups) return;

    // Save scroll position
    const container = document.getElementById('capacity-ranking-rules');
    const scrollPos = container ? container.scrollTop : 0;

    const groupIndex = settings.capacityGroups.findIndex(g => g.id === groupId);
    if (groupIndex > -1) {
        const group = settings.capacityGroups[groupIndex];
        // Remove from members
        group.members = group.members.filter(m => m !== dispatcherName);
        
        // Remove override for this specific dispatcher
        if (settings.capacityCustom[dispatcherName]) {
            delete settings.capacityCustom[dispatcherName];
        }

        // If group is empty, remove the group entirely
        if (group.members.length === 0) {
            settings.capacityGroups.splice(groupIndex, 1);
        }
    }

    renderDispatcherSettingsModal();
    
    setTimeout(() => {
         const newContainer = document.getElementById('capacity-ranking-rules');
         if(newContainer) newContainer.scrollTop = scrollPos;
    }, 0);
};
window.updateManualOverride = (dispatcherName, value, inputEl) => {
    const settings = appState.delegation.tempSettings;
    if (!settings) return;

    if (value === '' || value === null) {
        if (settings.capacityCustom && settings.capacityCustom.hasOwnProperty(dispatcherName)) {
            delete settings.capacityCustom[dispatcherName];
        }
    } else {
        const numValue = parseInt(value);
        if (!isNaN(numValue) && numValue >= 0) {
            if (!settings.capacityCustom) settings.capacityCustom = {};
            settings.capacityCustom[dispatcherName] = numValue;
        }
    }

    if (inputEl) {
        const tr = inputEl.closest('tr');
        if (tr) {
            const badgeCell = tr.cells[1]; 
            const actionCell = tr.cells[3]; 
            const isManual = (settings.capacityCustom && settings.capacityCustom[dispatcherName] !== undefined);
            const safeName = dispatcherName.replace(/'/g, "\\'"); 

            if (isManual) {
                inputEl.classList.add('border-yellow-500', 'text-yellow-400', 'font-bold');
                inputEl.classList.remove('border-gray-600', 'text-gray-300');
                badgeCell.innerHTML = '<span class="text-[10px] bg-yellow-900/50 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-700/50">Manual</span>';
                actionCell.innerHTML = `<button type="button" onclick="window.revertToRule('${safeName}')" class="text-xs text-red-400 hover:text-red-300 hover:underline">Reset</button>`;
            } else {
                inputEl.classList.remove('border-yellow-500', 'text-yellow-400', 'font-bold');
                inputEl.classList.add('border-gray-600', 'text-gray-300');
                badgeCell.innerHTML = '<span class="text-[10px] bg-teal-900/30 text-teal-400 px-1.5 py-0.5 rounded border border-teal-700/30">Auto Rule</span>';
                actionCell.innerHTML = '';
            }
        }
    }
};

function renderOverridesTableRows(displayList, overrides, rules, mode) {
    if (displayList.length === 0) return '<tr><td colspan="4" class="p-4 text-center text-gray-500 text-xs">No dispatchers found.</td></tr>';
    
    return displayList.map(d => {
        const customVal = overrides[d.name];
        const hasOverride = (typeof customVal === 'number');
        const safeName = d.name.replace(/'/g, "\\'"); 
        
        const criteriaKey = (mode === 'rank4w') ? 'criteria4w' : 'criteria1w';
        const criteriaValue = d[criteriaKey];
        let ruleBasedCap = 5;
        if (criteriaValue !== null && criteriaValue !== undefined) {
            const matchingRule = rules.find(rule => criteriaValue >= rule.min && criteriaValue <= rule.max);
            if (matchingRule) ruleBasedCap = matchingRule.cap;
        }

        const displayVal = hasOverride ? customVal : '';
        
        return `
        <tr class="hover:bg-gray-700/50 transition-colors">
            <td class="px-4 py-2 font-medium text-white">
                ${d.name}
                <div class="text-[10px] text-gray-500">Rank/Crit: ${(criteriaValue * 100).toFixed(1)}%</div>
            </td>
            <td class="px-4 py-2 text-center">
                ${hasOverride 
                    ? '<span class="text-[10px] bg-yellow-900/50 text-yellow-400 px-1.5 py-0.5 rounded border border-yellow-700/50">Manual</span>' 
                    : '<span class="text-[10px] bg-teal-900/30 text-teal-400 px-1.5 py-0.5 rounded border border-teal-700/30">Auto Rule</span>'
                }
            </td>
            <td class="px-4 py-2 text-center">
                <input type="number" 
                       min="0" 
                       placeholder="${ruleBasedCap}" 
                       value="${displayVal}"
                       oninput="window.updateManualOverride('${safeName}', this.value, this)"
                       class="w-20 bg-gray-900 border ${hasOverride ? 'border-yellow-500 text-yellow-400 font-bold' : 'border-gray-600 text-gray-300'} rounded px-2 py-1 text-center focus:outline-none focus:border-teal-500 transition-colors">
            </td>
            <td class="px-4 py-2 text-right">
                ${hasOverride ? `
                    <button type="button" onclick="window.revertToRule('${safeName}')" class="text-xs text-red-400 hover:text-red-300 hover:underline">
                        Reset
                    </button>
                ` : ''}
            </td>
        </tr>
        `;
    }).join('');
}

window.refreshOverridesTable = () => {
    const settings = appState.delegation.tempSettings || appState.delegation;
    const mode = settings.capacityMode;
    const rules = settings.capacityRules[mode] || [];
    const overrides = settings.capacityCustom || {};
    const searchTerm = (appState.delegation.overrideSearchTerm || '').toLowerCase();
    
    const allDispatchers = getDispatcherList().sort((a, b) => a.name.localeCompare(b.name));
    
    const displayList = allDispatchers.filter(d => d.name.toLowerCase().startsWith(searchTerm));
    
    const tbody = document.getElementById('overrides-table-body');
    if (tbody) {
        tbody.innerHTML = renderOverridesTableRows(displayList, overrides, rules, mode);
    }
};