// from 1. DISP TEST/rankings/rankings_api.js
import { canViewTeam, isAdmin, canViewDispatcher } from '../auth.js';
import { hasPermission, PERMISSIONS } from '../permissions.js';
import { RANKINGS_APPS_SCRIPT_URLS, coreMetrics, CRITERIA_APPS_SCRIPT_URL } from '../config.js';
import { appState, stubsSortConfig } from '../state.js';
import { calculateMedian, formatPercentage, fetchWithRetry, getPayrollWeekDateRange } from '../utils.js';
import { calculateRegionalPercentages } from './regions_utils.js';
import { fetchProfileData } from '../profiles/profiles_api.js';


const recalculateMetrics = (stubs, driverType) => {
    if (!stubs || stubs.length === 0) {
        return null;
    }

    const numDrivers = stubs.length;

    const avg = (key) => stubs.reduce((acc, stub) => acc + (stub[key] || 0), 0) / numDrivers;
    const sum = (key) => stubs.reduce((acc, stub) => acc + (stub[key] || 0), 0);

    const totalGross = sum('total_gross');
    const allMiles = sum('all_miles');
    const loadedMiles = sum('loaded_miles');

    // --- Recalculate all metrics on a per-driver average basis ---
    const driverHappiness = avg('netDriverGrossPercentage');
    const companyHappiness = avg('cashFlow');
    const complianceVal = avg('compliance') || 0;
    const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
    const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
    const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;
    const mainCriteria = (driverHappiness * wDriver) + (companyHappiness * wCompany) + (complianceVal * wCompliance);

    const recalculated = {
        // --- Core criteria and percentages (Averages) ---
        mainCriteria: mainCriteria,
        pNet: avg('netPercentage'),
        pDriverGross: avg('driverGross'), // This is the %
        pMargin: avg('margin'),
        pMainCriteriaNetDriverMargin: driverHappiness,
        pMainCriteria2CashFlow: companyHappiness,
        pDriver_rpm: avg('driver_rpm'),

        // --- Ratios, calculated from totals ---
        rpmAll: allMiles > 0 ? totalGross / allMiles : 0,

        // --- Raw values, calculated as per-driver averages ---
        pAll_miles: allMiles / numDrivers,
        pLoaded_miles: loadedMiles / numDrivers,
        pMargin_dollar: sum('margin_dollar') / numDrivers,
        pDriver_gross: sum('driver_gross') / numDrivers, // This is the $ amount
        pDefault_fuel: sum('default_fuel') / numDrivers,
        pEstimated_fuel: sum('estimated_fuel') / numDrivers,
        pEstimated_tolls: sum('estimated_tolls') / numDrivers,
        pMaintenance: sum('maintenance') / numDrivers,
        pDepreciation: sum('Depreciation') / numDrivers,
        pTotal_gross: totalGross / numDrivers,
        pEstimated_net: sum('estimated_net') / numDrivers,

        // --- Driver counts ---
        numDrivers: numDrivers,
        numOOs: driverType === 'oo' ? numDrivers : 0,
        numLOOs: driverType === 'loo' ? numDrivers : 0,
        driverNames: stubs.map(s => s.driverName),
    };

    return recalculated;
};

export const applyWeightsToHistoricalData = () => {
    const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
    const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
    const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;

    appState.allHistoricalData.forEach(item => {
        const driverHappiness = item.pMainCriteriaNetDriverMargin || 0;
        const companyHappiness = item.pMainCriteria2CashFlow || 0;
        const complianceVal = item.compliance || 0;
        item.mainCriteria = (driverHappiness * wDriver) + (companyHappiness * wCompany) + (complianceVal * wCompliance);
        
        if (item.stubs && Array.isArray(item.stubs)) {
            item.stubs.forEach(stub => {
                const sDriver = stub.netDriverGrossPercentage || 0;
                const sCompany = stub.cashFlow || 0;
                const sCompliance = stub.compliance || item.compliance || 0;
                stub.criteria = (sDriver * wDriver) + (sCompany * wCompany) + (sCompliance * wCompliance);
            });
        }
    });

    const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    appState.precomputedDispatcher4WkAverages = {};
    appState.precomputedTeam4WkAverages = {};
    for (const dateString of uniqueDates) {
        appState.precomputedDispatcher4WkAverages[dateString] = calculateFourWeekAverageDataForDate(dateString, 'dispatcher');
        appState.precomputedTeam4WkAverages[dateString] = calculateFourWeekAverageDataForDate(dateString, 'team');
    }
    
    appState.precomputationCache = {};
};

export const fetchAllHistoricalData = async () => {
    try {
        const loadStubsPromise = !appState.loads?.historicalStubsData 
            ? fetchWithRetry(STUBS_APPS_SCRIPT_URL).then(r => r.json()).then(d => { 
                  if(d.historicalData) {
                      if(!appState.loads) appState.loads = {};
                      appState.loads.historicalStubsData = d.historicalData; 
                  }
                  return d;
              })
            : Promise.resolve();

        const loadCriteriaPromise = fetchWithRetry(CRITERIA_APPS_SCRIPT_URL).then(r => r.json()).then(d => {
            appState.criteriaWeights = d || { driverHappiness: 50, companyHappiness: 50, compliance: 0 };
        }).catch(() => {
            appState.criteriaWeights = { driverHappiness: 50, companyHappiness: 50, compliance: 0 };
        });

        await Promise.all([fetchProfileData(), loadStubsPromise, loadCriteriaPromise]);

        const fetchPromises = RANKINGS_APPS_SCRIPT_URLS.map(url =>
            fetchWithRetry(url).then(res => res.json())
        );
        const results = await Promise.all(fetchPromises);
        let combinedHistoricalData = [];
        for (const result of results) {
            if (result.error) throw new Error(`Error: ${result.error}`);
            if (result.historicalData) combinedHistoricalData.push(...result.historicalData);
        }

        const _val = (item, ...keys) => {
            for (const k of keys) {
                if (item[k] !== undefined && item[k] !== null && String(item[k]).trim() !== '') {
                    const p = parseFloat(String(item[k]).replace(/[^0-9.-]/g, ''));
                    if (!isNaN(p)) return p;
                }
            }
            return null;
        };

        const mappedData = combinedHistoricalData.map(item => {
            const newItem = { ...item, dispatcherName: item.dispatcherName || item.name, date: new Date(item.date) };
            newItem.company_name = item.company_name || item.company || item.Company || '';
            newItem.dispatcherTeam = item.dispatcherTeam ? String(item.dispatcherTeam).trim() : null;
            
            if (item.driverName && !item.driverNames) newItem.driverNames = [item.driverName];
            else if (item.driverNames) { 
                if (Array.isArray(item.driverNames)) newItem.driverNames = item.driverNames;
                else if (typeof item.driverNames === 'string') newItem.driverNames = item.driverNames.split(',').map(name => name.trim()).filter(name => name.length > 0);
            } else newItem.driverNames = []; 

            newItem._fh_goodMoves = _val(item, 'goodMoves', 'Good Moves');
            newItem._fh_badMoves = _val(item, 'badMoves', 'Bad Moves');
            newItem._fh_hiddenMiles = _val(item, 'hiddenMiles', 'Hidden Miles');
            newItem._fh_lowRpm = _val(item, 'lowRpm', 'Low RPM');
            newItem._fh_tuesdayOpen = _val(item, 'tuesdayOpen', 'Tuesday Open');
            newItem._fh_missingPaperwork = _val(item, 'missingPaperwork', 'Missing Paperwork');
            newItem._fh_trailerDrops = _val(item, 'trailerDrops', 'Trailer Drops');
            newItem._fh_trailerRecoveries = _val(item, 'trailerRecoveries', 'Trailer Recoveries');
            newItem._fh_overdue = _val(item, 'overdueLoads', 'Overdue Loads', 'Overdue');
            newItem._fh_wellness = _val(item, 'wellness', 'Wellness', 'Wellness %');
            newItem._fh_retention = _val(item, 'retention4w', 'Retention', 'Retention %');
            newItem._fh_calc = _val(item, 'calculatorActivity', 'Calculator Activity');
            newItem._fh_rc = _val(item, 'rcEntry', 'RC Entry');
            newItem._fh_tenureOO = _val(item, 'medianTenureOO', 'Tenure OO');
            newItem._fh_tenureLOO = _val(item, 'medianTenureLOO', 'Tenure LOO');
            
            let comp = _val(item, 'compliance', 'Compliance', 'Compliance %');
            if (comp !== null && comp > 1) comp = comp / 100;
            newItem.compliance = comp;

            ['numDrivers', 'numOOs', 'numLOOs'].forEach(colId => { 
                const v = _val(item, colId);
                newItem[colId] = v;
            });
            return newItem;
        });

        const historicalStubs = appState.loads?.historicalStubsData || [];
        const liveLoads = appState.profiles?.liveData || [];
        
        const weights = appState.profiles?.complianceSettings?.weights || {
            goodMoves: 5, badMoves: 10, hiddenMiles: 10, lowRpm: 10,
            tuesdayOpen: 10, missingPaperwork: 10, overdueLoads: 10,
            trailerDrops: 5, trailerRecoveries: 5, wellness: 5,
            retention4w: 5, medianTenure: 5, calculatorActivity: 5, rcEntry: 5
        };
        const thresholdSettings = appState.profiles?.thresholdSettings || {};
        const goodMoveThresh = thresholdSettings.goodMove || { default: 6000, by_contract: {} };
        const lowRpmThresh = thresholdSettings.lowRpm || { default: 1.5, by_contract: {} };
        
        const getThresh = (setting, contract) => {
            const c = (contract || 'LOO').toUpperCase();
            const key = c === 'OO' ? 'OO' : 'LOO';
            return setting.by_contract?.[key] ?? setting.default;
        };
        const calcMedian = (values) => {
            if (!values || values.length === 0) return null;
            values.sort((a, b) => a - b);
            const half = Math.floor(values.length / 2);
            if (values.length % 2) return values[half];
            return (values[half - 1] + values[half]) / 2.0;
        };

        const groupedByWeek = {};
        mappedData.forEach(item => {
            if (!item.date || isNaN(item.date)) return;
            const payDate = new Date(item.date);
            const periodEnd = new Date(payDate);
            periodEnd.setUTCDate(payDate.getUTCDate() - 3); 
            periodEnd.setUTCHours(23, 59, 59, 999);
            const weekKey = periodEnd.toISOString().split('T')[0];
            if (!groupedByWeek[weekKey]) groupedByWeek[weekKey] = [];
            groupedByWeek[weekKey].push(item);
        });

        Object.values(groupedByWeek).forEach(weekItems => {
            if (weekItems.length === 0) return;

            const payDate = new Date(weekItems[0].date);
            const periodEnd = new Date(payDate);
            periodEnd.setUTCDate(payDate.getUTCDate() - 3); 
            periodEnd.setUTCHours(23, 59, 59, 999);
            const periodStart = new Date(periodEnd);
            periodStart.setUTCDate(periodEnd.getUTCDate() - 6); 
            periodStart.setUTCHours(0, 0, 0, 0);

            const isLiveWeek = liveLoads.some(l => {
                const d = new Date(l.do_date);
                return d >= periodStart && d <= periodEnd;
            });

            const dispatcherStats = {};
            
            weekItems.forEach(item => {
                const nameKey = String(item.dispatcherName).trim().toLowerCase();
                if (!dispatcherStats[nameKey]) {
                    let w = item._fh_wellness ?? 0;
                    if (w > 0 && w <= 1) w = w * 100; 
                    
                    dispatcherStats[nameKey] = {
                        name: item.dispatcherName,
                        goodMoves: item._fh_goodMoves ?? 0,
                        badMoves: item._fh_badMoves ?? 0,
                        hiddenMiles: item._fh_hiddenMiles ?? 0,
                        lowRpm: item._fh_lowRpm ?? 0,
                        tuesdayOpen: item._fh_tuesdayOpen ?? 0,
                        missingPaperwork: item._fh_missingPaperwork ?? 0,
                        trailerDrops: item._fh_trailerDrops ?? 0,
                        trailerRecoveries: item._fh_trailerRecoveries ?? 0,
                        overdueLoads: item._fh_overdue ?? 0,
                        calculatorActivity: item._fh_calc ?? 0,
                        rcEntry: item._fh_rc ?? null,
                        wellness: w,
                        retention4w: item._fh_retention !== null && item._fh_retention !== undefined ? item._fh_retention : 0, 
                        medianTenureOO: item._fh_tenureOO ?? null,
                        medianTenureLOO: item._fh_tenureLOO ?? null,
                        
                        wellnessTotal: 0, wellnessPass: 0, calcVisits: 0, rcValues: []
                    };
                }
            });

            if (isLiveWeek) {
                Object.values(dispatcherStats).forEach(s => {
                    s.goodMoves = 0; s.badMoves = 0; s.hiddenMiles = 0; s.lowRpm = 0;
                    s.tuesdayOpen = 0; s.missingPaperwork = 0; s.overdueLoads = 0;
                    s.trailerDrops = 0; s.trailerRecoveries = 0;
                    s.calculatorActivity = 0; s.rcEntry = null;
                    s.wellness = 0; s.wellnessTotal = 0; s.wellnessPass = 0;
                    s.retention4w = 0;
                });

                // 1. Live Loads Calculation
                liveLoads.forEach(load => {
                    if (!load.do_date) return;
                    const d = new Date(load.do_date);
                    if (d >= periodStart && d <= periodEnd) {
                        const nameKey = String(load.dispatcher).trim().toLowerCase();
                        if (dispatcherStats[nameKey]) {
                            const s = dispatcherStats[nameKey];
                            
                            // Init on first finding
                            if (s.goodMoves === null) s.goodMoves = 0;
                            if (s.badMoves === null) s.badMoves = 0;
                            if (s.lowRpm === null) s.lowRpm = 0;
                            if (s.hiddenMiles === null) s.hiddenMiles = 0;

                            if (['GOOD', 'FAIL', '-'].includes(load.wellness_fail)) {
                                s.wellnessTotal++;
                                if (load.wellness_fail !== 'FAIL') s.wellnessPass++;
                            }
                            if (load.moved_monday === 'Moved Monday Load') {
                                const thresh = getThresh(goodMoveThresh, load.contract_type);
                                const grossWithoutThisMovedLoad = liveLoads
                                    .filter(l => l.driver === load.driver && l.id !== load.id && l.status !== 'Canceled')
                                    .reduce((sum, l) => sum + (l.price || 0) - (l.cut || 0), 0);
                                if (grossWithoutThisMovedLoad < thresh) s.goodMoves++; else s.badMoves++;
                            }
                            const rpmThresh = getThresh(lowRpmThresh, load.contract_type);
                            if ((parseFloat(load.rpm_all) || 0) < rpmThresh) s.lowRpm++;
                            if (load.hidden_miles === 'Hidden Miles Found!') s.hiddenMiles++;
                        }
                    }
                });
                
                Object.values(dispatcherStats).forEach(s => {
                    if (s.wellnessTotal > 0) s.wellness = (s.wellnessPass / s.wellnessTotal) * 100;
                });

                const processLog = (data, dateKey, nameKey, statKey, isSum = false, valKey = null) => {
                    (data || []).forEach(d => {
                        const dt = new Date(d[dateKey]);
                        if (statKey === 'tuesdayOpen') { // Shift Logic
                             const shiftBack = dt.getUTCDay() === 2 ? 1 : 0;
                             dt.setUTCDate(dt.getUTCDate() - shiftBack);
                        }
                        if (dt >= periodStart && dt <= periodEnd) {
                            const nKey = String(d[nameKey]).trim().toLowerCase();
                            if (dispatcherStats[nKey]) {
                                if (isSum) dispatcherStats[nKey][statKey] += (d[valKey] || 0);
                                else dispatcherStats[nKey][statKey] += 1;
                            }
                        }
                    });
                };
                processLog(appState.profiles?.tuesdayOpenData, 'date', 'dispatch', 'tuesdayOpen');
                processLog(appState.profiles?.missingPaperworkData, 'do_date', 'dispatch', 'missingPaperwork');
                processLog(appState.profiles?.overdueLoadsData, 'deliveryDate', 'dispatcher', 'overdueLoads', true, 'daysPastDO');
                
                (appState.profiles?.trailerDropsData || []).forEach(d => {
                    if (d.dropTime && new Date(d.dropTime) >= periodStart && new Date(d.dropTime) <= periodEnd) {
                        const k = String(d.droppedByDispatcher).trim().toLowerCase();
                        if (dispatcherStats[k]) dispatcherStats[k].trailerDrops++;
                    }
                    if (d.recoveryTime && new Date(d.recoveryTime) >= periodStart && new Date(d.recoveryTime) <= periodEnd) {
                        const k = String(d.recoveredByDispatcher).trim().toLowerCase();
                        if (dispatcherStats[k]) dispatcherStats[k].trailerRecoveries++;
                    }
                });

                // Calc & RC for Live Week
                const processedCalc = {};
                (appState.profiles?.calculatorActivityData || []).forEach(r => {
                     const d = new Date(r.date);
                     if (d >= periodStart && d <= periodEnd) {
                         const k = String(r.dispatcher).trim().toLowerCase();
                         const dk = `${k}-${d.toISOString().split('T')[0]}`;
                         if (dispatcherStats[k] && !processedCalc[dk]) {
                             if ((parseFloat(r.minutes) || 0) > 0) {
                                 dispatcherStats[k].calcVisits++;
                                 processedCalc[dk] = true;
                             }
                         }
                     }
                });
                Object.values(dispatcherStats).forEach(s => { 
                    if(s.calcVisits > 0) s.calculatorActivity = (s.calcVisits / 7) * 100; 
                });

                (appState.profiles?.rcEntryData || []).forEach(r => {
                     const d = new Date(r.date);
                     if (d >= periodStart && d <= periodEnd) {
                         const k = String(r.dispatcher).trim().toLowerCase();
                         if (dispatcherStats[k]) {
                             const val = parseFloat(r.entry_minutes);
                             if (!isNaN(val)) dispatcherStats[k].rcValues.push(val);
                         }
                     }
                });
                Object.values(dispatcherStats).forEach(s => { 
                    if(s.rcValues.length > 0) s.rcEntry = calcMedian(s.rcValues); 
                });

                // Retention Live
                const prevFourWeeksAgoStart = new Date(periodStart);
                prevFourWeeksAgoStart.setUTCDate(prevFourWeeksAgoStart.getUTCDate() - 28);
                const prevFourWeeksAgoEnd = new Date(periodEnd);
                prevFourWeeksAgoEnd.setUTCDate(prevFourWeeksAgoEnd.getUTCDate() - 28);
                const prevTargetPayDateDate = new Date(prevFourWeeksAgoEnd);
                prevTargetPayDateDate.setUTCDate(prevTargetPayDateDate.getUTCDate() + 3);
                const prevTargetPayDate = prevTargetPayDateDate.toISOString().split('T')[0];

                Object.keys(dispatcherStats).forEach(dKey => {
                    const poolStubs = historicalStubs.filter(s => {
                        if (!s.pay_date) return false;
                        const isDateMatch = new Date(s.pay_date).toISOString().split('T')[0] === prevTargetPayDate;
                        const isDispatcherMatch = (s.stub_dispatcher || '').toLowerCase() === dKey;
                        const status = (s.retention_status || '').trim();
                        return isDateMatch && isDispatcherMatch && (status === 'Active' || status === 'Terminated' || status === 'Start');
                    });
                    const historicalPool = new Set(poolStubs.map(s => s.driver_name));
                    let retainedCount = 0;
                    historicalPool.forEach(driverName => {
                        const driverStubsInWindow = historicalStubs.filter(s => 
                            s.driver_name === driverName && 
                            new Date(s.pay_date) >= prevFourWeeksAgoStart && 
                            new Date(s.pay_date) <= prevTargetPayDate
                        ).sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
                        if (driverStubsInWindow.length > 0) {
                            const lastStub = driverStubsInWindow[0];
                            const status = (lastStub.retention_status || '').trim();
                            if (status !== 'Terminated' && (lastStub.stub_dispatcher || '').toLowerCase() === dKey) {
                                retainedCount++;
                            }
                        }
                    });
                    dispatcherStats[dKey].retention4w = historicalPool.size > 0 ? (retainedCount / historicalPool.size) * 100 : null;
                });
            }

          weekItems.forEach(item => {
                const nameKey = String(item.dispatcherName).trim().toLowerCase();
                const s = dispatcherStats[nameKey];
                
                if (s) {
                    item._fh_tuesdayOpen = s.tuesdayOpen;
                    item._fh_missingPaperwork = s.missingPaperwork;
                    item._fh_overdue = s.overdueLoads;
                    item._fh_trailerDrops = s.trailerDrops;
                    item._fh_calcActivity = s.calculatorActivity;
                    item._fh_rcEntry = s.rcEntry;
                    item._fh_retention = s.retention4w;
                }
                
                let complianceVal = item.compliance; 
                if (complianceVal === undefined || complianceVal === null) {
                    complianceVal = null;
                }
                
                item.compliance = complianceVal;
                
                if (item.stubs && Array.isArray(item.stubs)) {
                    item.stubs.forEach(stub => stub.compliance = item.compliance);
                }
            });
        });

        appState.allHistoricalData = mappedData;
        appState.complianceHistoryCalculated = false;
        const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
        if (uniqueDates.length > 0) {
            appState.selectedDate = uniqueDates[0];
            let matchedWeekId = 'week_1';
            for (let i = 0; i <= 10; i++) {
                const { end } = getPayrollWeekDateRange(i);
                const rankingsDate = new Date(end);
                rankingsDate.setUTCDate(end.getUTCDate() + 3);
                if (rankingsDate.toISOString().split('T')[0] === appState.selectedDate) {
                    matchedWeekId = i === 0 ? 'live' : 'week_' + i;
                    break;
                }
            }
            appState.profiles.selectedWeek = matchedWeekId;
        }

        applyWeightsToHistoricalData();

    } catch (e) {
        console.error("Error fetching all historical data:", e);
        appState.error = "Failed to load historical data. Error: " + e.message;
        throw e;
    }
};

export const getFilteredDataByDriverType = (data) => {
    const filter = appState.driverTypeFilter;
    if (filter === 'all') {
        return data;
    }

    return data.map(dispatcherData => {
        const stubs = dispatcherData.stubs || [];
        // Ensure contractType is a string before calling toLowerCase
        const filteredStubs = stubs.filter(stub => typeof stub.contractType === 'string' && stub.contractType.toLowerCase() === filter);

        if (filteredStubs.length === 0) {
            // Return null for dispatchers with no matching drivers
            return null;
        }

        const recalculatedMetrics = recalculateMetrics(filteredStubs, filter);
        if (!recalculatedMetrics) {
             // Also return null if recalculation fails for some reason
            return null;
        }
        
        // Combine original data with the new, recalculated metrics
        return { ...dispatcherData, ...recalculatedMetrics, stubs: filteredStubs };

    }).filter(Boolean); // This will filter out all the null values
};

export const getNUniqueHistoricalDates = (allHistoricalData, selectedDateString, numWeeks) => {
    const uniqueDates = [...new Set(allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse(); 
    const selectedDateIndex = uniqueDates.indexOf(selectedDateString);

    if (selectedDateIndex === -1) {
        return []; 
    }

    const relevantDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + numWeeks);
    
    return allHistoricalData.filter(d => relevantDateStrings.includes(d.date.toISOString().split('T')[0]));
};

export const getNWeeksAgoData = (currentDateString, numberOfWeeksAgo) => {
    const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const currentDateIndex = uniqueDates.indexOf(currentDateString);

    if (currentDateIndex === -1 || currentDateIndex + numberOfWeeksAgo >= uniqueDates.length) {
        return [];
    }
    const targetDateString = uniqueDates[currentDateIndex + numberOfWeeksAgo];
    return appState.allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === targetDateString);
};

export const getDataForDate = (dateString) => {
    return appState.allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === dateString);
};

export const getPreviousWeekData = (currentDateString) => {
    const availableDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse(); 

    let closestPrevWeekDate = null;
    for (let i = 0; i < availableDates.length; i++) {
        if (availableDates[i] < currentDateString) { 
            closestPrevWeekDate = availableDates[i];
            break;
        }
    }

    if (closestPrevWeekDate) {
        return appState.allHistoricalData.filter(d => d.date.toISOString().split('T')[0] === closestPrevWeekDate);
    }
    return [];
};

export const calculateFourWeekAverageDataForDate = (currentDateString, mode, preFilteredData = null) => {
    const dataToUse = preFilteredData || getFilteredDataByDriverType(appState.allHistoricalData);
    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(currentDateString);
    if (selectedDateIndex === -1) return {};

    const relevantDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + 4);
    
    const relevantHistoricalData = dataToUse.filter(d => 
        relevantDateStrings.includes(d.date.toISOString().split('T')[0])
    );

    const groupKey = mode === 'team' ? 'dispatcherTeam' : 'dispatcherName';

    const groupedByEntity = relevantHistoricalData.reduce((acc, curr) => {
        const key = curr[groupKey];
        if (!key) return acc;

        if (!acc[key]) {
            acc[key] = {
                entityName: key,
                weeks: new Set(),
                totalWeight: 0,
                totalGross: 0,
                totalMiles: 0,
            };
            coreMetrics.forEach(metric => {
                // Initialize sums for all metrics except rpmAll, as it's calculated from totals
                if (metric.id !== 'rpmAll') {
                    acc[key][metric.id] = 0;
                }
            });
            acc[key].compliance = 0;
            acc[key].complianceMap = new Map();
            acc[key].weeklyCompliance = new Map();
            ['numDrivers', 'numOOs', 'numLOOs'].forEach(colId => { 
                acc[key][colId] = 0;
            });
        }

        const entity = acc[key];
        const dateKey = curr.date.toISOString().split('T')[0];
        entity.weeks.add(dateKey);
        
        const weight = curr.numDrivers > 0 ? curr.numDrivers : 1;
        entity.totalWeight += weight;

        entity.totalGross += (curr.pTotal_gross || 0) * weight;
        entity.totalMiles += (curr.pAll_miles || 0) * weight;

        coreMetrics.forEach(metric => {
            // Use weighted average for all metrics except rpmAll
            if (metric.id !== 'rpmAll') {
                const value = curr[metric.id];
                if (typeof value === 'number' && !isNaN(value)) {
                    entity[metric.id] += value * weight;
                }
            }
        });
        if (typeof curr.compliance === 'number' && isFinite(curr.compliance)) {
                if (!entity.weeklyCompliance.has(dateKey)) {
                    entity.weeklyCompliance.set(dateKey, new Map());
                }
                const dispKey = curr.dispatcherName ? String(curr.dispatcherName).trim().toLowerCase() : 'unknown';
                entity.weeklyCompliance.get(dateKey).set(dispKey, curr.compliance);
            }
        ['numDrivers', 'numOOs', 'numLOOs'].forEach(colId => {
            const value = curr[colId];
            if (typeof value === 'number' && !isNaN(value)) {
                entity[colId] += value;
            }
        });
        return acc;
    }, {});

    const finalAverages = {};
    for (const entityName in groupedByEntity) {
        const entityAggregate = groupedByEntity[entityName];
        const activeWeeks = entityAggregate.weeks.size;
        if (activeWeeks > 0) {
            const avgData = {
                entityName: entityName,
                weeksIncluded: activeWeeks
            };
            coreMetrics.forEach(metric => {
                if (metric.id === 'rpmAll') {
                    // Calculate rpmAll from the summed totals
                    avgData.rpmAll = entityAggregate.totalMiles > 0 ? entityAggregate.totalGross / entityAggregate.totalMiles : 0;
                } else {
                    // For all other metrics, including pMargin, use the weighted average
                    avgData[metric.id] = entityAggregate.totalWeight > 0 ? entityAggregate[metric.id] / entityAggregate.totalWeight : 0;
                }
            });
            if (entityAggregate.weeklyCompliance) {
                const weeklyMedians = [];
                entityAggregate.weeklyCompliance.forEach((dispMap, dKey) => {
                    const vals = Array.from(dispMap.values());
                    if (vals.length > 0) {
                        weeklyMedians.push(vals.reduce((sum, val) => sum + val, 0) / vals.length);
                    }
                });
                avgData.compliance = weeklyMedians.length > 0 ? weeklyMedians.reduce((sum, val) => sum + val, 0) / weeklyMedians.length : 0;
            } else {
                avgData.compliance = 0;
            }
            ['numDrivers', 'numOOs', 'numLOOs'].forEach(colId => {
                avgData[colId] = entityAggregate[colId] / activeWeeks;
            });
            finalAverages[entityName] = avgData;
        }
    }
    return finalAverages; 
};

export const getOrComputeHistoricalMetrics = () => {
    const { rankingMode, driverTypeFilter } = appState;

    if (appState.precomputationCache[rankingMode] && appState.precomputationCache[rankingMode][driverTypeFilter]) {
        return;
    }

    console.log(`%cComputing metrics for: ${rankingMode} - ${driverTypeFilter}`, 'color: orange; font-weight: bold;');

    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);
    const groupKey = rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
    const allEntityNames = [...new Set(dataToUse.map(d => d[groupKey]).filter(Boolean))];
    const computedMetrics = new Map();

    allEntityNames.forEach(name => computedMetrics.set(name, []));

    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort();

    uniqueDates.forEach(dateString => {
        // --- FIX: Consolidate dispatcher data for each date before ranking ---
        let allDataForThisDate;
        if (rankingMode === 'dispatcher') {
            const rawDataForDate = dataToUse.filter(d => d.date.toISOString().split('T')[0] === dateString);
            const groupedByName = rawDataForDate.reduce((acc, curr) => {
                if (!acc[curr.dispatcherName]) {
                    acc[curr.dispatcherName] = { records: [], totalWeight: 0 };
                }
                acc[curr.dispatcherName].records.push(curr);
                acc[curr.dispatcherName].totalWeight += curr.numDrivers || 0;
                return acc;
            }, {});

            allDataForThisDate = Object.values(groupedByName).map(group => {
                if (group.records.length === 1) return group.records[0];
                const consolidated = {
                    dispatcherName: group.records[0].dispatcherName,
                    company: group.records[0].company_name || group.records[0].company || '', 
                    dispatcherTeam: [...new Set(group.records.map(r => r.dispatcherTeam))].join(', '),
                    date: group.records[0].date,
                    numDrivers: group.records.reduce((sum, r) => sum + (r.numDrivers || 0), 0),
                };
                coreMetrics.forEach(metric => {
                    const weightedSum = group.records.reduce((sum, r) => {
                        const value = r[metric.id];
                        const weight = r.numDrivers || 0;
                        return sum + ((typeof value === 'number' ? value : 0) * weight);
                    }, 0);
                    consolidated[metric.id] = group.totalWeight > 0 ? weightedSum / group.totalWeight : 0;
                });
                
                const weightedCompliance = group.records.reduce((sum, r) => sum + ((r.compliance || 0) * (r.numDrivers || 0)), 0);
                consolidated.compliance = group.totalWeight > 0 ? weightedCompliance / group.totalWeight : 0;

                const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
                const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
                const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;

                const dCurr = consolidated.pMainCriteriaNetDriverMargin || 0;
                const cCurr = consolidated.pMainCriteria2CashFlow || 0;
                const compCurr = consolidated.compliance || 0;
                consolidated.mainCriteria = (dCurr * wDriver) + (cCurr * wCompany) + (compCurr * wCompliance);

                return consolidated;
            });
        } else {
            // Team mode uses raw data for aggregation later
            allDataForThisDate = dataToUse.filter(d => d.date.toISOString().split('T')[0] === dateString);
        }
        // --- End of FIX ---

        let currentRankedData;
        if (rankingMode === 'team') {
            currentRankedData = aggregateTeamData(allDataForThisDate);
            currentRankedData.sort((a, b) => (b.mainCriteria_current || 0) - (a.mainCriteria_current || 0));
        } else {
            // Dispatcher mode now uses the consolidated data for ranking
            currentRankedData = allDataForThisDate
                .filter(d => d.mainCriteria !== null && d[groupKey])
                .sort((a, b) => (b.mainCriteria || 0) - (a.mainCriteria || 0));
        }

       const fourWeekAvgDataForDate = calculateFourWeekAverageDataForDate(dateString, rankingMode, dataToUse);
        const ranked4Wk = Object.values(fourWeekAvgDataForDate || {})
            .map(avgData => {
                const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
                const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
                const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;
                const d4w = avgData.pMainCriteriaNetDriverMargin || 0;
                const c4w = avgData.pMainCriteria2CashFlow || 0;
                const comp4w = avgData.compliance || 0;
                avgData.mainCriteria = (d4w * wDriver) + (c4w * wCompany) + (comp4w * wCompliance);
                return avgData;
            })
            .sort((a, b) => (b.mainCriteria || 0) - (a.mainCriteria || 0));

        allEntityNames.forEach(entityName => {
            let oneWeekEntityData = null;
            let oneWeekRank = null;

            if (rankingMode === 'team') {
                oneWeekEntityData = currentRankedData.find(d => d.entityName === entityName);
                if (oneWeekEntityData) {
                    oneWeekRank = currentRankedData.findIndex(d => d.entityName === entityName) + 1;
                }
            } else { // Dispatcher mode
                oneWeekEntityData = currentRankedData.find(d => d[groupKey] === entityName);
                if (oneWeekEntityData) {
                    oneWeekRank = currentRankedData.findIndex(d => d[groupKey] === entityName) + 1;
                }
            }

            const fourWeekRank = ranked4Wk.findIndex(d => d.entityName === entityName) + 1;

            if (oneWeekEntityData) {
                computedMetrics.get(entityName).push({
                    date: new Date(dateString),
                    oneWeekCriteria: rankingMode === 'team' ? oneWeekEntityData.mainCriteria_current : oneWeekEntityData.mainCriteria,
                    fourWeekCriteria: fourWeekAvgDataForDate?.[entityName]?.mainCriteria || null,
                    oneWeekRank: oneWeekRank > 0 ? oneWeekRank : null,
                    fourWeekRank: fourWeekRank > 0 ? fourWeekRank : null,
                    truckCount: oneWeekEntityData.numDrivers,
                });
            } else {
                computedMetrics.get(entityName).push({
                    date: new Date(dateString),
                    oneWeekCriteria: null,
                    fourWeekCriteria: fourWeekAvgDataForDate?.[entityName]?.mainCriteria || null,
                    oneWeekRank: null,
                    fourWeekRank: fourWeekRank > 0 ? fourWeekRank : null,
                    truckCount: fourWeekAvgDataForDate?.[entityName]?.numDrivers || null,
                });
            }
        });
    });

    if (!appState.precomputationCache[rankingMode]) {
        appState.precomputationCache[rankingMode] = {};
    }
    appState.precomputationCache[rankingMode][driverTypeFilter] = computedMetrics;
};

export const processDataForMode = (isForStubs = false, singleDispatcherName = null) => {
    if (!appState.profiles?.allProcessedDispatchers || appState.profiles.allProcessedDispatchers.length === 0) {
        try { 
            import('../profiles/profiles_ui.js').then(module => {
                if (module.renderTeamProfileUI) module.renderTeamProfileUI();
            });
        } catch(e) {}
    }

    if (!appState.complianceHistoryCalculated && typeof appState.profiles?.calculateComplianceHistoryData === 'function') {
        appState.profiles.calculateComplianceHistoryData();
        appState.complianceHistoryCalculated = true;
    }

    const mode = appState.rankingMode;
    const filteredHistoricalData = getFilteredDataByDriverType(appState.allHistoricalData);

    let currentWeekRawDataAll = filteredHistoricalData.filter(d => d.date.toISOString().split('T')[0] === appState.selectedDate);

    if (isForStubs && singleDispatcherName) {
        currentWeekRawDataAll = currentWeekRawDataAll.filter(d => d.dispatcherName === singleDispatcherName);
    }

    const uniqueDatesDesc = [...new Set(filteredHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const currentDateIndex = uniqueDatesDesc.indexOf(appState.selectedDate);
    const prevWeekDateString = uniqueDatesDesc[currentDateIndex + 1] || null;
    const fourWeeksAgoDateString = uniqueDatesDesc[currentDateIndex + 4] || null;

    if (mode === 'dispatcher' || (isForStubs && appState.rankingMode === 'team')) {
        const groupedByDispatcher = currentWeekRawDataAll.reduce((acc, curr) => {
            if (!acc[curr.dispatcherName]) {
                acc[curr.dispatcherName] = {
                    records: [],
                    totalWeight: 0,
                    totalGross: 0, // NEW
                    totalMiles: 0, // NEW
                };
            }
            acc[curr.dispatcherName].records.push(curr);
            const weight = curr.numDrivers || 0;
            acc[curr.dispatcherName].totalWeight += weight;
            // Sum up the total gross and miles from the raw data
            acc[curr.dispatcherName].totalGross += (curr.pTotal_gross || 0) * weight; // NEW
            acc[curr.dispatcherName].totalMiles += (curr.pAll_miles || 0) * weight;   // NEW
            return acc;
        }, {});

        const consolidatedDispatcherData = Object.values(groupedByDispatcher).map(group => {
            if (group.records.length === 1) {
                const record = group.records[0];
                // Ensure rpmAll is calculated correctly even for single records
                record.rpmAll = (record.pAll_miles || 0) > 0 ? (record.pTotal_gross || 0) / (record.pAll_miles) : 0;
                return record;
            }

            const consolidated = {
                dispatcherName: group.records[0].dispatcherName,
                dispatcherTeam: [...new Set(group.records.map(r => r.dispatcherTeam))].join(', '),
                date: group.records[0].date,
                numDrivers: group.records.reduce((sum, r) => sum + (r.numDrivers || 0), 0),
                numOOs: group.records.reduce((sum, r) => sum + (r.numOOs || 0), 0),
                numLOOs: group.records.reduce((sum, r) => sum + (r.numLOOs || 0), 0),
                driverNames: [...new Set(group.records.flatMap(r => r.driverNames || []))],
                stubs: group.records.flatMap(r => r.stubs || []),
            };

            coreMetrics.forEach(metric => {
                // Keep the original weighted average for all metrics except rpmAll
                if (metric.id !== 'rpmAll') {
                    const weightedSum = group.records.reduce((sum, r) => {
                        const value = r[metric.id];
                        const weight = r.numDrivers || 0;
                        return sum + ((typeof value === 'number' ? value : 0) * weight);
                    }, 0);
                    consolidated[metric.id] = group.totalWeight > 0 ? weightedSum / group.totalWeight : 0;
                }
            });
            
            // Explicitly calculate rpmAll from the summed totals
            consolidated.rpmAll = group.totalMiles > 0 ? group.totalGross / group.totalMiles : 0; // NEW

            const weightedCompliance = group.records.reduce((sum, r) => sum + ((r.compliance || 0) * (r.numDrivers || 0)), 0);
            consolidated.compliance = group.totalWeight > 0 ? weightedCompliance / group.totalWeight : 0;

            return consolidated;
        });
        
        const prevWeekRawData = getFilteredDataByDriverType(getNWeeksAgoData(appState.selectedDate, 1));
        const fourWeeksAgoRawData = getFilteredDataByDriverType(getNWeeksAgoData(appState.selectedDate, 4));
        const fourWeekAverages = calculateFourWeekAverageDataForDate(appState.selectedDate, 'dispatcher');
        const prevFourWeekAverages = calculateFourWeekAverageDataForDate(prevWeekDateString, 'dispatcher');
        const fourWeeksAgoFourWeekAverages = calculateFourWeekAverageDataForDate(fourWeeksAgoDateString, 'dispatcher');

        const prevWeekRankedData = [...prevWeekRawData]
            .sort((a, b) => (b.mainCriteria || -Infinity) - (a.mainCriteria || -Infinity))
            .map((d, i) => ({ ...d, rank: i + 1 }));

        let processedData = consolidatedDispatcherData.map(currentDispatcher => {
            const combinedData = { ...currentDispatcher, entityName: currentDispatcher.dispatcherName };
            coreMetrics.forEach(m => combinedData[`${m.id}_current`] = currentDispatcher[m.id]);

           const avg4wk = fourWeekAverages[currentDispatcher.dispatcherName];
        coreMetrics.forEach(m => combinedData[`${m.id}_4wkAvg`] = avg4wk ? avg4wk[m.id] : null);
        ['numDrivers', 'numOOs', 'numLOOs'].forEach(col => combinedData[`${col}_4wkAvg`] = avg4wk ? avg4wk[col] : null);

        const fhDispatchers = appState.profiles?.allProcessedDispatchers || [];
        const fhDisp = fhDispatchers.find(d => d.name.toLowerCase() === currentDispatcher.dispatcherName.toLowerCase());
        
        if (fhDisp && typeof fhDisp.complianceScore === 'number' && !isNaN(fhDisp.complianceScore)) {
            combinedData.compliance_current = fhDisp.complianceScore / 100;
        } else {
            combinedData.compliance_current = currentDispatcher.compliance;
        }
        
        const relevantDates = uniqueDatesDesc.slice(currentDateIndex, currentDateIndex + 4);
        const compHistory = appState.allHistoricalData.filter(d => 
            d.dispatcherName === currentDispatcher.dispatcherName && 
            relevantDates.includes(d.date.toISOString().split('T')[0])
        );
        
        combinedData.compliance_4wkAvg = avg4wk && typeof avg4wk.compliance === 'number' ? avg4wk.compliance : null;
        
        combinedData.weeksIncluded_4wkAvg = avg4wk ? avg4wk.weeksIncluded : null;

        const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
        const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
        const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;

        const dCurr = combinedData.pMainCriteriaNetDriverMargin_current || 0;
        const cCurr = combinedData.pMainCriteria2CashFlow_current || 0;
        const compCurr = combinedData.compliance_current || 0;
        combinedData.mainCriteria_current = (dCurr * wDriver) + (cCurr * wCompany) + (compCurr * wCompliance);

        if (combinedData.pMainCriteriaNetDriverMargin_4wkAvg !== null) {
            const d4w = combinedData.pMainCriteriaNetDriverMargin_4wkAvg || 0;
            const c4w = combinedData.pMainCriteria2CashFlow_4wkAvg || 0;
            const comp4w = combinedData.compliance_4wkAvg || 0;
            combinedData.mainCriteria_4wkAvg = (d4w * wDriver) + (c4w * wCompany) + (comp4w * wCompliance);
        }

        const prevDispatcher = prevWeekRankedData.find(d => d.dispatcherName === currentDispatcher.dispatcherName);
            combinedData.prevRank = prevDispatcher ? prevDispatcher.rank : null;

            const prevDispatcherData = prevWeekRawData.find(d => d.dispatcherName === currentDispatcher.dispatcherName);
            const fourWeeksAgoDispatcherData = fourWeeksAgoRawData.find(d => d.dispatcherName === currentDispatcher.dispatcherName);
            const prev4wkAvgData = prevFourWeekAverages[currentDispatcher.dispatcherName];
            const fourWksAgo4wkAvgData = fourWeeksAgoFourWeekAverages[currentDispatcher.dispatcherName];

            combinedData.mainCriteria_1wkChange = (combinedData.mainCriteria_current && prevDispatcherData?.mainCriteria) ? combinedData.mainCriteria_current - prevDispatcherData.mainCriteria : null;
            combinedData.mainCriteria_1wkChange_4wksAgo = (combinedData.mainCriteria_current && fourWeeksAgoDispatcherData?.mainCriteria) ? combinedData.mainCriteria_current - fourWeeksAgoDispatcherData.mainCriteria : null;
            combinedData.mainCriteria_4wkAvg_1wkChange = (combinedData.mainCriteria_4wkAvg && prev4wkAvgData?.mainCriteria) ? combinedData.mainCriteria_4wkAvg - prev4wkAvgData.mainCriteria : null;
            combinedData.mainCriteria_4wkAvg_4wkChange = (combinedData.mainCriteria_4wkAvg && fourWksAgo4wkAvgData?.mainCriteria) ? combinedData.mainCriteria_4wkAvg - fourWksAgo4wkAvgData.mainCriteria : null;

            // --- Regional Movement Calculation ---
            const regionStats = calculateRegionalPercentages(currentDispatcher.dispatcherName, appState.selectedDate);
            Object.assign(combinedData, regionStats);
            // ------------------------------------

            return combinedData;
        });

        const criteriaValues = processedData
            .map(d => d.mainCriteria_4wkAvg)
            .filter(v => typeof v === 'number' && !isNaN(v))
            .sort((a, b) => a - b);

        const total = criteriaValues.length;
        processedData.forEach(d => {
            const value = d.mainCriteria_4wkAvg;
            if (typeof value !== 'number' || isNaN(value)) {
                d.statusColor = 'gray';
                return;
            }
            const rank = criteriaValues.indexOf(value);
            const percentile = (rank / (total - 1));

            if (percentile <= 0.4) d.statusColor = '#ef4444';
            else if (percentile <= 0.7) d.statusColor = '#fb923c';
            else d.statusColor = '#22c55e';
        });

        if (isForStubs) return processedData;

        appState.data = processedData;
        const dispatcherRanks = new Map(processedData.sort((a, b) => (b.mainCriteria_current || -Infinity) - (a.mainCriteria_current || -Infinity)).map((d, i) => [d.entityName, i + 1]));
        appState.unfilteredRanks = dispatcherRanks;
        appState.data.forEach(d => d._sortRank = dispatcherRanks.get(d.entityName) || Infinity);

    } else if (mode === 'team') {
        const prevWeekRawData = getFilteredDataByDriverType(getNWeeksAgoData(appState.selectedDate, 1));
        const fourWeeksAgoRawData = getFilteredDataByDriverType(getNWeeksAgoData(appState.selectedDate, 4));

        const currentTeamData = aggregateTeamData(currentWeekRawDataAll);
        const prevWeekTeamData = aggregateTeamData(prevWeekRawData);
        const fourWeeksAgoTeamData = aggregateTeamData(fourWeeksAgoRawData);

        const fourWeekAverages = calculateFourWeekAverageDataForDate(appState.selectedDate, 'team');
        const prevFourWeekAverages = calculateFourWeekAverageDataForDate(prevWeekDateString, 'team');
        const fourWeeksAgoFourWeekAverages = calculateFourWeekAverageDataForDate(fourWeeksAgoDateString, 'team');

        const prevWeekTeamRanks = new Map(
            prevWeekTeamData
            .sort((a, b) => (b.mainCriteria_current || -Infinity) - (a.mainCriteria_current || -Infinity))
            .map((team, i) => [team.entityName, i + 1])
        );

        appState.data = currentTeamData.map(team => {
            const team4wkAvg = fourWeekAverages[team.entityName];
            coreMetrics.forEach(m => team[`${m.id}_4wkAvg`] = team4wkAvg ? team4wkAvg[m.id] : null);
           ['numDrivers', 'numOOs', 'numLOOs'].forEach(col => team[`${col}_4wkAvg`] = team4wkAvg ? team4wkAvg[col] : null);

            const fhDispatchers = appState.profiles?.allProcessedDispatchers || [];
            if (fhDispatchers.length > 0) {
                const dispatchersInThisTeam = [...new Set(currentWeekRawDataAll.filter(d => d.dispatcherTeam === team.entityName && d.dispatcherName).map(d => String(d.dispatcherName).toLowerCase()))];
                const teamDispatchers = fhDispatchers.filter(d => dispatchersInThisTeam.includes(String(d.name).toLowerCase()));
                
               if (teamDispatchers.length > 0) {
                    const validScores = teamDispatchers.map(d => d.complianceScore).filter(s => typeof s === 'number' && !isNaN(s));
                    if (validScores.length > 0) {
                        team.compliance_current = (validScores.reduce((sum, val) => sum + val, 0) / validScores.length) / 100;
                    }
                }
            }
            
            const relevantDates = uniqueDatesDesc.slice(currentDateIndex, currentDateIndex + 4);
            const teamHistory = appState.allHistoricalData.filter(d => 
                d.dispatcherTeam === team.entityName && 
                relevantDates.includes(d.date.toISOString().split('T')[0])
            );
            
            team.compliance_4wkAvg = team4wkAvg && typeof team4wkAvg.compliance === 'number' ? team4wkAvg.compliance : null;

            const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
            const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
            const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;
            
            const tDCurr = team.pMainCriteriaNetDriverMargin_current || 0;
            const tCCurr = team.pMainCriteria2CashFlow_current || 0;
            const tCompCurr = team.compliance_current || 0;
            team.mainCriteria_current = (tDCurr * wDriver) + (tCCurr * wCompany) + (tCompCurr * wCompliance);

            if (team.pMainCriteriaNetDriverMargin_4wkAvg !== null) {
                const td4w = team.pMainCriteriaNetDriverMargin_4wkAvg || 0;
                const tc4w = team.pMainCriteria2CashFlow_4wkAvg || 0;
                const tcomp4w = team.compliance_4wkAvg || 0;
                team.mainCriteria_4wkAvg = (td4w * wDriver) + (tc4w * wCompany) + (tcomp4w * wCompliance);
            }

            const prevTeam = prevWeekTeamData.find(t => t.entityName === team.entityName);
            const fourWeeksAgoTeam = fourWeeksAgoTeamData.find(t => t.entityName === team.entityName);
            const prev4wkAvgData = prevFourWeekAverages[team.entityName];
            const fourWksAgo4wkAvgData = fourWeeksAgoFourWeekAverages[team.entityName];

            team.mainCriteria_1wkChange = (team.mainCriteria_current && prevTeam?.mainCriteria_current) ? team.mainCriteria_current - prevTeam.mainCriteria_current : null;
            team.mainCriteria_1wkChange_4wksAgo = (team.mainCriteria_current && fourWeeksAgoTeam?.mainCriteria_current) ? team.mainCriteria_current - fourWeeksAgoTeam.mainCriteria_current : null;
            team.mainCriteria_4wkAvg_1wkChange = (team.mainCriteria_4wkAvg && prev4wkAvgData?.mainCriteria) ? team.mainCriteria_4wkAvg - prev4wkAvgData.mainCriteria : null;
            team.mainCriteria_4wkAvg_4wkChange = (team.mainCriteria_4wkAvg && fourWksAgo4wkAvgData?.mainCriteria) ? team.mainCriteria_4wkAvg - fourWksAgo4wkAvgData.mainCriteria : null;
            team.prevRank = prevWeekTeamRanks.get(team.entityName) || null;
            
            // --- NEW: Calculate Region Stats for Team ---
            const regionStats = calculateRegionalPercentages(team.entityName, appState.selectedDate, 'team');
            Object.assign(team, regionStats);
            // --------------------------------------------

            return team;
        });

        const teamRanks = new Map(
            appState.data
            .sort((a, b) => (b.mainCriteria_current || -Infinity) - (a.mainCriteria_current || -Infinity))
            .map((team, i) => [team.entityName, i + 1])
        );

        appState.unfilteredRanks = teamRanks;
        appState.data.forEach(d => d._sortRank = teamRanks.get(d.entityName) || Infinity);
    }
};

// WITH THIS
export const aggregateTeamData = (rawData) => {
    const groupedByTeam = rawData.reduce((acc, curr) => {
        if (!curr.dispatcherTeam) return acc;
        if (!acc[curr.dispatcherTeam]) {
            acc[curr.dispatcherTeam] = {
                entityName: curr.dispatcherTeam,
                dispatcherTeam: curr.dispatcherTeam,
                numDrivers: 0,
                numOOs: 0,
                numLOOs: 0,
                    driverNames: new Set(),
                    dispatchers: new Set(),
                    companies: new Set(),
                sum_pAll_miles: 0,
                sum_pDriver_gross_dollar: 0,
                sum_pMargin_dollar: 0,
                sum_pTotal_gross: 0,
                sum_pEstimated_net: 0,
                sum_pLoaded_miles: 0,
                sum_pDefault_fuel: 0,
                sum_pEstimated_fuel: 0,
                sum_pEstimated_tolls: 0,
                sum_pMaintenance: 0,
                sum_pDepreciation: 0,
                weighted_pMainCriteriaNetDriverMargin: { sum: 0, totalWeight: 0 },
                weighted_pMainCriteria2CashFlow: { sum: 0, totalWeight: 0 },
                weighted_pDriverGross_percent: { sum: 0, totalWeight: 0 },
                weighted_pNet_percent: { sum: 0, totalWeight: 0 },
                weighted_pMargin_percent: { sum: 0, totalWeight: 0 },
                weighted_pMileage_percent: { sum: 0, totalWeight: 0 },
                complianceMap: new Map(),
            };
        }
        
        const team = acc[curr.dispatcherTeam];
        const weight = curr.numDrivers > 0 ? curr.numDrivers : 1;
        const numDriversForRecord = curr.numDrivers || 0;

        team.numDrivers += numDriversForRecord;
        team.numOOs += curr.numOOs || 0;
        team.numLOOs += curr.numLOOs || 0;
        (curr.driverNames || []).forEach(name => team.driverNames.add(name));
        team.dispatchers.add(curr.dispatcherName);
        const compName = curr.company_name || curr.company || curr.Company;
        if (compName && compName !== '-') team.companies.add(compName);

        // Correctly calculate TOTALS by multiplying per-driver-averages by the driver count for each record
        team.sum_pAll_miles += (curr.pAll_miles || 0) * numDriversForRecord;
        team.sum_pDriver_gross_dollar += (curr.pDriver_gross || 0) * numDriversForRecord;
        team.sum_pMargin_dollar += (curr.pMargin_dollar || 0) * numDriversForRecord;
        team.sum_pTotal_gross += (curr.pTotal_gross || 0) * numDriversForRecord;
        team.sum_pEstimated_net += (curr.pEstimated_net || 0) * numDriversForRecord;
        team.sum_pLoaded_miles += (curr.pLoaded_miles || 0) * numDriversForRecord;
        team.sum_pDefault_fuel += (curr.pDefault_fuel || 0) * numDriversForRecord;
        team.sum_pEstimated_fuel += (curr.pEstimated_fuel || 0) * numDriversForRecord;
        team.sum_pEstimated_tolls += (curr.pEstimated_tolls || 0) * numDriversForRecord;
        team.sum_pMaintenance += (curr.pMaintenance || 0) * numDriversForRecord;
        team.sum_pDepreciation += (curr.pDepreciation || 0) * numDriversForRecord;

        // Weighted averages for percentage-based metrics
        if (typeof curr.pMainCriteriaNetDriverMargin === 'number') {
            team.weighted_pMainCriteriaNetDriverMargin.sum += curr.pMainCriteriaNetDriverMargin * weight;
            team.weighted_pMainCriteriaNetDriverMargin.totalWeight += weight;
        }
        if (typeof curr.pMainCriteria2CashFlow === 'number') {
            team.weighted_pMainCriteria2CashFlow.sum += curr.pMainCriteria2CashFlow * weight;
            team.weighted_pMainCriteria2CashFlow.totalWeight += weight;
        }
        if (typeof curr.pDriverGross === 'number') {
            team.weighted_pDriverGross_percent.sum += curr.pDriverGross * weight;
            team.weighted_pDriverGross_percent.totalWeight += weight;
        }
        if (typeof curr.pNet === 'number') {
            team.weighted_pNet_percent.sum += curr.pNet * weight;
            team.weighted_pNet_percent.totalWeight += weight;
        }
        if (typeof curr.pMargin === 'number') {
            team.weighted_pMargin_percent.sum += curr.pMargin * weight;
            team.weighted_pMargin_percent.totalWeight += weight;
        }
        // Added Mileage calculation
        if (typeof curr.pMileage === 'number') {
            team.weighted_pMileage_percent.sum += curr.pMileage * weight;
            team.weighted_pMileage_percent.totalWeight += weight;
        }
        if (typeof curr.compliance === 'number' && isFinite(curr.compliance)) {
            const dNameKey = curr.dispatcherName ? String(curr.dispatcherName).trim().toLowerCase() : null;
            if (dNameKey && !team.complianceMap.has(dNameKey)) {
                team.complianceMap.set(dNameKey, curr.compliance);
            }
        }
        return acc;
    }, {});

    return Object.values(groupedByTeam).map(team => {
        const finalTeamData = { ...team };
        const totalDrivers = team.numDrivers;

        finalTeamData.numDispatchers = team.dispatchers.size;
        finalTeamData.driverNames = [...team.driverNames];
        finalTeamData.companyNames = [...team.companies];
        
        // --- Per-Driver Averages for raw values ---
        finalTeamData['pAll_miles_current'] = totalDrivers > 0 ? team.sum_pAll_miles / totalDrivers : 0;
        finalTeamData['pDriver_gross_current'] = totalDrivers > 0 ? team.sum_pDriver_gross_dollar / totalDrivers : 0;
        finalTeamData['pMargin_dollar_current'] = totalDrivers > 0 ? team.sum_pMargin_dollar / totalDrivers : 0;
        finalTeamData['pTotal_gross_current'] = totalDrivers > 0 ? team.sum_pTotal_gross / totalDrivers : 0;
        finalTeamData['pEstimated_net_current'] = totalDrivers > 0 ? team.sum_pEstimated_net / totalDrivers : 0;
        // ** START: ADDED MISSING METRICS **
        finalTeamData['pLoaded_miles_current'] = totalDrivers > 0 ? team.sum_pLoaded_miles / totalDrivers : 0;
        finalTeamData['pDefault_fuel_current'] = totalDrivers > 0 ? team.sum_pDefault_fuel / totalDrivers : 0;
        finalTeamData['pEstimated_fuel_current'] = totalDrivers > 0 ? team.sum_pEstimated_fuel / totalDrivers : 0;
        finalTeamData['pEstimated_tolls_current'] = totalDrivers > 0 ? team.sum_pEstimated_tolls / totalDrivers : 0;
        finalTeamData['pMaintenance_current'] = totalDrivers > 0 ? team.sum_pMaintenance / totalDrivers : 0;
        finalTeamData['pDepreciation_current'] = totalDrivers > 0 ? team.sum_pDepreciation / totalDrivers : 0;
        // ** END: ADDED MISSING METRICS **

        // --- Team-Wide Ratios (calculated from true totals) ---
        finalTeamData['rpmAll_current'] = team.sum_pAll_miles > 0 ? team.sum_pTotal_gross / team.sum_pAll_miles : 0;
        finalTeamData['pDriver_rpm_current'] = team.sum_pLoaded_miles > 0 ? team.sum_pDriver_gross_dollar / team.sum_pLoaded_miles : 0;

        // --- Weighted Averages (for metrics that are already percentages) ---
        finalTeamData['pMargin_current'] = team.weighted_pMargin_percent.totalWeight > 0 ? team.weighted_pMargin_percent.sum / team.weighted_pMargin_percent.totalWeight : 0;
        finalTeamData['pNet_current'] = team.weighted_pNet_percent.totalWeight > 0 ? team.weighted_pNet_percent.sum / team.weighted_pNet_percent.totalWeight : 0;
        finalTeamData['pDriverGross_current'] = team.weighted_pDriverGross_percent.totalWeight > 0 ? team.weighted_pDriverGross_percent.sum / team.weighted_pDriverGross_percent.totalWeight : 0;
        finalTeamData['pMileage_current'] = team.weighted_pMileage_percent.totalWeight > 0 ? team.weighted_pMileage_percent.sum / team.weighted_pMileage_percent.totalWeight : 0;
        const complianceValues = Array.from(team.complianceMap.values()).filter(c => typeof c === 'number' && isFinite(c));
        finalTeamData['compliance_current'] = complianceValues.length > 0 ? (complianceValues.reduce((sum, val) => sum + val, 0) / complianceValues.length) : 0;

        const driverHappiness = team.weighted_pMainCriteriaNetDriverMargin.totalWeight > 0 ? team.weighted_pMainCriteriaNetDriverMargin.sum / team.weighted_pMainCriteriaNetDriverMargin.totalWeight : 0;
        const companyHappiness = team.weighted_pMainCriteria2CashFlow.totalWeight > 0 ? team.weighted_pMainCriteria2CashFlow.sum / team.weighted_pMainCriteria2CashFlow.totalWeight : 0;
        finalTeamData['pMainCriteriaNetDriverMargin_current'] = driverHappiness;
        finalTeamData['pMainCriteria2CashFlow_current'] = companyHappiness;
        const complianceVal = finalTeamData['compliance_current'] || 0;
        const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
        const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
        const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;
        finalTeamData['mainCriteria_current'] = (driverHappiness * wDriver) + (companyHappiness * wCompany) + (complianceVal * wCompliance);

        Object.keys(finalTeamData).forEach(key => {
            if (key.startsWith('sum_') || key.startsWith('weighted_')) {
                delete finalTeamData[key];
            }
        });
        delete finalTeamData.dispatchers;
        delete finalTeamData.complianceMap;

        return finalTeamData;
    });
};

export const calculateConsistentlyLowPerformers = () => {
    // Step 1: Define the 4-week window to determine activity.
    const allUniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = allUniqueDates.indexOf(appState.selectedDate);
    if (selectedDateIndex === -1) return [];
    const fourWeekDateStrings = allUniqueDates.slice(selectedDateIndex, selectedDateIndex + 4);

    // Step 2: Create a list of dispatchers/teams active in that 4-week window.
    const groupKey = appState.rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
    const activeEntities = new Set(
        appState.allHistoricalData
            .filter(d => fourWeekDateStrings.includes(d.date.toISOString().split('T')[0]))
            .map(d => d[groupKey])
            .filter(Boolean)
    );

    const metricHistory = getFilteredDataByDriverType(appState.allHistoricalData).filter(d => d[appState.lowPerformanceMetric] !== undefined);
    const metricInfo = coreMetrics.find(m => m.id === appState.lowPerformanceMetric);
    if (!metricInfo) return [];

    let relevantHistoryForLowPerformers = metricHistory;
    if (appState.lowPerfHistoryLookback === 'specificWeeks' && appState.lowPerfHistorySpecificWeeks) {
        const uniqueDatesInHistory = [...new Set(metricHistory.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
        const relevantUniqueDates = uniqueDatesInHistory.slice(selectedDateIndex, selectedDateIndex + appState.lowPerfHistorySpecificWeeks);
        relevantHistoryForLowPerformers = metricHistory.filter(d => relevantUniqueDates.includes(d.date.toISOString().split('T')[0]));
    } else if (appState.lowPerfHistoryLookback === 'allTime') {
        const endDate = new Date(appState.selectedDate);
        relevantHistoryForLowPerformers = metricHistory.filter(d => d.date.getTime() <= endDate.getTime());
    }

    // Step 3: Pre-filter the history to ONLY include active entities before calculations.
    const activeEntityHistory = relevantHistoryForLowPerformers.filter(d => activeEntities.has(d[groupKey]));

    const entityDailyMetrics = activeEntityHistory.reduce((acc, curr) => {
        const key = curr[groupKey];
        if (!key) return acc;
        if (!acc[key]) {
            acc[key] = [];
        }
        const val = typeof curr[appState.lowPerformanceMetric] === 'number' && !isNaN(curr[appState.lowPerformanceMetric]) ? curr[appState.lowPerformanceMetric] : null;
        if (val !== null) {
            acc[key].push({ date: curr.date, value: val });
        }
        return acc;
    }, {});

    const lowPerformers = [];
    const lowPerformerThresholdFactor = appState.lowPerformerThreshold / 100;

    for (const entityName in entityDailyMetrics) {
        const dailyData = entityDailyMetrics[entityName].sort((a, b) => a.date.getTime() - b.date.getTime());
        const relevantDaysCount = dailyData.length;
        if (relevantDaysCount === 0) continue;

        let lowDaysCount = 0;
        dailyData.forEach(day => {
            const allMetricsForDay = appState.allHistoricalData
                .filter(d => d.date.getTime() === day.date.getTime() && typeof d[appState.lowPerformanceMetric] === 'number' && !isNaN(d[appState.lowPerformanceMetric]))
                .map(d => d[appState.lowPerformanceMetric]);
            if (allMetricsForDay.length === 0) return;

            const sortedMetrics = [...allMetricsForDay].sort((a, b) => a - b);
            let percentileValue;

            if (metricInfo.lowerIsWorse) {
                const percentileIndex = Math.floor(lowPerformerThresholdFactor * sortedMetrics.length);
                percentileValue = sortedMetrics[percentileIndex];
                if (day.value <= percentileValue) {
                    lowDaysCount++;
                }
            } else {
                const percentileIndex = Math.floor((1 - lowPerformerThresholdFactor) * sortedMetrics.length);
                percentileValue = sortedMetrics[percentileIndex];
                if (day.value >= percentileValue) {
                    lowDaysCount++;
                }
            }
        });
        
        const minDaysThresholdFactor = appState.minLowDaysThreshold / 100;
        const requiredLowDays = Math.ceil(relevantDaysCount * minDaysThresholdFactor);

        if (lowDaysCount >= requiredLowDays && lowDaysCount > 0) {
            const currentEntityData = appState.data.find(d => d.entityName === entityName);
            lowPerformers.push({
                id: `${entityName}-low-${appState.lowPerformanceMetric}`,
                name: entityName,
                lowDaysCount: lowDaysCount,
                totalDays: relevantDaysCount,
                currentValue: currentEntityData ? currentEntityData[`${appState.lowPerformanceMetric}_current`] : null,
                currentRank: appState.unfilteredRanks.get(entityName) || '-',
                metricLabel: metricInfo.label,
                unit: metricInfo.unit,
            });
        }
    }
    return lowPerformers.sort((a, b) => b.lowDaysCount - a.lowDaysCount);
};

export const calculatePerformanceDrops = () => {
    const metricInfo = coreMetrics.find(m => {
        const baseId = appState.deviationMetric.replace('_4wkAvg', '');
        return m.id === baseId;
    });
    if (!metricInfo) return [];

    const drops = [];
    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);
    const groupKey = appState.rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';

    // Group all historical data by entity (dispatcher or team)
    const groupedByEntity = dataToUse.reduce((acc, curr) => {
        const key = curr[groupKey];
        if (!key) return acc;
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(curr);
        return acc;
    }, {});

    // This helper function consolidates data for a specific entity on a specific date,
    // exactly like the main table does.
    const getConsolidatedMetricForDate = (entityHistory, dateString, metricId) => {
        const recordsForDate = entityHistory.filter(d => d.date.toISOString().split('T')[0] === dateString);
        if (recordsForDate.length === 0) return null;
        if (recordsForDate.length === 1) return recordsForDate[0][metricId];

        // If multiple records exist (e.g., dispatcher with OO and LOO), consolidate them
        const totalWeight = recordsForDate.reduce((sum, r) => sum + (r.numDrivers || 0), 0);
        if (totalWeight === 0) return recordsForDate[0][metricId]; // Fallback if no drivers

        const weightedSum = recordsForDate.reduce((sum, r) => {
            const value = r[metricId];
            const weight = r.numDrivers || 0;
            return sum + ((typeof value === 'number' ? value : 0) * weight);
        }, 0);

        return weightedSum / totalWeight;
    };


    for (const entityName in groupedByEntity) {
        const entityHistory = groupedByEntity[entityName];
        const currentEntityProcessedData = appState.data.find(d => d.entityName === entityName);
        if (!currentEntityProcessedData) continue;

        const currentMetricKey = appState.deviationMetric.endsWith('_4wkAvg') ?
                                 appState.deviationMetric :
                                 `${appState.deviationMetric}_current`;
        const currentDayValue = currentEntityProcessedData[currentMetricKey];
        const currentRank = currentEntityProcessedData._sortRank;

        if (typeof currentDayValue !== 'number' || isNaN(currentDayValue)) continue;

        const allUniqueDatesForEntity = [...new Set(entityHistory.map(d => d.date.toISOString().split('T')[0]))].sort((a, b) => new Date(b) - new Date(a));
        const currentDateIndex = allUniqueDatesForEntity.indexOf(appState.selectedDate);
        if (currentDateIndex === -1) continue;

        let historicalDatesForAverage = [];
        if (appState.dropHistoryLookback === 'allTime') {
            historicalDatesForAverage = allUniqueDatesForEntity.slice(currentDateIndex + 1);
        } else if (appState.dropHistoryLookback === 'specificWeeks' && appState.dropHistorySpecificWeeks > 0) {
            historicalDatesForAverage = allUniqueDatesForEntity.slice(currentDateIndex + 1, currentDateIndex + 1 + appState.dropHistorySpecificWeeks);
        }

        if (historicalDatesForAverage.length === 0) continue;

        const baseMetricIdForAverage = appState.deviationMetric.replace('_4wkAvg', '');
        
        // **THIS IS THE CORE FIX**:
        // Instead of just grabbing raw values, we now calculate the consolidated value for each historical date.
        const consolidatedHistoricalValues = historicalDatesForAverage.map(dateString =>
            getConsolidatedMetricForDate(entityHistory, dateString, baseMetricIdForAverage)
        ).filter(val => typeof val === 'number' && !isNaN(val));


        if (consolidatedHistoricalValues.length === 0) continue;

        const averageValue = consolidatedHistoricalValues.reduce((sum, val) => sum + val, 0) / consolidatedHistoricalValues.length;

        let deviation = 0;
        if (averageValue !== 0) {
            deviation = ((currentDayValue - averageValue) / averageValue) * 100;
        }

        const lowerIsWorse = metricInfo.lowerIsWorse !== false; // Default to true

        if ((lowerIsWorse && deviation <= -appState.deviationThreshold) || (!lowerIsWorse && deviation >= appState.deviationThreshold)) {
            drops.push({
                id: `${entityName}-drop-${appState.deviationMetric}`,
                name: entityName,
                currentValue: currentDayValue,
                averageValue: averageValue,
                deviation: deviation,
                metricLabel: metricInfo.label,
                unit: metricInfo.unit,
                currentRank: currentRank,
            });
        }
    }

    return drops.sort((a, b) => {
        if (metricInfo && metricInfo.lowerIsWorse !== false) {
            return a.deviation - b.deviation; // Most negative is worst
        } else {
            return b.deviation - a.deviation; // Most positive is worst
        }
    });
};

export const calculateTrendingData = () => {
    const activeEntities = new Set(appState.data.map(d => d.entityName));
    const groupKey = appState.rankingMode === 'team' ? 'dispatcherTeam' : 'dispatcherName';
    const allTrends = [];

    const uniqueDates = [...new Set(appState.allHistoricalData.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(appState.selectedDate);

    const totalTrendPeriod = appState.trendOlderPeriod + appState.trendRecentPeriod;

    if (selectedDateIndex === -1 || (selectedDateIndex + totalTrendPeriod) > uniqueDates.length) {
        return { trendingUp: [], trendingDown: [] };
    }

    const trendDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + totalTrendPeriod);
    const historicalDataForTrend = appState.allHistoricalData.filter(d => trendDateStrings.includes(d.date.toISOString().split('T')[0]));

    const metricsToAnalyze = appState.trendAnalysisMetric === 'overall' ? coreMetrics : [coreMetrics.find(m => m.id === appState.trendAnalysisMetric)];

    activeEntities.forEach(entityName => {
        let entityTrends = [];

        metricsToAnalyze.forEach(metric => {
            if (!metric) return;

            // ** THE FIX STARTS HERE **
            // Keep the full data point (including numDrivers) for weighting
            const entityMetricHistory = historicalDataForTrend
                .filter(d => d[groupKey] === entityName && typeof d[metric.id] === 'number' && !isNaN(d[metric.id]))
                .map(d => ({ 
                    date: d.date.toISOString().split('T')[0], 
                    value: d[metric.id],
                    weight: d.numDrivers || 1 // Use numDrivers as the weight, default to 1
                }));

            const olderPeriodDates = trendDateStrings.slice(appState.trendRecentPeriod, totalTrendPeriod);
            const recentPeriodDates = trendDateStrings.slice(0, appState.trendRecentPeriod);

            const olderEntries = entityMetricHistory.filter(d => olderPeriodDates.includes(d.date));
            const recentEntries = entityMetricHistory.filter(d => recentPeriodDates.includes(d.date));

            if (olderEntries.length < appState.trendMinOlderStubs || recentEntries.length < appState.trendMinRecentStubs) {
                return;
            }

            // Calculate weighted average for the older period
            const olderSumOfProducts = olderEntries.reduce((sum, entry) => sum + (entry.value * entry.weight), 0);
            const olderSumOfWeights = olderEntries.reduce((sum, entry) => sum + entry.weight, 0);
            const avgOlder = olderSumOfWeights > 0 ? olderSumOfProducts / olderSumOfWeights : 0;

            // Calculate weighted average for the recent period
            const recentSumOfProducts = recentEntries.reduce((sum, entry) => sum + (entry.value * entry.weight), 0);
            const recentSumOfWeights = recentEntries.reduce((sum, entry) => sum + entry.weight, 0);
            const avgRecent = recentSumOfWeights > 0 ? recentSumOfProducts / recentSumOfWeights : 0;
            
            // ** THE FIX ENDS HERE **


            if (avgOlder === 0) return;

            const trendValue = avgRecent - avgOlder;
            const trendPercentage = (trendValue / avgOlder) * 100;

            if (Math.abs(trendPercentage) >= appState.trendSignificanceThreshold) {
                entityTrends.push({
                    metricId: metric.id,
                    metricLabel: metric.label,
                    unit: metric.unit,
                    trendValue,
                    trendPercentage,
                    avgOlder: avgOlder,
                    avgRecent: avgRecent,
                    olderPeriodDates: olderPeriodDates,
                    recentPeriodDates: recentPeriodDates
                });
            }
        });

        if (entityTrends.length > 0) {
            const mostSignificantTrend = entityTrends.sort((a, b) => Math.abs(b.trendPercentage) - Math.abs(a.trendPercentage))[0];
            allTrends.push({
                name: entityName,
                ...mostSignificantTrend
            });
        }
    });

    const trendingUp = allTrends.filter(t => t.trendPercentage > 0).sort((a,b) => b.trendPercentage - a.trendPercentage);
    const trendingDown = allTrends.filter(t => t.trendPercentage < 0).sort((a,b) => a.trendPercentage - b.trendPercentage);

    return { trendingUp, trendingDown };
};

export const calculateBumpChartData = () => {
    let bumpMetricInfo = coreMetrics.find(m => m.id === appState.bumpMetric.replace('_4wkAvg', '')) || coreMetrics.find(m => m.id === appState.bumpMetric);
    if (appState.bumpMetric.includes('compliance')) {
        bumpMetricInfo = { id: 'compliance', label: 'Compliance', lowerIsWorse: false, unit: '%' };
        if (!appState.complianceHistoryCalculated && typeof appState.profiles?.calculateComplianceHistoryData === 'function') {
            appState.profiles.calculateComplianceHistoryData();
            appState.complianceHistoryCalculated = true;
        }
    }
    if (!bumpMetricInfo) return [];

    const dataToUse = getFilteredDataByDriverType(appState.allHistoricalData);

    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const selectedDateIndex = uniqueDates.indexOf(appState.selectedDate);
    const relevantDateStrings = uniqueDates.slice(selectedDateIndex, selectedDateIndex + appState.weeksBack);

    const relevantHistory = dataToUse.filter(d => {
        return relevantDateStrings.includes(d.date.toISOString().split('T')[0]);
    });

    const groupedByDate = relevantHistory.reduce((acc, curr) => {
        const dateKey = curr.date.toISOString().split('T')[0];
        if (!acc[dateKey]) {
            acc[dateKey] = { date: new Date(dateKey), entries: [] };
        }
        acc[dateKey].entries.push(curr);
        return acc;
    }, {});

    const dataWithRanks = Object.values(groupedByDate).map(dayData => {
        let dailyMetrics;
        const dateKey = dayData.date.toISOString().split('T')[0];

        if (appState.bumpMetric.endsWith('_4wkAvg')) {
                const precomputedData = calculateFourWeekAverageDataForDate(dateKey, appState.rankingMode, dataToUse);
                dailyMetrics = precomputedData ? Object.entries(precomputedData).map(([entityName, avgData]) => {
                    let val = avgData[appState.bumpMetric.replace('_4wkAvg', '')] ?? null;
                    if (appState.bumpMetric === 'mainCriteria_4wkAvg') {
                        const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
                        const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
                        const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;
                        const d4w = avgData.pMainCriteriaNetDriverMargin || 0;
                        const c4w = avgData.pMainCriteria2CashFlow || 0;
                        const comp4w = avgData.compliance || 0;
                        val = (d4w * wDriver) + (c4w * wCompany) + (comp4w * wCompliance);
                    }
                    if (val !== null && appState.bumpMetric.includes('compliance')) val = val * 100;
                    return { name: entityName, value: val, _filterVal: avgData[appState.minDriverSetting.type] };
                }) : [];
            } else if (appState.rankingMode === 'team') {
                const aggregatedTeams = aggregateTeamData(dayData.entries);
                dailyMetrics = aggregatedTeams.map(teamData => {
                    let val = teamData[`${appState.bumpMetric}_current`] ?? teamData[appState.bumpMetric] ?? null;
                    if (appState.bumpMetric === 'mainCriteria') {
                        val = teamData.mainCriteria_current;
                    }
                   if (val !== null && appState.bumpMetric.includes('compliance')) val = val * 100;
                    return { name: teamData.entityName, value: val, _filterVal: teamData[appState.minDriverSetting.type] };
                });
            } else {
                const groupedByDispatcher = dayData.entries.reduce((acc, curr) => {
                    if (!acc[curr.dispatcherName]) {
                        acc[curr.dispatcherName] = { records: [], totalWeight: 0 };
                    }
                    acc[curr.dispatcherName].records.push(curr);
                    acc[curr.dispatcherName].totalWeight += curr.numDrivers || 0;
                    return acc;
                }, {});
                dailyMetrics = Object.entries(groupedByDispatcher).map(([name, group]) => {
                    let val = null;
                    if (appState.bumpMetric === 'mainCriteria') {
                        const wDriver = (appState.criteriaWeights?.driverHappiness ?? 50) / 100;
                        const wCompany = (appState.criteriaWeights?.companyHappiness ?? 50) / 100;
                        const wCompliance = (appState.criteriaWeights?.compliance ?? 0) / 100;
                        const dCurr = group.totalWeight > 0 ? group.records.reduce((sum, r) => sum + (r.pMainCriteriaNetDriverMargin || 0) * (r.numDrivers || 0), 0) / group.totalWeight : 0;
                        const cCurr = group.totalWeight > 0 ? group.records.reduce((sum, r) => sum + (r.pMainCriteria2CashFlow || 0) * (r.numDrivers || 0), 0) / group.totalWeight : 0;
                        const compCurr = group.totalWeight > 0 ? group.records.reduce((sum, r) => sum + (r.compliance || 0) * (r.numDrivers || 0), 0) / group.totalWeight : 0;
                        val = (dCurr * wDriver) + (cCurr * wCompany) + (compCurr * wCompliance);
                    } else if (appState.bumpMetric === 'rpmAll') {
                        const totalGross = group.records.reduce((sum, r) => sum + (r.pTotal_gross || 0) * (r.numDrivers || 0), 0);
                        const totalMiles = group.records.reduce((sum, r) => sum + (r.pAll_miles || 0) * (r.numDrivers || 0), 0);
                        val = totalMiles > 0 ? totalGross / totalMiles : 0;
                    } else {
                        const sum = group.records.reduce((s, r) => s + (r[appState.bumpMetric] || 0) * (r.numDrivers || 0), 0);
                        val = group.totalWeight > 0 ? sum / group.totalWeight : null;
                    }
                    if (val !== null && appState.bumpMetric.includes('compliance')) val = val * 100;
                    const minType = appState.minDriverSetting.type;
                    let filterVal = null;
                    if (minType !== 'none') {
                        if (minType === 'numDrivers' || minType === 'numOOs' || minType === 'numLOOs') {
                            filterVal = group.records.reduce((sum, r) => sum + (r[minType] || 0), 0);
                        } else {
                            const sum = group.records.reduce((s, r) => s + (r[minType] || 0) * (r.numDrivers || 0), 0);
                            filterVal = group.totalWeight > 0 ? sum / group.totalWeight : null;
                        }
                    }
                    return { name, value: val, _filterVal: filterVal };
                });
            }
        const sortedDayEntries = dailyMetrics
            .filter(entry => {
                if (typeof entry.value !== 'number' || isNaN(entry.value)) return false;
                const minType = appState.minDriverSetting.type;
                const minValue = appState.minDriverSetting.value;
                if (minType !== 'none' && entry._filterVal !== null && entry._filterVal !== undefined) {
                    if (entry._filterVal < minValue) return false;
                }
                return true;
            })
            .sort((a, b) => {
                if (bumpMetricInfo && bumpMetricInfo.lowerIsWorse === false && bumpMetricInfo.id !== 'compliance') {
                    return a.value - b.value;
                }
                return b.value - a.value;
            });

        const ranksAndValues = { date: dayData.date };
        let currentRank = 1;
        let prevValue = null;
        sortedDayEntries.forEach((entry, index) => {
            if (entry.value !== prevValue) {
                currentRank = index + 1;
                prevValue = entry.value;
            }
            ranksAndValues[entry.name] = {
                rank: currentRank,
                value: entry.value
            };
        });
        return ranksAndValues;
    }).sort((a, b) => a.date.getTime() - b.date.getTime());

    return dataWithRanks;
};

export const getFilteredBumpChartEntityNames = () => {
    const user = appState.auth.user;
    const isDispatcher = user && user.role === 'Dispatcher';

    // This function is now the single source of truth for the bump chart's default view.
    let filteredEntityNames;

    if (appState.selectedBumpEntities.length === 0 && appState.data.length > 0) {
        // Default View: Automatically select top 5 based on permissions.
        let dataToConsider = [...appState.data];

        // --- START: NEW LOGIC FOR DISPATCHER IN TEAM MODE ---
        if (isDispatcher && appState.rankingMode === 'team') {
            let dispatcherTeamName = null;
            const dispatcherNameFromAccess = (user.access || [])[0] || (typeof user.access === 'string' ? user.access.split(',')[0].trim() : null);

            if (dispatcherNameFromAccess) {
                // Find the team from the most recent historical data available
                const historicalInfo = appState.allHistoricalData
                    .filter(d => d.dispatcherName?.toLowerCase() === dispatcherNameFromAccess.toLowerCase() && d.dispatcherTeam)
                    .sort((a, b) => b.date - a.date);
                
                if (historicalInfo.length > 0) {
                    dispatcherTeamName = historicalInfo[0].dispatcherTeam;
                }
            }
            
            if (dispatcherTeamName) {
                appState.selectedBumpEntities = [dispatcherTeamName];
                return [dispatcherTeamName];
            }
        }
        // --- END: NEW LOGIC ---

        // 1. Filter the data based on user's access rights first.
        if (!hasPermission(user, PERMISSIONS.VIEW_ALL_TEAMS) && !hasPermission(user, PERMISSIONS.VIEW_ALL_DISPATCHERS)) {
            if (appState.rankingMode === 'team') {
                dataToConsider = dataToConsider.filter(d => canViewTeam(d.entityName));
            } else { // 'dispatcher' mode
                dataToConsider = dataToConsider.filter(d => canViewDispatcher(d.entityName));
            }
        }
        
        // 2. Sort the permission-filtered data and take the top 5.
        filteredEntityNames = dataToConsider
            .sort((a, b) => {
                const aMainCriteria = a.mainCriteria_current || -Infinity;
                const bMainCriteria = b.mainCriteria_current || -Infinity;
                return bMainCriteria - aMainCriteria;
            })
            .slice(0, 5)
            .map(d => d.entityName);

        // 3. CRITICAL FIX: Update the global state with the correctly filtered list.
        appState.selectedBumpEntities = filteredEntityNames;

    } else {
        // Manual Selection View: Use the user's manual selections. This part remains the same.
        const entityList = appState.rankingMode === 'team' ? appState.allTeamNames : appState.allDispatcherNames;
        filteredEntityNames = entityList.filter(name => appState.selectedBumpEntities.includes(name));
    }

    return filteredEntityNames;
};

export const getIndividualEntityChartData = (entityName) => {
    const { rankingMode, driverTypeFilter } = appState;
    const cachedData = appState.precomputationCache[rankingMode]?.[driverTypeFilter];

    if (cachedData) {
        return cachedData.get(entityName) || [];
    }
    
    // Fallback in case cache isn't ready.
    return [];
};


export const getCompanyOrAllTeamsCriteriaHistory = (entityName, entityType, allHistoricalData, numWeeks = 8) => {
    // Get data filtered by the currently selected driver type (OO, LOO, All) first
    const dataToUse = getFilteredDataByDriverType(allHistoricalData);

    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const relevantDates = uniqueDates.slice(0, numWeeks).sort();
    
    return relevantDates.map(dateString => {
        // Filter the already contract-filtered data for the specific date
        let relevantData = dataToUse.filter(d => d.date.toISOString().split('T')[0] === dateString);
        
        if (entityType === 'company') {
            relevantData = relevantData.filter(d => d.company_name === entityName);
        } else if (entityType === 'team') {
            relevantData = relevantData.filter(d => d.dispatcherTeam === entityName);
        }

        const criteriaValues = relevantData.map(d => d.mainCriteria).filter(v => typeof v === 'number' && !isNaN(v));
        
        if (criteriaValues.length === 0) {
            return { date: new Date(dateString), value: null };
        }
        
        const avgCriteria = criteriaValues.reduce((sum, v) => sum + v, 0) / criteriaValues.length;
        return { date: new Date(dateString), value: avgCriteria };
    });
};

export const getTeamRankHistory = (teamName, allHistoricalData, numWeeks = 8) => {
    // Get data filtered by the currently selected driver type (OO, LOO, All)
    const dataToUse = getFilteredDataByDriverType(allHistoricalData);

    const uniqueDates = [...new Set(dataToUse.map(d => d.date.toISOString().split('T')[0]))].sort().reverse();
    const relevantDates = uniqueDates.slice(0, numWeeks).sort();

    const rankHistory = relevantDates.map(dateString => {
        // Filter the already contract-filtered data for the specific date
        const dataForDate = dataToUse.filter(d => d.date.toISOString().split('T')[0] === dateString);
        
        const aggregatedTeamsForDate = aggregateTeamData(dataForDate);

        const rankedData = aggregatedTeamsForDate
            .sort((a, b) => (b.mainCriteria_current || 0) - (a.mainCriteria_current || 0));

        const rank = rankedData.findIndex(d => d.entityName === teamName) + 1;
        const teamDataForDate = rankedData.find(d => d.entityName === teamName);

        return {
            date: new Date(dateString),
            value: rank > 0 ? rank : null,
            criteria: teamDataForDate ? teamDataForDate.mainCriteria_current : null
        };
    });
    return rankHistory;
};
export const saveCriteriaWeights = async (weights) => {
    appState.criteriaWeights = weights;
    appState.precomputationCache = {};
    try {
        await fetch(CRITERIA_APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(weights)
        });
    } catch (e) {}
};