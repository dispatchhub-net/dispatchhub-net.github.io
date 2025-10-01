import { appState } from '../state.js';
import { calculateMedian } from '../utils.js';
import { getFilteredDataByDriverType, calculateFourWeekAverageDataForDate, getTeamRankHistory, getCompanyOrAllTeamsCriteriaHistory } from '../rankings/rankings_api.js';


const debounce = (func, delay) => {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};

/**
 * Finds the corresponding Thursday rankings date for a given profiles payroll week.
 * @param {number} weeksAgo - 0 for the current/live week, 1 for last week, etc.
 * @param {string[]} allHistoricalDates - An array of all available ranking dates.
 * @returns {string|null} The matching YYYY-MM-DD date string, or null if not found.
 */
function getRankingDateForProfileWeek(weeksAgo, allHistoricalDates) {
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
 * Calculates 1-week and 4-week ranks for a given list of dispatchers for a specific period.
 * @param {string} selectedWeekId - The week identifier (e.g., 'live', 'week_1').
 * @param {string} driverTypeFilter - The active driver type filter ('all', 'oo', 'loo').
 * @returns {Map<string, {rank1w: number|null, rank4w: number|null}>} A map of dispatcher names to their ranks.
 */
function calculateDispatcherRanksForPeriod(selectedWeekId, driverTypeFilter) {
    const { allHistoricalData } = appState;
    const ranks = new Map();

    const historicalDates = [...new Set(allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const weeksAgo = selectedWeekId === 'live' ? 0 : parseInt(selectedWeekId.replace('week_', ''), 10);
    
    const targetDateString = getRankingDateForProfileWeek(weeksAgo, historicalDates);

    if (!targetDateString) return ranks;

    const originalDriverType = appState.driverTypeFilter;
    appState.driverTypeFilter = driverTypeFilter;

    const dataFor1W = getFilteredDataByDriverType(allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === targetDateString));
    const ranked1W = dataFor1W
        .filter(d => d.mainCriteria != null)
        .sort((a, b) => b.mainCriteria - a.mainCriteria);
    ranked1W.forEach((dispatcher, index) => {
        const name = dispatcher.dispatcherName;
        if (!ranks.has(name)) ranks.set(name, { rank1w: null, rank4w: null });
        ranks.get(name).rank1w = index + 1;
    });

    const fourWeekAverages = calculateFourWeekAverageDataForDate(targetDateString, 'dispatcher');
    const ranked4W = Object.values(fourWeekAverages)
        .filter(d => d.mainCriteria != null)
        .sort((a, b) => b.mainCriteria - a.mainCriteria);
    ranked4W.forEach((dispatcher, index) => {
        const name = dispatcher.entityName;
        if (!ranks.has(name)) ranks.set(name, { rank1w: null, rank4w: null });
        ranks.get(name).rank4w = index + 1;
    });

    appState.driverTypeFilter = originalDriverType;
    return ranks;
}

function calculateKpiData(baseData, isLiveData, allDrivers, historicalStubs, contractFilter, currentTeamData) {
    console.log(`[KPI Calculation] Starting for ${isLiveData ? 'Live Data' : 'Historical Stubs'}. Initial items: ${baseData.length}, Pre-filtered drivers: ${allDrivers.length}`);

    // 'allDrivers' is already pre-filtered by the UI. We'll use this list directly for driver-specific KPIs.
    const driversForKpi = allDrivers;

    // 'baseData' is the raw, unfiltered load/stub data for the period. We'll filter this for load-specific KPIs.
    let activeData = isLiveData
    ? baseData.filter(l => l.status !== 'Canceled')
    : baseData.filter(s => s.stub_team && s.total_miles > 0);

    // Apply the contract filter to the raw load/stub data.
    if (contractFilter !== 'all') {
        const contractKey = isLiveData ? 'contract_type' : 'contract_type';
        activeData = activeData.filter(d => {
            // **THIS IS THE FIX**: Normalize the contract type from the raw data before comparing.
            // This ensures variations like 'oo', 'Owner Operator', etc., are all treated as 'OO'.
            const rawContract = String(d[contractKey] || '').trim().toUpperCase();
            const normalizedContract = rawContract === 'OO' ? 'OO' : 'LOO';

            if (contractFilter === 'loo') {
                return normalizedContract !== 'OO';
            }
            // This now correctly handles the 'oo' case.
            return normalizedContract === contractFilter.toUpperCase();
        });
    }

    console.log(`[KPI Calculation] Active data count after contract filter ('${contractFilter}'): ${activeData.length}`);

    const dispatcherNameKey = isLiveData ? 'dispatcher' : 'stub_dispatcher';
    const uniqueDispatchersInPeriod = [...new Set(activeData.map(d => d[dispatcherNameKey]).filter(Boolean))];

    const periodStartDate = isLiveData ?
        (activeData.length > 0 ? new Date(Math.min(...activeData.map(d => new Date(d.do_date)))) : new Date()) :
        (baseData.length > 0 ? getPayPeriodFromPayDate(baseData[0].pay_date).start : new Date());

    const periodEndDate = isLiveData ?
        (activeData.length > 0 ? new Date(Math.max(...activeData.map(d => new Date(d.do_date)))) : new Date()) :
        (baseData.length > 0 ? getPayPeriodFromPayDate(baseData[0].pay_date).end : new Date());

    const loadsForCompliancePeriod = appState.profiles.liveData.filter(l => {
        if (!l.do_date) return false;
        const doDate = new Date(l.do_date);
        return doDate >= periodStartDate && doDate <= periodEndDate;
    });
    console.log(`[KPI Calculation] Found ${loadsForCompliancePeriod.length} loads in the period for compliance/wellness checks.`);


    const dispatchersForPeriod = uniqueDispatchersInPeriod.map(name => {
        const loads = loadsForCompliancePeriod.filter(l => l.dispatcher === name);
        const wellnessLoads = loads.filter(l => l.wellness_fail === 'GOOD' || l.wellness_fail === 'FAIL');
        const goodWellnessLoads = wellnessLoads.filter(l => l.wellness_fail === 'GOOD').length;
        const wellness = wellnessLoads.length > 0 ? (goodWellnessLoads / wellnessLoads.length) * 100 : 0;
        
        return {
            name,
            wellness,
            loads: loads,
            goodMoves: loads.filter(l => l.moved_monday === 'Moved Monday Load' && (l.driver_gross_without_moved < (appState.profiles.thresholdSettings.goodMove.by_contract[l.contract_type] ?? appState.profiles.thresholdSettings.goodMove.default))).length,
            badMoves: loads.filter(l => l.moved_monday === 'Moved Monday Load' && (l.driver_gross_without_moved >= (appState.profiles.thresholdSettings.goodMove.by_contract[l.contract_type] ?? appState.profiles.thresholdSettings.goodMove.default))).length,
            hiddenMiles: loads.filter(l => l.hidden_miles === 'Hidden Miles Found!').length,
            lowRpm: loads.filter(l => l.rpm_all < getLowRpmThreshold(l.contract_type)).length,
        };
    });

    const dispatchersWithScores = calculateComplianceScores(dispatchersForPeriod, dispatchersForPeriod);

    const totalGross = isLiveData ? activeData.reduce((sum, l) => sum + (l.price || 0) + (l.cut || 0), 0) : activeData.reduce((sum, s) => sum + (s.driver_gross || 0) + (s.margin || 0), 0);
    const totalMiles = isLiveData ? activeData.reduce((sum, l) => sum + (l.trip_miles || 0) + (l.deadhead_miles || 0), 0) : activeData.reduce((sum, s) => sum + (s.total_miles || 0), 0);
    const totalMargin = isLiveData ? activeData.reduce((sum, l) => sum + (l.cut || 0), 0) : activeData.reduce((sum, s) => sum + (s.margin || 0), 0);
    
    // **KPI FIX**: 'activeTrucks' now correctly uses the filtered load data.
    const activeTrucks = new Set(activeData.map(d => isLiveData ? d.driver : d.driver_name)).size;
    
    // KPIs below correctly use the pre-filtered 'driversForKpi' list.
    const riskScores = driversForKpi.map(d => d.risk).filter(r => typeof r === 'number');
    const medianDropRisk = riskScores.length > 0 ? Math.round(calculateMedian(riskScores)) : 0;

    const totalBalance = driversForKpi.reduce((sum, driver) => {
        const driverStubs = historicalStubs.filter(s => s.driver_name === driver.name).sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
        if (driverStubs.length > 0) {
            const mostRecentStub = driverStubs[0];
            const finalBalance = (mostRecentStub.balance || 0) + (mostRecentStub.balance_settle || 0);
            const finalPo = (mostRecentStub.po_deductions || 0) - (mostRecentStub.po_settle || 0);
            return sum + Math.abs(finalBalance) + finalPo;
        }
        return sum;
    }, 0);

    // This KPI should be calculated from all data for the period, regardless of contract type.
    const canceledLoads = baseData.filter(l => l.status === 'Canceled').length;

    const wellnessScores = dispatchersWithScores.map(d => parseFloat(d.wellness)).filter(w => !isNaN(w));
    const medianWellness = wellnessScores.length > 0 ? calculateMedian(wellnessScores) : 0;
    
    const complianceScores = dispatchersWithScores.map(d => d.complianceScore).filter(c => !isNaN(c));
    const medianCompliance = complianceScores.length > 0 ? calculateMedian(complianceScores) : 0;
    
    console.log(`[KPI Calculation] Final KPI values:`, { totalGross, teamRpm: totalMiles > 0 ? totalGross / totalMiles : 0, teamMargin: totalMargin, activeTrucks, medianWellness, medianCompliance });


    return {
        totalGross, teamRpm: totalMiles > 0 ? totalGross / totalMiles : 0, teamMargin: totalMargin,
        activeTrucks, dispatchers: uniqueDispatchersInPeriod.length, medianDropRisk,
        balance: totalBalance, canceledLoads, medianWellness, medianCompliance
    };
}



/**
 * Calculates all active "Live Flags" for a specific driver based on settings.
 * This is the core logic that was missing.
 */
function calculateLiveFlagsForDriver(driverName, historicalStubs, allDriversData) {
    const flags = [];
    const settings = appState.profiles.driverHealthSettings.flags;

    const driverStubs = historicalStubs
        .filter(s => s.driver_name === driverName)
        .sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));

    const driverLoads = appState.profiles.liveData.filter(l => l.driver === driverName);

    if (driverStubs.length === 0 && driverLoads.length === 0) return flags;

    const getThreshold = (flagSettings, contractType) => {
        return flagSettings.thresholds.by_contract[contractType] ?? flagSettings.thresholds.default;
    };

    const getStubsInLookback = (flagSettings) => {
        let relevantStubs = driverStubs;

        if (flagSettings.lookback && flagSettings.lookback.type === 'weeks') {
            const weeksAgo = flagSettings.lookback.value;
            const lookbackDate = new Date();
            lookbackDate.setDate(lookbackDate.getDate() - (weeksAgo * 7));
            relevantStubs = driverStubs.filter(s => new Date(s.pay_date) >= lookbackDate);
        }

        return relevantStubs.filter(s => s.total_miles && s.total_miles > 0);
    };
    
    // --- High Tolls ---
    if (settings.highTolls.enabled) {
        const relevantStubsForDriver = getStubsInLookback(settings.highTolls);
        if (relevantStubsForDriver.length >= settings.highTolls.minStubs) { // <-- MIN STUBS CHECK
            const allRelevantStubs = historicalStubs.filter(stub => 
                relevantStubsForDriver.some(rs => rs.pay_date === stub.pay_date)
            ).filter(s => s.total_miles && s.total_miles > 0);
            
            const tollsByDriver = allRelevantStubs.reduce((acc, stub) => {
                const driver = stub.driver_name;
                const tolls = stub.total_expected_tolls || stub.pEstimated_tolls || 0;
                if (!acc[driver]) { acc[driver] = { totalTolls: 0, stubCount: 0 }; }
                acc[driver].totalTolls += tolls;
                acc[driver].stubCount++;
                return acc;
            }, {});

            const avgTollsByDriver = Object.entries(tollsByDriver).reduce((acc, [driver, data]) => {
                acc[driver] = data.stubCount > 0 ? data.totalTolls / data.stubCount : 0;
                return acc;
            }, {});

            const allAvgTollValues = Object.values(avgTollsByDriver).sort((a, b) => a - b);
            
            if (allAvgTollValues.length > 0) {
                const percentileIndex = Math.floor((1 - (settings.highTolls.thresholds.default / 100)) * (allAvgTollValues.length - 1));
                const tollThreshold = allAvgTollValues[percentileIndex];
                const driverAvgTolls = avgTollsByDriver[driverName] || 0;

                if (driverAvgTolls >= tollThreshold && driverAvgTolls > 0) {
                    flags.push({
                        text: settings.highTolls.label,
                        color: settings.highTolls.color,
                        tooltipData: {
                            avgTolls: driverAvgTolls,
                            lookback: settings.highTolls.lookback.value
                        }
                    });
                }
            }
        }
    }

    // --- Heavy Loads ---
    if (settings.heavyLoads.enabled) {
        const relevantLoads = driverLoads.filter(l => !['Canceled', 'TONU', 'Layover'].includes(l.status) && l.weight > 0);
        if (relevantLoads.length >= settings.heavyLoads.minLoads) { // <-- MIN LOADS CHECK
            const totalWeight = relevantLoads.reduce((sum, l) => sum + (l.weight || 0), 0);
            const avgWeight = totalWeight / relevantLoads.length;
            const threshold = getThreshold(settings.heavyLoads, relevantLoads[0]?.contract_type);
            if (avgWeight > threshold) {
                flags.push({
                    text: settings.heavyLoads.label,
                    color: settings.heavyLoads.color,
                    tooltipData: { avgWeight: avgWeight, loadCount: relevantLoads.length }
                });
            }
        }
    }

    // --- Dispatcher Hopper ---
    if (settings.dispatcherHopper.enabled) {
        const relevantStubs = getStubsInLookback(settings.dispatcherHopper);
        const uniqueDispatchers = [...new Set(relevantStubs.map(s => s.stub_dispatcher).filter(Boolean))];
        const threshold = getThreshold(settings.dispatcherHopper, driverStubs[0]?.contract_type);
        if (uniqueDispatchers.length > threshold) {
            flags.push({ 
                text: settings.dispatcherHopper.label, 
                color: settings.dispatcherHopper.color,
                tooltipData: {
                    dispatchers: uniqueDispatchers.sort(),
                    count: uniqueDispatchers.length,
                    lookback: settings.dispatcherHopper.lookback.type === 'allTime' ? 'All Time' : `${settings.dispatcherHopper.lookback.value} wks`
                }
            });
        }
    }

    // --- Negative Balance/PO ---
    if (settings.negative.enabled && driverStubs.length >= settings.negative.minStubs) { // <-- MIN STUBS CHECK
        const mostRecentStub = driverStubs[0];
        const finalBalance = (mostRecentStub.balance || 0) + (mostRecentStub.balance_settle || 0);
        const finalPo = (mostRecentStub.po_deductions || 0) - (mostRecentStub.po_settle || 0);
        const totalLiability = Math.abs(finalBalance) + finalPo;
        const threshold = getThreshold(settings.negative, mostRecentStub.contract_type);
        if (totalLiability > threshold) {
             flags.push({ 
                 text: settings.negative.label, 
                 color: settings.negative.color,
                 tooltipData: { balance: finalBalance, po: finalPo, date: mostRecentStub.pay_date }
            });
        }
    }

    // --- Low Pay Metrics ---
    ['lowRpm', 'lowGross', 'lowNet'].forEach(flagId => {
        const flagSettings = settings[flagId];
        if (flagSettings.enabled) {
            const relevantStubs = getStubsInLookback(flagSettings);
            if (relevantStubs.length >= flagSettings.minStubs) {
                const threshold = getThreshold(flagSettings, relevantStubs[0].contract_type);
                const metricKey = { lowRpm: 'rpm_all', lowGross: 'driver_gross', lowNet: 'net_pay' }[flagId];
                const stubsBelowThreshold = relevantStubs.filter(s => (s[metricKey] || 0) < threshold);
                const percentageBelow = (stubsBelowThreshold.length / relevantStubs.length) * 100;
                if (percentageBelow >= flagSettings.minPercentageOfStubs) {
                    flags.push({
                        text: flagSettings.label,
                        color: flagSettings.color,
                        tooltipData: {
                            stubsBelow: stubsBelowThreshold.length,
                            totalStubs: relevantStubs.length,
                            threshold: threshold,
                            metric: flagId
                        }
                    });
                }
            }
        }
    });

    return flags;
}

// Helper function to get historical data for a specific driver
const getHistoricalStubsForDriver = (driverName, historicalStubs = []) => {
    const driverData = historicalStubs.filter(stub => stub.driver_name === driverName);
    return driverData.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
};

// --- START: ADD THIS NEW HELPER FUNCTION ---
/**
 * Calculates the start (Tuesday) and end (Monday) date objects for a given payroll week.
 * @param {number} weeksAgo - 0 for current week, 1 for last week, etc.
 * @returns {{start: Date, end: Date}}
 */
function getPayrollWeekDateRange(weeksAgo = 0) {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // Sunday = 0, Monday = 1...
    
    // --- FIX: Correctly calculate the end date (Monday) of the CURRENT payroll week ---
    const daysUntilNextMonday = (1 - dayOfWeek + 7) % 7;
    const end = new Date(now);
    end.setUTCDate(now.getUTCDate() + daysUntilNextMonday - (weeksAgo * 7));
    end.setUTCHours(23, 59, 59, 999);

    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 6);
    start.setUTCHours(0, 0, 0, 0);
    
    return { start, end };
}
// --- END: ADD THIS NEW HELPER FUNCTION ---


const getLowRpmThreshold = (contractType) => {
    const thresholds = appState.profiles.thresholdSettings.lowRpm;
    return thresholds.by_contract[contractType] ?? thresholds.default;
};


const getChangeDisplay_Profiles = (current, previous, isCurrency = false, isRpm = false, isPercentage = false, lowerIsBetter = false) => {
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
};


// --- START: NEW PROFILE WEEK SELECTOR LOGIC ---

/**
 * Calculates the start (Tuesday) and end (Monday) of a payroll week for the Profiles section.
 * @param {number} weeksAgo - 0 for current, 1 for last week, etc.
 * @returns {{label: string, id: string}}
 */
function getProfilePayrollWeek(weeksAgo = 0) {
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

function renderProfileWeekSelector() {
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
function renderProfileHeader(teamData, allTeams, kpis, prevWeekKpis) {
    const headerContainer = document.getElementById('profiles-header');
    if (!headerContainer) return;

    // --- START: Active filter check logic ---
    const isContractFilterActive = appState.profiles.contractTypeFilter !== 'all';
    const isCompanyFilterActive = appState.profiles.selectedCompany !== 'All Companies';
    const isFranchiseFilterActive = appState.profiles.selectedFranchise !== 'All Franchises';
    // --- END: Active filter check logic ---

    const { visibleKpiIds } = appState.profiles.kpiSettings;
    
    const allKpiCards = [
        { id: 'totalGross', label: 'Total Gross', value: `$${Math.round(kpis.totalGross).toLocaleString()}`, trend: getChangeDisplay_Profiles(kpis.totalGross, prevWeekKpis.totalGross, true) },
        { id: 'teamRpm', label: 'Team RPM (All)', value: `$${kpis.teamRpm.toFixed(2)}`, trend: getChangeDisplay_Profiles(kpis.teamRpm, prevWeekKpis.teamRpm, false, true) },
        { id: 'teamMargin', label: 'Team Margin ($)', value: `$${Math.round(kpis.teamMargin).toLocaleString()}`, trend: getChangeDisplay_Profiles(kpis.teamMargin, prevWeekKpis.teamMargin, true) },
        { id: 'activeTrucks', label: 'Active Trucks', value: kpis.activeTrucks.toLocaleString(), trend: getChangeDisplay_Profiles(kpis.activeTrucks, prevWeekKpis.activeTrucks) },
        { id: 'dispatchers', label: 'Dispatchers', value: kpis.dispatchers.toLocaleString(), trend: getChangeDisplay_Profiles(kpis.dispatchers, prevWeekKpis.dispatchers) },
        { id: 'medianDropRisk', label: 'Median Drop Risk', value: `${kpis.medianDropRisk}%`, trend: `<span class="kpi-trend text-gray-500">-</span>` },
        { id: 'balance', label: 'Balance + PO', value: `$${Math.round(kpis.balance).toLocaleString()}`, trend: getChangeDisplay_Profiles(kpis.balance, prevWeekKpis.balance, true, false, false, true) },
        { id: 'canceledLoads', label: 'Canceled', value: kpis.canceledLoads.toLocaleString(), trend: getChangeDisplay_Profiles(kpis.canceledLoads, prevWeekKpis.canceledLoads, false, false, false, true) },
        { id: 'medianWellness', label: 'Median Wellness %', value: `${kpis.medianWellness.toFixed(1)}%`, trend: getChangeDisplay_Profiles(kpis.medianWellness, prevWeekKpis.medianWellness, false, false, true) },
        { id: 'medianCompliance', label: 'Median Compliance %', value: `${kpis.medianCompliance.toFixed(1)}%`, trend: getChangeDisplay_Profiles(kpis.medianCompliance, prevWeekKpis.medianCompliance, false, false, true) },
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

    headerContainer.innerHTML = `
        <div class="grid grid-flow-col auto-cols-fr gap-3">
            ${visibleKpiCards.map(kpi => `
                <div class="profile-kpi-card-ranking">
                    <h4 class="kpi-title-ranking">${kpi.label}</h4>
                    <p class="kpi-value-ranking">${kpi.value}</p>
                    ${kpi.trend}
                </div>
            `).join('')}
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
                <select id="team-selector" class="w-full bg-gray-900 text-gray-100 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent transition duration-200">
                    <option value="ALL_TEAMS" ${teamData.teamName === 'All Teams' ? 'selected' : ''}>All Teams</option>
                    ${(allTeams).map(team => `<option value="${team}" ${team === teamData.teamName ? 'selected' : ''}>${team}</option>`).join('')}
                </select>
            </div>
        </div>
    `;
}

// --- CONFIGURATION FOR DISPATCH TABLE ---
const dispatchTableColumns = [
    { id: 'name', label: 'Dispatcher', type: 'string' },
    { id: 'company', label: 'Company', type: 'string' },
    { id: 'allTrucks', label: 'All Trucks', type: 'number' },
    { id: 'ooTrucks', label: 'OO Trucks', type: 'number' },
    { id: 'looTrucks', label: 'LOO Trucks', type: 'number' },
    { id: 'dryvan', label: 'Dryvan', type: 'number' },
    { id: 'reefer', label: 'Reefer', type: 'number' },
    { id: 'flatbed', label: 'Flatbed', type: 'number' },
    { id: 'rank1w', label: '1W Rank', type: 'number' },
    { id: 'rank4w', label: '4W Rank', type: 'number' },
    { id: 'goodMoves', label: 'Good Moves', type: 'number' },
    { id: 'badMoves', label: 'Bad Moves', type: 'number' },
    { id: 'hiddenMiles', label: 'Hidden Miles', type: 'number' },
    { id: 'lowRpm', label: 'Low RPM', type: 'number' },
    { id: 'newStarts', label: 'New Starts', type: 'number' },
    { id: 'wellness', label: 'Wellness %', type: 'percentage' },
    { id: 'canceled', label: 'Canceled', type: 'number' },
    { id: 'complianceScore', label: '% Compliance', type: 'percentage' },
];

// --- FIX: Updated the driver table configuration ---
const driverTableColumns = [
    { id: 'name', label: 'Driver Name', type: 'string' },
    { id: 'company', label: 'Company', type: 'string' },
    { id: 'dispatcher', label: 'Dispatcher', type: 'string' },
    // 'team' is added dynamically for "All Teams" view
    { id: 'franchise', label: 'Franchise', type: 'string' }, // NEW
    { id: 'contract', label: 'Contract', type: 'string' },
    { id: 'equipment', label: 'Equipment', type: 'string' },
    { id: 'gross', label: 'Gross', type: 'number' },
    { id: 'miles', label: 'Miles', type: 'number' },
    { id: 'margin', label: 'Margin', type: 'number' },
    { id: 'rpm', label: 'RPM', type: 'number' },
    { id: 'risk', label: 'Drop Risk %', type: 'number' },
    { id: 'flags', label: 'Flags', type: 'string' },
];



function renderDriverDeepDiveModal_Profiles() {
    const modal = document.getElementById('profiles-driver-deep-dive-modal');
    if (!modal) return;

    const { isModalOpen, selectedDriver } = appState.profiles.driverDeepDive;
    modal.classList.toggle('hidden', !isModalOpen);

    if (isModalOpen && selectedDriver) {
        const historicalStubs = getHistoricalStubsForDriver(selectedDriver, appState.loads.historicalStubsData);
        const driverData = appState.profiles.currentTeamData?.drivers.find(d => d.name === selectedDriver);
        const contractType = driverData?.contract || null;

        // --- NEW: Logic to determine Team/Solo status ---
        const isLiveData = appState.profiles.selectedWeek === 'live';
        let teamStatus = null;

        if (isLiveData) {
            const driverLoads = appState.profiles.liveData
                .filter(l => l.driver === selectedDriver && l.status_teams)
                .sort((a, b) => new Date(b.do_date) - new Date(a.do_date)); // Sort by most recent
            if (driverLoads.length > 0) {
                teamStatus = driverLoads[0].status_teams;
            }
        } else {
            // Stubs are already sorted descending by pay_date
            const recentStubWithStatus = historicalStubs.find(s => s.status_teams);
            if (recentStubWithStatus) {
                teamStatus = recentStubWithStatus.status_teams;
            }
        }
        // --- END NEW LOGIC ---

        // Pass the new data to the header rendering function
        renderModalHeader_Profiles(selectedDriver, historicalStubs, contractType, teamStatus);
        renderModalKpis_Profiles(historicalStubs);
        renderModalHistoricalTable_Profiles(historicalStubs);
        renderModalChart_Profiles(historicalStubs);
    }
}

function renderSaveFilterModal() {
    const modal = document.getElementById('save-driver-filter-modal');
    if (!modal) return;

    if (appState.profiles.driverFilters.isSaveModalOpen) {
        document.body.appendChild(modal);
        modal.classList.remove('hidden');

        const nameInput = document.getElementById('save-filter-name-input');
        const colorInput = document.getElementById('save-filter-color-input');
        const filterToEdit = appState.profiles.driverFilters.filterToEdit;

        if (filterToEdit) {
            nameInput.value = filterToEdit.name;
            colorInput.value = filterToEdit.color || '#374151';
        } else {
            nameInput.value = '';
            colorInput.value = '#374151';
        }
        nameInput.focus();
    } else {
        modal.classList.add('hidden');
    }
}

function calculateDropRisk(driver) {
    const { weights } = appState.profiles.driverHealthSettings;
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) return 0;

    let weightedScore = 0;
    driver.flags.forEach(flag => {
        // Map flag label to weight key
        const flagKey = Object.keys(appState.profiles.driverHealthSettings.flags).find(key => appState.profiles.driverHealthSettings.flags[key].label === flag.text);
        if (flagKey && weights[flagKey]) {
            weightedScore += weights[flagKey];
        }
    });

    return Math.min(100, (weightedScore / totalWeight) * 100);
}

function renderModalHeader_Profiles(driverName, historicalStubs, contractType, teamStatus) {
    const headerEl = document.getElementById('profiles-modal-header'); // Get the parent header
    const leftEl = document.getElementById('profiles-modal-header-left');
    const centerEl = document.getElementById('profiles-modal-header-center');
    if (!headerEl || !leftEl || !centerEl) return;

    // --- START OF FIX: Add positioning classes ---
    // Make the header the positioning container for the center element.
    headerEl.classList.add('relative');
    // Position the center element absolutely within the header.
    centerEl.className = 'absolute left-1/2 -translate-x-1/2';
    // --- END OF FIX ---

    const driverData = appState.profiles.currentTeamData?.drivers.find(d => d.name === driverName);
    const riskPercent = driverData ? Math.round(driverData.risk) : 50;
    const mostRecentStub = historicalStubs.length > 0 ? historicalStubs[0] : null;
    const currentCompany = mostRecentStub?.company_name || driverData?.company || '-';

    const details = [
        currentCompany !== '-' ? currentCompany : null,
        contractType,
        teamStatus
    ].filter(Boolean).join(', ');

    leftEl.innerHTML = `
        <div>
            <h2 class="text-2xl font-bold text-white whitespace-nowrap">${driverName}</h2>
            ${details ? `<p class="text-sm text-gray-400 mt-1">${details}</p>` : ''}
        </div>
    `;

    centerEl.innerHTML = `
        <div class="modal-risk-display">
            <span class="modal-risk-label">Drop Risk: ${riskPercent}%</span>
            <div class="modal-risk-bar">
                <div class="modal-risk-bar-fill" style="width: ${riskPercent}%;"></div>
            </div>
        </div>
    `;
}

function renderModalKpis_Profiles(historicalStubs) {
    const kpiContainer = document.getElementById('profiles-modal-kpi-container');
    if (!kpiContainer) return;

    if (historicalStubs.length === 0) {
        kpiContainer.innerHTML = '<p class="text-gray-500 col-span-2 text-center">No historical data for KPIs.</p>';
        return;
    }

    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    
    // Filter for recent stubs AND stubs with more than 0 miles
    const recentStubs = historicalStubs.filter(s => new Date(s.pay_date) > fourWeeksAgo && s.total_miles > 0);
    
    // If there are recent valid stubs, use them; otherwise, use all valid historical stubs
    const allValidHistoricalStubs = historicalStubs.filter(s => s.total_miles > 0);
    const stubsForCalc = recentStubs.length > 0 ? recentStubs : allValidHistoricalStubs; 
    
    if (stubsForCalc.length === 0) {
        kpiContainer.innerHTML = '<p class="text-gray-500 col-span-2 text-center">No stubs with miles found for KPI calculation.</p>';
        return;
    }

    const totalStubs = stubsForCalc.length;

    const avgNetPay = stubsForCalc.reduce((sum, s) => sum + (s.net_pay || 0), 0) / totalStubs;
    const avgRpm = stubsForCalc.reduce((sum, s) => sum + (s.rpm_all || 0), 0) / totalStubs;
    const avgMiles = stubsForCalc.reduce((sum, s) => sum + (s.total_miles || 0), 0) / totalStubs;
    const avgGross = stubsForCalc.reduce((sum, s) => sum + (s.driver_gross || 0), 0) / totalStubs;

    const kpis = [
        { label: '4-Week Avg Net', value: `$${avgNetPay.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
        { label: '4-Week Avg Gross', value: `$${avgGross.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
        { label: '4-Week Avg RPM', value: `$${avgRpm.toFixed(2)}` },
        { label: '4-Week Avg Miles', value: `${avgMiles.toLocaleString('en-US', {maximumFractionDigits: 0})}` },
    ];
    
    kpiContainer.innerHTML = kpis.map(kpi => `
    <div class="bg-gray-800/50 border border-gray-700/50 rounded-lg p-2 text-center flex flex-col justify-center">
        <h4 class="text-xs text-gray-400 uppercase font-semibold">${kpi.label}</h4>
        <p class="text-xl font-bold text-teal-400 mt-0.5">${kpi.value}</p>
    </div>
    `).join('');
}

// 1. DISPEČ TEST/profiles/profiles_ui.js

// 1. DISPEČ TEST/profiles/profiles_ui.js

function renderModalHistoricalTable_Profiles(historicalStubs) {
    const tableContainer = document.getElementById('profiles-modal-table-container');
    if (!tableContainer) return;

    if (historicalStubs.length === 0) {
        tableContainer.innerHTML = '<p class="p-4 text-center text-gray-500">No historical stubs found for this driver.</p>';
        return;
    }

    const headers = [
        { label: 'Pay Date', key: 'pay_date', format: (d) => new Date(d).toLocaleDateString() },
        { label: 'Flags', key: 'flags' },
        { label: 'Gross', key: 'driver_gross', format: (d) => `$${(d || 0).toLocaleString()}`, class: 'text-blue-400' },
        { label: 'Margin', key: 'margin', format: (d) => `$${(d || 0).toLocaleString()}`, class: 'text-yellow-400' },
        { label: 'Net', key: 'net_pay', format: (d) => `$${(d || 0).toLocaleString()}`, class: 'text-green-400' },
        { label: 'Miles', key: 'total_miles', format: (val) => (val || 0).toLocaleString() },
        { label: 'RPM', key: 'rpm_all', format: (d) => `$${(d || 0).toFixed(2)}` },
        { label: 'Dispatch', key: 'stub_dispatcher' },
        { label: 'Team', key: 'stub_team' },
        { label: 'Balance', key: 'balance', format: (d) => `$${(d || 0).toFixed(2)}` },
        { label: 'Bal. Settle', key: 'balance_settle', format: (d) => `$${(d || 0).toFixed(2)}` },
        { label: 'PO Settle', key: 'po_settle', format: (d) => `$${(d || 0).toFixed(2)}` },
        {
            label: 'Equipment',
            key: 'trailer_type',
            format: (type) => {
                if (!type) return '-';
                const upperType = type.toUpperCase();
                if (upperType === 'REEFER') return `<span class="equipment-letter eq-r">R</span>`;
                if (upperType === 'FLATBED') return `<span class="equipment-letter eq-f">F</span>`;
                if (upperType === 'VAN' || upperType === 'V') return `<span class="equipment-letter eq-v">V</span>`;
                return type;
            }
        }
    ];

    tableContainer.innerHTML = `
        <table class="w-full text-xs text-left text-gray-400 stubs-deep-dive-table">
            <thead class="text-xs text-gray-300 uppercase bg-gray-900 sticky top-0">
                <tr>
                    ${headers.map(h => `<th class="px-3 py-2 text-center whitespace-nowrap">${h.label}</th>`).join('')}
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-800">
                ${historicalStubs.map(stub => {
                    // --- NEW LOGIC TO DETERMINE MOVE FLAG FOR THE STUB ---
                    const { start, end } = getPayPeriodFromPayDate(stub.pay_date);
                    const loadsForStub = appState.profiles.liveData.filter(load =>
                        load.driver === stub.driver_name &&
                        new Date(load.do_date) >= start &&
                        new Date(load.do_date) <= end
                    );

                    let moveFlag = null;
                    let hasGoodMove = false;
                    for (const load of loadsForStub) {
                        if (load.moved_monday === 'Moved Monday Load') {
                            const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;
                            const threshold = goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default;
                            const isGoodMove = (load.driver_gross_without_moved || 0) < threshold;
                            if (!isGoodMove) {
                                moveFlag = { text: 'Bad Move', color: 'red' };
                                break; // A single bad move is enough to flag the whole stub
                            }
                            hasGoodMove = true;
                        }
                    }
                    if (!moveFlag && hasGoodMove) {
                        moveFlag = { text: 'Good Move', color: 'green' };
                    }
                    // --- END OF NEW LOGIC ---

                    return `
                    <tr class="hover:bg-gray-700/50 cursor-pointer stub-row"
                        data-pay-date="${stub.pay_date}"
                        data-driver-name="${stub.driver_name}">
                        ${headers.map(h => {
                            let displayValue;
                            if (h.key === 'flags') {
                                // Combine existing flags with our new move flag
                                const existingFlags = Array.isArray(stub.flags) ? stub.flags : [];
                                const allFlags = moveFlag ? [...existingFlags, moveFlag] : existingFlags;
                                displayValue = allFlags.length > 0
                                    ? allFlags.map(f => `<span class="driver-flag flag-${f.color}">${f.text}</span>`).join(' ')
                                    : '-';
                            } else {
                                const value = stub[h.key] ?? '-';
                                displayValue = h.format ? h.format(value, stub) : value;
                            }
                            return `<td class="px-3 py-1.5 whitespace-nowrap text-center font-mono ${h.class || ''}">${displayValue}</td>`;
                        }).join('')}
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;

    // The event listener logic for expanding rows remains unchanged
    const tableBody = tableContainer.querySelector('tbody');
    if (tableBody && !tableBody._clickHandlerAttached) {
        tableBody.addEventListener('click', e => {
            const stubRow = e.target.closest('.stub-row');
            if (!stubRow) return;

            const existingDetailsRow = stubRow.nextElementSibling;
            if (existingDetailsRow && existingDetailsRow.classList.contains('stub-details-row')) {
                existingDetailsRow.remove();
                stubRow.classList.remove('bg-gray-700/80');
                return;
            }

            document.querySelectorAll('.stub-details-row').forEach(row => row.remove());
            document.querySelectorAll('.stub-row').forEach(row => row.classList.remove('bg-gray-700/80'));

            stubRow.classList.add('bg-gray-700/80');

            const payDate = stubRow.dataset.payDate;
            const driverName = stubRow.dataset.driverName;
            const { start, end } = getPayPeriodFromPayDate(payDate);

            const loadsForStub = appState.profiles.liveData.filter(load =>
                load.driver === driverName &&
                new Date(load.do_date) >= start &&
                new Date(load.do_date) <= end
            ).sort((a, b) => new Date(a.do_date) - new Date(b.do_date) || new Date(a.pu_date) - new Date(b.pu_date));

            const detailsRow = document.createElement('tr');
            detailsRow.className = 'stub-details-row';

            let contentHTML;
            if (loadsForStub.length > 0) {
                const loadsTable = loadsForStub.map(load => {
                    const isCanceled = load.status === 'Canceled';
                    let flags = [];
                    if (load.moved_monday === 'Moved Monday Load') {
                        const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;
                        const threshold = goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default;
                        flags.push((load.driver_gross_without_moved || 0) < threshold ? '<span class="stub-flag flag-green">Good</span>' : '<span class="stub-flag flag-red">Bad</span>');
                    }
                    if (load.hidden_miles === 'Hidden Miles Found!') {
                        flags.push('<span class="stub-flag flag-purple">Hidden</span>');
                    }
                    const puDate = new Date(load.pu_date).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit'});
                    const doDate = new Date(load.do_date).toLocaleDateString('en-US', {month: '2-digit', day: '2-digit'});
                    const totalMiles = (load.trip_miles || 0) + (load.deadhead_miles || 0);
                    const driverRate = (load.price || 0) - (load.cut || 0); // Calculate the correct driver rate

                    return `
                        <tr class="hover:bg-cyan-700/50 ${isCanceled ? 'opacity-50' : ''}">
                            <td class="px-2 py-1.5">${puDate} - ${doDate}</td>
                            <td class="px-2 py-1.5">${load.pu_location}</td>
                            <td class="px-2 py-1.5">${load.do_location}</td>
                            <td class="px-2 py-1.5 text-right font-mono text-green-400">$${driverRate.toLocaleString()}</td>
                            <td class="px-2 py-1.5 text-right font-mono text-yellow-400">$${(load.cut || 0).toLocaleString()}</td>
                            <td class="px-2 py-1.5 text-right font-mono">$${((load.price || 0) / (load.trip_miles || 1)).toFixed(2)}</td>
                            <td class="px-2 py-1.5 text-right font-mono">${totalMiles.toLocaleString()} mi</td>
                            <td class="px-2 py-1.5">${load.dispatcher}</td>
                            <td class="px-2 py-1.5">${load.status || 'N/A'}</td>
                            <td class="px-2 py-1.5">${flags.join(' ')}</td>
                        </tr>
                    `;
                }).join('');

                contentHTML = `
                    <div class="bg-cyan-900/50 p-3">
                        <table class="w-full text-xs">
                            <thead>
                                <tr class="border-b border-cyan-700">
                                    <th class="px-2 py-2 text-left">Dates</th><th class="px-2 py-2 text-left">Origin</th><th class="px-2 py-2 text-left">Destination</th>
                                    <th class="px-2 py-2 text-right">Driver Rate</th><th class="px-2 py-2 text-right">Margin</th><th class="px-2 py-2 text-right">RPM</th><th class="px-2 py-2 text-right">Miles</th>
                                    <th class="px-2 py-2 text-left">Dispatcher</th><th class="px-2 py-2 text-left">Status</th><th class="px-2 py-2 text-left">Flags</th>
                                </tr>
                            </thead>
                            <tbody>${loadsTable}</tbody>
                        </table>
                    </div>
                `;
            } else {
                contentHTML = `<div class="text-center text-gray-500 py-4">No individual loads found for this pay period.</div>`;
            }

            detailsRow.innerHTML = `<td colspan="13" class="p-0">${contentHTML}</td>`;
            stubRow.after(detailsRow);
        });
        tableBody._clickHandlerAttached = true;
    }
}


function renderModalChart_Profiles(historicalStubs) {
    const chartContainer = d3.select("#profiles-modal-chart-container");
    chartContainer.html("");

    const metrics = [
        { key: 'net_pay', label: 'Net Pay', format: d3.format("$,.0f"), color: "#4ade80", negativeColor: "#f87171" },
        { key: 'driver_gross', label: 'Gross', format: d3.format("$,.0f"), color: "#60a5fa", negativeColor: "#f87171" },
        { key: 'rpm_all', label: 'RPM', format: d3.format("$.2f"), color: "#f87171", negativeColor: "#f87171" },
        { key: 'total_miles', label: 'Miles', format: d3.format(",.0f"), color: "#fbbf24", negativeColor: "#f87171" },
    ];
    
    const switcher = chartContainer.append('div').attr('class', 'p-2 text-center');
    metrics.forEach(metric => {
        switcher.append('button')
            .attr('class', `px-3 py-1 text-xs rounded-md mx-1 font-semibold ${appState.profiles.driverDeepDive.chartView === metric.key ? 'bg-teal-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`)
            .text(metric.label)
            .on('click', () => {
                appState.profiles.driverDeepDive.chartView = metric.key;
                renderModalChart_Profiles(historicalStubs);
            });
    });

    const activeMetric = metrics.find(m => m.key === appState.profiles.driverDeepDive.chartView);

    const chartData = historicalStubs.map(d => ({ 
        date: new Date(d.pay_date), 
        value: d[activeMetric.key] || 0 
    })).filter(d => d.date instanceof Date && !isNaN(d.date) && typeof d.value === 'number' && isFinite(d.value))
       .sort((a, b) => a.date - b.date);

    if (chartData.length < 1) {
        chartContainer.append('div').attr('class', 'flex items-center justify-center h-full text-gray-500 text-sm').text('No data available for this chart.');
        return;
    }
    
    const margin = { top: 10, right: 20, bottom: 30, left: 60 };
    const width = chartContainer.node().getBoundingClientRect().width - margin.left - margin.right;
    const height = chartContainer.node().getBoundingClientRect().height - 80 - margin.top - margin.bottom;

    const svg = chartContainer.append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime().domain(d3.extent(chartData, d => d.date)).range([0, width]);
    const yDomain = d3.extent(chartData, d => d.value);
    const yMin = yDomain[0] >= 0 ? 0 : yDomain[0] * 1.2;
    const yMax = yDomain[1] < 0 ? 0 : yDomain[1] * 1.2;
    const y = d3.scaleLinear().domain([yMin, yMax]).range([height, 0]).nice();

    svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat("%b %d")).tickSizeOuter(0)).attr("class", "axis-style");
    svg.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(activeMetric.format).tickSizeOuter(0)).attr("class", "axis-style");
    svg.selectAll(".domain").remove();
    svg.selectAll(".tick line").attr("stroke", "#4b5563");
    svg.selectAll(".tick text").attr("fill", "#d1d5db").attr("font-size", "11px").attr("font-weight", "500");

    svg.append("defs").append("clipPath").attr("id", "clip-above-profiles").append("rect").attr("width", width).attr("height", y(0));
    svg.append("defs").append("clipPath").attr("id", "clip-below-profiles").append("rect").attr("width", width).attr("height", height - y(0)).attr("y", y(0));
    const area = d3.area().x(d => x(d.date)).y0(y(0)).y1(d => y(d.value));
    svg.append("path").datum(chartData).attr("clip-path", "url(#clip-above-profiles)").attr("fill", activeMetric.color).style("opacity", 0.4).attr("d", area);
    svg.append("path").datum(chartData).attr("clip-path", "url(#clip-below-profiles)").attr("fill", activeMetric.negativeColor).style("opacity", 0.4).attr("d", area);
    if (yMin < 0 && yMax > 0) svg.append("line").attr("x1", 0).attr("x2", width).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#6b7280").attr("stroke-width", 1.5).attr("stroke-dasharray", "3,3");
    svg.append("path").datum(chartData).attr("fill", "none").attr("stroke", activeMetric.color).attr("stroke-width", 2.5).attr("d", d3.line().x(d => x(d.date)).y(d => y(d.value)));
    
    const tooltip = chartContainer.selectAll(".d3-tooltip").data([null]).join("div").attr("class", "d3-tooltip hidden");
    const focus = svg.append("g").attr("class", "focus").style("display", "none");
    focus.append("line").attr("class", "x-hover-line").attr("stroke", "#9ca3af").attr("stroke-width", 1).attr("stroke-dasharray", "3,3").attr("y1", 0).attr("y2", height);
    focus.append("circle").attr("r", 5).attr("stroke", "white").attr("stroke-width", 2);

    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.classed('hidden', false); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.classed('hidden', true); })
        .on("mousemove", (event) => {
            const bisectDate = d3.bisector(d => d.date).left;
            
            // --- START: THIS IS THE CORRECTED FIX ---
            // Use d3.pointer(event) to get coordinates relative to the SVG container, not the whole page.
            const [pointerX, pointerY] = d3.pointer(event);
            // --- END: THIS IS THE CORRECTED FIX ---
        
            const x0 = x.invert(pointerX);
            const i = bisectDate(chartData, x0, 1);
            const d0 = chartData[i - 1], d1 = chartData[i];
            const d = (d1 && d0 && (x0 - d0.date > d1.date - x0)) ? d1 : (d0 || d1);
            if (!d) return;
        
            const focusX = x(d.date);
            const focusY = y(d.value);
            
            focus.attr("transform", `translate(${focusX}, 0)`);
            focus.select("circle").attr("transform", `translate(0, ${focusY})`).attr("fill", activeMetric.color);
            tooltip.html(`<strong>${d.date.toLocaleDateString('en-us', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</strong><br/>${activeMetric.label}: ${activeMetric.format(d.value)}`)
                
                // --- START: THIS IS THE CORRECTED FIX ---
                // Position the tooltip using the relative pointer coordinates instead of event.pageX/pageY.
                .style("left", `${pointerX + 15}px`)
                .style("top", `${pointerY - 15}px`);
                // --- END: THIS IS THE CORRECTED FIX ---
        })
}

function calculateComplianceScores(dispatchers, allDispatchers) {
    const { weights } = appState.profiles.complianceSettings;
    const comparisonPool = allDispatchers && allDispatchers.length > 0 ? allDispatchers : dispatchers;

    // Recalculate wellness based on the new logic before scoring
    dispatchers.forEach(d => {
        const wellnessLoads = d.loads.filter(l => ['GOOD', 'FAIL', '-'].includes(l.wellness_fail));
        const successfulLoads = wellnessLoads.filter(l => l.wellness_fail === 'GOOD' || l.wellness_fail === '-').length;
        d.wellness = wellnessLoads.length > 0 ? (successfulLoads / wellnessLoads.length) * 100 : 0;
    });

    const allMetrics = [
        { id: 'goodMoves', higherIsBetter: true },
        { id: 'badMoves', higherIsBetter: false },
        { id: 'hiddenMiles', higherIsBetter: false },
        { id: 'lowRpm', higherIsBetter: false },
        { id: 'wellness', higherIsBetter: true }
    ];

    const proportionalScores = {};

    allMetrics.forEach(metric => {
        const allValues = comparisonPool.map(d => d[metric.id] ?? 0);
        const maxValue = Math.max(...allValues, 1);
        
        const scores = {};
        comparisonPool.forEach(dispatcher => {
            const value = dispatcher[metric.id] ?? 0;
            let score = 0;
            if (metric.id === 'wellness') {
                score = value;
            } else {
                const proportion = value / maxValue;
                score = metric.higherIsBetter ? proportion * 100 : (1 - proportion) * 100;
            }
            scores[dispatcher.name] = score;
        });
        proportionalScores[metric.id] = scores;
    });

    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (totalWeight === 0) {
        return dispatchers.map(d => ({ ...d, complianceScore: 0 }));
    }

    return dispatchers.map(dispatcher => {
        let weightedScore = 0;
        for (const metricId in weights) {
            const weight = weights[metricId];
            if (proportionalScores[metricId] && proportionalScores[metricId][dispatcher.name] !== undefined) {
                const score = proportionalScores[metricId][dispatcher.name];
                weightedScore += (score * weight);
            }
        }
        const finalScore = weightedScore / totalWeight;
        return { ...dispatcher, complianceScore: finalScore };
    });
}

function renderComplianceSettingsModal(allDispatchers) {
    const modal = document.getElementById('profiles-compliance-settings-modal');
    if (!modal) return;

    modal.classList.toggle('hidden', !appState.profiles.complianceSettings.isModalOpen);
    if (!appState.profiles.complianceSettings.isModalOpen) return;

    const container = document.getElementById('compliance-weights-container');
    const totalEl = document.getElementById('compliance-total-weight');
    const weights = appState.profiles.complianceSettings.weights;

    const metrics = [
        { id: 'goodMoves', label: 'Good Moves' },
        { id: 'badMoves', label: 'Bad Moves' },
        { id: 'hiddenMiles', label: 'Hidden Miles' },
        { id: 'lowRpm', label: 'Low RPM Loads' },
        { id: 'wellness', label: 'Wellness %' },
    ];

    container.innerHTML = metrics.map(metric => `
        <div class="grid grid-cols-2 gap-4 items-center">
            <label class="text-gray-300 text-right">${metric.label}</label>
            <div class="relative">
                <input type="number" min="0" max="100" step="1" value="${weights[metric.id]}" 
                       data-metric-id="${metric.id}" 
                       class="settings-input w-full compliance-input">
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
            </div>
        </div>
    `).join('');

    const updateTotal = () => {
        const total = Object.values(appState.profiles.complianceSettings.weights).reduce((s, v) => s + v, 0);
        totalEl.textContent = `${total}%`;
        totalEl.classList.toggle('text-red-500', total !== 100);
        totalEl.classList.toggle('text-green-400', total === 100);
    };

    container.querySelectorAll('.compliance-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const metricId = e.target.dataset.metricId;
            let value = parseInt(e.target.value, 10);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 100) value = 100;

            appState.profiles.complianceSettings.weights[metricId] = value;
            e.target.value = value;

            updateTotal();
            const { selectedCompany } = appState.profiles;
            let filteredDispatchers = allDispatchers;
            if (selectedCompany && selectedCompany !== 'All Companies') {
                 filteredDispatchers = allDispatchers.filter(d => d.company === selectedCompany);
            }
            renderDispatchTable(filteredDispatchers, allDispatchers);
        });
    });

    updateTotal();
}

// 1. DISPEČ TEST/profiles/profiles_ui.js

function renderDriverHealthSettingsModal() {
    const modal = document.getElementById('profiles-driver-health-settings-modal');
    if (!modal) return;

    modal.classList.toggle('hidden', !appState.profiles.driverHealthSettings.isModalOpen);
    if (!appState.profiles.driverHealthSettings.isModalOpen) return;

    const container = document.getElementById('driver-health-weights-container');
    const totalEl = document.getElementById('driver-health-total-weight');
    const weights = appState.profiles.driverHealthSettings.weights;

    const metrics = [
        { id: 'highTolls', label: 'High Tolls' },
        { id: 'dispatcherHopper', label: 'Dispatcher Hopper' },
        { id: 'lowRpm', label: 'Low RPM' },
        { id: 'lowGross', label: 'Low Gross' },
        { id: 'lowNet', label: 'Low Net' },
        { id: 'heavyLoads', label: 'Heavy Loads' },
        { id: 'negative', label: 'Negative Balance' },
    ];

    container.innerHTML = metrics.map(metric => `
        <div class="grid grid-cols-2 gap-4 items-center">
            <label class="text-gray-300 text-right">${metric.label}</label>
            <div class="relative">
                <input type="number" min="0" max="100" step="1" value="${weights[metric.id]}" 
                       data-metric-id="${metric.id}" 
                       class="settings-input w-full driver-health-input">
                <span class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">%</span>
            </div>
        </div>
    `).join('');

    const updateTotal = () => {
        const total = Object.values(appState.profiles.driverHealthSettings.weights).reduce((s, v) => s + v, 0);
        totalEl.textContent = `${total}%`;
        totalEl.classList.toggle('text-red-500', total !== 100);
        totalEl.classList.toggle('text-green-400', total === 100);
    };

    container.querySelectorAll('.driver-health-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const metricId = e.target.dataset.metricId;
            let value = parseInt(e.target.value, 10);
            if (isNaN(value) || value < 0) value = 0;
            if (value > 100) value = 100;

            appState.profiles.driverHealthSettings.weights[metricId] = value;
            e.target.value = value;

            updateTotal();
        });
    });

    updateTotal();
}

// 1. DISPEČ TEST/profiles/profiles_ui.js

function renderDriverSettingsModal() {
    const modal = document.getElementById('profiles-driver-settings-modal');
    if (!modal) return;

    modal.classList.toggle('hidden', !appState.profiles.isDriverSettingsModalOpen);
    if (!appState.profiles.isDriverSettingsModalOpen || !appState.profiles.tempDriverHealthSettings) return;

    const contentContainer = document.getElementById('driver-settings-modal-content');
    const { flags, activeSettingTab } = appState.profiles.tempDriverHealthSettings;

    const tabs = [
        { id: 'highTolls', label: 'High Tolls', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />' },
        { id: 'dispatcherHopper', label: 'Dispatcher Hopper', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />' },
        { id: 'heavyLoads', label: 'Heavy Loads', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.096.428m3.095 2.074A5.983 5.983 0 0118.75 20.25m-13.5-14.78A48.416 48.416 0 0112 4.5c2.291 0 4.545.16 6.75.47m-13.5 0c-1.01.143-2.01.317-3 .52m3-.52l-2.62 10.726c-.122.499.106 1.028.589 1.202a5.989 5.989 0 002.096.428m-3.095 2.074A5.983 5.983 0 005.25 20.25" />' },
        { id: 'negative', label: 'Balance/PO', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M15 12H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />' },
        { id: 'lowPayMetrics', label: 'Low Pay Metrics', icon: '<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V5.75A2.25 2.25 0 0018 3.5H6A2.25 2.25 0 003.75 5.75v12.5A2.25 2.25 0 006 20.25z" />' },
    ];
    
    const createSettingSection = (description, content) => `
        <div class="description">${description}</div>
        <div class="setting-controls">${content}</div>
    `;
    
    const createLookbackInput = (flagKey) => {
        const lookback = flags[flagKey].lookback;
        return `<div class="input-group compact">
            <label>Lookback Period</label>
            <div class="lookback-group">
                <select data-flag="${flagKey}" data-sub-setting="type" class="settings-select lookback-type-select">
                    <option value="allTime" ${lookback.type === 'allTime' ? 'selected' : ''}>All Time</option>
                    <option value="weeks" ${lookback.type === 'weeks' ? 'selected' : ''}>Weeks</option>
                </select>
                <input type="number" data-flag="${flagKey}" data-sub-setting="value" value="${lookback.value}" class="settings-input lookback-value-input" ${lookback.type === 'allTime' ? 'disabled' : ''}>
            </div>
        </div>`;
    };

    const createThresholdsWithOverrides = (flagKey, labelText, step = "1", showLabel = true) => {
        const thresholds = flags[flagKey].thresholds;
        const availableOverrides = ['OO', 'LOO'].filter(c => !Object.keys(thresholds.by_contract).includes(c));
        return `<div class="input-group compact">
            ${showLabel ? `<label>${labelText}</label>` : ''}
            <input data-flag="${flagKey}" data-threshold-type="default" type="number" step="${step}" value="${thresholds.default}" class="settings-input" placeholder="${labelText}">
            <div class="override-section">
                ${Object.entries(thresholds.by_contract).map(([contract, value]) => `
                    <div class="input-group compact override-row" data-contract="${contract}">
                        <label class="override-label">${contract} Override</label>
                        <div class="flex items-center">
                            <input data-flag="${flagKey}" class="contract-value-input settings-input" type="number" step="${step}" value="${value}">
                            <button class="remove-override-btn" title="Remove override">&times;</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            ${availableOverrides.length > 0 ? `<div class="relative mt-2">
                <button class="add-override-btn" data-flag="${flagKey}">+ Add Contract Override</button>
                </div>` : ''}
        </div>`;
    };
    
    let accordionHTML = '';
    tabs.forEach(tab => {
        let panelContentHTML = '';
        switch(tab.id) {
            case 'highTolls':
                panelContentHTML = createSettingSection(
                    'Flag drivers in the top X% of estimated toll costs compared to the company average for the selected period.',
                    `<div class="setting-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                        ${createLookbackInput('highTolls')}
                        ${createThresholdsWithOverrides('highTolls', 'Top Percentile Threshold (%)')}
                        <div class="input-group compact">
                            <label>Min. Stubs</label>
                            <input type="number" data-flag="highTolls" data-setting="minStubs" value="${flags.highTolls.minStubs}" class="settings-input w-full">
                        </div>
                    </div>`
                );
                break;
            case 'dispatcherHopper':
                panelContentHTML = createSettingSection('Flag drivers who have worked with more than X different dispatchers.', `<div class="setting-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">${createLookbackInput('dispatcherHopper')}${createThresholdsWithOverrides('dispatcherHopper', 'Min. Different Dispatchers')}</div>`);
                break;
            case 'heavyLoads':
                panelContentHTML = createSettingSection(
                    'Flag drivers whose average load weight is over a certain threshold.',
                    `<div class="setting-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                        ${createLookbackInput('heavyLoads')}
                        ${createThresholdsWithOverrides('heavyLoads', 'Avg. Weight Threshold (lbs)')}
                        <div class="input-group compact">
                            <label>Min. Loads</label>
                            <input type="number" data-flag="heavyLoads" data-setting="minLoads" value="${flags.heavyLoads.minLoads}" class="settings-input w-full">
                        </div>
                    </div>`
                );
                break;
            case 'negative':
                 panelContentHTML = createSettingSection(
                    'Flag drivers when their combined Balance and PO are negative.',
                    `<div class="setting-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
                        ${createThresholdsWithOverrides('negative', 'Combined Balance/PO Threshold ($)')}
                        <div class="input-group compact">
                            <label>Min. Stubs</label>
                            <input type="number" data-flag="negative" data-setting="minStubs" value="${flags.negative.minStubs}" class="settings-input w-full" placeholder="Min. Stubs">
                        </div>
                    </div>`
                );
                break;
            case 'lowPayMetrics':
                panelContentHTML = createSettingSection('Flag if X% of stubs in a period are below a threshold, given a minimum number of stubs.', `
                    <div class="low-pay-grid compact grid-cols-[0.75fr_1fr_2.5fr_1fr_1fr]"><div class="grid-header"></div>
                        <div class="grid-header">Lookback (Wks)</div>
                        <div class="grid-header">Threshold ($)</div>
                        <div class="grid-header">% of Stubs Below</div>
                        <div class="grid-header">Min. Stubs</div>
                        
                        <div class="metric-label">Low RPM</div>
                        <div class="input-group compact"><input type="number" data-flag="lowRpm" data-sub-setting="value" value="${flags.lowRpm.lookback.value}" class="settings-input"></div>
                        <div class="threshold-wrapper">${createThresholdsWithOverrides('lowRpm', 'Default RPM ($/mi)', '0.01', false)}</div>
                        <div class="input-group compact"><input type="number" data-flag="lowRpm" data-setting="minPercentageOfStubs" value="${flags.lowRpm.minPercentageOfStubs}" class="settings-input"></div>
                        <div class="input-group compact"><input type="number" data-flag="lowRpm" data-setting="minStubs" value="${flags.lowRpm.minStubs}" class="settings-input"></div>
                        
                        <div class="metric-label">Low Gross</div>
                        <div class="input-group compact"><input type="number" data-flag="lowGross" data-sub-setting="value" value="${flags.lowGross.lookback.value}" class="settings-input"></div>
                        <div class="threshold-wrapper">${createThresholdsWithOverrides('lowGross', 'Default Gross ($)', '1', false)}</div>
                        <div class="input-group compact"><input type="number" data-flag="lowGross" data-setting="minPercentageOfStubs" value="${flags.lowGross.minPercentageOfStubs}" class="settings-input"></div>
                        <div class="input-group compact"><input type="number" data-flag="lowGross" data-setting="minStubs" value="${flags.lowGross.minStubs}" class="settings-input"></div>

                        <div class="metric-label">Low Net</div>
                        <div class="input-group compact"><input type="number" data-flag="lowNet" data-sub-setting="value" value="${flags.lowNet.lookback.value}" class="settings-input"></div>
                        <div class="threshold-wrapper">${createThresholdsWithOverrides('lowNet', 'Default Net ($)', '1', false)}</div>
                        <div class="input-group compact"><input type="number" data-flag="lowNet" data-setting="minPercentageOfStubs" value="${flags.lowNet.minPercentageOfStubs}" class="settings-input"></div>
                        <div class="input-group compact"><input type="number" data-flag="lowNet" data-setting="minStubs" value="${flags.lowNet.minStubs}" class="settings-input"></div>
                    </div>`);
                break;
        }

        accordionHTML += `
            <div class="accordion-item ${activeSettingTab === tab.id ? 'open' : ''}" data-tab-id="${tab.id}">
                <button class="accordion-header">
                    <span class="accordion-title">
                        <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">${tab.icon}</svg>
                        ${tab.label}
                    </span>
                    <svg class="accordion-arrow w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                </button>
                <div class="accordion-panel">
                    <div class="accordion-panel-content">
                        ${panelContentHTML}
                    </div>
                </div>
            </div>
        `;
    });

    contentContainer.innerHTML = accordionHTML;

    const openPanel = contentContainer.querySelector('.accordion-item.open .accordion-panel');
    if (openPanel) {
        requestAnimationFrame(() => {
            openPanel.style.maxHeight = openPanel.scrollHeight + 'px';
        });
    }
}





function initializeDriverSettingsModalEventListeners() {
    const modal = document.getElementById('profiles-driver-settings-modal');
    if (!modal || modal.dataset.listenersAttached === 'true') return;
    modal.dataset.listenersAttached = 'true';

    // Helper function to recalculate the open accordion's height
    const updateOpenAccordionHeight = () => {
        requestAnimationFrame(() => {
            const openItem = modal.querySelector('.accordion-item.open');
            if (openItem) {
                const panel = openItem.querySelector('.accordion-panel');
                if (panel) {
                    panel.style.maxHeight = panel.scrollHeight + 'px';
                }
            }
        });
    };

    // Main event listener for all actions within the modal
    modal.addEventListener('click', e => {
        const header = e.target.closest('.accordion-header');
        const removeBtn = e.target.closest('.remove-override-btn');
        const addOverrideBtn = e.target.closest('.add-override-btn');

        // --- Accordion Toggle Logic (FIXED) ---
        if (header) {
            // Check if the click was on the toggle switch itself. If so, do nothing here.
            // The 'change' event listener will handle the toggle action.
            if (e.target.closest('.toggle-switch-container')) {
                return;
            }

            const item = header.closest('.accordion-item');
            if (!item) return;

            const panel = item.querySelector('.accordion-panel');
            const isOpen = item.classList.contains('open');

            // Close all other items first
            document.querySelectorAll('#driver-settings-modal-content .accordion-item.open').forEach(openItem => {
                if (openItem !== item) {
                    openItem.classList.remove('open');
                    openItem.querySelector('.accordion-panel').style.maxHeight = null;
                }
            });

            // Then, toggle the clicked item
            if (isOpen) {
                item.classList.remove('open');
                panel.style.maxHeight = null; // Collapse it
                appState.profiles.tempDriverHealthSettings.activeSettingTab = null;
            } else {
                item.classList.add('open');
                panel.style.maxHeight = panel.scrollHeight + 'px'; // Expand to its content height
                appState.profiles.tempDriverHealthSettings.activeSettingTab = item.dataset.tabId;
            }
            return;
        }

        // --- Add/Remove Override Logic ---
        if (removeBtn) {
            const overrideRow = removeBtn.closest('.override-row');
            const flagKey = overrideRow.closest('.setting-controls, .threshold-wrapper').querySelector('[data-flag]').dataset.flag;
            const contract = overrideRow.dataset.contract;
            delete appState.profiles.tempDriverHealthSettings.flags[flagKey].thresholds.by_contract[contract];
            renderDriverSettingsModal();
            return;
        }
        
        if (addOverrideBtn) {
            document.querySelectorAll('.add-override-panel').forEach(p => p.remove());
            const flagKey = addOverrideBtn.dataset.flag;
            const thresholds = appState.profiles.tempDriverHealthSettings.flags[flagKey].thresholds;
            const availableOverrides = ['OO', 'LOO'].filter(c => !Object.keys(thresholds.by_contract).includes(c));
            if (availableOverrides.length === 0) return;

            const panel = document.createElement('div');
            panel.className = 'add-override-panel';
            panel.innerHTML = availableOverrides.map(c => `<div class="add-override-option" data-contract="${c}">${c}</div>`).join('');
            document.body.appendChild(panel);

            const rect = addOverrideBtn.getBoundingClientRect();
            panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
            panel.style.left = `${rect.left + window.scrollX}px`;

            const handlePanelClick = (event) => {
                const option = event.target.closest('.add-override-option');
                if (option) {
                    const contract = option.dataset.contract;
                    const flagSettings = appState.profiles.tempDriverHealthSettings.flags[flagKey];
                    flagSettings.thresholds.by_contract[contract] = flagSettings.thresholds.default;
                    renderDriverSettingsModal();
                }
                panel.remove();
                document.removeEventListener('click', handlePanelClick, true);
            };

            setTimeout(() => {
                document.addEventListener('click', handlePanelClick, true);
            }, 0);
            return;
        }
    });

    // --- Input/Select Change Logic ---
    modal.addEventListener('change', e => {
        const target = e.target;
        const flagKey = target.dataset.flag;
        if (!flagKey) return;

        const flagSettings = appState.profiles.tempDriverHealthSettings.flags[flagKey];
        const isFloat = target.step === '0.01';
        const parse = isFloat ? parseFloat : parseInt;
        
        if (target.classList.contains('toggle-input')) {
            flagSettings.enabled = target.checked;
            const item = target.closest('.accordion-item');
            if (item) item.classList.toggle('is-disabled', !target.checked);
        } else if (target.classList.contains('lookback-type-select')) {
            flagSettings.lookback.type = target.value;
            renderDriverSettingsModal();
        } else if (target.classList.contains('lookback-value-input')) {
            flagSettings.lookback.value = parse(target.value) || 0;
        } else if (target.dataset.thresholdType === 'default') {
            flagSettings.thresholds.default = parse(target.value);
        } else if (target.classList.contains('contract-value-input')) {
            const contract = target.closest('.override-row').dataset.contract;
            flagSettings.thresholds.by_contract[contract] = parse(target.value);
        } else if (target.dataset.setting) {
             flagSettings[target.dataset.setting] = parse(target.value);
        } else if(target.dataset.subSetting) {
            flagSettings.lookback[target.dataset.subSetting] = parse(target.value);
        }

        updateOpenAccordionHeight();
    });
}


function saveDriverHealthSettings() {
    // Commit the temporary settings to the actual application state
    appState.profiles.driverHealthSettings = JSON.parse(JSON.stringify(appState.profiles.tempDriverHealthSettings));
    appState.profiles.tempDriverHealthSettings = null; // Clear the temporary state

    appState.profiles.fleetHealthCache = {}; // FIX: Clear the cache to force recalculation
    appState.profiles.isDriverSettingsModalOpen = false;
    renderTeamProfileUI(); // Re-render the main UI to reflect the saved changes
}

// --- FIX: Updated the entire renderTeamProfileUI function ---
function renderFlagSummary(drivers) {
    const container = document.getElementById('fleet-health-flag-summary');
    if (!container) return;

    // Initialize counts for all possible flags to ensure they are always displayed
    const allPossibleFlags = appState.profiles.driverHealthSettings.flags;
    const flagCounts = {};
    Object.values(allPossibleFlags).forEach(flag => {
        flagCounts[flag.label] = { count: 0, color: flag.color };
    });

    // Populate counts from the drivers who have flags
    drivers.flatMap(d => d.flags).forEach(flag => {
        if (flagCounts[flag.text]) {
            flagCounts[flag.text].count++;
        }
    });

    // Manually calculate and add good/bad moves from the dispatch breakdown data
    const dispatchers = appState.profiles.currentTeamData?.dispatchers || [];
    flagCounts['Good Moves'] = { count: dispatchers.reduce((sum, d) => sum + d.goodMoves, 0), color: 'green' };
    flagCounts['Bad Moves'] = { count: dispatchers.reduce((sum, d) => sum + d.badMoves, 0), color: 'red' };
    
    // Create a specific order for the flags to be displayed
    const displayOrder = [
        'Balance', 'High Tolls', 'Low Net', 'Heavy Loads', 'Hopper', 'Low RPM', 'Low Gross', 'Good Moves', 'Bad Moves'
    ];

    // Filter and sort the flags based on the predefined order
    const sortedFlags = Object.entries(flagCounts)
        .filter(([label]) => displayOrder.includes(label))
        .sort(([labelA], [labelB]) => displayOrder.indexOf(labelA) - displayOrder.indexOf(labelB));

    if (sortedFlags.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = sortedFlags.map(([label, data]) => `
        <div class="flag-summary-item">
            <span class="flag-summary-count" style="color: var(--flag-color-${data.color}, '#e5e7eb');">${data.count}</span>
            <span class="flag-summary-label">${label}</span>
        </div>
    `).join('');
}

function renderFranchiseFilterDropdown() {
    const container = document.getElementById('franchise-filter-container');
    if (!container) return;

    const existingDropdown = document.getElementById('franchise-filter-dropdown');
    if (existingDropdown) existingDropdown.remove();

    if (!appState.profiles.isFranchiseFilterOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'franchise-filter-dropdown';
    dropdown.className = 'absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

    const { selectedWeek } = appState.profiles;
    const weeksAgo = selectedWeek === 'live' ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
    const { start, end } = getPayrollWeekDateRange(weeksAgo);

    const useLiveData = selectedWeek === 'live';
    const sourceData = useLiveData ? appState.profiles.liveData : appState.loads.historicalStubsData;
    const dateKey = useLiveData ? 'do_date' : 'pay_date';
    const franchiseKey = 'franchise_name';

    const activeFranchises = [...new Set(
        sourceData
            .filter(d => {
                if (!d[dateKey]) return false;
                const itemDate = new Date(d[dateKey]);
                return itemDate >= start && itemDate <= end && d[franchiseKey];
            })
            .map(d => d[franchiseKey])
    )].sort();

    const options = ['All Franchises', ...activeFranchises];

    let dropdownHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Filter Franchise</div>`;

    options.forEach(opt => {
        const isActive = appState.profiles.selectedFranchise === opt;
        dropdownHTML += `
            <a href="#" data-filter="${opt}" class="franchise-filter-option flex items-center justify-between p-1.5 hover:bg-gray-600 rounded-md text-sm ${isActive ? 'text-teal-400 font-semibold' : 'text-gray-200'}">
                <span>${opt}</span>
                ${isActive ? '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clip-rule="evenodd" /></svg>' : ''}
            </a>
        `;
    });

    dropdown.innerHTML = dropdownHTML;
    container.appendChild(dropdown);

    dropdown.querySelectorAll('.franchise-filter-option').forEach(optionEl => {
        optionEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            appState.profiles.selectedFranchise = e.currentTarget.dataset.filter;
            appState.profiles.isFranchiseFilterOpen = false;
            renderTeamProfileUI();
        });
    });
}





export const renderTeamProfileUI = async () => {
    // --- START OF THE CORRECTED FIX ---
    // This logic runs every time any filter changes within the Fleet Health view.
    const snapshotTrigger = document.getElementById('snapshot-trigger');
    if (snapshotTrigger) {
        // Define all conditions required for the button to be visible.
        const isSpecificTeamSelected = appState.profiles.selectedTeam !== 'ALL_TEAMS';
        const isHistoricalWeekSelected = appState.profiles.selectedWeek !== 'live';
        const isAllCompaniesSelected = appState.profiles.selectedCompany === 'All Companies';
        const isAllFranchisesSelected = appState.profiles.selectedFranchise === 'All Franchises';

        // Show the button ONLY IF all conditions are true. Otherwise, hide it.
        if (isSpecificTeamSelected && isHistoricalWeekSelected && isAllCompaniesSelected && isAllFranchisesSelected) {
            snapshotTrigger.style.display = 'flex';
        } else {
            snapshotTrigger.style.display = 'none';
        }
    }
    // --- END OF THE CORRECTED FIX ---

    const profilesContent = document.getElementById('profiles-content');
    if (!profilesContent) return;

    if (!appState.profiles.liveData || appState.profiles.liveData.length === 0) {
        profilesContent.innerHTML = `<div class="flex items-center justify-center h-full"><div class="text-center"><div class="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400 mx-auto"></div><p class="mt-4 text-gray-400">Loading Live Profile Data...</p></div></div>`;
        return;
    }
    
    const liveData = appState.profiles.liveData;
    const historicalStubs = appState.loads.historicalStubsData || [];
    const { allHistoricalData } = appState;
    const historicalDates = [...new Set(allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();

    const allAvailableTeams = [...new Set(liveData.map(d => d.team).filter(Boolean))]
        .filter(name => !['cletus spuckler', 'ralph wiggum', 'seymour skinner', 'med disp disp'].includes(name.toLowerCase()))
        .sort();

    if (!allAvailableTeams.includes(appState.profiles.selectedTeam) && appState.profiles.selectedTeam !== 'ALL_TEAMS') {
        appState.profiles.selectedTeam = 'ALL_TEAMS';
    }

    const { selectedWeek, selectedTeam, contractTypeFilter, selectedCompany, selectedFranchise } = appState.profiles;
    const cacheKey = `${selectedWeek}-${selectedTeam}-${contractTypeFilter}-${selectedCompany}-${selectedFranchise}`;

    if (appState.profiles.fleetHealthCache[cacheKey]) {
        const { teamData, currentKpis, prevWeekKpis, allAvailableTeams, allProcessedDispatchersForCompliance } = appState.profiles.fleetHealthCache[cacheKey];
        appState.profiles.currentTeamData = teamData;
        appState.profiles.allProcessedDispatchers = allProcessedDispatchersForCompliance;
        profilesContent.innerHTML = `
            <div id="profiles-header" class="flex-shrink-0 flex justify-between items-center"></div>
            <div class="profile-tables-wrapper">
                <div id="profiles-dispatch-breakdown" class="profile-table-container"></div>
                <div id="fleet-health-flag-summary" class="flex-shrink-0"></div>
                <div id="profiles-driver-health" class="profile-table-container">
                    <div id="profiles-driver-toolbar" class="flex-shrink-0 flex flex-wrap items-center justify-between gap-4 mb-3"></div>
                    <div id="profiles-driver-table-container" class="flex-grow overflow-auto"></div>
                </div>
            </div>
        `;
        renderProfileHeader(teamData, allAvailableTeams, currentKpis, prevWeekKpis);
        renderFlagSummary(teamData.drivers);
        renderDispatchTable(teamData.dispatchers, allProcessedDispatchersForCompliance);
        renderDriverToolbar(teamData);
        renderDriverTable(teamData.drivers);
        renderDriverSettingsModal();
        renderComplianceSettingsModal(allProcessedDispatchersForCompliance);
        renderContractTypeFilterDropdown();
        renderCompanyFilterDropdown();
        renderFranchiseFilterDropdown();
        renderThresholdSettingsModal();
        renderDriverHealthSettingsModal();
        renderDriverDeepDiveModal_Profiles();
        renderTeamSnapshot();
        initializeProfileEventListeners();
        return;
    }
    
    const weeksAgo = selectedWeek === 'live' ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
    const targetStubDate = getRankingDateForProfileWeek(weeksAgo, historicalDates);
    const useLiveData = selectedWeek === 'live' || !targetStubDate;
    const dispatcherRanks = calculateDispatcherRanksForPeriod(selectedWeek, contractTypeFilter);

    if (isNaN(weeksAgo)) {
        profilesContent.innerHTML = `<p class="p-4 text-center text-red-400">Invalid date selection.</p>`;
        return;
    }

    const { start: currentStart, end: currentEnd } = getPayrollWeekDateRange(weeksAgo);
    const { start: prevStart, end: prevEnd } = getPayrollWeekDateRange(weeksAgo + 1);
    
    const filterDataByDateAndTeam = (source, start, end, isForLiveData, ignoreFilters = false) => {
        let dateFilteredSource = isForLiveData
            ? source.filter(d => d.do_date && new Date(d.do_date) >= start && new Date(d.do_date) <= end)
            : source.filter(d => {
                if (!d.pay_date) return false;
                const payDate = new Date(d.pay_date);
                if (isNaN(payDate.getTime())) return false;
                const weekEnd = new Date(end);
                weekEnd.setUTCDate(weekEnd.getUTCDate() + 3);
                return payDate.toISOString().split('T')[0] === weekEnd.toISOString().split('T')[0];
            });
    
        if (ignoreFilters) {
            return dateFilteredSource;
        }
    
        if (selectedTeam !== 'ALL_TEAMS') {
            const teamKey = isForLiveData ? 'team' : 'stub_team';
            dateFilteredSource = dateFilteredSource.filter(d => d[teamKey] === selectedTeam);
        }
        if (selectedCompany && selectedCompany !== 'All Companies') {
            dateFilteredSource = dateFilteredSource.filter(d => d.company_name === selectedCompany);
        }
        if (selectedFranchise && selectedFranchise !== 'All Franchises') {
            const franchiseKey = isForLiveData ? 'franchise_name' : 'franchise_name'; // Assuming same key
            dateFilteredSource = dateFilteredSource.filter(d => d[franchiseKey] === selectedFranchise);
        }
        return dateFilteredSource;
    };

    const universalDataForPeriod = filterDataByDateAndTeam(useLiveData ? liveData : historicalStubs, currentStart, currentEnd, useLiveData, true);
    const weekFilteredLiveDataForDispatch = liveData.filter(d => d.do_date && new Date(d.do_date) >= currentStart && new Date(d.do_date) <= currentEnd);

    let sourceForDispatcherNames = useLiveData ? appState.profiles.liveDriverCountData : universalDataForPeriod;
    const nameKey = useLiveData ? 'dispatcher_name' : 'stub_dispatcher';
    const allDispatcherNamesAcrossAllTeams = [...new Set(sourceForDispatcherNames.map(d => d[nameKey]).filter(Boolean))];
    
    const masterDispatcherList = allDispatcherNamesAcrossAllTeams.map((name, index) => {
        const wellnessLoads = weekFilteredLiveDataForDispatch.filter(d => d.dispatcher === name && (d.wellness_fail === 'GOOD' || d.wellness_fail === 'FAIL'));
        const goodWellnessLoads = wellnessLoads.filter(d => d.wellness_fail === 'GOOD').length;
        const wellness = wellnessLoads.length > 0 ? (goodWellnessLoads / wellnessLoads.length) * 100 : 0;
        const liveDriversForDispatcher = appState.profiles.liveDriverCountData.filter(d => d.dispatcher_name && d.dispatcher_name.trim().toLowerCase() === name.trim().toLowerCase());
        const allTrucks = liveDriversForDispatcher.length;
        const ooTrucks = liveDriversForDispatcher.filter(d => d.contract_type === 'OO').length;
        const looTrucks = allTrucks - ooTrucks;
        let loadsForStats = weekFilteredLiveDataForDispatch.filter(d => d.dispatcher === name);
        const movedLoads = loadsForStats.filter(d => d.moved_monday === 'Moved Monday Load');
        const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;
        const goodMoves = movedLoads.filter(load => (load.driver_gross_without_moved || 0) < (goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default)).length;
        const firstLiveDriverRecord = appState.profiles.liveDriverCountData.find(d => d.dispatcher_name && d.dispatcher_name.trim().toLowerCase() === name.trim().toLowerCase());
        const ranks = dispatcherRanks.get(name) || { rank1w: null, rank4w: null };
        return {
            id: index + 1, name, loads: loadsForStats,
            company: firstLiveDriverRecord?.company_name || '-',
            team: firstLiveDriverRecord?.dispatcher_team || '-',
            allTrucks, ooTrucks, looTrucks,
            goodMoves, badMoves: movedLoads.length - goodMoves,
            hiddenMiles: loadsForStats.filter(d => d.hidden_miles === 'Hidden Miles Found!').length,
            lowRpm: loadsForStats.filter(d => d.rpm_all < getLowRpmThreshold(d.contract_type)).length,
            newStarts: new Set(loadsForStats.filter(d => d.new_start === 'NEW START').map(l => l.driver)).size,
            canceled: loadsForStats.filter(d => d.status === 'Canceled').length,
            rank1w: ranks.rank1w, rank4w: ranks.rank4w,
            wellness: wellness.toFixed(0)
        };
    });

    const allProcessedDispatchersForCompliance = calculateComplianceScores(masterDispatcherList, masterDispatcherList);
    appState.profiles.allProcessedDispatchers = allProcessedDispatchersForCompliance;

    const currentFilteredData = filterDataByDateAndTeam(useLiveData ? liveData : historicalStubs, currentStart, currentEnd, useLiveData);
    const allDriversInViewUnfiltered = [...new Set(currentFilteredData.map(d => useLiveData ? d.driver : d.driver_name).filter(Boolean))];
    const driverEquipmentMap = historicalStubs.reduce((acc, stub) => {
        if (stub.driver_name && stub.trailer_type) {
            if (!acc[stub.driver_name] || new Date(stub.pay_date) > new Date(acc[stub.driver_name].pay_date)) {
                acc[stub.driver_name] = { trailer_type: stub.trailer_type, pay_date: stub.pay_date };
            }
        }
        return acc;
    }, {});
    let processedDrivers = allDriversInViewUnfiltered.map((name, index) => {
        let driverData = currentFilteredData.filter(d => (useLiveData ? d.driver : d.driver_name) === name);
        if (useLiveData) driverData = driverData.filter(l => l.status !== 'Canceled');
        const firstEntry = driverData[0] || {};
        let equipment = '-';
        const equipmentInfo = driverEquipmentMap[name];
        if (equipmentInfo) {
            const trailerType = equipmentInfo.trailer_type.toUpperCase();
            if (trailerType === 'REEFER') equipment = 'R'; else if (trailerType === 'FLATBED') equipment = 'F'; else if (trailerType === 'VAN') equipment = 'V';
        }
        const liveFlags = calculateLiveFlagsForDriver(name, historicalStubs, allDriversInViewUnfiltered);
        const contractType = firstEntry.contract_type ? firstEntry.contract_type.toUpperCase() : 'LOO';
        const contract = contractType === 'OO' ? 'OO' : 'LOO';
        const driver = {
            id: 1000 + index, name, company: firstEntry.company_name || '-',
            dispatcher: useLiveData ? firstEntry.dispatcher : firstEntry.stub_dispatcher || '-',
            team: useLiveData ? firstEntry.team : firstEntry.stub_team || '-',
            franchise: firstEntry.franchise_name || '-', // UPDATED
            contract, equipment, flags: liveFlags,
            gross: useLiveData ? driverData.reduce((s, l) => s + ((l.price || 0) - (l.cut || 0)), 0) : driverData.reduce((s, l) => s + (l.driver_gross || 0), 0),
            margin: useLiveData ? driverData.reduce((s, l) => s + (l.cut || 0), 0) : driverData.reduce((s, l) => s + (l.margin || 0), 0),
            miles: useLiveData ? driverData.reduce((s, l) => s + (l.trip_miles || 0), 0) : driverData.reduce((s, l) => s + (l.total_miles || 0), 0),
            rpm: useLiveData ? (driverData.reduce((s, l) => s + (l.trip_miles || 0), 0) > 0 ? driverData.reduce((s, l) => s + (l.price || 0), 0) / driverData.reduce((s, l) => s + (l.trip_miles || 0), 0) : 0) : firstEntry.rpm_all || 0,
        };
        driver.risk = calculateDropRisk(driver);
        return driver;
    });
    
    if (contractTypeFilter !== 'all') {
        processedDrivers = processedDrivers.filter(driver => {
            if (contractTypeFilter === 'oo') {
                return driver.contract === 'OO';
            }
            if (contractTypeFilter === 'loo') {
                return driver.contract !== 'OO';
            }
            return true;
        });
    }

    let dispatchersToDisplay = allProcessedDispatchersForCompliance;
    if (contractTypeFilter !== 'all') {
        dispatchersToDisplay = dispatchersToDisplay.filter(d => contractTypeFilter === 'oo' ? d.ooTrucks > 0 : d.looTrucks > 0);
    }
    if (selectedCompany && selectedCompany !== 'All Companies') {
        dispatchersToDisplay = dispatchersToDisplay.filter(d => d.company === selectedCompany);
    }
    if (selectedFranchise && selectedFranchise !== 'All Franchises') {
        const driversInFranchise = new Set(processedDrivers.filter(d => d.franchise === selectedFranchise).map(d => d.name));
        dispatchersToDisplay = dispatchersToDisplay.filter(disp => {
            return disp.loads.some(load => driversInFranchise.has(load.driver));
        });
    }
    if (selectedTeam && selectedTeam !== 'ALL_TEAMS') {
        dispatchersToDisplay = dispatchersToDisplay.filter(d => d.team === selectedTeam);
    }

    const teamData = {
        teamName: selectedTeam === 'ALL_TEAMS' ? 'All Teams' : selectedTeam,
        weekLabel: getProfilePayrollWeek(weeksAgo).label,
        companies: [...new Set(universalDataForPeriod.map(d => d.company_name).filter(Boolean))],
        dispatchers: dispatchersToDisplay,
        drivers: processedDrivers
    };
    appState.profiles.currentTeamData = teamData;
    
    const prevWeeksAgo = weeksAgo + 1;
    const prevTargetStubDate = getRankingDateForProfileWeek(prevWeeksAgo, historicalDates);
    const useLiveDataForPrev = prevWeeksAgo === 0 || !prevTargetStubDate;
    const prevWeekFilteredData = filterDataByDateAndTeam(useLiveDataForPrev ? liveData : historicalStubs, prevStart, prevEnd, useLiveDataForPrev);
    const prevWeekDriverNames = [...new Set(prevWeekFilteredData.map(d => useLiveDataForPrev ? d.driver : d.driver_name).filter(Boolean))];
    const prevWeekDrivers = prevWeekDriverNames.map(name => ({ name }));
    const currentKpis = calculateKpiData(currentFilteredData, useLiveData, processedDrivers, historicalStubs, contractTypeFilter, teamData);
    const prevWeekKpis = calculateKpiData(prevWeekFilteredData, useLiveDataForPrev, prevWeekDrivers, historicalStubs, contractTypeFilter, teamData);
    
    appState.profiles.fleetHealthCache[cacheKey] = {
        teamData,
        currentKpis,
        prevWeekKpis,
        allAvailableTeams,
        allProcessedDispatchersForCompliance
    };

    profilesContent.innerHTML = `
        <div id="profiles-header" class="flex-shrink-0 flex justify-between items-center"></div>
        <div class="profile-tables-wrapper">
            <div id="profiles-dispatch-breakdown" class="profile-table-container"></div>
            <div id="fleet-health-flag-summary" class="flex-shrink-0"></div>
            <div id="profiles-driver-health" class="profile-table-container">
                <div id="profiles-driver-toolbar" class="flex-shrink-0 flex flex-wrap items-center justify-between gap-4 mb-3"></div>
                <div id="profiles-driver-table-container" class="flex-grow overflow-auto"></div>
            </div>
        </div>
    `;

    renderProfileHeader(teamData, allAvailableTeams, currentKpis, prevWeekKpis);
    renderFlagSummary(processedDrivers);
    renderDispatchTable(dispatchersToDisplay, allProcessedDispatchersForCompliance);
    renderDriverToolbar(teamData);
    renderDriverTable(teamData.drivers);
    renderDriverSettingsModal();
    renderComplianceSettingsModal(allProcessedDispatchersForCompliance);
    renderContractTypeFilterDropdown(); 
    renderCompanyFilterDropdown();
    renderThresholdSettingsModal();
    renderDriverHealthSettingsModal();
    renderDriverDeepDiveModal_Profiles();
    renderSaveFilterModal();
    initializeProfileEventListeners();
};




function renderKpiSettingsDropdown() {
    const container = document.getElementById('kpi-settings-container');
    if (!container) return;

    const existingDropdown = document.getElementById('kpi-settings-dropdown');
    if (existingDropdown) existingDropdown.remove();

    if (!appState.profiles.isKpiSettingsOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'kpi-settings-dropdown';
    dropdown.className = 'absolute right-0 mt-2 w-72 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

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

            renderTeamProfileUI(); // This line forces the view to re-render with the new settings
        });
    });
}


function renderDispatchTable(dispatchersToDisplay, allDispatchers) {
    const componentContainer = document.getElementById('profiles-dispatch-breakdown');
    if (!componentContainer) return;

    const teamData = appState.profiles.currentTeamData;
    const franchiseText = appState.profiles.selectedFranchise === 'All Franchises' ? '' : ` for ${appState.profiles.selectedFranchise}`;
    const title = teamData ? `Dispatch Breakdown for ${teamData.teamName}${franchiseText}` : 'Dispatch Breakdown';

    // --- START: Search Filtering Logic ---
    const searchTerm = appState.profiles.dispatcherSearchTerm.toLowerCase();
    let dispatchersWithScores = calculateComplianceScores(dispatchersToDisplay, allDispatchers);
    if (searchTerm) {
        dispatchersWithScores = dispatchersWithScores.filter(d => 
            d.name.toLowerCase().includes(searchTerm)
        );
    }
    // --- END: Search Filtering Logic ---
    
    const { sortConfig, columnOrder, visibleColumnIds, pinnedLeftColumns, pinnedRightColumns } = appState.profiles.dispatchTable;
    const selectedDispatcherId = appState.profiles.selectedDispatcherId;
    
    let visibleColumns = columnOrder
        .map(id => dispatchTableColumns.find(c => c.id === id))
        .filter(col => col && visibleColumnIds.includes(col.id));

    if (appState.profiles.selectedTeam === 'ALL_TEAMS') {
        const companyIndex = visibleColumns.findIndex(c => c.id === 'company');
        const insertionIndex = companyIndex > -1 ? companyIndex : 1; 
        if (!visibleColumns.some(c => c.id === 'team')) {
            visibleColumns.splice(insertionIndex, 0, { id: 'team', label: 'Team', type: 'string' });
        }
    }

    dispatchersWithScores.sort((a, b) => {
        const valA = a[sortConfig.key];
        const valB = b[sortConfig.key];
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'string') {
            return sortConfig.direction === 'ascending' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return sortConfig.direction === 'ascending' ? valA - valB : valB - valA;
        }
    });

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return '';
        return sortConfig.direction === 'ascending' ? ' ▲' : ' ▼';
    };

    componentContainer.innerHTML = `
        <div class="flex justify-between items-center mb-3">
            <div class="flex items-center">
                <h3 class="text-lg font-bold text-gray-200">${title}</h3>
                <input type="text" id="dispatcher-search-input" class="profile-table-search" placeholder="Search dispatcher..." value="${appState.profiles.dispatcherSearchTerm}">
            </div>
            <div class="flex items-center gap-2">
                 <button id="compliance-settings-btn" class="toolbar-btn !p-2" title="Compliance Score Settings">
                    <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
                </button>
                <button id="dispatch-threshold-settings-btn" class="toolbar-btn !p-2" title="Threshold Settings">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                </button>
                <div class="relative">
                    <button id="dispatch-table-settings-btn" class="toolbar-btn !p-2" title="Visible Columns">
                        <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3.375 6.375h17.25M3.375 12h17.25m-17.25 5.625h17.25" /></svg>
                    </button>
                    <div id="dispatch-column-settings-dropdown" class="absolute right-0 mt-2 w-72 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 hidden p-2"></div>
                </div>
            </div>
        </div>
        <div id="profiles-dispatch-table-container" class="overflow-auto">
             <table class="w-full text-sm text-left text-gray-400">
                <thead class="text-xs text-gray-300 uppercase sticky top-0 bg-gray-900 z-20">
                    <tr id="dispatch-table-head">
                        ${visibleColumns.map(col => {
                            const isPinnedLeft = pinnedLeftColumns.includes(col.id);
                            const isPinnedRight = pinnedRightColumns.includes(col.id);
                            const stickyClasses = isPinnedLeft ? 'sticky sticky-left' : isPinnedRight ? 'sticky sticky-right' : '';
                            return `<th class="py-2 px-3 whitespace-nowrap cursor-pointer select-none ${stickyClasses}" draggable="true" data-col-id="${col.id}" onclick="requestDispatchSort('${col.id}')">${col.label}${getSortIcon(col.id)}</th>`;
                        }).join('')}
                    </tr>
                </thead>
                <tbody id="dispatch-table-body" class="divide-y divide-gray-700">
                    ${dispatchersWithScores.map(d => `
                        <tr class="dispatch-table-row ${selectedDispatcherId === d.id ? 'selected' : ''}" data-dispatcher-id="${d.id}" data-dispatcher-name="${d.name}">
                            ${visibleColumns.map(col => {
                                const isPinnedLeft = pinnedLeftColumns.includes(col.id);
                                const isPinnedRight = pinnedRightColumns.includes(col.id);
                                const stickyClasses = isPinnedLeft ? 'sticky sticky-left' : isPinnedRight ? 'sticky sticky-right' : '';
                                
                                let content = d[col.id];
                                let cellClass = 'text-center';
                                let tooltipAttr = '';

                                if (['goodMoves', 'badMoves', 'hiddenMiles', 'lowRpm', 'newStarts', 'wellness', 'canceled'].includes(col.id)) {
                                    cellClass += ' dispatch-tooltip-trigger cursor-help';
                                    tooltipAttr = `data-tooltip-metric="${col.id}"`;
                                }
                                
                                if (col.id === 'name') cellClass = 'text-left font-medium text-gray-200';
                                if (col.id === 'goodMoves') cellClass += ' text-green-400 font-semibold';
                                if (col.id === 'badMoves') cellClass += ' text-red-400 font-semibold';
                                
                                switch(col.type) {
                                    case 'percentage': 
                                        if (col.id === 'complianceScore') {
                                            content = `<span class="font-bold text-teal-300">${(d[col.id] ?? 0).toFixed(1)}%</span>`;
                                        } else {
                                            content = `${(d[col.id] ?? 0).toFixed(0)}%`; 
                                        }
                                        break;
                                }
                                return `<td class="py-2 px-3 whitespace-nowrap ${stickyClasses} ${cellClass}" ${tooltipAttr}>${content ?? '-'}</td>`;
                            }).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;

    renderDispatchColumnSettingsDropdown();
    initializeDispatchTableDragDrop();
    applyStickyStyles_DispatchTable();
    initializeProfileEventListeners();
}

function renderThresholdSettingsModal() {
    const modal = document.getElementById('profiles-threshold-settings-modal');
    if (!modal) return;

    modal.classList.toggle('hidden', !appState.profiles.thresholdSettings.isModalOpen);
    if (!appState.profiles.thresholdSettings.isModalOpen) return;

    const { goodMove, lowRpm } = appState.profiles.thresholdSettings;
    const allContractTypes = [...new Set((appState.profiles.liveData || []).map(d => d.contract_type).filter(Boolean))].sort();

    const createThresholdSection = (config) => {
        let overridesHTML = '';
        for (const [contract, value] of Object.entries(config.settings.by_contract)) {
            overridesHTML += `
                <div class="threshold-row">
                    <select class="contract-type-select settings-select" data-type="${config.type}" data-old-contract="${contract}">
                        ${allContractTypes.map(c => `<option value="${c}" ${c === contract ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                    <div class="input-dollar-sign-wrapper">
                        <span>$</span>
                        <input class="contract-value-input settings-input" type="number" step="${config.step}" data-type="${config.type}" data-contract="${contract}" value="${value}">
                    </div>
                    <button class="remove-threshold-btn" data-type="${config.type}" data-contract="${contract}" title="Remove override">&times;</button>
                </div>
            `;
        }

        return `
            <div class="flex-1 flex flex-col">
                <h4 class="settings-section-title">${config.title}</h4>
                <p class="text-xs text-gray-400 mb-4">${config.description}</p>
                <div class="setting-item">
                    <label class="setting-label">Default Threshold</label>
                    <div class="input-dollar-sign-wrapper">
                        <span>$</span>
                        <input id="${config.type}-default-threshold" data-type="${config.type}" type="number" step="${config.step}" value="${config.settings.default}" class="settings-input default-threshold-input">
                    </div>
                </div>
                <div class="border-t border-gray-700 my-4"></div>
                <p class="text-gray-400 text-xs mb-3">Contract-Specific Overrides</p>
                <div class="good-move-overrides-list flex-grow">${overridesHTML}</div>
                <button class="add-criteria-btn mt-2 add-override-btn" data-type="${config.type}">+ Add Override</button>
            </div>
        `;
    };

    const modalContent = document.getElementById('threshold-modal-content');
    modalContent.innerHTML = `
        <div class="flex gap-x-6">
            ${createThresholdSection({
                type: 'lowRpm',
                title: 'Low RPM Thresholds',
                description: 'Loads with an RPM below this value will be flagged as "Low RPM".',
                settings: lowRpm,
                step: 0.01
            })}
            <div class="w-px bg-gray-700"></div>
            ${createThresholdSection({
                type: 'goodMove',
                title: '"Good Move" Thresholds',
                description: 'A "Moved Load" is a <span class="font-bold text-green-400">Good Move</span> if the driver\'s gross pay for that week (excluding the moved load) is below this threshold.',
                settings: goodMove,
                step: 100
            })}
        </div>
    `;
    
    // --- NEW EVENT LISTENER LOGIC ---
    if (!modalContent._listenersAttached) {
        modalContent.addEventListener('change', e => {
            const type = e.target.dataset.type;
            const settings = appState.profiles.thresholdSettings[type];
            if (!settings) return;

            if (e.target.classList.contains('default-threshold-input')) {
                const isFloat = e.target.step === '0.01';
                settings.default = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            } else if (e.target.classList.contains('contract-value-input')) {
                const isFloat = e.target.step === '0.01';
                settings.by_contract[e.target.dataset.contract] = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
            } else if (e.target.classList.contains('contract-type-select')) {
                const oldContract = e.target.dataset.oldContract;
                const newContract = e.target.value;
                if (oldContract !== newContract) {
                    const value = settings.by_contract[oldContract];
                    delete settings.by_contract[oldContract];
                    settings.by_contract[newContract] = value;
                    renderThresholdSettingsModal(); // Re-render to update attributes
                }
            }
        });

        modalContent.addEventListener('click', e => {
            if (e.target.classList.contains('add-override-btn')) {
                e.preventDefault();
                const type = e.target.dataset.type;
                const settings = appState.profiles.thresholdSettings[type];
                const usedContracts = Object.keys(settings.by_contract);
                const availableContract = allContractTypes.find(c => !usedContracts.includes(c));
                
                if (availableContract) {
                    settings.by_contract[availableContract] = settings.default;
                    renderThresholdSettingsModal();
                } else {
                    alert('All contract types already have a specific threshold.');
                }
            } else if (e.target.classList.contains('remove-threshold-btn')) {
                e.preventDefault();
                const type = e.target.dataset.type;
                const contract = e.target.dataset.contract;
                delete appState.profiles.thresholdSettings[type].by_contract[contract];
                renderThresholdSettingsModal();
            }
        });
        modalContent._listenersAttached = true;
    }
}

function renderDispatchTableSettings(allDispatchers) {
    renderComplianceSettingsModal(allDispatchers);
}

function renderDriverToolbar(teamData) {
    const toolbarContainer = document.getElementById('profiles-driver-toolbar');
    if (!toolbarContainer) return;

    const selectedDispatcherName = appState.profiles.selectedDispatcherId
        ? teamData.dispatchers.find(d => d.id === appState.profiles.selectedDispatcherId)?.name
        : null;

    const activeFiltersCount = appState.profiles.driverFilters.activeFilters.length;
    const isFilterModified = appState.profiles.activeSavedFilterId === null;

    const savedFilters = appState.profiles.savedDriverFilters || [];
    const hasCustomFilters = savedFilters.some(f => !f.isDefault);

    const franchiseText = appState.profiles.selectedFranchise === 'All Franchises' ? '' : ` for ${appState.profiles.selectedFranchise}`;
    
    const title = selectedDispatcherName 
        ? `Driver Health for ${selectedDispatcherName}` 
        : `Driver Health for ${teamData.teamName}${franchiseText}`;
    
    const modifiedText = isFilterModified ? '<span class="text-sm font-normal text-yellow-400 ml-2">(modified)</span>' : '';

    const savedFiltersHTML = savedFilters.map(filter => {
        if (!hasCustomFilters && filter.isDefault) {
            return '';
        }

        const isActive = appState.profiles.activeSavedFilterId === filter.id;
        const isDefault = filter.isDefault;
        let styleOverrides = '';
        if (!isDefault && filter.color && filter.color.startsWith('#')) {
            if (isActive) {
                styleOverrides = `style="background-color: ${filter.color}; border-color: ${filter.color}; color: white;"`;
            } else {
                styleOverrides = `style="border-color: ${filter.color}; color: ${filter.color};"`;
            }
        }

        if (isDefault) {
            return `<button class="saved-filter-btn ${isActive ? 'active' : ''}" data-filter-id="${filter.id}" data-color="blue"><span class="text-sm">${filter.name}</span></button>`;
        } else {
            return `
            <div class="custom-filter-wrapper ${isActive ? 'is-active' : ''}" data-color="${filter.color || 'gray'}" data-filter-id="${filter.id}">
                <button class="saved-filter-btn saved-filter-main" data-filter-id="${filter.id}" ${styleOverrides}>
                    <span class="text-sm">${filter.name}</span>
                </button>
                <div class="filter-actions-menu-container ${!isActive ? 'hidden' : ''}">
                    <button class="filter-actions-trigger" ${styleOverrides}>☰</button>
                    <div class="filter-actions-panel hidden">
                        <button class="filter-action-item edit-driver-filter-btn" data-filter-id="${filter.id}">Edit</button>
                        <button class="filter-action-item delete-driver-filter-btn" data-filter-id="${filter.id}">Delete</button>
                    </div>
                </div>
            </div>`;
        }
    }).join('');

    toolbarContainer.innerHTML = `
        <div class="flex items-center">
             <h3 id="driver-table-title" class="text-lg font-bold text-gray-200 flex-shrink-0">
                ${title}${modifiedText}
            </h3>
            <input type="text" id="driver-search-input" class="profile-table-search" placeholder="Search driver..." value="${appState.profiles.driverSearchTerm}">
        </div>
        
        <div id="saved-driver-filters-bar" class="flex items-center justify-center gap-x-2 flex-wrap">
            ${savedFiltersHTML}
        </div>

        <div class="flex items-center gap-x-2 flex-shrink-0">
            <button id="driver-health-settings-btn" class="toolbar-btn !p-2" title="Drop Risk Settings">
                <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" /></svg>
            </button>
            <button id="driver-filter-btn" class="toolbar-btn !p-2 relative" title="Filters">
                <svg class="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.572a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg>
                ${activeFiltersCount > 0 ? `<span class="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center border-2 border-gray-800">${activeFiltersCount}</span>` : ''}
            </button>
            <button id="driver-settings-btn" class="toolbar-btn !p-2" title="Flag Settings">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
            </button>
        </div>
    `;
}

// --- FIX: Updated the renderDriverTable function ---
// 1. DISPEČ TEST/profiles/profiles_ui.js

function renderDriverTable(drivers) {
    const tableContainer = document.getElementById('profiles-driver-table-container');
    if (!tableContainer) return;

    let filteredDrivers = [...drivers];
    const teamData = appState.profiles.currentTeamData;

    // --- START: Search Filtering Logic ---
    const searchTerm = appState.profiles.driverSearchTerm.toLowerCase();
    if (searchTerm) {
        filteredDrivers = filteredDrivers.filter(d => 
            d.name.toLowerCase().includes(searchTerm)
        );
    }
    // --- END: Search Filtering Logic ---

    const selectedDispatcherName = appState.profiles.selectedDispatcherId
        ? teamData?.dispatchers.find(d => d.id === appState.profiles.selectedDispatcherId)?.name
        : null;
    if (selectedDispatcherName) {
        filteredDrivers = filteredDrivers.filter(driver => driver.dispatcher === selectedDispatcherName);
    }

    const { activeFilters } = appState.profiles.driverFilters;
    if (activeFilters.length > 0) {
        const filterMethod = appState.profiles.driverFilters.filterLogic === 'OR' ? 'some' : 'every';
        
        filteredDrivers = filteredDrivers.filter(driver => {
            return activeFilters[filterMethod](filter => {
                const driverValue = driver[filter.columnId];
                const filterValue = filter.value;

                if (filter.operator === 'isEmpty') return driverValue === null || driverValue === undefined || driverValue === '';
                if (filter.operator === 'isNotEmpty') return driverValue !== null && driverValue !== undefined && driverValue !== '';
                if (driverValue === undefined || driverValue === null) return false;

                const parseList = (val) => Array.isArray(val) ? val.map(s => String(s).trim().toLowerCase()) : String(val).split(',').map(s => s.trim().toLowerCase());

                if (filter.columnId === 'flags') {
                    const driverFlags = driver.flags.map(f => f.text.toLowerCase());
                    const filterFlags = parseList(filterValue);
                    if (filter.operator === 'containsAll') return filterFlags.every(ff => driverFlags.includes(ff));
                    if (filter.operator === 'containsAny') return filterFlags.some(ff => driverFlags.includes(ff));
                    if (filter.operator === 'notContainsAny') return !filterFlags.some(ff => driverFlags.includes(ff));
                }

                switch (filter.operator) {
                    case 'contains': return String(driverValue).toLowerCase().includes(String(filterValue).toLowerCase());
                    case 'notContains': return !String(driverValue).toLowerCase().includes(String(filterValue).toLowerCase());
                    case 'equals': case 'is': return String(driverValue).toLowerCase() === String(filterValue).toLowerCase();
                    case 'notEquals': case 'isNot': return String(driverValue).toLowerCase() !== String(filterValue).toLowerCase();
                    case 'startsWith': return String(driverValue).toLowerCase().startsWith(String(filterValue).toLowerCase());
                    case 'endsWith': return String(driverValue).toLowerCase().endsWith(String(filterValue).toLowerCase());
                    case 'isAnyOf':
                        const list = parseList(filterValue);
                        return list.includes(String(driverValue).toLowerCase());
                    case 'isNotAnyOf':
                        const notList = parseList(filterValue);
                        return !notList.includes(String(driverValue).toLowerCase());
                    case 'greaterThan': return Number(driverValue) > Number(filterValue);
                    case 'greaterOrEqual': return Number(driverValue) >= Number(filterValue);
                    case 'lessThan': return Number(driverValue) < Number(filterValue);
                    case 'lessOrEqual': return Number(driverValue) <= Number(filterValue);
                    default: return true;
                }
            });
        });
    }

    const { sortConfig } = appState.profiles.driverTable;
    filteredDrivers.sort((a, b) => {
        const valA = a[sortConfig.key];
        const valB = b[sortConfig.key];
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        if (typeof valA === 'string') {
            return sortConfig.direction === 'ascending' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return sortConfig.direction === 'ascending' ? valA - valB : valB - valA;
        }
    });

    let currentColumns = [...driverTableColumns];
    if (appState.profiles.selectedTeam === 'ALL_TEAMS') {
        const dispatcherIndex = currentColumns.findIndex(c => c.id === 'dispatcher');
        if (!currentColumns.some(c => c.id === 'team')) {
            currentColumns.splice(dispatcherIndex + 1, 0, { id: 'team', label: 'Team', type: 'string' });
        }
    }

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) return '';
        return sortConfig.direction === 'ascending' ? ' ▲' : ' ▼';
    };

    const renderCell = (driver, col) => {
        let content = driver[col.id] ?? '-';
        let cellClass = '';
        const numericCols = ['risk', 'gross', 'margin', 'rpm', 'miles'];

        if (numericCols.includes(col.id)) {
            cellClass = 'text-right font-mono';
        } else if (col.id === 'equipment') {
            cellClass = 'text-center';
        } else {
            cellClass = 'text-left';
        }

        switch (col.id) {
            case 'name':
                content = `<td class="py-2 px-3 font-medium text-gray-200">${driver.name}</td>`;
                break;
            case 'equipment':
                const eqClass = { V: 'eq-v', R: 'eq-r', F: 'eq-f' }[driver.equipment] || '';
                content = `<td class="py-2 px-3 text-center"><span class="equipment-letter ${eqClass}">${driver.equipment}</span></td>`;
                break;
            case 'flags':
                const flagsHTML = driver.flags.map(flag => {
                    const flagConfig = Object.values(appState.profiles.driverHealthSettings.flags).find(f => f.label === flag.text);
                    if (!flagConfig) return '';
                    let tooltipHtml = '';
                    let finalClasses = `driver-flag-icon flag-${flag.color}`;
                    if (flag.text === 'Balance' && flag.tooltipData) {
                        const { balance, po, date } = flag.tooltipData;
                        const formattedDate = new Date(date).toLocaleDateString('en-US', { timeZone: 'UTC' });
                        tooltipHtml = `<strong class='tooltip-title'>${flag.text} (from ${formattedDate})</strong><div class='tooltip-grid'><span class='tooltip-label'>Final Balance:</span><span class='font-mono ${balance < 0 ? 'text-red-400' : 'text-green-400'}'>$${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span><span class='tooltip-label'>Final PO:</span><span class='font-mono text-orange-400'>$${po.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`;
                    } else if (flag.text === 'High Tolls' && flag.tooltipData) {
                        const { avgTolls, lookback } = flag.tooltipData;
                        tooltipHtml = `<strong class='tooltip-title'>${flag.text}</strong><div class='tooltip-grid'><span class='tooltip-label'>Avg Tolls/${lookback} wks:</span><span class='font-mono text-orange-400'>$${avgTolls.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`;
                    } else if (flag.text === 'Heavy Loads' && flag.tooltipData) {
                        const { avgWeight, loadCount } = flag.tooltipData;
                        tooltipHtml = `<strong class='tooltip-title'>${flag.text}</strong><div class='tooltip-grid'><span class='tooltip-label'>Avg. Weight:</span><span class='font-mono text-blue-400'>${Math.round(avgWeight).toLocaleString()} lbs</span><span class='tooltip-label'>Loads Sampled:</span><span>${loadCount}</span></div>`;
                    } else if (['Low RPM', 'Low Gross', 'Low Net'].includes(flag.text) && flag.tooltipData) {
                        const { stubsBelow, totalStubs, threshold, metric } = flag.tooltipData;
                        const isRpm = metric === 'lowRpm';
                        const formattedThreshold = isRpm ? `$${threshold.toFixed(2)}` : `$${threshold.toLocaleString()}`;
                        tooltipHtml = `<strong class='tooltip-title'>${flag.text}</strong><div class='tooltip-grid'><span class='tooltip-label'>Stubs Below Threshold:</span><span class='font-mono text-red-400'>${stubsBelow} of ${totalStubs}</span><span class='tooltip-label'>Threshold:</span><span>Less than ${formattedThreshold}</span></div>`;
                    } else if (flag.text === 'Hopper' && flag.tooltipData) {
                        const { dispatchers, count, lookback } = flag.tooltipData;
                        tooltipHtml = `<strong class='tooltip-title'>${flag.text} (${lookback})</strong><div class='tooltip-grid'><span class='tooltip-label'>Count:</span><span class='font-mono text-purple-400'>${count} Dispatchers</span><span class='tooltip-label'>Names:</span><span>${dispatchers.join(', ')}</span></div>`;
                    }
                    
                    let tooltipAttr = `title="${flag.text}"`;
                    if (tooltipHtml) {
                        const cleanedTooltipHtml = tooltipHtml.replace(/"/g, '&quot;').replace(/\n/g, '').trim();
                        tooltipAttr = `data-tooltip-html="${cleanedTooltipHtml}"`;
                        finalClasses += ' dispatch-tooltip-trigger cursor-help';
                    }

                    return `<div class="${finalClasses}" ${tooltipAttr}>${flagConfig.icon}</div>`;
                }).join('');
                content = `<td class="py-2 px-3"><div class="flex flex-wrap gap-1.5">${flagsHTML}</div></td>`;
                break;
            case 'risk':
                content = `<td class="py-2 px-3 text-center"><div class="flex items-center justify-center gap-2"><div class="risk-bar"><div style="width: ${Math.round(driver.risk)}%;" class="risk-bar-fill"></div></div><span class="font-mono text-xs">${Math.round(driver.risk)}%</span></div></td>`;
                break;
            case 'gross':
            case 'margin':
                const value = driver[col.id] || 0;
                content = `<td class="py-2 px-3 text-right font-mono">$${value.toLocaleString()}</td>`;
                break;
            case 'rpm':
                content = `<td class="py-2 px-3 text-right font-mono">$${(driver.rpm || 0).toFixed(2)}</td>`;
                break;
            case 'miles':
                content = `<td class="py-2 px-3 text-right font-mono">${(driver[col.id] || 0).toLocaleString()}</td>`;
                break;
            default:
                 content = `<td class="py-2 px-3 ${cellClass}">${driver[col.id] ?? '-'}</td>`;
        }
        return content;
    };

    tableContainer.innerHTML = `
    <table class="w-full text-sm text-left text-gray-400">
        <thead class="text-xs text-gray-300 uppercase sticky top-0 bg-gray-900">
            <tr>
                ${currentColumns.map(col => {
                    let headerClass = '';
                    if (['risk', 'gross', 'margin', 'rpm', 'miles', 'balance', 'po'].includes(col.id)) {
                        headerClass = 'text-right';
                    } else if (col.id === 'equipment') {
                        headerClass = 'text-center';
                    } else {
                        headerClass = 'text-left';
                    }
                    
                    const tooltipText = {
                        miles: 'Total Miles',
                        rpm: 'RPM (All)',
                        flags: "Flags are always 'live' and show the driver's current risk status, not their status from the selected historical week."
                    };
                    const titleAttribute = tooltipText[col.id] ? `title="${tooltipText[col.id]}"` : '';

                    return `<th class="py-2 px-3 cursor-pointer select-none ${headerClass}" onclick="requestDriverSort('${col.id}')" ${titleAttribute}>${col.label}${getSortIcon(col.id)}</th>`
                }).join('')}
            </tr>
        </thead>
        <tbody class="divide-y divide-gray-700">
            ${filteredDrivers.length > 0 ? filteredDrivers.map(driver => `<tr class="hover:bg-gray-700/50 cursor-pointer" data-driver-name="${driver.name}">${currentColumns.map(col => renderCell(driver, col)).join('')}</tr>`).join('') : `<tr><td colspan="${currentColumns.length}" class="text-center py-6 text-gray-500">No drivers match the current filters.</td></tr>`}
        </tbody>
    </table>
`;
}

function renderDispatchColumnSettingsDropdown() {
    const container = document.getElementById('dispatch-column-settings-dropdown');
    if (!container) return;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    container.innerHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Visible Columns</div>`;
    appState.profiles.dispatchTable.columnOrder.forEach(colId => {
        const column = dispatchTableColumns.find(c => c.id === colId);
        if (!column) return;
        const isVisible = appState.profiles.dispatchTable.visibleColumnIds.includes(colId);
        const isPinnedLeft = appState.profiles.dispatchTable.pinnedLeftColumns.includes(colId);
        const isPinnedRight = appState.profiles.dispatchTable.pinnedRightColumns.includes(colId);
        const wrapper = document.createElement('div');
        wrapper.className = 'flex items-center justify-between p-1.5 hover:bg-gray-600 rounded-md text-sm text-gray-200';
        const label = document.createElement('label');
        label.className = 'flex items-center cursor-pointer flex-grow';
        label.innerHTML = `
            <input type="checkbox" ${isVisible ? 'checked' : ''} class="form-checkbox h-4 w-4 text-teal-500 rounded border-gray-500 focus:ring-teal-500 mr-2 bg-gray-800">
            <span>${column.label}</span>
        `;
        label.querySelector('input').addEventListener('change', (e) => {
            e.stopPropagation(); 
            const visibleSet = new Set(appState.profiles.dispatchTable.visibleColumnIds);
            visibleSet.has(colId) ? visibleSet.delete(colId) : visibleSet.add(colId);
            appState.profiles.dispatchTable.visibleColumnIds = Array.from(visibleSet);
            renderDispatchTable(teamData.dispatchers, teamData.dispatchers);
        });
        const controls = document.createElement('div');
        controls.className = 'flex items-center space-x-2';
        controls.innerHTML = `
            <button class="p-1 rounded-md ${isPinnedLeft ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-500'}" title="Pin to Left" data-col-id="${colId}" data-pin="left">
                <svg class="w-4 h-4 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.5 12H6m-2.5 0h2.5M11 18l-6-6 6-6"/></svg>
            </button>
            <button class="p-1 rounded-md ${isPinnedRight ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-500'}" title="Pin to Right" data-col-id="${colId}" data-pin="right">
                <svg class="w-4 h-4 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5.5 12H18m2.5 0h-2.5M13 18l6-6-6-6"/></svg>
            </button>
        `;
        wrapper.appendChild(label);
        wrapper.appendChild(controls);
        container.appendChild(wrapper);
    });
}

function getChangeDisplay(current, previous, options = {}) {
    if (previous === null || current === null || previous === undefined || current === undefined) return '<span>-</span>';

    const change = current - previous;
    if (change === 0) return `<span class="text-gray-400">No Change</span>`;

    const isPositive = change > 0;
    const isGood = options.lowerIsBetter ? !isPositive : isPositive;

    const colorClass = isGood ? 'text-green-400' : 'text-red-400';
    const arrow = isPositive 
        ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>`;

    let changeText;
    if (options.isRpm) {
        changeText = `${isPositive ? '+' : ''}$${Math.abs(change).toFixed(2)}`;
    } else if (options.isCurrency) {
        changeText = `${isPositive ? '+' : ''}$${Math.abs(change).toLocaleString()}`;
    } else {
        changeText = `${isPositive ? '+' : ''}${Math.abs(change).toLocaleString()}`;
    }

    return `<span class="${colorClass} flex items-center justify-center gap-1">${arrow} ${changeText} vs Prev. Week</span>`;
}




function renderFlagFilter() {
    const container = document.getElementById('driver-flag-filter-container');
    if (!container) return;
    container.innerHTML = `<select id="flag-filter-select" class="w-full bg-gray-700 text-gray-100 border border-gray-600 rounded-lg px-3 py-2 text-sm"><option>All Flags</option></select>`;
}

function handlePinColumn(columnId, side) {
    const { pinnedLeftColumns, pinnedRightColumns, columnOrder } = appState.profiles.dispatchTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    const isPinnedLeft = pinnedLeftColumns.includes(columnId);
    const isPinnedRight = pinnedRightColumns.includes(columnId);
    
    // Create a new set of unpinned columns by removing all currently pinned ones
    let unpinned = columnOrder.filter(id => !pinnedLeftColumns.includes(id) && !pinnedRightColumns.includes(id));
    
    // Always remove the column from its current state first
    if (isPinnedLeft) {
        pinnedLeftColumns.splice(pinnedLeftColumns.indexOf(columnId), 1);
    }
    if (isPinnedRight) {
        pinnedRightColumns.splice(pinnedRightColumns.indexOf(columnId), 1);
    }
    if (!isPinnedLeft && !isPinnedRight) {
        unpinned.splice(unpinned.indexOf(columnId), 1);
    }

    // Now, add the column to its new state (or leave it unpinned)
    if (side === 'left' && !isPinnedLeft) {
        pinnedLeftColumns.push(columnId); 
    } else if (side === 'right' && !isPinnedRight) {
        pinnedRightColumns.unshift(columnId); 
    } else {
        // If the side is null (unpinning) or it's already pinned to that side, add it to unpinned
        unpinned.unshift(columnId);
    }

    // Reconstruct the column order and re-render
    appState.profiles.dispatchTable.columnOrder = [...pinnedLeftColumns, ...unpinned, ...pinnedRightColumns];
    renderDispatchTable(teamData.dispatchers, teamData.dispatchers);
}

function applyStickyStyles_DispatchTable() {
    const tableHead = document.getElementById('dispatch-table-head');
    const tableBody = document.getElementById('dispatch-table-body');
    if (!tableHead || !tableBody) return;

    const { pinnedLeftColumns, pinnedRightColumns } = appState.profiles.dispatchTable;
    const headerCells = Array.from(tableHead.children);
    const bodyRows = Array.from(tableBody.children);

    let leftOffset = 0;
    
    headerCells.forEach((th, index) => {
        const colId = th.dataset.colId;
        if (pinnedLeftColumns.includes(colId)) {
            const zIndex = 20 + (pinnedLeftColumns.length - pinnedLeftColumns.indexOf(colId));
            th.style.left = `${leftOffset}px`;
            th.style.zIndex = zIndex;
            bodyRows.forEach(row => {
                if (row.children[index]) {
                    row.children[index].style.left = `${leftOffset}px`;
                    row.children[index].style.zIndex = zIndex - 10;
                }
            });
            leftOffset += th.offsetWidth;
        }
    });

    let rightOffset = 0;

    for (let i = headerCells.length - 1; i >= 0; i--) {
        const th = headerCells[i];
        const colId = th.dataset.colId;
        if (pinnedRightColumns.includes(colId)) {
            const zIndex = 20 + (pinnedRightColumns.length - pinnedRightColumns.indexOf(colId));
            th.style.right = `${rightOffset}px`;
            th.style.zIndex = zIndex;
            bodyRows.forEach(row => {
                if (row.children[i]) {
                    row.children[i].style.right = `${rightOffset}px`;
                    row.children[i].style.zIndex = zIndex - 10;
                }
            });
            rightOffset += th.offsetWidth;
        }
    }
}

function initializeDispatchTableDragDrop() {
    const headers = document.querySelectorAll('#dispatch-table-head th');
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    headers.forEach(header => {
        header.addEventListener('dragstart', e => {
            appState.profiles.dispatchTable.draggedColumnId = e.target.dataset.colId;
            e.target.classList.add('opacity-50');
        });
        header.addEventListener('dragover', e => {
            e.preventDefault();
            if (e.target.dataset.colId !== appState.profiles.dispatchTable.draggedColumnId) {
                e.target.classList.add('drag-over-border');
            }
        });
        header.addEventListener('dragleave', e => e.target.classList.remove('drag-over-border'));
        header.addEventListener('drop', e => {
            e.preventDefault();
            e.target.classList.remove('drag-over-border');
            const draggedId = appState.profiles.dispatchTable.draggedColumnId;
            const droppedOnId = e.target.dataset.colId;
            if (draggedId && draggedId !== droppedOnId) {
                const order = [...appState.profiles.dispatchTable.columnOrder];
                const fromIndex = order.indexOf(draggedId);
                order.splice(fromIndex, 1);
                const toIndex = order.indexOf(droppedOnId);
                order.splice(toIndex, 0, draggedId);
                appState.profiles.dispatchTable.columnOrder = order;
                renderDispatchTable(teamData.dispatchers, teamData.dispatchers);
            }
        });
        header.addEventListener('dragend', e => e.target.classList.remove('opacity-50'));
    });
}



export function initializeProfileEventListeners() {
    if (!document.body.profileListenersAttached) {
        // --- START: Updated Global Click Listener ---
        document.body.addEventListener('click', (e) => {
            const openDropdowns = {
                kpi: appState.profiles.isKpiSettingsOpen,
                contract: appState.profiles.isContractTypeFilterOpen,
                company: appState.profiles.isCompanyFilterOpen,
                franchise: appState.profiles.isFranchiseFilterOpen,
                week: appState.profiles.isWeekSelectorOpen
            };

            const isClickInsideAnyDropdown = e.target.closest('#kpi-settings-container, #contract-type-filter-container, #company-filter-container, #franchise-filter-container, #profile-week-selector-container');
            
            if (Object.values(openDropdowns).some(isOpen => isOpen) && !isClickInsideAnyDropdown) {
                appState.profiles.isKpiSettingsOpen = false;
                appState.profiles.isContractTypeFilterOpen = false;
                appState.profiles.isCompanyFilterOpen = false;
                appState.profiles.isFranchiseFilterOpen = false;
                appState.profiles.isWeekSelectorOpen = false;
                renderTeamProfileUI();
            }

            // Close settings dropdown
            const settingsDropdown = document.getElementById('dispatch-column-settings-dropdown');
            if (settingsDropdown && !settingsDropdown.classList.contains('hidden') && !e.target.closest('#dispatch-table-settings-btn') && !settingsDropdown.contains(e.target)) {
                settingsDropdown.classList.add('hidden');
            }
        });
        // --- END: Updated Global Click Listener ---

        document.body.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (appState.profiles.driverDeepDive.isModalOpen) {
                    appState.profiles.driverDeepDive.isModalOpen = false;
                    renderDriverDeepDiveModal_Profiles();
                }
            }
        });
        document.body.profileListenersAttached = true;
    }
    
    // ... (dispatcher and driver search listeners remain the same) ...
    const dispatcherSearchInput = document.getElementById('dispatcher-search-input');
    if (dispatcherSearchInput && !dispatcherSearchInput.listenerAttached) {
        dispatcherSearchInput.addEventListener('input', debounce((e) => {
            appState.profiles.dispatcherSearchTerm = e.target.value;
            const teamData = appState.profiles.currentTeamData;
            renderDispatchTable(teamData.dispatchers, appState.profiles.allProcessedDispatchers);
        }, 300));
        dispatcherSearchInput.listenerAttached = true;
    }

    const driverSearchInput = document.getElementById('driver-search-input');
    if (driverSearchInput && !driverSearchInput.listenerAttached) {
        driverSearchInput.addEventListener('input', debounce((e) => {
            appState.profiles.driverSearchTerm = e.target.value;
            const teamData = appState.profiles.currentTeamData;
            renderDriverTable(teamData.drivers);
        }, 300));
        driverSearchInput.listenerAttached = true;
    }
    // ...

    const teamSelector = document.getElementById('team-selector');
    if (teamSelector && !teamSelector.listenerAttached) {
        teamSelector.addEventListener('change', (e) => {
            appState.profiles.selectedTeam = e.target.value;
            renderTeamProfileUI();
        });
        teamSelector.listenerAttached = true;
    }

    const header = document.getElementById('profiles-header');
    if (header) {
        if (header._clickHandler) header.removeEventListener('click', header._clickHandler);
        
        // --- START: New Header Click Handler for Exclusive Dropdowns ---
        header._clickHandler = (e) => {
            const targetId = e.target.closest('button')?.id;
            if (!targetId) {
                // Handle selecting an option from a dropdown
                const weekOption = e.target.closest('.profile-week-option');
                if (weekOption) {
                    e.preventDefault();
                    appState.profiles.selectedWeek = weekOption.dataset.weekId;
                    appState.profiles.isWeekSelectorOpen = false;
                    renderTeamProfileUI();
                }
                return;
            }

            e.stopPropagation();

            const dropdownStates = {
                'kpi-settings-btn': 'isKpiSettingsOpen',
                'contract-type-filter-btn': 'isContractTypeFilterOpen',
                'company-filter-btn': 'isCompanyFilterOpen',
                'franchise-filter-btn': 'isFranchiseFilterOpen',
                'profile-week-selector-btn': 'isWeekSelectorOpen'
            };

            const clickedStateKey = dropdownStates[targetId];
            if (!clickedStateKey) return;

            const wasOpen = appState.profiles[clickedStateKey];

            // Close all dropdowns
            Object.values(dropdownStates).forEach(key => appState.profiles[key] = false);
            
            // Toggle the clicked one
            appState.profiles[clickedStateKey] = !wasOpen;

            renderTeamProfileUI();
        };
        // --- END: New Header Click Handler ---
        header.addEventListener('click', header._clickHandler);
    }

    // ... (The rest of the function remains the same, handling tooltips, modals, table clicks etc.)
    const tooltip = document.getElementById('dispatch-tooltip');
    const attachTooltipListeners = (containerElement) => {
        if (!containerElement || !tooltip) return;
        if (containerElement._mouseoverHandler) containerElement.removeEventListener('mouseover', containerElement._mouseoverHandler);
        containerElement._mouseoverHandler = (e) => {
            const trigger = e.target.closest('.dispatch-tooltip-trigger');
            if (!trigger) return;
            let htmlContent = '';
            if (trigger.dataset.tooltipHtml) {
                htmlContent = trigger.dataset.tooltipHtml;
            } else if (trigger.dataset.tooltipMetric) {
                const teamData = appState.profiles.currentTeamData;
                const dispatcherId = parseInt(trigger.parentElement.dataset.dispatcherId, 10);
                const dispatcher = teamData?.dispatchers.find(d => d.id === dispatcherId);
                const metricId = trigger.dataset.tooltipMetric;
                if (dispatcher && metricId) {
                    htmlContent = generateDispatchTooltipHTML(dispatcher, metricId, appState.profiles.liveData);
                }
            }
            if (htmlContent) {
                tooltip.innerHTML = htmlContent;
                tooltip.classList.add('visible');
            }
        };
        containerElement.addEventListener('mouseover', containerElement._mouseoverHandler);
        if (containerElement._mousemoveHandler) containerElement.removeEventListener('mousemove', containerElement._mousemoveHandler);
        containerElement._mousemoveHandler = (e) => {
            if (tooltip.classList.contains('visible')) {
                const tooltipRect = tooltip.getBoundingClientRect();
                let left = e.pageX - tooltipRect.width - 15;
                if (left < 10) { left = e.pageX + 15; }
                tooltip.style.left = `${left}px`;
                tooltip.style.top = `${e.pageY + 15}px`;
            }
        };
        containerElement.addEventListener('mousemove', containerElement._mousemoveHandler);
        if (containerElement._mouseoutHandler) containerElement.removeEventListener('mouseout', containerElement._mouseoutHandler);
        containerElement._mouseoutHandler = (e) => {
            if (e.target.closest('.dispatch-tooltip-trigger')) {
                tooltip.classList.remove('visible');
            }
        };
        containerElement.addEventListener('mouseout', containerElement._mouseoutHandler);
    };

    const dispatchTable = document.getElementById('profiles-dispatch-table-container');
    if (dispatchTable) {
        if (dispatchTable._clickHandler) dispatchTable.removeEventListener('click', dispatchTable._clickHandler);
        dispatchTable._clickHandler = (e) => {
            const teamData = appState.profiles.currentTeamData;
            if (!teamData) return;
            const tooltipTrigger = e.target.closest('.dispatch-tooltip-trigger');
            const row = e.target.closest('.dispatch-table-row');
            if (tooltipTrigger) {
                const dispatcherId = parseInt(tooltipTrigger.parentElement.dataset.dispatcherId, 10);
                const dispatcher = teamData.dispatchers.find(d => d.id === dispatcherId);
                const metricId = tooltipTrigger.dataset.tooltipMetric;
                if (dispatcher && metricId) {
                    const htmlContent = generateDispatchTooltipHTML(dispatcher, metricId, appState.profiles.liveData);
                    const plainText = htmlContent.replace(/<br\s*[\/]?>/gi, "\n").replace(/<[^>]*>/g, '').trim();
                    copyToClipboard(plainText);
                    const tooltipElement = document.getElementById('dispatch-tooltip');
                    tooltipElement.classList.add('copied');
                    setTimeout(() => tooltipElement.classList.remove('copied'), 500);
                }
            } else if (row) {
                const dispatcherId = parseInt(row.dataset.dispatcherId, 10);
                appState.profiles.selectedDispatcherId = appState.profiles.selectedDispatcherId === dispatcherId ? null : dispatcherId;
                renderDispatchTable(teamData.dispatchers, appState.profiles.allProcessedDispatchers);
                renderDriverToolbar(teamData);
                renderDriverTable(teamData.drivers);
                requestAnimationFrame(() => {
                    const newRow = document.querySelector(`.dispatch-table-row[data-dispatcher-id='${dispatcherId}']`);
                    if (newRow) {
                        newRow.scrollIntoView({ behavior: 'auto', block: 'nearest' });
                    }
                });
            }
        };
        dispatchTable.addEventListener('click', dispatchTable._clickHandler);
        attachTooltipListeners(dispatchTable);
    }

    const driverTableContainer = document.getElementById('profiles-driver-table-container');
    if (driverTableContainer) {
        if (driverTableContainer._clickHandler) driverTableContainer.removeEventListener('click', driverTableContainer._clickHandler);
        driverTableContainer._clickHandler = (e) => {
            const row = e.target.closest('tr[data-driver-name]');
            if (row && !e.target.closest('.dispatch-tooltip-trigger')) {
                appState.profiles.driverDeepDive.selectedDriver = row.dataset.driverName;
                appState.profiles.driverDeepDive.isModalOpen = true;
                renderDriverDeepDiveModal_Profiles();
            }
        };
        driverTableContainer.addEventListener('click', driverTableContainer._clickHandler);
        attachTooltipListeners(driverTableContainer);
    }
    
    // The rest of the function continues as before...
    const driverDeepDiveModal = document.getElementById('profiles-driver-deep-dive-modal');
    if (driverDeepDiveModal && !driverDeepDiveModal._clickHandlerAttached) {
        driverDeepDiveModal.addEventListener('click', (e) => {
            if (e.target.closest('#close-profiles-deep-dive-modal-btn')) {
                appState.profiles.driverDeepDive.isModalOpen = false;
                appState.profiles.driverDeepDive.selectedDriver = null;
                renderDriverDeepDiveModal_Profiles();
            }
        });
        driverDeepDiveModal._clickHandlerAttached = true;
    }

    const snapshotTrigger = document.getElementById('snapshot-trigger');
    if (snapshotTrigger && !snapshotTrigger._clickHandlerAttached) {
        snapshotTrigger.addEventListener('click', () => {
            appState.profiles.isSnapshotOpen = true;
            renderTeamSnapshot();
        });
        snapshotTrigger._clickHandlerAttached = true;
    }

    const snapshotCloseBtn = document.getElementById('snapshot-close-btn');
    if (snapshotCloseBtn && !snapshotCloseBtn._clickHandlerAttached) {
        snapshotCloseBtn.addEventListener('click', () => {
            appState.profiles.isSnapshotOpen = false;
            renderTeamSnapshot();
        });
        snapshotCloseBtn._clickHandlerAttached = true;
    }
    
    const complianceSettingsBtn = document.getElementById('compliance-settings-btn');
    if (complianceSettingsBtn) {
        if (complianceSettingsBtn._clickHandler) complianceSettingsBtn.removeEventListener('click', complianceSettingsBtn._clickHandler);
        complianceSettingsBtn._clickHandler = (e) => {
            e.stopPropagation();
            appState.profiles.complianceSettings.isModalOpen = true;
            const teamData = appState.profiles.currentTeamData;
            if (teamData) {
                renderComplianceSettingsModal(teamData.dispatchers);
            }
        };
        complianceSettingsBtn.addEventListener('click', complianceSettingsBtn._clickHandler);
    }

    const thresholdSettingsBtn = document.getElementById('dispatch-threshold-settings-btn');
    if (thresholdSettingsBtn && !thresholdSettingsBtn.listenerAttached) {
        thresholdSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            appState.profiles.thresholdSettings.isModalOpen = true;
            renderThresholdSettingsModal();
        });
        thresholdSettingsBtn.listenerAttached = true;
    }

    const settingsBtn = document.getElementById('dispatch-table-settings-btn');
    const settingsDropdown = document.getElementById('dispatch-column-settings-dropdown');
    if (settingsBtn && settingsDropdown) {
        if (settingsBtn._clickHandler) settingsBtn.removeEventListener('click', settingsBtn._clickHandler);
        settingsBtn._clickHandler = (e) => {
            e.stopPropagation();
            settingsDropdown.classList.toggle('hidden');
        };
        settingsBtn.addEventListener('click', settingsBtn._clickHandler);
        if (settingsDropdown._clickHandler) settingsDropdown.removeEventListener('click', settingsDropdown._clickHandler);
        settingsDropdown._clickHandler = (e) => {
            const pinButton = e.target.closest('button[data-pin]');
            if (pinButton) { e.stopPropagation(); handlePinColumn(pinButton.dataset.colId, pinButton.dataset.pin); }
        };
        settingsDropdown.addEventListener('click', settingsDropdown._clickHandler);
    }

    const complianceModal = document.getElementById('profiles-compliance-settings-modal');
    if (complianceModal) {
        if (complianceModal._clickHandler) complianceModal.removeEventListener('click', complianceModal._clickHandler);
        complianceModal._clickHandler = (e) => {
            const teamData = appState.profiles.currentTeamData;
            if (!teamData) return;
            if (e.target.closest('#close-compliance-settings-modal-btn') || e.target.closest('#save-compliance-settings-btn')) {
                appState.profiles.complianceSettings.isModalOpen = false;
                renderComplianceSettingsModal(teamData.dispatchers);
            }
        };
        complianceModal.addEventListener('click', complianceModal._clickHandler);
    }
    
    const thresholdModal = document.getElementById('profiles-threshold-settings-modal');
    if (thresholdModal && !thresholdModal.listenerAttached) {
        thresholdModal.addEventListener('click', e => {
            if (e.target.closest('#close-threshold-settings-modal-btn') || e.target.closest('#save-threshold-settings-btn')) {
                appState.profiles.thresholdSettings.isModalOpen = false;
                renderThresholdSettingsModal();
                const teamData = appState.profiles.currentTeamData;
                if(teamData) renderDispatchTable(teamData.dispatchers, teamData.dispatchers);
            }
        });
        thresholdModal.listenerAttached = true;
    }

    const driverToolbar = document.getElementById('profiles-driver-toolbar');
    if (driverToolbar) {
        if (driverToolbar._clickHandler) driverToolbar.removeEventListener('click', driverToolbar._clickHandler);
        driverToolbar._clickHandler = (e) => {
            const savedFilterBtn = e.target.closest('.saved-filter-btn');
            const actionsTrigger = e.target.closest('.filter-actions-trigger');
            const editBtn = e.target.closest('.edit-driver-filter-btn');
            const deleteBtn = e.target.closest('.delete-driver-filter-btn');
            if (savedFilterBtn) {
                const filterId = savedFilterBtn.dataset.filterId;
                const savedFilter = appState.profiles.savedDriverFilters.find(f => f.id === filterId);
                if (savedFilter) {
                    appState.profiles.driverFilters.activeFilters = savedFilter.criteria;
                    appState.profiles.driverFilters.filterLogic = savedFilter.logic || 'AND';
                    appState.profiles.activeSavedFilterId = filterId;
                    renderTeamProfileUI();
                }
                return;
            }
            if (actionsTrigger) {
                e.stopPropagation();
                const panel = actionsTrigger.nextElementSibling;
                const isHidden = panel.classList.contains('hidden');
                document.querySelectorAll('.filter-actions-panel').forEach(p => p.classList.add('hidden'));
                if (isHidden) {
                    panel.classList.remove('hidden');
                }
                return;
            }
            if (editBtn) {
                e.stopPropagation();
                const filterId = editBtn.dataset.filterId;
                const filterToEdit = appState.profiles.savedDriverFilters.find(f => f.id === filterId);
                if (filterToEdit) {
                    appState.profiles.driverFilters.filterToEdit = filterToEdit;
                    appState.profiles.driverFilters.activeFilters = filterToEdit.criteria;
                    appState.profiles.driverFilters.isSaveModalOpen = true;
                    renderSaveFilterModal();
                }
                return;
            }
            if (deleteBtn) {
                e.stopPropagation();
                const filterIdToDelete = deleteBtn.dataset.filterId;
                if (confirm('Are you sure you want to delete this filter?')) {
                    appState.profiles.savedDriverFilters = appState.profiles.savedDriverFilters.filter(f => f.id !== filterIdToDelete);
                    if (appState.profiles.activeSavedFilterId === filterIdToDelete) {
                        appState.profiles.activeSavedFilterId = 'all_drivers';
                        const allDriversFilter = appState.profiles.savedDriverFilters.find(f=>f.id === 'all_drivers');
                        appState.profiles.driverFilters.activeFilters = allDriversFilter ? allDriversFilter.criteria : [];
                    }
                    renderTeamProfileUI();
                }
                return;
            }
            if (e.target.closest('#driver-filter-btn')) {
                appState.profiles.driverFilters.isFilterModalOpen = true;
                renderDriverFilterModal();
            }
            if (e.target.closest('#driver-settings-btn')) {
                appState.profiles.tempDriverHealthSettings = JSON.parse(JSON.stringify(appState.profiles.driverHealthSettings));
                appState.profiles.isDriverSettingsModalOpen = true;
                renderDriverSettingsModal();
            }
            if (e.target.closest('#driver-health-settings-btn')) {
                appState.profiles.driverHealthSettings.isModalOpen = true;
                renderDriverHealthSettingsModal();
            }
        };
        driverToolbar.addEventListener('click', driverToolbar._clickHandler);
    }
    
const driverFilterModal = document.getElementById('profiles-driver-filter-modal');
if (driverFilterModal && !driverFilterModal._listenersAttached) {
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    const readCriteriaFromModal = () => {
        const criteriaRows = driverFilterModal.querySelectorAll('.driver-filter-criteria-row');
        return Array.from(criteriaRows).map((row) => {
            const columnId = row.querySelector('.column-select').value;
            const operator = row.querySelector('.operator-select').value;
            let value;
            const multiSelectContainer = row.querySelector('.filter-multiselect-container');
            const standardInput = row.querySelector('.value-input');
            const previousDaysContainer = row.querySelector('.load-filter-previous-days-container');

            if (multiSelectContainer && multiSelectContainer.offsetParent !== null) {
                value = Array.from(row.querySelectorAll('.multiselect-checkbox:checked')).map(cb => cb.value);
            } else if (previousDaysContainer && previousDaysContainer.offsetParent !== null) {
                 value = {
                    days: parseInt(row.querySelector('.load-filter-previous-days-input').value, 10) || 7,
                    from: row.querySelector('.load-filter-previous-days-from-select').value
                };
            } else if (standardInput && standardInput.offsetParent !== null) {
                value = standardInput.value;
            } else {
                value = null;
            }
            
            return { columnId, operator, value };
        }).filter(f => {
            if (['isEmpty', 'isNotEmpty'].includes(f.operator)) return true;
            if (f.operator === 'inPrevious') return f.value && !isNaN(f.value.days);
            return (Array.isArray(f.value) ? f.value.length > 0 : f.value !== '' && f.value !== null);
        });
    };

    const closeModal = () => {
        appState.profiles.driverFilters.isFilterModalOpen = false;
        renderDriverFilterModal();
    };

    driverFilterModal.querySelector('#close-driver-filter-modal-btn')?.addEventListener('click', closeModal);
    driverFilterModal.querySelector('#cancel-driver-filter-btn')?.addEventListener('click', closeModal);

    driverFilterModal.querySelector('#apply-driver-filter-btn')?.addEventListener('click', () => {
        const newFilters = readCriteriaFromModal();
        appState.profiles.driverFilters.activeFilters = newFilters;
        appState.profiles.activeSavedFilterId = null; 
        closeModal();
        renderDriverToolbar(teamData);
        renderDriverTable(teamData.drivers);
    });

    driverFilterModal.querySelector('#clear-driver-filters-btn')?.addEventListener('click', () => {
        appState.profiles.driverFilters.activeFilters = [];
        appState.profiles.activeSavedFilterId = 'all_drivers'; 
        closeModal();
        renderDriverToolbar(teamData);
        renderDriverTable(teamData.drivers);
    });

    driverFilterModal.querySelector('#save-driver-filter-btn')?.addEventListener('click', () => {
        const newFilters = readCriteriaFromModal();
        if (newFilters.length === 0) {
            alert("Please add at least one valid criterion before saving.");
            return;
        }
        
        appState.profiles.driverFilters.activeFilters = newFilters;
        appState.profiles.driverFilters.isSaveModalOpen = true;
        renderSaveFilterModal();
    });

    driverFilterModal._listenersAttached = true;
}

const driverHealthSettingsModal = document.getElementById('profiles-driver-health-settings-modal');
if (driverHealthSettingsModal && !driverHealthSettingsModal.listenerAttached) {
    driverHealthSettingsModal.addEventListener('click', e => {
        if (e.target.closest('#close-driver-health-settings-modal-btn') || e.target.closest('#save-driver-health-settings-btn')) {
            appState.profiles.driverHealthSettings.isModalOpen = false;
            appState.profiles.fleetHealthCache = {};
            renderTeamProfileUI();
        }
    });
    driverHealthSettingsModal.listenerAttached = true;
}

    const driverSettingsModal = document.getElementById('profiles-driver-settings-modal');
    if (driverSettingsModal) {
        if (driverSettingsModal._clickHandler) driverSettingsModal.removeEventListener('click', driverSettingsModal._clickHandler);
        driverSettingsModal._clickHandler = (e) => {
            if (e.target.closest('#close-driver-settings-modal-btn')) {
                appState.profiles.isDriverSettingsModalOpen = false;
                appState.profiles.tempDriverHealthSettings = null;
                renderDriverSettingsModal();
            }
            if (e.target.closest('#save-driver-settings-btn')) {
                saveDriverHealthSettings();
            }
        };
        driverSettingsModal.addEventListener('click', driverSettingsModal._clickHandler);
        initializeDriverSettingsModalEventListeners(); 
    }

    const saveFilterModal = document.getElementById('save-driver-filter-modal');
    if (saveFilterModal && !saveFilterModal._clickHandlerAttached) {
        saveFilterModal.addEventListener('click', e => {
            if (e.target.closest('#close-save-driver-filter-modal-btn')) {
                appState.profiles.driverFilters.isSaveModalOpen = false;
                renderSaveFilterModal();
                appState.profiles.driverFilters.isFilterModalOpen = true;
                renderDriverFilterModal();
            }
            if (e.target.closest('#confirm-save-driver-filter-btn')) {
                const nameInput = document.getElementById('save-filter-name-input');
                const colorInput = document.getElementById('save-filter-color-input');
                const filterName = nameInput.value.trim();
                if (!filterName) {
                    alert('Please provide a name for the filter.');
                    return;
                }
                const filterToEdit = appState.profiles.driverFilters.filterToEdit;
                if (filterToEdit) {
                    const existingFilter = appState.profiles.savedDriverFilters.find(f => f.id === filterToEdit.id);
                    if (existingFilter) {
                        existingFilter.name = filterName;
                        existingFilter.color = colorInput.value;
                        existingFilter.criteria = [...appState.profiles.driverFilters.activeFilters];
                        existingFilter.logic = appState.profiles.driverFilters.filterLogic;
                    }
                } else {
                    const newFilter = {
                        id: `custom_${Date.now()}`,
                        name: filterName,
                        color: colorInput.value,
                        isDefault: false,
                        criteria: [...appState.profiles.driverFilters.activeFilters],
                        logic: appState.profiles.driverFilters.filterLogic,
                    };
                    appState.profiles.savedDriverFilters.push(newFilter);
                    appState.profiles.activeSavedFilterId = newFilter.id;
                }

                appState.profiles.driverFilters.filterToEdit = null;
                appState.profiles.driverFilters.isSaveModalOpen = false;
                appState.profiles.driverFilters.isFilterModalOpen = false;

                renderSaveFilterModal();
                renderDriverFilterModal();
                renderTeamProfileUI();
            }
        });
        saveFilterModal._clickHandlerAttached = true;
    }
}


window.requestDispatchSort = (key) => {
    const { sortConfig } = appState.profiles.dispatchTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    appState.profiles.dispatchTable.sortConfig = { key, direction };
    renderDispatchTable(teamData.dispatchers, teamData.dispatchers);
};


window.requestDriverSort = (key) => {
    const { sortConfig } = appState.profiles.driverTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    appState.profiles.driverTable.sortConfig = { key, direction };
    renderDriverTable(teamData.drivers);
};

function generateDispatchTooltipHTML(dispatcher, metricId, allLoadsForSearch) {
    const title = `<strong class="tooltip-title">${metricId.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} for ${dispatcher.name}</strong>`;
    let content = '';
    const allLoadsForDispatcher = dispatcher.loads || [];
    let filteredLoads = [];
    
    const goodMoveThresholds = appState.profiles.thresholdSettings.goodMove;

    const findPreviousLoad = (currentLoad) => {
        if (!currentLoad.driver || typeof currentLoad.load_order !== 'number' && typeof currentLoad.load_order !== 'string') {
            return null;
        }
        
        const currentOrder = parseInt(currentLoad.load_order, 10);
        if (isNaN(currentOrder)) return null;

        const targetLoadOrder = currentOrder - 1;

        const driverLoads = allLoadsForSearch.filter(l => l.driver === currentLoad.driver);
        
        return driverLoads.find(l => l.load_order != null && parseInt(l.load_order, 10) === targetLoadOrder) || null;
    };

    switch (metricId) {
        case 'goodMoves':
            filteredLoads = allLoadsForDispatcher.filter(l => l.moved_monday === 'Moved Monday Load' && (l.driver_gross_without_moved < (goodMoveThresholds.by_contract[l.contract_type] ?? goodMoveThresholds.default)));
            break;
        case 'badMoves':
            filteredLoads = allLoadsForDispatcher.filter(l => l.moved_monday === 'Moved Monday Load' && (l.driver_gross_without_moved >= (goodMoveThresholds.by_contract[l.contract_type] ?? goodMoveThresholds.default)));
            break;
        case 'canceled':
            filteredLoads = allLoadsForDispatcher.filter(l => l.status === 'Canceled');
            break;
        case 'hiddenMiles':
            filteredLoads = allLoadsForDispatcher.filter(l => l.hidden_miles === 'Hidden Miles Found!');
            break;
        case 'lowRpm':
            filteredLoads = allLoadsForDispatcher.filter(l => l.rpm_all < getLowRpmThreshold(l.contract_type));
            break;
        case 'newStarts':
            filteredLoads = allLoadsForDispatcher.filter(l => l.new_start === 'NEW START');
            break;
            case 'wellness':
                const goodLoads = allLoadsForDispatcher.filter(d => d.wellness_fail === 'GOOD');
                const passedLoads = allLoadsForDispatcher.filter(d => d.wellness_fail === '-');
                const failedLoads = allLoadsForDispatcher.filter(d => d.wellness_fail === 'FAIL');
                
                let stats = `<div class="tooltip-grid">
                    <span class="tooltip-label">Passed Wellness Plan:</span><span class="tooltip-value-green">${goodLoads.length}</span>
                    <span class="tooltip-label">Good Wellness:</span><span class="tooltip-value-green">${passedLoads.length}</span>
                    <span class="tooltip-label">Failed Wellness Plan:</span><span class="tooltip-value-orange">${failedLoads.length}</span>
                </div>`;
    
                if (failedLoads.length > 0) {
                stats += `<hr class="tooltip-hr"><strong class="tooltip-title !mb-1">Failed Wellness Plan Details</strong>`;
                const failedLoadsList = failedLoads.map(load => 
                    `<div class="tooltip-load-row-flex">
                        <span class="font-bold text-gray-400">#${load.id}</span>
                        <span class="tooltip-driver-name">${load.driver || 'N/A'}</span>
                        <span class="tooltip-route-flex">${load.pu_location || 'N/A'} → ${load.do_location || 'N/A'}</span>
                    </div>`
                ).join('');
                content = `<div class="tooltip-load-list">${stats}${failedLoadsList}</div>`;
            } else {
                content = stats;
            }
            return title + content; // Return directly since content is fully built
        default:
            return 'No details available.';
    }

    if (filteredLoads.length === 0) {
        return `${title}<div class="p-2 text-gray-500">No matching loads found.</div>`;
    }

    if (metricId === 'newStarts') {
        const newStartsByDriver = filteredLoads.reduce((acc, load) => {
            const driver = load.driver;
            if (!acc[driver] || new Date(load.pu_date) < new Date(acc[driver].pu_date)) {
                acc[driver] = load;
            }
            return acc;
        }, {});

        const sortedNewStarts = Object.values(newStartsByDriver).sort((a,b) => new Date(a.pu_date) - new Date(b.pu_date));
        
        content = `<div class="tooltip-load-list">${sortedNewStarts.map(load => {
            const puDate = new Date(load.pu_date);
            const dayOfWeek = puDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
            const formattedDate = puDate.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });

            return `<div class="tooltip-load-row-flex">
                <span class="tooltip-driver-name">${load.driver || 'N/A'}</span>
                <span class="tooltip-details-flex ml-auto">First load on ${formattedDate} (${dayOfWeek})</span>
            </div>`;
        }).join('')}</div>`;

    } else {
        const loadToHtml = (load) => {
            let details = '';
            switch (metricId) {
                case 'goodMoves':
                case 'badMoves':
                    const threshold = goodMoveThresholds.by_contract[load.contract_type] ?? goodMoveThresholds.default;
                    details = `Gross w/o: <span class="tooltip-rate">$${(load.driver_gross_without_moved || 0).toLocaleString()}</span> (Thresh: $${threshold.toLocaleString()})`;
                    break;
                    case 'lowRpm':
                        details = `RPM: <span class="tooltip-value-yellow">$${(load.rpm_all || 0).toFixed(2)}</span>`;
                        break;
                    case 'canceled':
                        details = `Status: <span class="tooltip-canceled">Canceled</span>`;
                        break;
                    case 'hiddenMiles':
                     const startCity = load.start_location_city || '-';
                     const startState = load.start_location_state || '';
                     const previousLoad = findPreviousLoad(load);
                     const prevDOLocation = previousLoad ? previousLoad.do_location : '-';
                     details = `Prev DO: <span class="tooltip-value-purple">${prevDOLocation}</span> | Start: <span class="tooltip-value-purple">${startCity}, ${startState}</span>`;
                     break;
            }

            return `<div class="tooltip-load-row-flex">
                <span class="font-bold text-gray-400">#${load.id}</span>
                <span class="tooltip-driver-name">${load.driver || 'N/A'}</span>
                <span class="tooltip-route-flex">${load.pu_location || 'N/A'} → ${load.do_location || 'N/A'}</span>
                <span class="tooltip-details-flex ml-auto">${details}</span>
            </div>`;
        };
        content = `<div class="tooltip-load-list">${filteredLoads.map(loadToHtml).join('')}</div>`;
    }

    return title + content;
}

function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed'; 
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
    }
    document.body.removeChild(textarea);
}

function renderDriverFilterModal() {
    const modal = document.getElementById('profiles-driver-filter-modal');
    const container = document.getElementById('driver-filter-criteria-container');
    if (!modal || !container) return;

    modal.classList.toggle('hidden', !appState.profiles.driverFilters.isFilterModalOpen);
    if (!appState.profiles.driverFilters.isFilterModalOpen) return;

    const teamData = appState.profiles.currentTeamData;
    if (!teamData) {
        container.innerHTML = `<p class="text-gray-400">Driver data is not available for filtering.</p>`;
        return;
    }

    const readModalState = () => {
        const rows = container.querySelectorAll('.driver-filter-criteria-row');
        if (!rows || rows.length === 0) return [];
        return Array.from(rows).map(row => {
            const columnId = row.querySelector('.column-select').value;
            const operator = row.querySelector('.operator-select').value;
            let value;
            if (row.querySelector('.filter-multiselect-container')) {
                value = Array.from(row.querySelectorAll('.multiselect-checkbox:checked')).map(cb => cb.value);
            } else {
                const valueInput = row.querySelector('.value-input');
                value = valueInput ? valueInput.value : null;
            }
            return { columnId, operator, value };
        });
    };

    const tempFilters = appState.profiles.driverFilters.activeFilters;
    container.innerHTML = '';

    // --- START: UPDATED FILTERABLE COLUMNS ---
    const filterColumns = [
        { id: 'name', label: 'Driver Name', type: 'string' },
        { id: 'company', label: 'Company', type: 'select', options: [...new Set(teamData.drivers.map(d => d.company))] },
        { id: 'dispatcher', label: 'Dispatcher', type: 'select', options: [...new Set(teamData.drivers.map(d => d.dispatcher))] },
        { id: 'team', label: 'Team', type: 'select', options: [...new Set(teamData.drivers.map(d => d.team))] },
        { id: 'contract', label: 'Contract', type: 'select', options: ['OO', 'LOO'] },
        { id: 'equipment', label: 'Equipment', type: 'select', options: ['V', 'R', 'F'] },
        { id: 'flags', label: 'Flags', type: 'multiselect', options: [...new Set(teamData.drivers.flatMap(d => d.flags.map(f => f.text)))] },
        { id: 'risk', label: 'Drop Risk %', type: 'number' },
        { id: 'gross', label: 'Weekly Gross', type: 'number' },
        { id: 'margin', label: 'Margin', type: 'number' },
        { id: 'rpm', label: 'RPM', type: 'number' },
        { id: 'miles', label: 'Total Miles', type: 'number' }
    ];
    // --- END: UPDATED FILTERABLE COLUMNS ---

    const operators = {
        string: [
            { v: 'contains', l: 'contains' }, { v: 'notContains', l: 'does not contain' },
            { v: 'equals', l: 'equals' }, { v: 'isNot', l: 'is not' },
            { v: 'startsWith', l: 'starts with' }, { v: 'endsWith', l: 'ends with' },
            { v: 'isAnyOf', l: 'is any of (a,b)' }, { v: 'isNotAnyOf', l: 'is not any of (a,b)' },
            { v: 'isEmpty', l: 'is empty' }, { v: 'isNotEmpty', l: 'is not empty' }
        ],
        number: [
            { v: 'equals', l: '=' }, { v: 'notEquals', l: '!=' },
            { v: 'greaterThan', l: '>' }, { v: 'greaterOrEqual', l: '>=' },
            { v: 'lessThan', l: '<' }, { v: 'lessOrEqual', l: '<=' },
            { v: 'isAnyOf', l: 'is any of (1,2)' },
            { v: 'isEmpty', l: 'is empty' }, { v: 'isNotEmpty', l: 'is not empty' }
        ],
        select: [
            { v: 'is', l: 'is' }, { v: 'isNot', l: 'is not' },
            { v: 'isAnyOf', l: 'is any of' }, { v: 'isNotAnyOf', l: 'is not any of' },
            { v: 'isEmpty', l: 'is empty' }, { v: 'isNotEmpty', l: 'is not empty' }
        ],
        multiselect: [
            { v: 'containsAll', l: 'contains all of' },
            { v: 'containsAny', l: 'contains any of' },
            { v: 'notContainsAny', l: 'does not contain any of' }
        ]
    };

    const renderRow = (filter = {}) => {
        const row = document.createElement('div');
        row.className = 'grid grid-cols-[1.5fr_1.5fr_2fr_auto] gap-2 items-center driver-filter-criteria-row';
        
        const selectedColumn = filterColumns.find(c => c.id === filter.columnId) || filterColumns[0];
        
        const validOperatorsForType = operators[selectedColumn.type] || operators.string;
        const isOperatorValid = validOperatorsForType.some(op => op.v === filter.operator);

        if (!filter.operator || !isOperatorValid) {
            filter.operator = validOperatorsForType[0].v;
        }

        const ops = validOperatorsForType;
        const currentOperator = filter.operator;
        const needsValue = !['isEmpty', 'isNotEmpty'].includes(currentOperator);
        let valueInputHTML = '';

        if (needsValue) {
            const isMultiSelectOp = ['isAnyOf', 'isNotAnyOf', 'containsAll', 'containsAny', 'notContainsAny'].includes(currentOperator);
            
            if (isMultiSelectOp && (selectedColumn.type === 'select' || selectedColumn.type === 'multiselect')) {
                 const opts = selectedColumn.options || [];
                 const currentValues = new Set(Array.isArray(filter.value) ? filter.value : String(filter.value || '').split(',').map(s => s.trim()));
                 const selectedCount = currentValues.size;
                 const triggerText = selectedCount === 0 ? 'Select...' : selectedCount === 1 ? [...currentValues][0] : `${selectedCount} selected`;

                 valueInputHTML = `<div class="filter-multiselect-container relative">
                    <button type="button" class="multiselect-trigger settings-select text-left w-full">${triggerText}</button>
                    <div class="multiselect-panel hidden">${opts.map(opt => `<label><input type="checkbox" class="multiselect-checkbox" value="${opt}" ${currentValues.has(opt) ? 'checked' : ''}> ${opt}</label>`).join('')}</div>
                 </div>`;

            } else if (selectedColumn.type === 'select' && ['is', 'isNot'].includes(currentOperator)) {
                valueInputHTML = `<select class="settings-select value-input">${selectedColumn.options.map(opt => `<option value="${opt}" ${filter.value === opt ? 'selected' : ''}>${opt}</option>`).join('')}</select>`;
            } else {
                 valueInputHTML = `<input type="${selectedColumn.type === 'number' ? 'number' : 'text'}" class="settings-input value-input w-full" value="${filter.value || ''}" placeholder="Enter value...">`;
            }
        }
        row.innerHTML = `
            <select class="settings-select column-select">${filterColumns.map(c => `<option value="${c.id}" ${filter.columnId === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
            <select class="settings-select operator-select">${ops.map(op => `<option value="${op.v}" ${currentOperator === op.v ? 'selected' : ''}>${op.l}</option>`).join('')}</select>
            <div class="value-container">${valueInputHTML}</div>
            <button class="remove-threshold-btn remove-criteria-btn" title="Remove Criteria"><svg class="pointer-events-none" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>
        `;
        container.appendChild(row);
        
        const multiSelectTrigger = row.querySelector('.multiselect-trigger');
        if (multiSelectTrigger) {
            multiSelectTrigger.addEventListener('click', (e) => {
                const panel = e.target.nextElementSibling;
                panel.classList.toggle('hidden');
            });
        }
    };

    if (tempFilters.length === 0) {
        renderRow(); 
    } else {
        tempFilters.forEach(filter => renderRow(filter));
    }
    
    container.querySelectorAll('.column-select, .operator-select').forEach(sel => {
        sel.addEventListener('change', () => {
            appState.profiles.driverFilters.activeFilters = readModalState();
            renderDriverFilterModal(); 
        });
    });

    container.addEventListener('click', e => {
        if (e.target.closest('.remove-criteria-btn')) {
            e.target.closest('.driver-filter-criteria-row').remove();
            appState.profiles.driverFilters.activeFilters = readModalState();
        }
    });

    const addBtn = modal.querySelector('#add-driver-filter-criteria-btn');
    if (addBtn && !addBtn.listenerAttached) {
        addBtn.addEventListener('click', () => {
            const currentFilters = readModalState();
            currentFilters.push({}); 
            appState.profiles.driverFilters.activeFilters = currentFilters;
            renderDriverFilterModal();
        });
        addBtn.listenerAttached = true;
    }
    
    const logicButtons = modal.querySelectorAll('.filter-logic-btn');
    logicButtons.forEach(btn => {
        btn.classList.toggle('active', appState.profiles.driverFilters.filterLogic === btn.dataset.logic);
        const handleLogicClick = () => {
            appState.profiles.driverFilters.filterLogic = btn.dataset.logic;
            logicButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
        btn.removeEventListener('click', btn.logicClickHandler);
        btn.addEventListener('click', handleLogicClick);
        btn.logicClickHandler = handleLogicClick;
    });
}

function renderContractTypeFilterDropdown() {
    const container = document.getElementById('contract-type-filter-container');
    if (!container) return;

    const existingDropdown = document.getElementById('contract-type-filter-dropdown');
    if (existingDropdown) existingDropdown.remove();

    if (!appState.profiles.isContractTypeFilterOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'contract-type-filter-dropdown';
    dropdown.className = 'absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

    const options = [
        { id: 'all', label: 'All Drivers' },
        { id: 'oo', label: 'OO Only' },
        { id: 'loo', label: 'LOO Only' },
    ];

    let dropdownHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Filter Contract Type</div>`;
    
    options.forEach(opt => {
        const isActive = appState.profiles.contractTypeFilter === opt.id;
        dropdownHTML += `
            <a href="#" data-filter="${opt.id}" class="contract-type-option flex items-center justify-between p-1.5 hover:bg-gray-600 rounded-md text-sm ${isActive ? 'text-teal-400 font-semibold' : 'text-gray-200'}">
                <span>${opt.label}</span>
                ${isActive ? '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clip-rule="evenodd" /></svg>' : ''}
            </a>
        `;
    });
    
    dropdown.innerHTML = dropdownHTML;
    container.appendChild(dropdown);

    dropdown.querySelectorAll('.contract-type-option').forEach(optionEl => {
        optionEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            appState.profiles.contractTypeFilter = e.currentTarget.dataset.filter;
            appState.profiles.isContractTypeFilterOpen = false; 
            renderTeamProfileUI(); 
        });
    });
}

function renderCompanyFilterDropdown() {
    const container = document.getElementById('company-filter-container');
    if (!container) return;

    const existingDropdown = document.getElementById('company-filter-dropdown');
    if (existingDropdown) existingDropdown.remove();

    if (!appState.profiles.isCompanyFilterOpen) return;

    const dropdown = document.createElement('div');
    dropdown.id = 'company-filter-dropdown';
    dropdown.className = 'absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-50 p-2';

    // FIX: Use the full list of companies from the master data source
    const allCompanies = [...new Set((appState.profiles.liveDriverCountData || []).map(d => d.company_name).filter(Boolean))].sort();
    const options = ['All Companies', ...allCompanies];

    let dropdownHTML = `<div class="text-xs uppercase text-gray-400 font-bold mb-2">Filter Company</div>`;

    options.forEach(opt => {
        const isActive = appState.profiles.selectedCompany === opt;
        dropdownHTML += `
            <a href="#" data-filter="${opt}" class="company-filter-option flex items-center justify-between p-1.5 hover:bg-gray-600 rounded-md text-sm ${isActive ? 'text-teal-400 font-semibold' : 'text-gray-200'}">
                <span>${opt}</span>
                ${isActive ? '<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.052-.143z" clip-rule="evenodd" /></svg>' : ''}
            </a>
        `;
    });

    dropdown.innerHTML = dropdownHTML;
    container.appendChild(dropdown);

    dropdown.querySelectorAll('.company-filter-option').forEach(optionEl => {
        optionEl.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            appState.profiles.selectedCompany = e.currentTarget.dataset.filter;
            appState.profiles.isCompanyFilterOpen = false;
            renderTeamProfileUI(); 
        });
    });
}

window.requestDispatchSort = (key) => {
    const { sortConfig } = appState.profiles.dispatchTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    appState.profiles.dispatchTable.sortConfig = { key, direction };
    renderDispatchTable(teamData.dispatchers, teamData.dispatchers);
};

window.requestDriverSort = (key) => {
    const { sortConfig } = appState.profiles.driverTable;
    const teamData = appState.profiles.currentTeamData;
    if (!teamData) return;

    let direction = 'descending';
    if (sortConfig.key === key && sortConfig.direction === 'descending') {
        direction = 'ascending';
    }
    appState.profiles.driverTable.sortConfig = { key, direction };
    renderDriverTable(teamData.drivers);
};


/**
 * Calculates the start (Tuesday) and end (Monday) of a pay period from a given pay date (Thursday).
 * @param {string} payDateString - The pay date from the stub (e.g., "8/28/2025").
 * @returns {{start: Date, end: Date}}
 */
function getPayPeriodFromPayDate(payDateString) {
    const payDate = new Date(payDateString);
    payDate.setUTCHours(0, 0, 0, 0);

    // A stub's pay_date is a Thursday. The period it covers ended on the preceding Monday.
    const end = new Date(payDate);
    end.setUTCDate(payDate.getUTCDate() - 3); // Thursday -> Monday is 3 days prior.
    end.setUTCHours(23, 59, 59, 999);

    // The period started on the Tuesday before that Monday.
    const start = new Date(end);
    start.setUTCDate(end.getUTCDate() - 6); // Monday -> Tuesday is 6 days prior.
    start.setUTCHours(0, 0, 0, 0);

    return { start, end };
}

/**
 * Generates a trend display for snapshot KPIs.
 */
function getSnapshotTrend(current, previous, lowerIsBetter = false) {
    if (current === null || previous === null || isNaN(current) || isNaN(previous) || previous === 0) {
        return '<span class="trend neutral">--</span>';
    }
    const change = current - previous;
    if (Math.abs(change) < 0.01) {
        return '<span class="trend neutral">--</span>';
    }

    const isPositive = change > 0;
    const isGood = lowerIsBetter ? !isPositive : isPositive;
    const color = isGood ? 'good' : 'bad';
    const arrow = isPositive ? '▲' : '▼';
    
    return `<span class="trend ${color}">${arrow}</span>`;
}

/**
 * Generates the title for the snapshot panel based on active filters.
 */
function generateSnapshotTitle() {
    const { selectedTeam, selectedCompany, contractTypeFilter, selectedWeek } = appState.profiles;
    const weeksAgo = selectedWeek === 'live' ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
    const weekLabel = getProfilePayrollWeek(weeksAgo).label;

    let context = [];

    if (selectedCompany !== 'All Companies') {
        context.push(selectedCompany);
    } else if (selectedTeam !== 'ALL_TEAMS') {
        context.push(selectedTeam);
    } else {
        context.push("All Teams");
    }

    if (contractTypeFilter !== 'all') {
        context.push(`(${contractTypeFilter.toUpperCase()})`);
    }

    return `${context.join(' ')} | ${weekLabel}`;
}
function generateSnapshotData() {
    const { currentTeamData, liveData, selectedWeek, selectedTeam, selectedCompany, contractTypeFilter } = appState.profiles;
    if (!currentTeamData) return null;

    const weeksAgo = selectedWeek === 'live' ? 0 : parseInt(selectedWeek.replace('week_', ''), 10);
    const { start: currentStart, end: currentEnd } = getPayrollWeekDateRange(weeksAgo);
    const useLiveData = selectedWeek === 'live';

    // --- FIX START: The date filtering logic for historical stubs has been corrected ---
    let baseFilteredData = (useLiveData ? liveData : appState.loads.historicalStubsData).filter(d => {
        if (useLiveData) {
            const dateKey = 'do_date';
            if (!d[dateKey]) return false;
            const itemDate = new Date(d[dateKey]);
            return itemDate >= currentStart && itemDate <= currentEnd;
        } else {
            // Corrected logic for historical data
            if (!d.pay_date) return false;
            const payDate = new Date(d.pay_date);
            if (isNaN(payDate.getTime())) return false;
            
            // Calculate the target Thursday for the selected week's pay period
            const weekEndForPayDate = new Date(currentEnd);
            weekEndForPayDate.setUTCDate(weekEndForPayDate.getUTCDate() + 3); 
            
            // Match the stub's pay_date with the target Thursday
            return payDate.toISOString().split('T')[0] === weekEndForPayDate.toISOString().split('T')[0];
        }
    });

    if (selectedTeam !== 'ALL_TEAMS') {
        const teamKey = useLiveData ? 'team' : 'stub_team';
        baseFilteredData = baseFilteredData.filter(d => d[teamKey] === selectedTeam);
    }
    if (selectedCompany !== 'All Companies') {
        baseFilteredData = baseFilteredData.filter(d => d.company_name === selectedCompany);
    }
    
    // This now receives the correctly filtered data
    const snapshotKpis = calculateKpiData(baseFilteredData, useLiveData, currentTeamData.drivers, appState.loads.historicalStubsData, contractTypeFilter, currentTeamData);
    // --- END FIX ---


    const { dispatchers, drivers } = currentTeamData;
    
    const { start: prevStart, end: prevEnd } = getPayrollWeekDateRange(weeksAgo + 1);

    // Get previous week data based on the same filters (ignoring contract type for an apples-to-apples comparison)
    let prevWeekFilteredData = liveData.filter(d => {
        if (!d.do_date) return false;
        const doDate = new Date(d.do_date);
        return doDate >= prevStart && doDate <= prevEnd;
    });
    if (selectedTeam !== 'ALL_TEAMS') prevWeekFilteredData = prevWeekFilteredData.filter(d => d.team === selectedTeam);
    if (selectedCompany !== 'All Companies') prevWeekFilteredData = prevWeekFilteredData.filter(d => d.company_name === selectedCompany);
    
    const prevGross = prevWeekFilteredData.reduce((sum, l) => sum + (l.price || 0) + (l.cut || 0), 0);
    const prevActiveTrucks = new Set(prevWeekFilteredData.map(d => d.driver)).size;
    
    const kpis = {
        totalGross: { value: snapshotKpis.totalGross, trend: getSnapshotTrend(snapshotKpis.totalGross, prevGross) },
        totalMargin: { value: snapshotKpis.teamMargin, trend: getSnapshotTrend(0,0) },
        totalRpm: { value: snapshotKpis.teamRpm, trend: getSnapshotTrend(0,0)},
        activeTrucks: { value: snapshotKpis.activeTrucks, trend: getSnapshotTrend(snapshotKpis.activeTrucks, prevActiveTrucks) },
        dispatchers: { value: snapshotKpis.dispatchers, trend: getSnapshotTrend(0,0) }, 
        avgWellness: { value: snapshotKpis.medianWellness, trend: getSnapshotTrend(0,0) }
    };

    const sortedByRank = [...dispatchers].sort((a, b) => (a.rank1w || Infinity) - (b.rank1w || Infinity));
    const sortedByCompliance = [...dispatchers].sort((a, b) => (b.complianceScore || 0) - (a.complianceScore || 0));
    const highRiskDrivers = [...drivers].sort((a, b) => b.risk - a.risk).slice(0, 5);
    
    const flagSnapshot = drivers.flatMap(d => d.flags.map(f => f.text)).reduce((acc, flag) => {
        acc[flag] = (acc[flag] || 0) + 1;
        return acc;
    }, {});
    const badMoves = dispatchers.reduce((sum, d) => sum + (d.badMoves || 0), 0);
    if (badMoves > 0) flagSnapshot['Bad Moves'] = badMoves;


    return {
        kpis,
        bestDispatchersRank: sortedByRank.slice(0, 3),
        worstDispatchersRank: sortedByRank.filter(d => d.rank1w !== null).slice(-3).reverse(),
        worstDispatchersCompliance: sortedByCompliance.slice(-3).reverse(),
        highRiskDrivers,
        flagSnapshot
    };
}

/**
 * Renders the D3 chart for the snapshot panel with adaptive logic.
 */
export function renderSnapshotChart(containerId) {
    const container = d3.select(`#${containerId}`);
    container.html(""); // Clear previous chart

    const containerNode = container.node();
    if (!containerNode) return;
    const { width: containerWidth, height: containerHeight } = containerNode.getBoundingClientRect();

    if (containerWidth < 50 || containerHeight < 50) {
        setTimeout(() => renderSnapshotChart(containerId), 50);
        return;
    }

    // --- START OF THE FIX ---
    // 1. Store the original, global filter from the Rankings view.
    const originalDriverFilter = appState.driverTypeFilter;
    // 2. Temporarily set the global filter to match the one selected in the Profiles view.
    appState.driverTypeFilter = appState.profiles.contractTypeFilter;
    // --- END OF THE FIX ---

    const { selectedTeam, selectedCompany } = appState.profiles;
    const allTeams = [...new Set(appState.allHistoricalData.map(d => d.dispatcherTeam).filter(Boolean))];
    let datasets = [];
    let yLabel = "Rank";

    if (selectedCompany !== 'All Companies') {
        const entityName = selectedCompany;
        // This will now use the correct, temporarily set filter
        datasets.push({ name: entityName, data: getCompanyOrAllTeamsCriteriaHistory(entityName, 'company', appState.allHistoricalData, 8) });
        yLabel = "Avg Criteria";
    } else if (selectedTeam !== 'ALL_TEAMS') {
        const teamsToPlot = allTeams.filter(t => t.startsWith(selectedTeam));
        
        if (teamsToPlot.length > 0) {
            teamsToPlot.forEach(teamName => {
                const shortName = teamName.replace(selectedTeam, '').trim() || teamName;
                // This will now use the correct, temporarily set filter
                datasets.push({ name: shortName, data: getTeamRankHistory(teamName, appState.allHistoricalData, 8) });
            });
        } else {
            // This will now use the correct, temporarily set filter
            datasets.push({ name: selectedTeam, data: getTeamRankHistory(selectedTeam, appState.allHistoricalData, 8) });
        }
    } else {
        // This will now use the correct, temporarily set filter
        datasets.push({ name: "All Teams", data: getCompanyOrAllTeamsCriteriaHistory('ALL_TEAMS', 'all', appState.allHistoricalData, 8) });
        yLabel = "Avg Criteria";
    }

    // --- START OF THE FIX ---
    // 3. Immediately reset the global filter to its original value so it doesn't affect the Rankings view.
    appState.driverTypeFilter = originalDriverFilter;
    // --- END OF THE FIX ---


    const chartData = datasets.flatMap(ds => ds.data.filter(d => d.value !== null));
    if (!chartData || chartData.length === 0) {
        container.html(`<div class="flex items-center justify-center h-full text-gray-500 text-sm">Not enough historical data for trend.</div>`);
        return;
    }
    
    const margin = { top: 20, right: 15, bottom: 40, left: 15 };
    const width = containerWidth - margin.left - margin.right;
    const height = containerHeight - margin.top - margin.bottom;

    const svg = container.append("svg").attr("width", containerWidth).attr("height", containerHeight)
        .append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime().domain(d3.extent(chartData, d => d.date)).range([0, width]);
    const y = d3.scaleLinear().domain(d3.extent(chartData, d => d.value)).range([height, 0]).nice();
    if (yLabel === "Rank") y.domain([d3.max(chartData, d => d.value) * 1.1, 0.5]);
    
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat("%b %d")));
    
    svg.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat('')).select('.domain').remove();

    const colorScale = d3.scaleOrdinal(["#2dd4bf", "#a78bfa", "#f472b6", "#fbbf24"]);

    datasets.forEach((dataset, i) => {
        const color = colorScale(i);
        const line = d3.line().x(d => x(d.date)).y(d => y(d.value)).defined(d => d.value !== null);
        svg.append("path").datum(dataset.data).attr("class", "chart-line").attr("d", line).style("stroke", color);

        svg.selectAll(`.label-${i}`).data(dataset.data.filter(d => d.value !== null))
           .enter().append("text")
           .attr("class", "chart-data-label")
           .attr("x", d => x(d.date))
           .attr("y", d => y(d.value) - 6)
           .attr("fill", color)
           .text(d => yLabel === "Rank" ? `#${d.value}` : d3.format(".0%")(d.value));
    });

    if (datasets.length > 1) {
        const legend = container.append("div").attr("class", "snapshot-chart-legend");
        datasets.forEach((ds, i) => {
            legend.append("div").attr("class", "snapshot-legend-item")
                .html(`<div class="snapshot-legend-color" style="background-color: ${colorScale(i)};"></div> ${ds.name}`);
        });
    }

    const tooltip = d3.select("body").selectAll(".d3-tooltip").data([null]).join("div").attr("class", "d3-tooltip");

    const focus = svg.append("g")
        .attr("class", "focus")
        .style("display", "none");

    focus.append("line")
        .attr("class", "x-hover-line")
        .attr("y1", 0)
        .attr("y2", height);

    datasets.forEach((ds, i) => {
        focus.append("circle")
            .attr("r", 4)
            .attr("class", `focus-circle-${i}`)
            .style("fill", colorScale(i))
            .style("stroke", "white");
    });

    svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .on("mouseover", () => { focus.style("display", null); tooltip.style("opacity", 1); })
        .on("mouseout", () => { focus.style("display", "none"); tooltip.style("opacity", 0); })
        .on("mousemove", mousemove);

    function mousemove(event) {
        const bisectDate = d3.bisector(d => d.date).left;
        const x0 = x.invert(d3.pointer(event)[0]);
        let tooltipHtml = `<strong>${d3.timeFormat("%b %d, %Y")(x0)}</strong>`;
        let closestDateForLine = null;

        datasets.forEach((dataset, i) => {
            const data = dataset.data.filter(d => d.value !== null);
            if (data.length === 0) return;
            
            const index = bisectDate(data, x0, 1);
            const d0 = data[index - 1];
            const d1 = data[index];
            const d = (d1 && d0) ? (x0 - d0.date > d1.date - x0 ? d1 : d0) : (d0 || d1);

            if (d) {
                closestDateForLine = d.date; 
                focus.select(`.focus-circle-${i}`)
                    .attr("transform", `translate(${x(d.date)},${y(d.value)})`);
                
                const formattedValue = yLabel === "Rank" ? `#${d.value}` : d3.format(".0%")(d.value);
                tooltipHtml += `<br><span style="color:${colorScale(i)}">●</span> ${dataset.name}: ${formattedValue}`;
            }
        });

        if (closestDateForLine) {
            focus.select(".x-hover-line").attr("transform", `translate(${x(closestDateForLine)},0)`);
        }

        const tooltipNode = tooltip.node();
        if (!tooltipNode) return;
        
        const tooltipWidth = tooltipNode.getBoundingClientRect().width;
        tooltip.html(tooltipHtml)
            .style("left", `${event.pageX - tooltipWidth - 15}px`) 
            .style("top", `${event.pageY - 10}px`);
    }
}

/**
 * Renders the entire snapshot panel with dynamic data.
 */
export function renderTeamSnapshot() {
    const panel = document.getElementById('snapshot-panel');
    const content = document.getElementById('snapshot-content');
    if (!panel || !content) return;

    if (!appState.profiles.isSnapshotOpen) {
        panel.classList.remove('open');
        return;
    }
    
    panel.classList.add('open');
    document.getElementById('snapshot-title').textContent = generateSnapshotTitle();
    
    const data = generateSnapshotData();
    if (!data) {
        content.innerHTML = `<p class="text-gray-400 p-4 text-center">No data available.</p>`;
        return;
    }

    const { kpis, bestDispatchersRank, worstDispatchersRank, worstDispatchersCompliance, highRiskDrivers, flagSnapshot } = data;
    
    const flagKpis = [
        { label: 'Balance/PO', value: flagSnapshot['Balance'] || 0 },
        { label: 'High Tolls', value: flagSnapshot['High Tolls'] || 0 },
        { label: 'Low Net', value: flagSnapshot['Low Net'] || 0 },
        { label: 'Low RPM', value: flagSnapshot['Low RPM'] || 0 },
        { label: 'Low Gross', value: flagSnapshot['Low Gross'] || 0 },
        { label: 'Heavy Loads', value: flagSnapshot['Heavy Loads'] || 0 },
        { label: 'Bad Moves', value: flagSnapshot['Bad Moves'] || 0 },
        { label: 'Hopper', value: flagSnapshot['Hopper'] || 0 },
    ];

    content.innerHTML = `
        <div class="snapshot-kpi-grid">
            <div class="snapshot-kpi-item relative"><div class="label">Total Gross</div><div class="value">$${Math.round(kpis.totalGross.value).toLocaleString()}</div><div class="trend">${kpis.totalGross.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">RPM (All)</div><div class="value">$${kpis.totalRpm.value.toFixed(2)}</div><div class="trend">${kpis.totalRpm.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">Total Margin</div><div class="value">$${Math.round(kpis.totalMargin.value).toLocaleString()}</div><div class="trend">${kpis.totalMargin.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">Active Trucks</div><div class="value">${kpis.activeTrucks.value}</div><div class="trend">${kpis.activeTrucks.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">Dispatchers</div><div class="value">${kpis.dispatchers.value}</div><div class="trend">${kpis.dispatchers.trend}</div></div>
            <div class="snapshot-kpi-item relative"><div class="label">Avg Wellness</div><div class="value">${kpis.avgWellness.value.toFixed(0)}%</div><div class="trend">${kpis.avgWellness.trend}</div></div>
        </div>

        <div class="snapshot-section flex-grow min-h-0">
             <h3 class="snapshot-section-title">8-Week Performance Trend</h3>
             <div class="snapshot-chart-container" id="snapshot-chart-container"></div>
        </div>

        <div class="snapshot-section">
            <h3 class="snapshot-section-title">Dispatcher Snapshot</h3>
            <div class="snapshot-rankings-grid">
                <div>
                    <h5>Top 3 (Rank)</h5>
                    ${bestDispatchersRank.map(d => `<div class="snapshot-list-item"><span class="name">${d.name}</span><span class="value good">#${d.rank1w || '-'}</span></div>`).join('')}
                </div>
                <div>
                    <h5>Bottom 3 (Rank)</h5>
                    ${worstDispatchersRank.map(d => `<div class="snapshot-list-item"><span class="name">${d.name}</span><span class="value bad">#${d.rank1w || '-'}</span></div>`).join('')}
                </div>
                 <div>
                    <h5>Bottom 3 (Compliance)</h5>
                    ${worstDispatchersCompliance.map(d => `<div class="snapshot-list-item"><span class="name">${d.name}</span><span class="value bad">${d.complianceScore.toFixed(0)}%</span></div>`).join('')}
                </div>
            </div>
        </div>
        
        <div class="snapshot-section">
            <h3 class="snapshot-section-title">Flag Summary</h3>
            <div class="snapshot-kpi-grid" style="grid-template-columns: repeat(4, 1fr);">
                ${flagKpis.map(fk => `<div class="snapshot-kpi-item !py-1 !h-auto"><div class="label">${fk.label}</div><div class="value !text-base">${fk.value}</div></div>`).join('')}
            </div>
        </div>

        <div class="snapshot-section">
        <h3 class="snapshot-section-title">Driver Insight</h3>
        <table id="snapshot-driver-table">
            <thead>
                <tr><th>NAME</th><th>Company</th><th>Contract</th><th>Dispatcher</th><th class="text-right">Risk %</th></tr>
            </thead>
            <tbody>
            ${highRiskDrivers.map(d => `
                <tr>
                    <td class="font-semibold">${d.name}</td>
                    <td>${d.company}</td>
                    <td>${d.contract}</td>
                    <td>${d.dispatcher}</td>
                    <td class="text-right risk-value">${Math.round(d.risk)}%</td>
                </tr>
            `).join('')}
            </tbody>
        </table>
    </div>
    `;

    // --- FIX: Implement ResizeObserver for responsive chart rendering ---
    const chartContainer = document.getElementById('snapshot-chart-container');
    if (chartContainer) {
        // If an observer is already on this element from a previous render, disconnect it first.
        if (chartContainer._resizeObserver) {
            chartContainer._resizeObserver.disconnect();
        }

        // Create a debounced version of the render function to prevent rapid-fire redraws.
        const debouncedRender = debounce(renderSnapshotChart, 50);

        // Create an observer that calls the debounced render function whenever the container size changes.
        const observer = new ResizeObserver(() => {
            debouncedRender('snapshot-chart-container');
        });

        // Start observing the container.
        observer.observe(chartContainer);

        // Store the observer on the element itself so we can manage it later.
        chartContainer._resizeObserver = observer;
    }
}
