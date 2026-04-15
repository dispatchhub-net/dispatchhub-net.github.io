import { appState } from '../state.js';
import { ProfileCard } from './profile_card.js';
import { CompareView } from './compare_view.js'; 
import { SettingsUI } from './photos_url.js';
import { calculateMedian, getPayrollWeekDateRange } from '../utils.js';
import { LeaderboardUI } from './leaderboard.js';
import { UpdatesUI } from './updates.js';


const LOGO_URLS = {
    'SMJ': 'https://images.squarespace-cdn.com/content/v1/65dcc6ddc23f46020d153086/e0b56a73-e4fc-4812-aaa7-1a2d9b734504/Logo-SMJ.png?format=1500w',
    'EBInfinity': 'https://images.squarespace-cdn.com/content/v1/67734e14b025c127a03e5730/2ed49605-95db-4d98-a715-77c77663dd69/Blue+Modern+Infinity+Loop+Business+Consulting+Logo.png?format=1500w',
    'AmongUs': 'https://images.squarespace-cdn.com/content/v1/67816277ce6fe832dd037896/dbe69b84-b7dc-4b22-a542-0f4d512178b0/AMONG-US-Logo-Icon-horizontal.png?format=1500w',
    'Default': 'https://via.placeholder.com/200x80?text=COMPANY'
};

const SILHOUETTE_ICON = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%231f2937'%3E%3Cpath fill-rule='evenodd' d='M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z' clip-rule='evenodd' /%3E%3C/svg%3E`;

export const DispatchersUI = {
    state: {
        notificationMinimized: false,
        notificationDismissed: false,
        selectedDispatcherId: null,
        rankings: {}, // Stores { name: { best1w: X, best4w: Y } }
        totalDispatchers: 0,
        searchTerm: '',
        // Multiselect Arrays
        activeCompanyFilter: [],
        activeTeamFilter: [],
        advFilters: {
            overall: { min: 0, max: 100 },
            
            // Financials
            gross: { min: 0, max: 100 }, dGross: { min: 0, max: 100 }, margin: { min: 0, max: 100 },
            loadRate: { min: 0, max: 100 }, netPay: { min: 0, max: 100 }, consist: { min: 0, max: 100 },
            
            // Velocity
            rpm: { min: 0, max: 100 }, miles: { min: 0, max: 100 }, loads: { min: 0, max: 100 },
            rpmLoad: { min: 0, max: 100 }, trucks: { min: 0, max: 100 },
            
            // Efficiency
            expense: { min: 0, max: 100 }, weight: { min: 0, max: 100 }, netPct: { min: 0, max: 100 },
            grossPct: { min: 0, max: 100 }, marginPct: { min: 0, max: 100 },
            
            // Operations
            rc: { min: 0, max: 100 }, calc: { min: 0, max: 100 },
ppw: { min: 0, max: 100 }, tue: { min: 0, max: 100 }, overdue: { min: 0, max: 100 }, hidden: { min: 0, max: 100 },
compliance: { min: 0, max: 100 },
            
            // Health
            retention: { min: 0, max: 100 }, tenure: { min: 0, max: 100 }, good: { min: 0, max: 100 },
            bad: { min: 0, max: 100 }, dHappy: { min: 0, max: 100 }, cHappy: { min: 0, max: 100 },
            cancel: { min: 0, max: 100 }, balance: { min: 0, max: 100 }, wellness: { min: 0, max: 100 }
        
        },
        // Tiers Filter
        tiers: { gold: true, silver: true, bronze: true },
        teams: [],
        companies: [],
       stats: {},
        specialFilter: null
    },
renderSliderControl: function(label, key) {
        return `
            <div class="adv-slider-row" id="slider-wrap-${key}" data-key="${key}">
                <div class="slider-header">
                    <span class="slider-label">${label}</span>
                    <span class="slider-val-display" id="disp-${key}">0 - 100</span>
                </div>
                <div class="slider-track-container">
                    <div class="slider-track"></div>
                    <div class="slider-fill" id="fill-${key}"></div>
                    <div class="slider-thumb min-thumb" id="thumb-min-${key}"></div>
                    <div class="slider-thumb max-thumb" id="thumb-max-${key}"></div>
                </div>
            </div>
        `;
    },

    initSliders: function() {
        const sliders = document.querySelectorAll('.adv-slider-row');
        
        sliders.forEach(row => {
            const key = row.getAttribute('data-key');
            
            if (!this.state.advFilters[key]) {
                this.state.advFilters[key] = { min: 0, max: 100 };
            }
            const filterState = this.state.advFilters[key];
            if (filterState.min === undefined) filterState.min = 0;
            if (filterState.max === undefined) filterState.max = 100;

            const minThumb = document.getElementById(`thumb-min-${key}`);
            const maxThumb = document.getElementById(`thumb-max-${key}`);
            const fill = document.getElementById(`fill-${key}`);
            const disp = document.getElementById(`disp-${key}`);
            const track = row.querySelector('.slider-track-container');

            const updateUI = () => {
                const min = filterState.min;
                const max = filterState.max;
                
                minThumb.style.left = `${min}%`;
                maxThumb.style.left = `${max}%`;
                
                fill.style.left = `${min}%`;
                fill.style.width = `${max - min}%`;
                
                disp.textContent = `${min} - ${max}`;
            };

            updateUI();

            const handleDrag = (e, isMin) => {
                e.preventDefault();
                const rect = track.getBoundingClientRect();
                
                const onMove = (moveEvent) => {
                    let clientX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
                    let pct = ((clientX - rect.left) / rect.width) * 100;
                    pct = Math.max(0, Math.min(100, pct));
                    pct = Math.round(pct);

                    if (isMin) {
                        if (pct > filterState.max - 1) pct = filterState.max - 1;
                        filterState.min = pct;
                    } else {
                        if (pct < filterState.min + 1) pct = filterState.min + 1;
                        filterState.max = pct;
                    }
                    updateUI();
                };

                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.removeEventListener('touchmove', onMove);
                    document.removeEventListener('touchend', onUp);
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                document.addEventListener('touchmove', onMove, { passive: false });
                document.addEventListener('touchend', onUp);
            };

            minThumb.onmousedown = (e) => handleDrag(e, true);
            minThumb.ontouchstart = (e) => handleDrag(e, true);
            
            maxThumb.onmousedown = (e) => handleDrag(e, false);
            maxThumb.ontouchstart = (e) => handleDrag(e, false);
        });
    },
    init: function() {
        this.ensureContainerExists();
        const imgUrl = 'https://i.postimg.cc/X7bwQmKM/Loading-Screen-P.png';
        
        const settingsPromise = SettingsUI.init().catch(e => console.error(e));

        const img = new Image();
        img.src = imgUrl;
        
        const startApp = () => {
            settingsPromise.then(() => {
                this.calculateGlobalRankings(); 
                this.processStats(0); 
                this.processStats(1); 
                this.loadData();
                this.renderLayout();
                this.hideLoading();
            });
        };

        img.onload = () => {
            this.renderSkeleton(imgUrl);
            this.showLoading();
            setTimeout(() => requestAnimationFrame(startApp), 50);
        };

        img.onerror = () => {
            startApp();
        };
    },
    loadAllStarScript: function() {
        // Loads All Star for the modal usage, but renders Leaderboard trigger
        if (!document.getElementById('all-star-script')) {
            const script = document.createElement('script');
            script.id = 'all-star-script';
            script.src = 'performance/all_star.js';
            document.body.appendChild(script);
        }
        // Initialize Leaderboard Trigger
        LeaderboardUI.renderTriggerBtn(this);
    },
    renderSkeleton: function(url) {
        const container = document.getElementById('dispatchers-view');
        container.classList.remove('hidden');
        container.style.position = 'relative';
        container.style.pointerEvents = 'none';
        
        container.innerHTML = `
            <div id="perf-skeleton-bg" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url('${url}') center top / cover no-repeat; filter: blur(12px); opacity: 0.8; z-index: 1;"></div>
            <div class="dota-view" style="position: relative; z-index: 2; opacity: 0;"></div>
            <div id="perf-loader" style="position:absolute; top:0; left:0; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:9999; color:white; font-family:sans-serif;">
                <div style="width:80px; height:80px; border:6px solid rgba(255,255,255,0.1); border-top:6px solid #14b8a6; border-radius:50%; animation:perf-spin 1s linear infinite; margin-bottom:25px; box-shadow: 0 0 40px rgba(0,0,0,0.8);"></div>
                <div style="font-family: 'Inter', sans-serif; font-size: 18px; font-weight: 700; letter-spacing: 6px; text-transform: uppercase; color: #fff; text-shadow: 0 4px 15px rgba(0, 0, 0, 1);">Processing Statistics...</div>
                <style>@keyframes perf-spin { to { transform:rotate(360deg); } }</style>
            </div>
        `;
    },

    showLoading: function() {
        const loader = document.getElementById('perf-loader');
        if (loader) loader.style.display = 'flex';
    },

    hideLoading: function() {
        const view = document.getElementById('dispatchers-view');
        if (view) {
            view.style.pointerEvents = 'auto';
            const loader = document.getElementById('perf-loader');
            if (loader) loader.remove();
            const skeletonBg = document.getElementById('perf-skeleton-bg');
            if (skeletonBg) skeletonBg.remove();
            const content = view.querySelector('.dota-view');
            if (content) {
                content.style.opacity = '1';
                content.style.filter = 'none';
            }
        }
    },
    ensureContainerExists: function() {
        let container = document.getElementById('dispatchers-view');
        if (!container) {
            container = document.createElement('div');
            container.id = 'dispatchers-view';
            container.className = 'h-full w-full hidden';
            const app = document.getElementById('app') || document.body;
            app.appendChild(container);
        }
    },

    calculateGlobalRankings: function() {
        const today = new Date();
        const day = today.getUTCDay();
        
        const calendarThu = new Date(today);
        const daysSinceThu = (day + 3) % 7;
        calendarThu.setUTCDate(today.getUTCDate() - daysSinceThu);
        calendarThu.setUTCHours(0, 0, 0, 0);

        const stubs = appState.loads?.historicalStubsData || [];
        const hasPayrollRun = stubs.some(s => {
            if (!s.pay_date) return false;
            const pDate = new Date(s.pay_date);
            pDate.setUTCHours(0, 0, 0, 0);
            return pDate.getTime() === calendarThu.getTime();
        });

        const effectivePayrollThu = new Date(calendarThu);
        if (!hasPayrollRun) {
            effectivePayrollThu.setUTCDate(effectivePayrollThu.getUTCDate() - 7);
        }

        const lastMonday = new Date(effectivePayrollThu);
        lastMonday.setUTCDate(effectivePayrollThu.getUTCDate() - 3);
        lastMonday.setUTCHours(23, 59, 59, 999);
        
        const startWindow = new Date(lastMonday);
        startWindow.setUTCDate(lastMonday.getUTCDate() - (12 * 7)); 

        const helpers = {
            num: (v) => parseFloat(String(v || '0').replace(/[^0-9.-]/g, '')) || 0,
            clean: (s) => String(s || '').trim() 
        };

        const dispatcherStats = {}; 

        if (appState.loads && appState.loads.historicalStubsData) {
            appState.loads.historicalStubsData.forEach(s => {
                if (!s.stub_dispatcher) return;

                const rDate = new Date(s.pay_date);
                if (isNaN(rDate.getTime())) return;

                if (rDate < startWindow || rDate > lastMonday) return;

                const name = s.stub_dispatcher.trim(); 
                if (!dispatcherStats[name]) dispatcherStats[name] = { gross: 0, loads: 0, miles: 0 };

                const g = helpers.num(s.driver_gross || s.gross);
                dispatcherStats[name].gross += g;

                let l = helpers.num(s.load_count || s.loads || s.Load_Count);
                if (l === 0) l = 1; 
                dispatcherStats[name].loads += l;

                const m = helpers.num(s.total_miles || s.miles);
                dispatcherStats[name].miles += m;
            });
        }

        this.state.rankings = dispatcherStats;
    },

    

    processStats: function(weeksBack = 0) {
        if (weeksBack === 0 && this._statsCached && appState.allHistoricalData === this._lastDataRef && this.state.prevStats) return;
        
        if (weeksBack === 0) this._lookups = null;
        const currentStatsMap = {};

        const helpers = {
            clean: (s) => String(s || '').trim().toLowerCase(),
            num: (v) => { 
                if (v === undefined || v === null || v === '') return 0;
                const p = parseFloat(String(v).replace(/[^0-9.-]/g, '')); 
                return isFinite(p) ? p : 0; 
            },
            median: (arr) => {
                if (!arr || arr.length === 0) return 0;
                const s = [...arr].sort((a, b) => a - b);
                const m = Math.floor(s.length / 2);
                return s.length % 2 !== 0 ? s[m] : (s[m - 1] + s[m]) / 2;
            },
            avg: (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
            sum: (arr) => arr.reduce((a, b) => a + b, 0),
            safeDiv: (a, b) => b ? a / b : 0
        };

        // --- 1. CONFIG & HELPERS ---
        const complianceMap = {}; 
        const validScores = {};   
        
        const getMonKey = (d) => {
            const date = new Date(d);
            if (isNaN(date.getTime())) return null;
            const day = date.getUTCDay();
            const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
            return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff)).toISOString().split('T')[0];
        };
        const currentWeekKey = getMonKey(new Date());
        // ---------------------------------------------
        const tDate = new Date();
        if (weeksBack > 0) tDate.setUTCDate(tDate.getUTCDate() - (7 * weeksBack));
        const tDay = tDate.getUTCDay();
        
        const tCalendarThu = new Date(tDate);
        const tDaysSinceThu = (tDay + 3) % 7;
        tCalendarThu.setUTCDate(tDate.getUTCDate() - tDaysSinceThu);
        tCalendarThu.setUTCHours(0, 0, 0, 0);

        const tStubs = appState.loads?.historicalStubsData || [];
        const tHasPayrollRun = tStubs.some(s => {
            if (!s.pay_date) return false;
            const pDate = new Date(s.pay_date);
            pDate.setUTCHours(0, 0, 0, 0);
            return pDate.getTime() === tCalendarThu.getTime();
        });

        const tEffectivePayrollThu = new Date(tCalendarThu);
        if (!tHasPayrollRun) {
            tEffectivePayrollThu.setUTCDate(tEffectivePayrollThu.getUTCDate() - 7);
        }

        const cutoffDate = new Date(tEffectivePayrollThu);
        cutoffDate.setUTCDate(tEffectivePayrollThu.getUTCDate() - 3);
        cutoffDate.setUTCHours(23, 59, 59, 999);
        const lookupStart = new Date(cutoffDate);
lookupStart.setUTCDate(cutoffDate.getUTCDate() - (12 * 7));



const dispatcherCompHistory = {};
        const dispatcherWellHistory = {};
        const weeksToCheck = 12;
        const historicalWeeks = [];
        const complianceWeeklyScores = {};

        let shiftIndex = 0;
        const checkRange = getPayrollWeekDateRange(1);
        const checkEnd = new Date(checkRange.end);
        checkEnd.setUTCHours(23, 59, 59, 999);
        
        if (checkEnd > cutoffDate) {
            shiftIndex = 1;
        }

        // USE CUTOFF DATE TO DETERMINE WEEKS (Respects if Payroll is run or not)
        for (let i = 0; i < weeksToCheck; i++) {
            // End is Cutoff Date minus i weeks
            const wEnd = new Date(cutoffDate);
            wEnd.setUTCDate(wEnd.getUTCDate() - (i * 7));
            wEnd.setUTCHours(23, 59, 59, 999);

            // Start is 6 days before End (Tue-Mon cycle)
            const wStart = new Date(wEnd);
            wStart.setUTCDate(wStart.getUTCDate() - 6);
            wStart.setUTCHours(0, 0, 0, 0);
            
            historicalWeeks.push({ start: wStart, end: wEnd, id: i + 1 });
        }

        historicalWeeks.forEach(week => {
            const { start, end } = week;
            
            const _clean = helpers.clean;
            const _num = helpers.num;
            // -------------------------------------------------------

            const dispatchersInWeek = {}; 

            const ensureDisp = (name) => {
                if (!name) return null;
                const cName = _clean(name);
                if (!dispatchersInWeek[cName]) {
                    dispatchersInWeek[cName] = { 
                        name: name, 
                        // Metrics
                        goodMoves: 0, badMoves: 0, hiddenMiles: 0, lowRpm: 0,
                        tuesdayOpen: 0, missingPaperwork: 0, trailerDrops: 0, trailerRecoveries: 0,
                        overdueLoads: 0, rcEntries: [], calcVisits: 0,
                        // Wellness container
            wellnessValues: [],
            wellnessLoadsCount: 0,
            wellnessPassedCount: 0,
                        // Tenure/Retention
                        retention: null, medianTenureOO: null, medianTenureLOO: null, genTenure: null
                    };
                }
                return dispatchersInWeek[cName];
            };

            // 1. DATA FROM HISTORY 
            if (appState.allHistoricalData) {
                appState.allHistoricalData.forEach(r => {
                    const rDate = new Date(r.date || r.Date || r.created_at);
                    if (isNaN(rDate.getTime()) || rDate < start || rDate > end) return;

                    const d = ensureDisp(r.dispatcherName || r.name || r.dispatcher || r.Dispatcher);
                    if (!d) return;

                    const val = (keys) => { 
                        for(const k of keys) if(r[k]!=null && r[k]!=='') return _num(r[k]); 
                        return null; 
                    };

            
                    const gm = val(['goodMoves', 'Good Moves']); if(gm!==null) d.goodMoves += gm;
                    const bm = val(['badMoves', 'Bad Moves']); if(bm!==null) d.badMoves += bm;
                    
                    const hm = val(['hiddenMiles', 'Hidden Miles']); if(hm!==null) d.hiddenMiles += hm;
                    const lr = val(['lowRpm', 'Low RPM']); if(lr!==null) d.lowRpm += lr;
                    const to = val(['tuesdayOpen', 'Tuesday Open']); if(to!==null) d.tuesdayOpen += to;
                    const mp = val(['missingPaperwork', 'Missing Paperwork']); if(mp!==null) d.missingPaperwork += mp;
                    const td = val(['trailerDrops', 'Trailer Drops']); if(td!==null) d.trailerDrops += td;
                    const tr = val(['trailerRecoveries', 'Trailer Recoveries']); if(tr!==null) d.trailerRecoveries += tr;
                    const ov = val(['overdueLoads', 'Overdue Loads']); if(ov!==null) d.overdueLoads += ov;
                    const wl = val(['wellness', 'Wellness', 'Wellness %']); if(wl!==null) d.wellness = wl;

                    // Tenure & Retention
                    const ret = val(['retention4w', 'Retention']); if(ret!==null) d.retention = ret;
                    const tOO = val(['medianTenureOO', 'Tenure OO']); if(tOO!==null) d.medianTenureOO = tOO;
                    const tLOO = val(['medianTenureLOO', 'Tenure LOO']); if(tLOO!==null) d.medianTenureLOO = tLOO;
                    const rowDispName = r.dispatcherName || r.name || r.dispatcher || r.Dispatcher;
                    if (rowDispName) {
                        const rawComp = r.pCompliance || r.compliance || r.Compliance || r['Compliance Score'] || 0;
                        const compVal = parseFloat(String(rawComp).replace(/[^-0-9.]/g, ''));
                        const rowKey = _clean(rowDispName);
                        if (!isNaN(compVal) && compVal !== 0) {
                            if (!dispatcherCompHistory[rowKey]) dispatcherCompHistory[rowKey] = [];
                            dispatcherCompHistory[rowKey].push(compVal <= 1 ? compVal * 100 : compVal);
                        }
                    }
                });
            }

            

            if (appState.profiles && appState.profiles.liveData && week.end <= cutoffDate) {
                const checkDate = (dStr) => { 
                    const d = new Date(dStr); 
                    return d >= start && d <= end; 
                };

                const weekLoads = appState.profiles.liveData.filter(l => {
                    const lDate = new Date(l.do_date || l.pickup_date || l.date);
                    return !isNaN(lDate.getTime()) && lDate >= start && lDate <= end && l.status !== 'Canceled';
                });

                weekLoads.forEach(l => {
                    const d = ensureDisp(l.dispatcher);
                    if (d && l.wellness_fail && l.wellness_fail.trim() !== '') {
                        d.wellnessLoadsCount++;
                        if (l.wellness_fail === 'GOOD' || l.wellness_fail === '-') {
                            d.wellnessPassedCount++;
                        }
                    }
                });

                Object.values(dispatchersInWeek).forEach(d => {
                    if (d.wellnessLoadsCount > 0) {
                        const weeklyWellness = (d.wellnessPassedCount / d.wellnessLoadsCount) * 100;
                        const cName = _clean(d.name);
                        if (!dispatcherWellHistory[cName]) dispatcherWellHistory[cName] = [];
                        dispatcherWellHistory[cName].push(weeklyWellness);
                    }
                });
            }

            // --- FLEET HEALTH COMPLIANCE CALCULATION FOR THIS WEEK ---
            const getCnt = (src, dateKey, nameKey) => {
                const c = {};
                (src || []).forEach(x => {
                    const d = new Date(x[dateKey] || x.date);
                    if (d >= start && d <= end) {
                        const n = helpers.clean(x[nameKey] || x.dispatcherName || x.dispatcher);
                        if (n) c[n] = (c[n] || 0) + 1;
                    }
                });
                return c;
            };
            
            const wTue = getCnt(appState.profiles?.tuesdayOpenData, 'date', 'dispatcher');
            const wPpw = getCnt(appState.profiles?.missingPaperworkData, 'date', 'dispatcher');
            const wOver = getCnt(appState.profiles?.overdueLoadsData, 'date', 'dispatcher');
            const wCalc = getCnt(appState.profiles?.calculatorActivityData, 'date', 'dispatcher');
            const wDrop = getCnt(appState.profiles?.trailerDropsData, 'dropTime', 'droppedByDispatcher');

            const wRcSum = {}, wRcCnt = {};
            (appState.profiles?.rcEntryData || []).forEach(x => {
                const d = new Date(x.created_at || x.date);
                if (d >= start && d <= end) {
                     const n = helpers.clean(x.dispatcher || x.dispatcherName);
                     const v = parseFloat(x.entry_minutes || x.minutes);
                     if (n && !isNaN(v)) { wRcSum[n]=(wRcSum[n]||0)+v; wRcCnt[n]=(wRcCnt[n]||0)+1; }
                }
            });

            const dKeys = Object.keys(dispatchersInWeek);
            if (dKeys.length > 0) {
                 dKeys.forEach(k => {
                      if (wTue[k] !== undefined) dispatchersInWeek[k].tuesdayOpen = wTue[k];
                      if (wPpw[k] !== undefined) dispatchersInWeek[k].missingPaperwork = wPpw[k];
                      if (wOver[k] !== undefined) dispatchersInWeek[k].overdueLoads = wOver[k];
                      if (wDrop[k] !== undefined) dispatchersInWeek[k].trailerDrops = wDrop[k];
                      dispatchersInWeek[k].calc = wCalc[k] || 0;
                      dispatchersInWeek[k].rc = wRcCnt[k] ? (wRcSum[k]/wRcCnt[k]) : 0;
                 });
                 
                 const weights = appState.profiles?.complianceSettings?.weights || {
                     goodMoves: 5, badMoves: 10, hiddenMiles: 10, lowRpm: 10, tuesdayOpen: 10,
                     missingPaperwork: 10, trailerDrops: 5, trailerRecoveries: 5, calculatorActivity: 5,
                     rcEntry: 5, overdueLoads: 10, wellness: 5, retention4w: 5, medianTenure: 5
                 };

                 const allMetrics = [
                     { id: 'goodMoves', higherIsBetter: true },
                     { id: 'badMoves', higherIsBetter: false },
                     { id: 'hiddenMiles', higherIsBetter: false },
                     { id: 'lowRpm', higherIsBetter: false },
                     { id: 'tuesdayOpen', higherIsBetter: false }, 
                     { id: 'missingPaperwork', higherIsBetter: false }, 
                     { id: 'trailerDrops', higherIsBetter: false },
                     { id: 'trailerRecoveries', higherIsBetter: true },
                     { id: 'calculatorActivity', higherIsBetter: true }, 
                     { id: 'rcEntry', higherIsBetter: false },
                     { id: 'overdueLoads', higherIsBetter: false },
                     { id: 'wellness', higherIsBetter: true },
                     { id: 'retention4w', higherIsBetter: true },
                     { id: 'medianTenure', higherIsBetter: true }
                 ];
                 
                 const proportionalScores = {};
                 allMetrics.forEach(metric => {
                     const allValues = dKeys.map(k => {
                         let val = dispatchersInWeek[k][metric.id];
                         if (metric.id === 'medianTenure') val = (dispatchersInWeek[k].medianTenureOO + dispatchersInWeek[k].medianTenureLOO) / 2;
                         if (metric.id === 'calculatorActivity') val = dispatchersInWeek[k].calc;
                         if (metric.id === 'rcEntry') val = dispatchersInWeek[k].rc;
                         if (metric.id === 'retention4w') val = dispatchersInWeek[k].retention;
                         return (val === null || val === undefined) ? null : val;
                     }).filter(v => v !== null);

                     if (allValues.length > 0) {
                         const maxValue = Math.max(...allValues, 1);
                         proportionalScores[metric.id] = {};
                         dKeys.forEach(k => {
                             let v = dispatchersInWeek[k][metric.id];
                             if (metric.id === 'medianTenure') v = (dispatchersInWeek[k].medianTenureOO + dispatchersInWeek[k].medianTenureLOO) / 2;
                             if (metric.id === 'calculatorActivity') v = dispatchersInWeek[k].calc;
                             if (metric.id === 'rcEntry') v = dispatchersInWeek[k].rc;
                             if (metric.id === 'retention4w') v = dispatchersInWeek[k].retention;
                             
                             if (v === null || v === undefined) {
                                 proportionalScores[metric.id][k] = null;
                             } else if (metric.id === 'wellness') {
                                 proportionalScores[metric.id][k] = v;
                             } else {
                                 const proportion = v / maxValue;
                                 proportionalScores[metric.id][k] = metric.higherIsBetter ? proportion * 100 : (1 - proportion) * 100;
                             }
                         });
                     }
                 });

                 const weekHasData = dKeys.some(k => {
                     return (wTue[k] || 0) > 0 || (wPpw[k] || 0) > 0 || (wOver[k] || 0) > 0 || (wCalc[k] || 0) > 0 || (wDrop[k] || 0) > 0 || (wRcCnt[k] || 0) > 0;
                 });

                 if (weekHasData) {
                     dKeys.forEach(k => {
                         let weightedScore = 0;
                         let dynamicTotalWeight = 0;

                         allMetrics.forEach(metric => {
                             const weight = weights[metric.id] || 0;
                             if (weight > 0 && proportionalScores[metric.id] && proportionalScores[metric.id][k] !== null) {
                                 weightedScore += (proportionalScores[metric.id][k] * weight);
                                 dynamicTotalWeight += weight;
                             }
                         });

                         const finalS = dynamicTotalWeight > 0 ? (weightedScore / dynamicTotalWeight) : 0;
                         if (!complianceWeeklyScores[k]) complianceWeeklyScores[k] = [];
                         complianceWeeklyScores[k].push(finalS);
                     });
                 }
            }
        });
        const complianceValuesMap = {};
        const complianceScoresMap = {};
        const fKeys = Object.keys(complianceWeeklyScores);
        if (fKeys.length > 0) {
             const avgs = {};
             let minA = 100, maxA = 0;
             fKeys.forEach(k => {
                  const arr = complianceWeeklyScores[k];
                  const a = arr.reduce((x,y)=>x+y,0)/arr.length;
                  avgs[k] = a;
                  if (a < minA) minA = a;
                  if (a > maxA) maxA = a;
             });
             fKeys.forEach(k => {
                  const r = avgs[k];
                  complianceValuesMap[k] = r;
                  complianceScoresMap[k] = Math.round(r);
             });
        }

       

        const getType = (contractType) => (contractType || '').toUpperCase() === 'OO' ? 'OO' : 'LOO';

        // Helper to safely extract name from various field possibilities
        const getName = (x) => helpers.clean(x.dispatcher || x.dispatch || x.dispatcherName || x.Dispatcher || x.dispatcher_name || x.Disp || x['Dispatcher Name'] || x['Dispatcher'] || x.name || x.Name || x.droppedByDispatcher);

      

        const isFuture = (dStr) => {
            const d = new Date(dStr || new Date());
            return d > cutoffDate;
        };

        const lookups = {
            overdue: (appState.profiles?.overdueLoadsData || []).reduce((acc, x) => {
                const dDate = new Date(x.date || x.Date || x.pickup_date);
                if (dDate < lookupStart || dDate > cutoffDate) return acc;
                const name = getName(x);
                if(name) acc[name] = (acc[name] || 0) + 1;
                return acc;
            }, {}),
            rc: (appState.profiles?.rcEntryData || []).reduce((acc, x) => {
                const dDate = new Date(x.created_at || x.date || x.Date);
                if (dDate < lookupStart || dDate > cutoffDate) return acc;
                const name = getName(x);
                if(name) {
                    if (!acc[name]) acc[name] = [];
                    acc[name].push(parseFloat(x.entry_minutes || x.minutes || x.Time) || 0);
                }
                return acc;
            }, {}),
            calc: (appState.profiles?.calculatorActivityData || []).reduce((acc, x) => {
                const dDate = new Date(x.date || x.Date);
                if (dDate < lookupStart || dDate > cutoffDate) return acc;
                const name = getName(x);
                if(name) {
                    if (!acc[name]) acc[name] = [];
                    if (parseFloat(x.minutes || x.duration || x.Minutes) > 0) acc[name].push(1);
                }
                return acc;
            }, {}),
            ppw: (appState.profiles?.missingPaperworkData || []).reduce((acc, x) => {
                const dDate = new Date(x.do_date || x.date || x.Date);
                if (dDate < lookupStart || dDate > cutoffDate) return acc;
                const name = getName(x);
                if(name) acc[name] = (acc[name] || 0) + 1;
                return acc;
            }, {}),
            tue: (appState.profiles?.tuesdayOpenData || []).reduce((acc, x) => {
                const dDate = new Date(x.date || x.Date);
                if (dDate < lookupStart || dDate > cutoffDate) return acc;
                const name = getName(x);
                if(name) acc[name] = (acc[name] || 0) + 1;
                return acc;
            }, {}),
            hiddenLive: (appState.loads?.data || []).reduce((acc, l) => {
                const lDate = new Date(l.pickup_date || l.date || l.Date);
                if (lDate < lookupStart || lDate > cutoffDate) return acc;
                const name = getName(l);
                const val = l.hidden_miles || l.Hidden_Miles || l.hidden || l.Hidden || l.notes;
                if (name && val && (String(val).toLowerCase().includes('hidden') || parseFloat(val) > 0)) {
                    acc[name] = (acc[name] || 0) + 1;
                }
                return acc;
            }, {}),
             cancelLive: (appState.loads?.data || []).reduce((acc, l) => {
                const lDate = new Date(l.pickup_date || l.date || l.Date);
                if (lDate < lookupStart || lDate > cutoffDate) return acc;
                const name = getName(l);
                if (name && l.status === 'Canceled') acc[name] = (acc[name] || 0) + 1;
                return acc;
            }, {})
        };


        

  
        const calcDatesMap = {};
        const calcData = appState.profiles?.calculatorActivityData || [];

        calcData.forEach(row => {
            const name = getName(row); 
            
            const dateVal = row.date; 
            
    
            const mins = parseFloat(row.minutes || 0);
            
            if (name && dateVal && mins > 0) {
                 if (!calcDatesMap[name]) calcDatesMap[name] = [];
                 
                 const ts = new Date(dateVal).getTime();
                 if (!isNaN(ts)) {
                    calcDatesMap[name].push(ts);
                 }
            }
        });

        const dispatcherActiveWeeks = {};
        
        const registerActivity = (name, dateStr) => {
            if (isFuture(dateStr)) return;
            const week = getMonKey(dateStr);
            if (!name || !week) return;
            if (!dispatcherActiveWeeks[name]) dispatcherActiveWeeks[name] = new Set();
            dispatcherActiveWeeks[name].add(week);
        };

        // Sources for Activity
        (appState.loads?.historicalStubsData || []).forEach(s => registerActivity(getName(s), s.pay_date));
        (appState.profiles?.tuesdayOpenData || []).forEach(d => registerActivity(getName(d), d.date || d.Date));
        (appState.profiles?.missingPaperworkData || []).forEach(d => registerActivity(getName(d), d.do_date || d.date || d.Date));
        (appState.profiles?.afterHoursData || []).forEach(d => registerActivity(getName(d), d.date || d.Date || d.created_at));

        // 2. INITIALIZE SCORES
        const tueWeeklyCounts = {};
        const ppwWeeklyCounts = {};
        const weeklyCompScores = {}; 
        const weeklyWellScores = {}; 

        Object.keys(dispatcherActiveWeeks).forEach(name => {
            weeklyCompScores[name] = {};
            weeklyWellScores[name] = {};
            dispatcherActiveWeeks[name].forEach(week => {
                weeklyCompScores[name][week] = 100;
                weeklyWellScores[name][week] = 100;
            });
        });

        // 3. APPLY PENALTIES
       const W_TUE = 25; 
        const W_PPW = 15;
        const W_WELL = 20;

        (appState.profiles?.tuesdayOpenData || []).forEach(d => {
            const dDate = d.date || d.Date;
            if (isFuture(dDate)) return;
            const name = getName(d);
            const week = getMonKey(dDate);
            if (!name || !week) return;

            if (!tueWeeklyCounts[name]) tueWeeklyCounts[name] = {};
            if (!tueWeeklyCounts[name][week]) tueWeeklyCounts[name][week] = 0;
            tueWeeklyCounts[name][week]++;

            if (weeklyCompScores[name] && weeklyCompScores[name][week] !== undefined) {
                weeklyCompScores[name][week] = Math.max(0, weeklyCompScores[name][week] - W_TUE);
            }
        });

        (appState.profiles?.missingPaperworkData || []).forEach(d => {
            const dDate = d.do_date || d.date || d.Date;
            if (isFuture(dDate)) return;
            const name = getName(d);
            const week = getMonKey(dDate);
            if (!name || !week) return;

            if (!ppwWeeklyCounts[name]) ppwWeeklyCounts[name] = {};
            if (!ppwWeeklyCounts[name][week]) ppwWeeklyCounts[name][week] = 0;
            ppwWeeklyCounts[name][week]++;

            if (weeklyCompScores[name] && weeklyCompScores[name][week] !== undefined) {
                weeklyCompScores[name][week] = Math.max(0, weeklyCompScores[name][week] - W_PPW);
            }
        });

        (appState.profiles?.overdueLoadsData || []).forEach(d => {
            const dDate = d.date || d.Date || d.pickup_date;
            if (isFuture(dDate)) return;
            const name = getName(d);
            const week = getMonKey(dDate);
            if (!name || !week) return;
            const W_OVERDUE = 20;
            if (weeklyCompScores[name] && weeklyCompScores[name][week] !== undefined) {
                weeklyCompScores[name][week] = Math.max(0, weeklyCompScores[name][week] - W_OVERDUE);
            }
        });

        (appState.profiles?.afterHoursData || []).forEach(d => {
            const dDate = d.date || d.Date;
            if (isFuture(dDate)) return;
            const name = getName(d);
            const week = getMonKey(dDate);
            if (!name || !week) return;
            const W_AFTER = 10;
            if (weeklyCompScores[name] && weeklyCompScores[name][week] !== undefined) {
                weeklyCompScores[name][week] = Math.max(0, weeklyCompScores[name][week] - W_AFTER);
            }
        });

        (appState.profiles?.missingPaperworkData || []).forEach(d => {
            const name = getName(d);
            const week = getMonKey(d.do_date || d.date || d.Date);
            if (!name || !week || week === currentWeekKey) return;

            if (!ppwWeeklyCounts[name]) ppwWeeklyCounts[name] = {};
            if (!ppwWeeklyCounts[name][week]) ppwWeeklyCounts[name][week] = 0;
            ppwWeeklyCounts[name][week]++;

            if (weeklyCompScores[name] && weeklyCompScores[name][week] !== undefined) {
                weeklyCompScores[name][week] = Math.max(0, weeklyCompScores[name][week] - W_PPW);
            }
        });

        (appState.profiles?.overdueLoadsData || []).forEach(d => {
            const name = getName(d);
            const week = getMonKey(d.date || d.Date || d.pickup_date);
            if (!name || !week || week === currentWeekKey) return;
            const W_OVERDUE = 20;
            if (weeklyCompScores[name] && weeklyCompScores[name][week] !== undefined) {
                weeklyCompScores[name][week] = Math.max(0, weeklyCompScores[name][week] - W_OVERDUE);
            }
        });

        (appState.profiles?.afterHoursData || []).forEach(d => {
            const name = getName(d);
            const week = getMonKey(d.date || d.Date);
            if (!name || !week || week === currentWeekKey) return;
            const W_AFTER = 10;
            if (weeklyCompScores[name] && weeklyCompScores[name][week] !== undefined) {
                weeklyCompScores[name][week] = Math.max(0, weeklyCompScores[name][week] - W_AFTER);
            }
        });

        Object.keys(weeklyCompScores).forEach(name => {
            const weeklyScores = Object.values(weeklyCompScores[name]);
            const cName = helpers.clean(name);
            
            if (dispatcherActiveWeeks[name] && dispatcherActiveWeeks[name].size > 0) {
                if (!dispatcherCompHistory[cName]) dispatcherCompHistory[cName] = [];
                weeklyScores.forEach(s => dispatcherCompHistory[cName].push(s));
            }
        });

        // 1. COLLECT RAW DATA
        const dispatcherData = {};

        const getDispObj = (name) => {
            const cleanName = helpers.clean(name);
            if (!dispatcherData[cleanName]) {
                dispatcherData[cleanName] = { 
                    OO: { weeks: {}, loads: [], stubs: [], loadCount: 0, stubCount: 0, ops: { good: 0, bad: 0, hidden: 0 } }, 
                    LOO: { weeks: {}, loads: [], stubs: [], loadCount: 0, stubCount: 0, ops: { good: 0, bad: 0, hidden: 0 } },
                    Global: { weeks: {} },
                    rawName: name
                };
            }
            return dispatcherData[cleanName];
        };

        // A. Process Stubs (Financials)
        // --- DEFINE DATE WINDOW (Last 12 Weeks, No Live) ---
        const lMonday = new Date(cutoffDate); 
        const sWindow = new Date(lMonday);
        sWindow.setUTCDate(lMonday.getUTCDate() - (12 * 7));
        // ---------------------------------------------------

        if (appState.loads && appState.loads.historicalStubsData) {
            appState.loads.historicalStubsData.forEach(s => {
                if (!s.stub_dispatcher) return;

                // --- CHECK DATE RANGE ---
                const sDate = new Date(s.pay_date);
                if (sDate < sWindow || sDate > lMonday) return;
                // ------------------------

                const d = getDispObj(s.stub_dispatcher);
                const type = getType(s.contract_type);
                const weekKey = s.pay_date;

                d[type].stubs.push(s);
                d[type].stubCount++;

                if (!d[type].weeks[weekKey]) d[type].weeks[weekKey] = { gross: 0, margin: 0, drivers: new Set(), netPay: 0, miles: 0, loads: 0, fuel: 0, tolls: 0, hidden: 0, good: 0, bad: 0, hasPayroll: true, calcLoadMiles: 0, calcLoadCount: 0 };
                else d[type].weeks[weekKey].hasPayroll = true;
                const w = d[type].weeks[weekKey];
                
                const gross = helpers.num(s.driver_gross);
                const margin = helpers.num(s.margin);
                const miles = helpers.num(s.total_miles);
                let loads = parseFloat(s.load_count || s.loads || s.Load_Count);
                if (isNaN(loads) || loads === 0) loads = 1;
                
                w.gross += gross;
                w.margin += margin;
                w.miles += miles;
                w.loads += loads;
                w.netPay += (gross - margin);
                w.drivers.add(s.driver_name);
            });
        }

        if (appState.loads && appState.loads.data) {
            appState.loads.data.forEach(l => {
                if (!l.dispatcher) return;

                const lDate = l.pickup_date || l.date || l.Date;
                if (new Date(lDate) > lMonday) return;
                // ---------------------------------

                const d = getDispObj(l.dispatcher);
                const type = getType(l.contract_type);

                d[type].loads.push(l);
                d[type].loadCount++;
                
                const hiddenVal = l.hidden_miles || l.Hidden_Miles || l.hidden || l.Hidden || l.notes;
                if (hiddenVal && (String(hiddenVal).toLowerCase().includes('hidden') || String(hiddenVal).includes('Found') || parseFloat(hiddenVal) > 0)) {
                     d[type].ops = d[type].ops || { good: 0, bad: 0, hidden: 0 };
                     d[type].ops.hidden++;
                }

                if (l.moved_monday === 'Moved Monday Load') {
                    d[type].ops = d[type].ops || { good: 0, bad: 0, hidden: 0 };
                    const thresh = (appState.profiles?.thresholdSettings?.goodMove?.default) || 5000;
                    const g = (l.driver_gross_without_moved !== undefined ? parseFloat(l.driver_gross_without_moved) : (parseFloat(l.gross) || 0)); 
                    if (g < thresh) d[type].ops.good++; else d[type].ops.bad++;
                }
                
            });
        }

        // C. Calculate Metrics
        const metrics = {}; 
        
        Object.keys(dispatcherData).forEach(key => {
            const d = dispatcherData[key];
            metrics[key] = { OO: {}, LOO: {}, Combined: {}, raw: {}, counts: { OO: d.OO.loadCount, LOO: d.LOO.loadCount, OO_Stubs: d.OO.stubCount, LOO_Stubs: d.LOO.stubCount } };

            [d.OO.weeks, d.LOO.weeks].forEach(weeksMap => {
                Object.values(weeksMap).forEach(w => {
                    if (w.hasPayroll) {
                        if (w.miles === 0 && w.calcLoadMiles > 0) w.miles = w.calcLoadMiles;
                        if (w.loads === 0 && w.calcLoadCount > 0) w.loads = w.calcLoadCount;
                    }
                });
            });

            const computeBucketStats = (weeksMap, loadList, stubList) => {
                const wData = Object.values(weeksMap);
                
                const weeklyGrosses = wData.map(x => x.gross);
                const weeklyMargins = wData.map(x => x.margin);
                const weeklyNetPays = wData.map(x => x.netPay);
                const weeklyDriverGrosses = wData.map(x => x.gross / (x.drivers && x.drivers.size > 0 ? x.drivers.size : 1));

                const medGross = helpers.median(weeklyGrosses);
                const avgGross = helpers.avg(weeklyGrosses);
                const consist = medGross > 0 ? Math.min(1, avgGross / medGross) : 0;

                const weeklyMiles = wData.map(x => x.miles);
                const weeklyLoadCounts = wData.map(x => x.loads);
                
                const weeklyRPMs = wData.filter(x => x.miles > 100).map(x => (x.gross > 0 ? x.gross : (x.miles * 2.5)) / x.miles); 
                
                const loadRPMs = [];
                stubList.forEach(s => {
                    const miles = helpers.num(s.total_miles);
                    const gross = helpers.num(s.driver_gross);
                    if (miles > 0 && gross > 0) loadRPMs.push(gross / miles);
                });
                
                const allRates = stubList.map(s => helpers.num(s.driver_gross)).filter(v => v > 0);
                
                const weeklyExpense = wData.filter(x => x.gross > 0).map(x => (x.fuel + x.tolls + (x.miles * 0.25)) / x.gross);
                const weeklyTrucks = wData.map(x => x.drivers ? x.drivers.size : 0);
                const avgTrucks = helpers.median(weeklyTrucks);

                const uniqueDrivers = new Set(stubList.map(s => s.driver_name));
                const qualifiedDrivers = new Set();
                const activeDrivers = new Set();

                uniqueDrivers.forEach(drv => {
                    const drvStubs = stubList.filter(s => s.driver_name === drv).sort((a,b) => new Date(b.pay_date) - new Date(a.pay_date));
                    
                    // Driver had minimum 3 weeks (paystubs)
                    if (drvStubs.length >= 3) {
                        qualifiedDrivers.add(drv);
                        
                        // Check if currently active (based on latest stub status)
                        if (drvStubs.length > 0 && (drvStubs[0].retention_status || '').toLowerCase() === 'active') {
                            activeDrivers.add(drv);
                        }
                    }
                });

                const totalQualified = qualifiedDrivers.size;
                const retention = totalQualified > 0 ? (activeDrivers.size / totalQualified) * 100 : 0;
                
                const tenures = Array.from(uniqueDrivers).map(drv => {
                     const drvStubs = stubList.filter(s => s.driver_name === drv);
                     if (drvStubs.length < 3) return null;
                     const dates = new Set(drvStubs.map(s => s.pay_date));
                     return dates.size;
                }).filter(t => t !== null);
                const tenure = helpers.median(tenures);

                return {
                    s_gross: medGross,
                    s_dGross: helpers.median(weeklyDriverGrosses),
                    s_margin: helpers.median(weeklyMargins),
                    s_netPay: helpers.median(weeklyNetPays),
                    s_consist: consist,
                    s_loadRate: helpers.avg(allRates),
                    s_loads: helpers.median(weeklyLoadCounts),
                    s_rpm: helpers.median(weeklyRPMs),
                    s_miles: helpers.median(weeklyMiles.filter(m => m > 0)),
                    s_rpmLoad: helpers.median(loadRPMs),
                    s_expense: helpers.median(weeklyExpense),
                    s_trucks: helpers.avg(weeklyTrucks),
                    s_retention: retention,
                   s_tenure: tenure,
                    s_weight: helpers.avg([...loadList.map(l => helpers.num(l.weight || l.Weight || l.total_weight || l['Total Weight'] || l.Load_Weight)), ...stubList.map(s => helpers.num(s.weight || s.total_weight || s.Total_Weight || s.Weight || s['Total Weight'] || s.Load_Weight))].filter(w => w > 0)),
                    s_netPct: medGross > 0 ? (helpers.median(weeklyNetPays) / medGross) * 100 : 0,
                    s_grossPct: 0, 
                    s_marginPct: medGross > 0 ? (helpers.median(weeklyMargins) / medGross) * 100 : 0,
                    s_uniqueCount: uniqueDrivers.size
                };
            };

            const combinedWeeks = {};
            const mergeWeeks = (src) => {
                Object.entries(src).forEach(([wk, data]) => {
                    if(!combinedWeeks[wk]) combinedWeeks[wk] = { gross:0, margin:0, miles:0, loads:0, fuel:0, tolls:0, drivers: new Set(), netPay:0, hidden:0, good:0, bad:0 };
                    combinedWeeks[wk].gross += data.gross;
                    combinedWeeks[wk].margin += data.margin;
                    combinedWeeks[wk].netPay += data.netPay;
                    combinedWeeks[wk].miles += data.miles;
                    combinedWeeks[wk].loads += data.loads;
                    combinedWeeks[wk].fuel += data.fuel;
                    combinedWeeks[wk].tolls += data.tolls;
                    combinedWeeks[wk].hidden += (data.hidden||0);
                    combinedWeeks[wk].good += (data.good||0);
                    combinedWeeks[wk].bad += (data.bad||0);
                    if(data.drivers) data.drivers.forEach(drv => combinedWeeks[wk].drivers.add(drv));
                });
            };
            mergeWeeks(d.OO.weeks);
            mergeWeeks(d.LOO.weeks);
            
            const allLoads = [...d.OO.loads, ...d.LOO.loads];
            const allStubs = [...d.OO.stubs, ...d.LOO.stubs];
            
            metrics[key].OO = computeBucketStats(d.OO.weeks, d.OO.loads, d.OO.stubs);
            metrics[key].LOO = computeBucketStats(d.LOO.weeks, d.LOO.loads, d.LOO.stubs);
            metrics[key].Combined = computeBucketStats(combinedWeeks, allLoads, allStubs);
            
            const cm = metrics[key].Combined; 

         
            const totalLoads = (metrics[key].counts.OO_Stubs + metrics[key].counts.LOO_Stubs) || 1; 
            const totalMiles = cm.s_miles > 0 ? cm.s_miles * (Object.keys(combinedWeeks).length || 1) : (helpers.sum(allStubs.map(s => helpers.num(s.total_miles))) || 1);

            const cleanKey = helpers.clean(key);

            const getProfileCount = (dataSet, dispName) => {
                if (!dataSet || !Array.isArray(dataSet)) return 0;
                return dataSet
                    .filter(r => helpers.clean(r.dispatcherName || r.dispatcher || r.droppedByDispatcher || r.Dispatcher || r.dispatcher_name || r.name || r['Dispatcher Name']) === helpers.clean(dispName))
                    .length;
            };

            const countTue = getProfileCount(appState.profiles?.tuesdayOpenData, key);
            const countPpw = getProfileCount(appState.profiles?.missingPaperworkData, key);
            let rawHiddenCount = getProfileCount(appState.profiles?.rcEntryData, key);

            let histOver = 0;
            let histTueValues = []; 
            let histPpwValues = [];
            let histCompValues = [];
            let histWellValues = [];
            let histWeightSum = 0, histWeightCount = 0;
            let histGrossPctSum = 0, histGrossPctCount = 0;
            let histHappySum = 0, histHappyCount = 0;
            let histCHappySum = 0, histCHappyCount = 0;
            let histWellnessValues = [];

            if (appState.allHistoricalData && Array.isArray(appState.allHistoricalData)) {
                appState.allHistoricalData.forEach(r => {
                    if (helpers.clean(r.dispatcherName || r.name) === cleanKey) {
                         // Overdue Loads (History)
                        histOver += helpers.num(r.overdueLoads || r.overdue_loads || r.overdue || r['Overdue Loads']);
                        
                        histTueValues.push(helpers.num(r.tuesdayOpen || r.tuesday_open || r['Tuesday Open'] || r.Tue_Open || r.tue_open));

                        histPpwValues.push(helpers.num(r.missingPaperwork || r.missing_paperwork || r['Missing Paperwork'] || r.ppw || r.PPW));

                        // Fallback for Hidden Miles if not found in Profiles
                        if (rawHiddenCount === 0) {
                            rawHiddenCount += helpers.num(r.hiddenMiles || r.hidden_miles || r.hidden || r['Hidden Miles']);
                        }

                        // Compliance Score
                        const rDate = new Date(r.date || r.Date);
                        let rKey = '';
                        if (!isNaN(rDate.getTime())) {
                            const d = rDate.getUTCDay();
                            const df = rDate.getUTCDate() - d + (d === 0 ? -6 : 1);
                            rKey = new Date(Date.UTC(rDate.getUTCFullYear(), rDate.getUTCMonth(), df)).toISOString().split('T')[0];
                        }

                       
                        

                        // Gross %
                        const grossPctVal = helpers.num(r.pDriverGross || r.driverGross || r['Driver Gross']);
                        if (grossPctVal > 0) { histGrossPctSum += grossPctVal; histGrossPctCount++; }

                        // Happiness
                        const hVal = r.dHappy || r.pMainCriteriaNetDriverMargin;
                        if (hVal !== undefined) { histHappySum += (hVal <= 1 ? hVal * 100 : hVal); histHappyCount++; }
                        const cVal = r.cHappy || r.pMainCriteria2CashFlow;
                        if (cVal !== undefined) { histCHappySum += (cVal <= 1 ? cVal * 100 : cVal); histCHappyCount++; }

                       if (historicalWeeks.length > 0) {
                            const rDateObj = new Date(r.date || r.Date || r.created_at);
                            if (!isNaN(rDateObj.getTime())) {
                                let wVal = parseFloat(r.wellness || r.Wellness || r.medianWellness || r['Wellness %'] || 0);
                                const wellnessVal = parseFloat(r.wellness || r.Wellness || r['Wellness %'] || 0);
const wellnessStatus = String(r.wellness_fail || r.status || '').toUpperCase();
if (wellnessVal > 0) {
    histWellnessValues.push(wellnessVal <= 1 ? wellnessVal * 100 : wellnessVal);
} else if (wellnessStatus !== '') {
    const isHealthy = wellnessStatus === 'GOOD' || wellnessStatus === 'HEALTHY' || wellnessStatus === '-';
    histWellnessValues.push(isHealthy ? 100 : 0);
}
                            }
                        }
                    }
                });
            }


            

            let myActiveWeeks = dispatcherActiveWeeks[cleanKey] ? Array.from(dispatcherActiveWeeks[cleanKey]) : [];
            myActiveWeeks.sort((a, b) => new Date(b) - new Date(a));
            myActiveWeeks = myActiveWeeks.slice(0, 12);

            const tueVals = myActiveWeeks.map(w => tueWeeklyCounts[cleanKey]?.[w] || 0);
            const ppwVals = myActiveWeeks.map(w => ppwWeeklyCounts[cleanKey]?.[w] || 0);

            let avgTue = helpers.avg(tueVals);
            let avgPpw = helpers.avg(ppwVals);
            
            const weightValsByWeek = myActiveWeeks.map(weekKey => {
                const weekRecs = (appState.allHistoricalData || []).filter(r => {
                    const rDate = new Date(r.date || r.Date);
                    if (isNaN(rDate.getTime())) return false;
                    const rWeek = new Date(Date.UTC(rDate.getUTCFullYear(), rDate.getUTCMonth(), rDate.getUTCDate() - (rDate.getUTCDay() === 0 ? 6 : rDate.getUTCDay() - 1))).toISOString().split('T')[0];
                    return helpers.clean(r.dispatcherName || r.name) === cleanKey && rWeek === weekKey;
                });

                const weightKeys = [
                    'pTotalWeight', 'pWeight', 
                    'weight', 'Weight', 
                    'total_weight', 'Total_Weight',
                    'Total Weight', 'Load Weight', 'Load_Weight'
                ];

                const weights = weekRecs.map(r => {
                    let w = 0;
                    let isTotal = false;

                    for (const key of weightKeys) {
                        const val = helpers.num(r[key]);
                        if (val > 0) {
                            w = val;
                            if (key.toLowerCase().includes('total') || w > 80000) isTotal = true;
                            break;
                        }
                    }

                    if (w > 0 && isTotal) {
                        const loads = helpers.num(r.load_count || r.loads || r.Load_Count || r.no_of_loads || 1);
                        if (loads > 0) w = w / loads;
                    }

                    if (w === 0 && Array.isArray(r.stubs) && r.stubs.length > 0) {
                        const stubWeights = r.stubs.map(s => {
                            for (const key of weightKeys) {
                                const val = helpers.num(s[key]);
                                if (val > 0) return val;
                            }
                            return 0;
                        }).filter(x => x > 0);
                        
                        if (stubWeights.length > 0) {
                            w = helpers.median(stubWeights);
                        }
                    }

                    return w;
                }).filter(v => v > 0);

                return weights.length > 0 ? helpers.avg(weights) : null;
            }).filter(v => v !== null);

            let histMedianWeight = weightValsByWeek.length > 0 ? helpers.avg(weightValsByWeek) : (cm.s_weight > 0 ? cm.s_weight : 0);
            
            if (histMedianWeight > 0 && (cm.s_weight === 0 || cm.s_weight < 5000)) {
                cm.s_weight = histMedianWeight;
            }
            
            if (histMedianWeight === 0 && cm.s_weight > 0) histMedianWeight = cm.s_weight;

            let rawGrossPctVal = histGrossPctCount > 0 ? histGrossPctSum / histGrossPctCount : 0;
            if (rawGrossPctVal > 0 && rawGrossPctVal <= 1) rawGrossPctVal *= 100;
            if (rawGrossPctVal > 0) cm.s_grossPct = rawGrossPctVal;

            let dHappy = histHappyCount > 0 ? histHappySum / histHappyCount : 0;
            let cHappy = histCHappyCount > 0 ? histCHappySum / histCHappyCount : 0;
            
            const allWellnessPoints = [...(dispatcherWellHistory[cleanKey] || []), ...histWellnessValues];
            let medianWellness = allWellnessPoints.length > 0 ? helpers.median(allWellnessPoints) : 0;
            
            const valCompliance = complianceValuesMap[cleanKey] || 0;
            const avgCompliance = complianceScoresMap[cleanKey] || 0;

            const countOverdue = (lookups.overdue[key] || 0) + histOver;
            const totalWeeks = Object.keys(combinedWeeks).length || 1;
            const rawRc = lookups.rc[key] ? (helpers.sum(lookups.rc[key]) / totalWeeks) : 0;
            
            const myCalcData = (appState.profiles?.calculatorActivityData || []).filter(r => 
                helpers.clean(r.dispatcher || r.dispatcherName || r.name || r.Dispatcher) === cleanKey && 
                parseFloat(r.minutes || r.duration || r.Minutes || 0) > 0
            );

            const myActiveDates = new Set();
            myCalcData.forEach(r => {
                const d = new Date(r.date || r.Date);
                if (!isNaN(d.getTime())) myActiveDates.add(d.toISOString().split('T')[0]);
            });

           // Identify globally active dates for filtering weeks
            const globalActiveDates = new Set();
            (appState.profiles?.calculatorActivityData || []).forEach(r => {
                if (parseFloat(r.minutes || r.duration || r.Minutes || 0) > 0) {
                     const d = new Date(r.date || r.Date);
                     if (!isNaN(d.getTime())) globalActiveDates.add(d.toISOString().split('T')[0]);
                }
            });

            // Filter historicalWeeks to keep only those with GLOBAL activity
            const validWeeks = historicalWeeks.filter(hw => {
                for (let i = 0; i < 7; i++) {
                     const d = new Date(hw.start);
                     d.setUTCDate(d.getUTCDate() + i);
                     if (globalActiveDates.has(d.toISOString().split('T')[0])) return true;
                }
                return false;
            });

            const calcScores = validWeeks.map(hw => {
                let daysActive = 0;
                for (let i = 0; i < 7; i++) {
                    const d = new Date(hw.start);
                    d.setUTCDate(d.getUTCDate() + i);
                    const dateStr = d.toISOString().split('T')[0];
                    if (myActiveDates.has(dateStr)) daysActive++;
                }
                return Math.round((daysActive / 7) * 100);
            });

            // Calculate Average of Valid Weeks (including 0s)
            let rawCalc = helpers.avg(calcScores);
            
            const ooOps = d.OO.ops || { good: 0, bad: 0, hidden: 0 };
            const looOps = d.LOO.ops || { good: 0, bad: 0, hidden: 0 };
            const rawGood = ooOps.good + looOps.good;
            const rawBad = ooOps.bad + looOps.bad;
            const rawCancel = lookups.cancelLive[key] || 0;

            const drvMap = {};
            allStubs.forEach(s => {
                if (!drvMap[s.driver_name]) drvMap[s.driver_name] = [];
                drvMap[s.driver_name].push(s);
            });
            const fBalances = [];
            Object.values(drvMap).forEach(l => {
                if (l.length >= 3) {
                    l.sort((a, b) => new Date(b.pay_date) - new Date(a.pay_date));
                    const last = l[0];
                    fBalances.push((helpers.num(last.balance) + helpers.num(last.po_liability)) * -1);
                }
            });
            const rawBalance = helpers.avg(fBalances);

            metrics[key].Global = {
                 s_rc: rawRc,
                 s_calc: rawCalc,
                 s_ppw: avgPpw, 
                 s_tue: avgTue,
                 s_overdue: countOverdue / totalWeeks,
                 s_hidden: rawHiddenCount / totalWeeks,
                 s_good: rawGood / totalWeeks,
                 s_bad: rawBad / totalWeeks, 
                 s_cancel: totalWeeks > 0 ? (rawCancel / totalWeeks) : 0,
                 s_balance: rawBalance,
                 s_dHappy: dHappy,
                 s_cHappy: cHappy,
                 s_wellness: medianWellness,
                 s_compliance: avgCompliance,
                 
                 s_rpm: cm.s_rpm,
                 s_miles: cm.s_miles,
                 s_loads: cm.s_loads,
                 s_rpmLoad: cm.s_rpmLoad,
                 s_trucks: cm.s_trucks
                 
                 
            };
            

            metrics[key].raw = {
                medGross: cm.s_gross,
                medDriverGross: cm.s_dGross,
                medMargin: cm.s_margin,
                medRPM: cm.s_rpm,
                medLoads: cm.s_loads,
                loadRate: cm.s_loadRate,
                medMiles: cm.s_miles,
                medRpmLoad: cm.s_rpmLoad, 
                
                totalMiles: helpers.sum(allStubs.map(s => helpers.num(s.total_miles))),
                avgRpm: cm.s_rpm, 
                medNetPay: cm.s_netPay,
                consistency: cm.s_consist,
                expenseRatio: cm.s_expense,
                retention: cm.s_retention,
                tenure: cm.s_tenure,
                avgTrucks: cm.s_trucks,
                
                goodMoves: totalWeeks > 0 ? (rawGood / totalWeeks) : 0,
                badMoves: totalWeeks > 0 ? (rawBad / totalWeeks) : 0,
                dHappy, cHappy, medianWellness,
                canceled: totalWeeks > 0 ? (rawCancel / totalWeeks) : 0,
                balance: rawBalance,
                rcEntry: rawRc,
                calcActivity: rawCalc,
                missingPpw: avgPpw,
                tueOpen: totalWeeks > 0 ? (helpers.sum(tueVals) / totalWeeks) : 0,
                overdue: totalWeeks > 0 ? (countOverdue / totalWeeks) : 0,
                hidden: totalWeeks > 0 ? (rawHiddenCount / totalWeeks) : 0,
                compliance: valCompliance,
                avgWeight: histMedianWeight,
                netPct: cm.s_gross > 0 ? (cm.s_netPay / cm.s_gross) * 100 : 0,
                grossPct: cm.s_grossPct,
                marginPct: cm.s_gross > 0 ? (cm.s_margin / cm.s_gross) * 100 : 0,
                weeksCount: Object.keys(combinedWeeks).length
                
            };
        });
        
const splitKeys = ['s_gross', 's_dGross', 's_margin', 's_netPay', 's_consist', 's_loadRate', 's_expense', 's_retention', 's_tenure', 's_rpm', 's_miles', 's_loads', 's_rpmLoad', 's_trucks', 's_weight', 's_netPct', 's_grossPct', 's_marginPct'];
        const globalKeys = ['s_rc', 's_calc', 's_ppw', 's_tue', 's_overdue', 's_hidden', 's_compliance', 's_good', 's_bad', 's_cancel', 's_balance', 's_dHappy', 's_cHappy', 's_wellness'];
        const inverseMetrics = ['s_expense', 's_weight', 's_ppw', 's_tue', 's_overdue', 's_hidden', 's_bad', 's_cancel', 's_balance', 's_rc'];
        const validPoolDispatchers = new Set();
        const poolToday = new Date();
        const poolW1 = new Date(poolToday); poolW1.setUTCDate(poolToday.getUTCDate() - 7);
        const poolW2 = new Date(poolToday); poolW2.setUTCDate(poolToday.getUTCDate() - 14);
        const poolK1 = getMonKey(poolW1);
        const poolK2 = getMonKey(poolW2);

        const recentMilesMap = {};
        (appState.loads?.historicalStubsData || []).forEach(s => {
             if (s.stub_dispatcher) {
                 const miles = parseFloat(s.total_miles) || 0;
                 if (miles > 0) {
                     const k = getMonKey(s.pay_date);
                     if (k === poolK1 || k === poolK2) {
                         const c = helpers.clean(s.stub_dispatcher);
                         recentMilesMap[c] = (recentMilesMap[c] || 0) + miles;
                     }
                 }
             }
        });

        Object.keys(metrics).forEach(k => {
            const cleanKey = helpers.clean(k);
            const total = metrics[k].raw.totalMiles || 0;
            const recent = recentMilesMap[cleanKey] || 0;
            const isInList = (appState.allDispatcherNames || []).some(n => helpers.clean(n) === cleanKey);
            if (isInList && total >= 20000 && recent > 0) {
                validPoolDispatchers.add(k);
            }
        });
        this.validPerformanceNames = validPoolDispatchers; // EXPOSE GLOBALLY

        const fillSums = {};
        const fillCounts = {};
        Object.keys(metrics).forEach(key => {
            if (!validPoolDispatchers.has(key)) return; 

            const m = metrics[key];
            const isActive = m.raw.weeksCount > 0 || m.raw.totalMiles > 0;
            const addToAvg = (k, val) => {
                if (val !== undefined && val !== null) {
                    const isInverse = inverseMetrics.includes(k);
                    if (k === 's_rc') {
                        if (val > 0) {
                             fillSums[k] = (fillSums[k] || 0) + val;
                             fillCounts[k] = (fillCounts[k] || 0) + 1;
                        }
                    } else if ((isInverse && isActive) || (!isInverse && val > 0)) {
                         fillSums[k] = (fillSums[k] || 0) + val;
                         fillCounts[k] = (fillCounts[k] || 0) + 1;
                    }
                }
            };
            globalKeys.forEach(k => addToAvg(k, m.Global[k]));
            splitKeys.forEach(k => addToAvg(k, m.Combined[k]));
        });

        const fillAvgs = {};
        [...splitKeys, ...globalKeys].forEach(k => {
            fillAvgs[k] = fillCounts[k] > 0 ? fillSums[k] / fillCounts[k] : 0;
        });

        Object.values(metrics).forEach(m => {
            const fillValue = (targetObj, key, isSplit = false) => {
                const val = targetObj[key];
                if (val === undefined || val === null || (key === 's_rc' && val === 0)) {
                    if (fillAvgs[key] > 0) {
                        targetObj[key] = fillAvgs[key];
                        if (isSplit) {
                            if (m.OO[key] === undefined || m.OO[key] === null) { m.OO[key] = fillAvgs[key]; if (!m.OO.s_uniqueCount) m.OO.s_uniqueCount = 1; }
                            if (m.LOO[key] === undefined || m.LOO[key] === null) { m.LOO[key] = fillAvgs[key]; if (!m.LOO.s_uniqueCount) m.LOO.s_uniqueCount = 1; }
                        }
                        if (key === 's_rc') m.raw.rcEntry = fillAvgs[key];
                        if (key === 's_calc') m.raw.calcActivity = fillAvgs[key];
                        if (key === 's_dHappy') m.raw.dHappy = fillAvgs[key];
                        if (key === 's_cHappy') m.raw.cHappy = fillAvgs[key];
                        if (key === 's_wellness') m.raw.medianWellness = fillAvgs[key];
                        if (key === 's_compliance') m.raw.compliance = fillAvgs[key];
                        if (key === 's_gross') m.raw.medGross = fillAvgs[key];
                        if (key === 's_rpm') m.raw.medRPM = fillAvgs[key];
                    }
                }
            };
            globalKeys.forEach(k => fillValue(m.Global, k));
            splitKeys.forEach(k => fillValue(m.Combined, k, true));
        });

        const pools = {};
        [...splitKeys, ...globalKeys].forEach(k => pools[k] = []);
        const poolGrossOO = [];
        const poolGrossLOO = [];
        const poolDGrossOO = [];
        const poolDGrossLOO = [];
        const poolMarginOO = [];
        const poolMarginLOO = [];
        const poolLoadRateOO = [];
        const poolLoadRateLOO = [];
        const poolNetPayOO = [];
        const poolNetPayLOO = [];
        const poolConsistOO = [];
        const poolConsistLOO = [];
        const poolMilesOO = [];
        const poolMilesLOO = [];
        const poolRPMOO = [];
        const poolRPMLOO = [];
        const poolRpmLoadOO = [];
        const poolRpmLoadLOO = [];
        const poolExpenseOO = [];
        const poolExpenseLOO = [];
        const poolRetentionOO = [];
        const poolRetentionLOO = [];
        const poolTenureOO = [];
        const poolTenureLOO = [];

        Object.keys(metrics).forEach(key => {
            const m = metrics[key];
            const cleanKey = helpers.clean(key);
            
            if (!validPoolDispatchers.has(cleanKey)) return;

            splitKeys.forEach(k => {
                if (m.Combined[k] !== undefined) {
                    pools[k].push(m.Combined[k]);
                }
            });
            if (m.OO && m.OO.s_gross > 0) poolGrossOO.push(m.OO.s_gross);
            if (m.LOO && m.LOO.s_gross > 0) poolGrossLOO.push(m.LOO.s_gross);
            
            if (m.OO && m.OO.s_dGross > 0) poolDGrossOO.push(m.OO.s_dGross);
            if (m.LOO && m.LOO.s_dGross > 0) poolDGrossLOO.push(m.LOO.s_dGross);

            if (m.OO && m.OO.s_margin > 0) poolMarginOO.push(m.OO.s_margin);
            if (m.LOO && m.LOO.s_margin > 0) poolMarginLOO.push(m.LOO.s_margin);

            if (m.OO && m.OO.s_loadRate > 0) poolLoadRateOO.push(m.OO.s_loadRate);
            if (m.LOO && m.LOO.s_loadRate > 0) poolLoadRateLOO.push(m.LOO.s_loadRate);

            if (m.OO && m.OO.s_netPay > 0) poolNetPayOO.push(m.OO.s_netPay);
            if (m.LOO && m.LOO.s_netPay > 0) poolNetPayLOO.push(m.LOO.s_netPay);

            if (m.OO && m.OO.s_consist > 0) poolConsistOO.push(m.OO.s_consist);
            if (m.LOO && m.LOO.s_consist > 0) poolConsistLOO.push(m.LOO.s_consist);

            if (m.OO && m.OO.s_miles > 0) poolMilesOO.push(m.OO.s_miles);
            if (m.LOO && m.LOO.s_miles > 0) poolMilesLOO.push(m.LOO.s_miles);

            if (m.OO && m.OO.s_rpm > 0) poolRPMOO.push(m.OO.s_rpm);
            if (m.LOO && m.LOO.s_rpm > 0) poolRPMLOO.push(m.LOO.s_rpm);

            if (m.OO && m.OO.s_rpmLoad > 0) poolRpmLoadOO.push(m.OO.s_rpmLoad);
            if (m.LOO && m.LOO.s_rpmLoad > 0) poolRpmLoadLOO.push(m.LOO.s_rpmLoad);

            if (m.OO && m.OO.s_expense > 0) poolExpenseOO.push(m.OO.s_expense);
            if (m.LOO && m.LOO.s_expense > 0) poolExpenseLOO.push(m.LOO.s_expense);

            if (m.OO && m.OO.s_retention > 0) poolRetentionOO.push(m.OO.s_retention);
            if (m.LOO && m.LOO.s_retention > 0) poolRetentionLOO.push(m.LOO.s_retention);

            if (m.OO && m.OO.s_tenure > 0) poolTenureOO.push(m.OO.s_tenure);
            if (m.LOO && m.LOO.s_tenure > 0) poolTenureLOO.push(m.LOO.s_tenure);

            globalKeys.forEach(k => {
                if (m.Global[k] !== undefined) {
                    if (k === 's_wellness') {
                         if (dispatcherWellHistory[cleanKey] && dispatcherWellHistory[cleanKey].length > 0) {
                             pools[k].push(m.Global[k]);
                         }
                    } else {
                        pools[k].push(m.Global[k]);
                    }
                }
            });
        });

        Object.values(pools).forEach(p => p.sort((a,b) => a - b));
        poolGrossOO.sort((a,b) => a - b);
        poolGrossLOO.sort((a,b) => a - b);
        poolDGrossOO.sort((a,b) => a - b);
        poolDGrossLOO.sort((a,b) => a - b);
        poolMarginOO.sort((a,b) => a - b);
        poolMarginLOO.sort((a,b) => a - b);
        poolLoadRateOO.sort((a,b) => a - b);
        poolLoadRateLOO.sort((a,b) => a - b);
        poolNetPayOO.sort((a,b) => a - b);
        poolNetPayLOO.sort((a,b) => a - b);
        poolConsistOO.sort((a,b) => a - b);
        poolConsistLOO.sort((a,b) => a - b);
        poolMilesOO.sort((a,b) => a - b);
        poolMilesLOO.sort((a,b) => a - b);
        poolRPMOO.sort((a,b) => a - b);
        poolRPMLOO.sort((a,b) => a - b);
        poolRpmLoadOO.sort((a,b) => a - b);
        poolRpmLoadLOO.sort((a,b) => a - b);
        poolExpenseOO.sort((a,b) => a - b);
        poolExpenseLOO.sort((a,b) => a - b);
        poolRetentionOO.sort((a,b) => a - b);
        poolRetentionLOO.sort((a,b) => a - b);
        poolTenureOO.sort((a,b) => a - b);
        poolTenureLOO.sort((a,b) => a - b);

        
        const rangeMap = {};
        [...splitKeys, ...globalKeys].forEach(k => {
            if (pools[k] && pools[k].length > 0) {
                rangeMap[k] = { min: pools[k][0], max: pools[k][pools[k].length - 1] };
            } else {
                rangeMap[k] = { min: 0, max: 0 };
            }
        });

        const rangeGrossOO = { min: poolGrossOO[0] || 0, max: poolGrossOO[poolGrossOO.length - 1] || 0 };
        const rangeGrossLOO = { min: poolGrossLOO[0] || 0, max: poolGrossLOO[poolGrossLOO.length - 1] || 0 };
        
        const rangeDGrossOO = { min: poolDGrossOO[0] || 0, max: poolDGrossOO[poolDGrossOO.length - 1] || 0 };
        const rangeDGrossLOO = { min: poolDGrossLOO[0] || 0, max: poolDGrossLOO[poolDGrossLOO.length - 1] || 0 };
        
        const rangeMarginOO = { min: poolMarginOO[0] || 0, max: poolMarginOO[poolMarginOO.length - 1] || 0 };
        const rangeMarginLOO = { min: poolMarginLOO[0] || 0, max: poolMarginLOO[poolMarginLOO.length - 1] || 0 };

        const rangeLoadRateOO = { min: poolLoadRateOO[0] || 0, max: poolLoadRateOO[poolLoadRateOO.length - 1] || 0 };
        const rangeLoadRateLOO = { min: poolLoadRateLOO[0] || 0, max: poolLoadRateLOO[poolLoadRateLOO.length - 1] || 0 };

        const rangeNetPayOO = { min: poolNetPayOO[0] || 0, max: poolNetPayOO[poolNetPayOO.length - 1] || 0 };
        const rangeNetPayLOO = { min: poolNetPayLOO[0] || 0, max: poolNetPayLOO[poolNetPayLOO.length - 1] || 0 };

        const rangeConsistOO = { min: poolConsistOO[0] || 0, max: poolConsistOO[poolConsistOO.length - 1] || 0 };
        const rangeConsistLOO = { min: poolConsistLOO[0] || 0, max: poolConsistLOO[poolConsistLOO.length - 1] || 0 };

        const rangeMilesOO = { min: poolMilesOO[0] || 0, max: poolMilesOO[poolMilesOO.length - 1] || 0 };
        const rangeMilesLOO = { min: poolMilesLOO[0] || 0, max: poolMilesLOO[poolMilesLOO.length - 1] || 0 };

        const rangeRPMOO = { min: poolRPMOO[0] || 0, max: poolRPMOO[poolRPMOO.length - 1] || 0 };
        const rangeRPMLOO = { min: poolRPMLOO[0] || 0, max: poolRPMLOO[poolRPMLOO.length - 1] || 0 };

        const rangeRpmLoadOO = { min: poolRpmLoadOO[0] || 0, max: poolRpmLoadOO[poolRpmLoadOO.length - 1] || 0 };
        const rangeRpmLoadLOO = { min: poolRpmLoadLOO[0] || 0, max: poolRpmLoadLOO[poolRpmLoadLOO.length - 1] || 0 };

        const rangeExpenseOO = { min: poolExpenseOO[0] || 0, max: poolExpenseOO[poolExpenseOO.length - 1] || 0 };
        const rangeExpenseLOO = { min: poolExpenseLOO[0] || 0, max: poolExpenseLOO[poolExpenseLOO.length - 1] || 0 };

        const rangeRetentionOO = { min: poolRetentionOO[0] || 0, max: poolRetentionOO[poolRetentionOO.length - 1] || 0 };
        const rangeRetentionLOO = { min: poolRetentionLOO[0] || 0, max: poolRetentionLOO[poolRetentionLOO.length - 1] || 0 };
       
        const rangeTenureOO = { min: poolTenureOO[0] || 0, max: poolTenureOO[poolTenureOO.length - 1] || 0 };
        const rangeTenureLOO = { min: poolTenureLOO[0] || 0, max: poolTenureLOO[poolTenureLOO.length - 1] || 0 };

        

        Object.keys(metrics).forEach(key => {
            const m = metrics[key];
            const scores = {};

            const calcScore = (k, val, customRange = null) => {
                const r = customRange || rangeMap[k];
                if (r.max === r.min) return 100;

                let pct = (val - r.min) / (r.max - r.min);
                pct = Math.max(0, Math.min(1, pct));

                if (inverseMetrics.includes(k)) pct = 1 - pct;

                if (k === 's_wellness') {
                    return Math.round(70 + (pct * 30));
                }

                return Math.round(20 + (pct * 80));
            };


            globalKeys.forEach(k => scores[k] = calcScore(k, m.Global[k]));
            
            // Combined Metrics (Moved from Weighted to Direct per user request)
            scores.s_loads = calcScore('s_loads', m.Combined.s_loads);
            scores.s_trucks = calcScore('s_trucks', m.Combined.s_trucks);
            scores.s_weight = calcScore('s_weight', m.Combined.s_weight);
            scores.s_netPct = calcScore('s_netPct', m.Combined.s_netPct);
            scores.s_grossPct = calcScore('s_grossPct', m.Combined.s_grossPct);
            scores.s_marginPct = calcScore('s_marginPct', m.Combined.s_marginPct);


            // --- 2. WEIGHTED METRICS (OO vs LOO Split) ---
            const calcWeighted = (metricKey, rangeOO, rangeLOO) => {
                let sOO = 0, sLOO = 0;
                
                const hOO = m.OO && (m.OO.s_uniqueCount > 0);
                const hLOO = m.LOO && (m.LOO.s_uniqueCount > 0);

                if (hOO) sOO = calcScore(metricKey, m.OO[metricKey], rangeOO);
                if (hLOO) sLOO = calcScore(metricKey, m.LOO[metricKey], rangeLOO);

                if (hOO && hLOO) {
                    const cOO = m.OO.s_uniqueCount || 0;
                    const cLOO = m.LOO.s_uniqueCount || 0;
                    const tot = cOO + cLOO;
                    // Weighted average based on driver count
                    return tot > 0 ? Math.round((sOO * (cOO/tot)) + (sLOO * (cLOO/tot))) : Math.round((sOO+sLOO)/2);
                } else if (hOO) return sOO;
                else if (hLOO) return sLOO;
                
                return 0;
            };

            scores.s_gross = calcWeighted('s_gross', rangeGrossOO, rangeGrossLOO);
            scores.s_dGross = calcWeighted('s_dGross', rangeDGrossOO, rangeDGrossLOO);
            scores.s_margin = calcWeighted('s_margin', rangeMarginOO, rangeMarginLOO);
            scores.s_loadRate = calcWeighted('s_loadRate', rangeLoadRateOO, rangeLoadRateLOO);
            scores.s_netPay = calcWeighted('s_netPay', rangeNetPayOO, rangeNetPayLOO);
            scores.s_consist = calcWeighted('s_consist', rangeConsistOO, rangeConsistLOO);
            scores.s_miles = calcWeighted('s_miles', rangeMilesOO, rangeMilesLOO);
            scores.s_rpm = calcWeighted('s_rpm', rangeRPMOO, rangeRPMLOO);
            scores.s_rpmLoad = calcWeighted('s_rpmLoad', rangeRpmLoadOO, rangeRpmLoadLOO);
            scores.s_expense = calcWeighted('s_expense', rangeExpenseOO, rangeExpenseLOO);
            scores.s_retention = calcWeighted('s_retention', rangeRetentionOO, rangeRetentionLOO);
            scores.s_tenure = calcWeighted('s_tenure', rangeTenureOO, rangeTenureLOO);
            
            // Special handling for Driver Happiness (already calculated in Global, but ensuring consistency)
            scores.s_dHappy = calcScore('s_dHappy', m.Global.s_dHappy);
            scores.s_cHappy = calcScore('s_cHappy', m.Global.s_cHappy);

            // --- 3. CATEGORY SCORES ---
            scores.REV = Math.round((scores.s_gross + scores.s_dGross + scores.s_margin + scores.s_loadRate + scores.s_netPay + scores.s_consist) / 6);
            scores.VEL = Math.round((scores.s_rpm + scores.s_miles + scores.s_loads + scores.s_rpmLoad + scores.s_trucks) / 5);
            scores.EFF = Math.round((scores.s_expense + scores.s_weight + scores.s_netPct + scores.s_grossPct + scores.s_marginPct) / 5);
            scores.OPS = Math.round((scores.s_rc + scores.s_calc + scores.s_ppw + scores.s_tue + scores.s_overdue + scores.s_hidden + scores.s_compliance) / 7);
            scores.HLT = Math.round((scores.s_retention + scores.s_tenure + scores.s_dHappy + scores.s_cHappy + scores.s_good + scores.s_bad + scores.s_cancel + scores.s_balance + scores.s_wellness) / 9);

            let overallScore = Math.round((scores.REV + scores.VEL + scores.EFF + scores.OPS + scores.HLT) / 5);

            const trophies = [];
            let bonus = 0;
            const hofData = appState.hallOfFameData || {};
            // HoF Logic with Tooltips
            const hofTitlesMap = {
                'DRIVER_GROSS': 'Highest Driver Gross', 'TOTAL_GROSS': 'Highest Total Gross', 'MARGIN': 'Highest Margin',
                'MILEAGE': 'Highest Mileage', 'RPM_ALL': 'Highest RPM',
                'WEEKLY_GROSS': 'Best Weekly Gross', 'WEEKLY_MARGIN': 'Best Weekly Margin', 'WEEKLY_MILEAGE': 'Best Weekly Miles',
                'WEEKLY_RPM_ALL': 'Best Weekly RPM', 'LOAD_RATE': 'Best Load Rate', 'LOAD_MARGIN': 'Best Load Margin',
                'REGION_RATE_NORTHEAST': 'Rate NE', 'REGION_RATE_SOUTHEAST': 'Rate SE', 'REGION_RATE_MIDWEST': 'Rate MW',
                'REGION_RATE_SOUTH': 'Rate South', 'REGION_RATE_WEST': 'Rate West', 'REGION_RATE_MOUNTAIN_WEST': 'Rate Mtn',
                'REGION_MARGIN_NORTHEAST': 'Margin NE', 'REGION_MARGIN_SOUTHEAST': 'Margin SE', 'REGION_MARGIN_MIDWEST': 'Margin MW',
                'REGION_MARGIN_SOUTH': 'Margin South', 'REGION_MARGIN_WEST': 'Margin West', 'REGION_MARGIN_MOUNTAIN_WEST': 'Margin Mtn'
            };
            const myHoFTitles = [];
            Object.entries(hofData).forEach(([k, r]) => {
                if (r.holder_name && helpers.clean(r.holder_name) === key) {
                    const baseKey = k.replace(/^(OO|LOO)_/, '');
                    const t = hofTitlesMap[baseKey] || baseKey;
                    if (!myHoFTitles.includes(t)) myHoFTitles.push(t);
                }
            });

            if (myHoFTitles.length > 0) {
                trophies.push({ icon: '🏆', title: 'Hall of Fame', desc: myHoFTitles.join(', '), isHoF: true });
                bonus += 5;
            }

            // --- UPDATED TROPHIES (New Rules) ---
            if (scores.REV >= 70) trophies.push({ icon: '💰', title: 'Money Maker', desc: 'Financials Score 70+' });
            if (scores.VEL >= 70) trophies.push({ icon: '🚀', title: 'Full Throttle', desc: 'Velocity Score 70+' });
            if (scores.EFF >= 65) trophies.push({ icon: '🧠', title: 'Strategist', desc: 'Efficiency Score 65+' });
            if (scores.OPS >= 75) trophies.push({ icon: '⚙️', title: 'Operator', desc: 'Operations Score 85+' });
            if (scores.HLT >= 75) trophies.push({ icon: '🛡️', title: 'Ironclad', desc: 'Health Score 75+' });
            
            if (scores.s_gross >= 80) trophies.push({ icon: '💎', title: 'High Roller', desc: 'Gross Score 80+' });
            if (scores.s_loads >= 80) trophies.push({ icon: '📦', title: 'Volume King', desc: 'Volume Score 80+' });
            if (scores.s_rpm >= 70) trophies.push({ icon: '🎯', title: 'Sharpshooter', desc: 'RPM Score 70+' });
            
            if (scores.s_ppw >= 80 && scores.s_overdue >= 80 && scores.s_hidden >= 80) trophies.push({ icon: '✨', title: 'Clean Sheet', desc: 'Ops Perfection (80+)' });
            
            if (scores.s_good >= 75) trophies.push({ icon: '⚡', title: 'The Mover', desc: 'Good Moves Score 75+' });

            if (scores.s_dHappy >= 75) trophies.push({ icon: '🤝', title: 'People Person', desc: 'Driver Happiness 75+' });
            if (scores.s_cHappy >= 75) trophies.push({ icon: '🏢', title: 'Company Man', desc: 'Company Happiness 75+' });
            
            // Veteran: Active for all 12 tracked weeks
            if (scores.s_dHappy >= 75 && scores.s_cHappy >= 75) {
                trophies.push({ icon: '⚖️', title: 'The Diplomat', desc: 'Driver & Company Happiness 75+' });
            }

            const regularTrophiesCount = trophies.filter(t => !t.isHoF).length;
            bonus += regularTrophiesCount;
            
            overallScore = Math.min(100, overallScore + bonus);

            currentStatsMap[key] = {
                name: key,
                overallScore,
                scores,
                raw: metrics[key].raw,
                subStats: { OO: metrics[key].OO, LOO: metrics[key].LOO },
                totalGross: metrics[key].raw.medGross * 52, 
                totalMiles: metrics[key].raw.totalMiles,
                avgRpm: metrics[key].raw.avgRpm,
                trophies
            };
        });

        
        // --- CALCULATE MVP ---
        let maxScore = -1;
        let mvpId = null;
        Object.values(currentStatsMap).forEach(s => {
            if (s.overallScore > maxScore) {
                maxScore = s.overallScore;
                mvpId = s.name;
            }
        });
        if (mvpId && currentStatsMap[mvpId]) {
            currentStatsMap[mvpId].trophies.unshift({ icon: '👑', title: 'Season MVP', desc: 'Highest Overall Score' });
        }

        if (weeksBack === 0) {
            this.state.stats = currentStatsMap;
            this._statsCached = true;
            this._lastDataRef = appState.allHistoricalData;
        } else {
            this.state.prevStats = currentStatsMap;
        }
    },

    loadData: function() {
        const uniqueTeams = new Set();
        this.state.companies = ['AmongUs', 'EBInfinity', 'SMJ'];
        
        // Remove localStorage dependency
        this.state.ratingChanges = { count: 0, items: [] };

        const getMonKey = (d) => {
            const date = new Date(d);
            if (isNaN(date.getTime())) return null;
            const day = date.getUTCDay();
            const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
            return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff)).toISOString().split('T')[0];
        };
        const currentWeekKey = getMonKey(new Date());

        if (appState && appState.allDispatcherNames && appState.allDispatcherNames.length > 0) {
            let rawDispatchers = appState.allDispatcherNames.map((name) => {
                
                let companyName = null;
                let team = '';
                let ooNamesSet = new Set();
                let looNamesSet = new Set();

                const cleanName = name.trim().toLowerCase();

                // --- DATE WINDOW SETUP ---
                const tDate = new Date();
                const curDay = tDate.getUTCDay();
                const endW = new Date(tDate);
                endW.setUTCDate(tDate.getUTCDate() - (curDay === 0 ? 6 : curDay - 1) - 7);
                endW.setUTCHours(23, 59, 59, 999);
                const startW = new Date(endW);
                startW.setUTCDate(endW.getUTCDate() - (12 * 7));
                // -------------------------

                // We keep this ONLY for Company Name / Team detection, NOT for counting
                if (appState.profiles && appState.profiles.liveDriverCountData) {
                    const myDrivers = appState.profiles.liveDriverCountData.filter(d => {
                        if (!d.dispatcher_name) return false;
                        const dName = d.dispatcher_name.trim().toLowerCase();
                        return dName === cleanName || dName.includes(cleanName) || cleanName.includes(dName);
                    });

                    if (myDrivers.length > 0) {
                        if (myDrivers[0].company_name) companyName = myDrivers[0].company_name;
                        if (myDrivers[0].dispatcher_team) team = myDrivers[0].dispatcher_team;
                    }
                }

                // 2. Historical Drivers (Last 12 Weeks Only)
                if (appState.loads && appState.loads.historicalStubsData) {
                     appState.loads.historicalStubsData.forEach(s => {
                         if (!s.stub_dispatcher) return;
                         
                         // Check Date
                         const sDate = new Date(s.pay_date);
                         if (sDate < startW || sDate > endW) return;

                         if (s.stub_dispatcher.trim().toLowerCase() === cleanName) {
                             const type = (s.contract_type || '').toUpperCase() === 'OO' ? 'OO' : 'LOO';
                             if (type === 'OO') ooNamesSet.add(s.driver_name);
                             else looNamesSet.add(s.driver_name);
                         }
                     });
                }

                // Fallback for Company/Team
                if (!companyName || team === 'General') {
                    const allRecords = appState.allHistoricalData 
                        ? appState.allHistoricalData.filter(d => d.dispatcherName === name).sort((a, b) => new Date(b.date) - new Date(a.date)) 
                        : [];
                    const recordWithInfo = allRecords.find(r => (r.company_name && r.company_name.trim()) || (r.company && r.company.trim()) || (r.dispatcherCompany && r.dispatcherCompany.trim()));
                    if (recordWithInfo) {
                        if (!companyName) companyName = recordWithInfo.company_name || recordWithInfo.company || recordWithInfo.dispatcherCompany;
                    }
                    const recordWithTeam = allRecords.find(r => r.dispatcherTeam && r.dispatcherTeam.trim());
                    if (recordWithTeam && !team) team = recordWithTeam.dispatcherTeam;
                }
                
                if (!companyName) companyName = team;

                let companyGroup = 'Other';
                const cUp = String(companyName || '').toUpperCase();
                if (cUp.includes('SMJ')) companyGroup = 'SMJ';
                else if (cUp.includes('INFINITY') || cUp.includes('EBI')) companyGroup = 'EBInfinity';
                else if (cUp.includes('AMONG')) companyGroup = 'AmongUs';

               const TEAMS_TO_SPLIT = ['Miles', 'Uros', 'Agnius', 'Stefan'];
                if (TEAMS_TO_SPLIT.includes(team)) {
                    if (companyGroup === 'SMJ') team += ' SMJ';
                    else if (companyGroup === 'EBInfinity') team += ' EB Infinity';
                    else if (companyGroup === 'AmongUs') team += ' AmongUs';
                    else team = '';
                }

                let logo = LOGO_URLS.Default;
                if (companyGroup === 'SMJ') logo = LOGO_URLS.SMJ;
                else if (companyGroup === 'EBInfinity') logo = LOGO_URLS.EBInfinity;
                else if (companyGroup === 'AmongUs') logo = LOGO_URLS.AmongUs;

                const stats = this.state.stats[cleanName] || { overallScore: 75, scores: {} };
                let rating = stats.overallScore;
                
                let cardType = 'fut-bronze';
                if (rating >= 75) cardType = 'fut-gold';
                else if (rating >= 61) cardType = 'fut-silver';

                // --- NEW LOGIC: Always compare against calculated PrevStats (Week - 1) ---
                const prevStats = this.state.prevStats && this.state.prevStats[cleanName];
                // If no history exists, diff is 0
                const prevOverall = prevStats ? prevStats.overallScore : rating; 
                
                let diff = rating - prevOverall;
                const changeTs = Date.now();

                const metricDiffs = {};
                const prevScores = prevStats ? prevStats.scores : (stats.scores || {});

                Object.keys(stats.scores || {}).forEach(k => {
                    const cur = (stats.scores && stats.scores[k]) || 0;
                    const prev = (prevScores && prevScores[k]) || 0;
                    if (cur !== prev) metricDiffs[k] = cur - prev;
                });

                const ooTrucks = ooNamesSet.size;
                const looTrucks = looNamesSet.size;
                const ooNames = Array.from(ooNamesSet).join(', ');
                const looNames = Array.from(looNamesSet).join(', ');

                return {
                    id: name,
                    name: name,
                    team: team,
                    company: companyName,
                    companyGroup: companyGroup,
                    companyLogo: logo,
                    teamLogo: SettingsUI.getTeamLogo(team),
                    photo: (SettingsUI.getDispatcherPhoto(name) && SettingsUI.getDispatcherPhoto(name).trim() !== '')
                           ? SettingsUI.getDispatcherPhoto(name) 
                           : SILHOUETTE_ICON,
                    rating: rating,
                    diff: diff,
                    metricDiffs: metricDiffs,
                    cardType: cardType,
                    ooTrucks: ooTrucks,
                    looTrucks: looTrucks,
                    ooNames: ooNames,
                    looNames: looNames,
                    changeTs: changeTs
                };
            
            });

            // --- CALC RECENT ACTIVITY (LAST 2 WEEKS) ---
            const last2WeeksMiles = {};
            const pToday = new Date();
            const pW1 = new Date(pToday); pW1.setUTCDate(pToday.getUTCDate() - 7);
            const pW2 = new Date(pToday); pW2.setUTCDate(pToday.getUTCDate() - 14);
            const pK1 = getMonKey(pW1);
            const pK2 = getMonKey(pW2);

            if (appState.loads && appState.loads.historicalStubsData) {
                appState.loads.historicalStubsData.forEach(s => {
                    if (s.stub_dispatcher) {
                        const k = getMonKey(s.pay_date);
                        if (k === pK1 || k === pK2) {
                             const c = s.stub_dispatcher.trim().toLowerCase();
                             const m = parseFloat(s.total_miles) || 0;
                             last2WeeksMiles[c] = (last2WeeksMiles[c] || 0) + m;
                        }
                    }
                });
            }
            
            this.state.dispatchers = rawDispatchers.filter(d => {
                const cleanName = d.name.trim().toLowerCase();
                const stats = this.state.stats[cleanName];
                const totalMiles = stats && stats.raw ? (stats.raw.totalMiles || 0) : 0;
                const recentMiles = last2WeeksMiles[cleanName] || 0;
                
                return totalMiles >= 20000 && recentMiles > 0;
            });

            

            this.state.ratingChanges = { count: 0, items: [] };
            this.state.dispatchers.forEach(d => {
                if (d.team) uniqueTeams.add(d.team);
                // Notification Logic: Only show if there is a diff AND this diff is likely from a new week calculation
                if (d.diff !== 0) {
                    this.state.ratingChanges.count++;
                    this.state.ratingChanges.items.push({ id: d.id, name: d.name, old: d.rating - d.diff, new: d.rating, diff: d.diff, photo: d.photo, cardType: d.cardType, changeTs: d.changeTs });
                }
            });

        } else {
            this.state.dispatchers = [];
        }

        this.state.teams = Array.from(uniqueTeams).sort();
    },

    getCompleteStats: function(dispatcherName) {
        if (!appState.allHistoricalData) return {};
        const records = appState.allHistoricalData.filter(d => d.dispatcherName === dispatcherName);
        
        let totalRevenue = 0, totalMiles = 0, totalLoads = 0, totalMargin = 0;
        
        records.forEach(rec => {
            totalRevenue += parseFloat(rec.driver_gross) || 0;
            totalMiles += parseFloat(rec.total_miles) || 0;
            const loads = parseFloat(rec.load_count);
            totalLoads += (isNaN(loads) ? 1 : loads);
            totalMargin += parseFloat(rec.margin) || 0;
        });

        const rpm = totalMiles > 0 ? (totalRevenue / totalMiles) : 0;
        const avgMargin = totalLoads > 0 ? (totalMargin / totalLoads) : 0;
        const fleetHealthScore = Math.min(100, Math.max(50, Math.round((rpm / 3.5) * 100))); 
        const complianceScore = Math.min(100, Math.round(90 + (totalLoads > 50 ? 5 : 0) + (rpm > 2.5 ? 3 : -2)));

        return {
            revenue: totalRevenue,
            loads: totalLoads,
            miles: totalMiles,
            rpm: rpm,
            margin: totalMargin,
            avgMargin: avgMargin,
            rank: this.state.rankings[dispatcherName] || '-',
            totalRank: this.state.totalDispatchers,
            fleetHealth: fleetHealthScore,
            compliance: complianceScore,
            delegations: Math.floor(totalLoads * 0.05)
        };
    },

    renderLayout: function() {
        const container = document.getElementById('dispatchers-view');
        container.classList.remove('hidden');
        
        // 1. Filter logic
        this.state.dispatchers.forEach(d => {
            let matches = true;
            const f = this.state.advFilters;
            const myStats = this.state.stats[d.name.trim().toLowerCase()] || {};
            const s = myStats.scores || {};
            
            const vals = {
                overall: d.rating,
                gross: s.s_gross, dGross: s.s_dGross, margin: s.s_margin, loadRate: s.s_loadRate, netPay: s.s_netPay, consist: s.s_consist,
                rpm: s.s_rpm, miles: s.s_miles, loads: s.s_loads, rpmLoad: s.s_rpmLoad, trucks: s.s_trucks,
                expense: s.s_expense, weight: s.s_weight, netPct: s.s_netPct, grossPct: s.s_grossPct, marginPct: s.s_marginPct,
                rc: s.s_rc, calc: s.s_calc, ppw: s.s_ppw, tue: s.s_tue, overdue: s.s_overdue, hidden: s.s_hidden, compliance: s.s_compliance,
                retention: s.s_retention, tenure: s.s_tenure, good: s.s_good, bad: s.s_bad,
                dHappy: s.s_dHappy, cHappy: s.s_cHappy, cancel: s.s_cancel, balance: s.s_balance, wellness: s.s_wellness
            };

            for (const key in f) {
                const v = vals[key] !== undefined ? vals[key] : 0;
                if (v < f[key].min || v > f[key].max) matches = false;
            }

            if (d.cardType === 'fut-gold' && !this.state.tiers.gold) matches = false;
            if (d.cardType === 'fut-silver' && !this.state.tiers.silver) matches = false;
            if (d.cardType === 'fut-bronze' && !this.state.tiers.bronze) matches = false;

            if (this.state.activeCompanyFilter.length > 0 && !this.state.activeCompanyFilter.includes(d.companyGroup)) matches = false;
            if (this.state.activeTeamFilter.length > 0 && !this.state.activeTeamFilter.includes(d.team)) matches = false;

            if (this.state.searchTerm && !d.name.toLowerCase().includes(this.state.searchTerm)) matches = false;

            if (this.state.specialFilter) {
                const ms = this.state.stats[d.name.trim().toLowerCase()];
                if (!ms) matches = false;
                else {
                    switch(this.state.specialFilter) {
                        case 'high_roller': if ((ms.scores?.s_gross || 0) < 80) matches = false; break;
                        case 'volume_king': if ((ms.scores?.s_loads || 0) < 80) matches = false; break;
                        case 'money_maker': if ((ms.scores?.REV || 0) < 70) matches = false; break;
                        case 'sharpshooter': if ((ms.scores?.s_rpm || 0) < 70) matches = false; break;
                        case 'ironclad': if ((ms.scores?.HLT || 0) < 75) matches = false; break;
                        case 'people_person': if ((ms.scores?.s_dHappy || 0) < 75) matches = false; break;
                        case 'company_man': if ((ms.scores?.s_cHappy || 0) < 75) matches = false; break;
                        case 'clean_sheet': if ((ms.scores?.s_ppw || 0) < 80 || (ms.scores?.s_overdue || 0) < 80 || (ms.scores?.s_hidden || 0) < 80) matches = false; break;
                        case 'mover': if ((ms.scores?.s_good || 0) < 75) matches = false; break;
                        case 'full_throttle': if ((ms.scores?.VEL || 0) < 70) matches = false; break;
                        case 'strategist': if ((ms.scores?.EFF || 0) < 65) matches = false; break;
                        case 'operator': if ((ms.scores?.OPS || 0) < 75) matches = false; break;
                        case 'diplomat': if ((ms.scores?.s_dHappy || 0) < 75 || (ms.scores?.s_cHappy || 0) < 75) matches = false; break;
                    }
                }
            }

            d.isDimmed = !matches;
        });

        const ooGroup = [];
        const looGroup = [];
        const hybridGroup = [];

        this.state.dispatchers.forEach(d => {
            const oo = d.ooTrucks || 0;
            const loo = d.looTrucks || 0;
            const diff = Math.abs(oo - loo);
            const total = oo + loo;

            if (total === 0) return;

            let isHybrid = true;

            if (total === 1) {
                isHybrid = false;
            } else if (total === 2) {
                if (diff === 2) isHybrid = false; 
            } else if (total === 3) {
                if (diff === 3) isHybrid = false; 
            } else if (total === 4) {
                if (diff === 4) isHybrid = false;
            } else if (total >= 5 && total <= 11) {
                if (diff >= 3) isHybrid = false;
            } else if (total >= 12 && total <= 17) {
                if (diff >= 4) isHybrid = false;
            } else if (total >= 18 && total <= 22) {
                if (diff >= 6) isHybrid = false;
            } else if (total >= 23 && total <= 30) {
                if (diff >= 7) isHybrid = false;
            } else if (total >= 31 && total <= 40) {
                if (diff >= 9) isHybrid = false;
            } else if (total >= 41 && total <= 50) {
                if (diff >= 15) isHybrid = false;
            } else if (total >= 51) {
                if (diff >= 20) isHybrid = false;
            }

            if (isHybrid) {
                hybridGroup.push(d);
            } else {
                if (oo > loo) ooGroup.push(d);
                else looGroup.push(d);
            }
        });

      container.innerHTML = `
            <style>
                /* #dispatchers-view { zoom: 1; } Zoom removed */
                .adv-slider-row { margin-bottom: 12px; display: flex; align-items: center; gap: 10px; width: 100%; height: 24px; }
                .slider-header { flex: 0 0 140px; display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #9ca3af; font-weight: 600; padding-right: 10px; }
                .slider-val-display { color: #fbbf24; font-family: monospace; font-weight: 700; }
               .slider-track-container { flex: 1; height: 6px; background: #374151; border-radius: 3px; position: relative; cursor: pointer; margin-right: 15px; }
                .slider-fill { position: absolute; top: 0; bottom: 0; background: #14b8a6; border-radius: 3px; pointer-events: none; opacity: 0.8; transition: left 0.05s, width 0.05s; }
                .slider-thumb { position: absolute; top: 50%; width: 14px; height: 14px; background: #f3f4f6; border: 2px solid #14b8a6; border-radius: 50%; transform: translate(-50%, -50%); cursor: grab; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.5); transition: left 0.05s; }
                .slider-thumb:active { cursor: grabbing; transform: translate(-50%, -50%) scale(1.1); border-color: #fbbf24; }
                
                /* Tooltip CSS */
                .dsp-tooltip { position: relative; display: inline-flex; justify-content: center; align-items: center; width: 22px; height: 22px; background: #374151; color: #9ca3af; border-radius: 50%; cursor: help; font-size: 13px; font-weight: bold; margin-left: auto; transition: 0.2s; border: 1px solid #4b5563; }
                .dsp-tooltip:hover { background: #14b8a6; color: white; border-color: #14b8a6; }
                .dsp-tooltip-popup { position: absolute; top: 30px; right: -10px; width: 280px; background: #1f2937; border: 1px solid #4b5563; padding: 12px; border-radius: 6px; box-shadow: 0 10px 25px -3px rgba(0, 0, 0, 0.7); visibility: hidden; opacity: 0; transform: translateY(-5px); transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); z-index: 100; text-transform: none; text-align: left; pointer-events: none; }
                .dsp-tooltip:hover .dsp-tooltip-popup { visibility: visible; opacity: 1; transform: translateY(0); }
                .dsp-tooltip-popup p { margin: 0 0 8px 0; color: #e5e7eb; font-size: 12px; line-height: 1.4; font-weight: 500; }
                .dsp-tooltip-popup p:last-child { margin: 0; color: #9ca3af; font-size: 11px; }
                .dsp-tooltip-popup::before { content: ''; position: absolute; top: -6px; right: 15px; width: 10px; height: 10px; background: #1f2937; border-left: 1px solid #4b5563; border-top: 1px solid #4b5563; transform: rotate(45deg); }

                .adv-modal-content { max-width: 600px !important; }
                .adv-filter-grid { display: block !important; max-height: 60vh; overflow-y: auto; padding-right: 5px; }
                .adv-group-title { font-size: 10px; text-transform: uppercase; color: #4b5563; margin: 15px 0 5px 0; font-weight: 800; letter-spacing: 1px; border-bottom: 1px solid #1f2937; padding-bottom: 2px; }
            </style>
            <div class="dota-view">
                <div class="perf-top-bar">
                    <div class="footer-left">
                        <button class="adv-filter-btn" id="open-adv-filters">
                            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>
                            Filters & Rating
                        </button>
                        <div class="dsp-tiers-group">
                             <label class="dsp-tier-check ${this.state.tiers.gold ? 'active' : ''}" id="tier-gold">Gold</label>
                             <label class="dsp-tier-check ${this.state.tiers.silver ? 'active' : ''}" id="tier-silver">Silver</label>
                             <label class="dsp-tier-check ${this.state.tiers.bronze ? 'active' : ''}" id="tier-bronze">Bronze</label>
                        </div>
                    </div>

                    <div class="footer-center">
                        <input type="text" id="dsp-search-input" class="dsp-search-input" placeholder="SEARCH DISPATCHERS..." value="${this.state.searchTerm}">
                    </div>

                   <div class="footer-right">
                        <div id="ms-company" class="dsp-multiselect-wrapper"></div>
                        <div id="ms-team" class="dsp-multiselect-wrapper"></div>
                        
                       <div class="dsp-settings-btn" id="open-settings-ui" style="cursor:pointer; width:38px; height:38px; color:#e5e7eb; border:1px solid #4b5563; border-radius:4px; display:flex; align-items:center; justify-content:center; background: #1f2937; transition: all 0.2s;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:22px; height:22px;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                                <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </div>

                        <div class="dsp-tooltip" style="margin-left: 10px; display:flex; align-items:center; background: transparent !important; border: none !important;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:24px; height:24px; color:#9ca3af !important; cursor: help;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                            </svg>
                            <div class="dsp-tooltip-popup" style="right: 0; width: 340px;">
                                <p><strong style="color:#14b8a6; text-transform:uppercase;">Profiles Dashboard Guide</strong></p>
                                <p style="margin-bottom:8px;">This section displays <strong>dispatcher profiles</strong> based on the last 12 completed weeks (excluding Live).</p>
                                <p style="margin-bottom:8px; font-size:11px; color:#fbbf24;">* Only dispatchers with 20k+ miles are shown.</p>
                                <p style="margin-bottom:8px;"><strong>Groups:</strong></p>
                                <ul style="list-style:none; padding:0; margin:0 0 8px 0; color:#9ca3af; font-size:11px;">
                                    <li>• <span style="color:#ef4444; font-weight:700;">OO</span>: Owner Operators</li>
                                    <li>• <span style="color:#3b82f6; font-weight:700;">LOO</span>: Lease Owner Operators</li>
                                    <li>• <span style="color:#22c55e; font-weight:700;">ALL</span>: Mixed Fleet</li>
                                </ul>
                                <p>The system automatically rates dispatchers (0-100) based on 5 main categories: Financials, Velocity, Efficiency, Operations, and Health.</p>
                                <div style="margin-top:8px; border-top:1px solid #4b5563; padding-top:8px;">
                                    <strong style="color:#fbbf24; font-size:11px;">Bonus Points:</strong>
                                    <p style="margin-top:4px; margin-bottom:0;">We also award <strong>Trophies</strong> for outstanding performance. Each regular trophy adds <span style="color:#fff;">+1 point</span> to the Overall Score, while a Hall of Fame trophy adds <span style="color:#fff;">+5 points</span>.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="dota-heroes-area">
                    <div class="rows-container">
                        <div class="category-row">
                            <div class="col-header type-hybrid">ALL</div>
                            <div class="cards-grid horizontal-scroll" id="grid-hybrid"></div>
                        </div>
                        <div class="category-row">
                            <div class="col-header type-oo">OO</div>
                            <div class="cards-grid horizontal-scroll" id="grid-oo"></div>
                        </div>
                        <div class="category-row">
                            <div class="col-header type-loo">LOO</div>
                            <div class="cards-grid horizontal-scroll" id="grid-loo"></div>
                        </div>
                    </div>
                </div>

                <div class="perf-bottom-bar" id="achievements-bar"></div>
            </div>

            

            <div id="dsp-notification-area" class="dsp-notification-area"></div>

            <div id="dsp-changes-modal" class="dsp-modal-overlay">
                <div class="changes-modal-content">
                     <button class="close-modal-btn" id="close-changes-modal" style="top:10px; right:10px;">✕</button>
                     <h3 class="changes-title">Rating Updates</h3>
                     <div id="changes-list-grid" class="changes-grid"></div>
                </div>
            </div>

            <div id="adv-filter-modal" class="dsp-modal-overlay">
                <div class="adv-modal-content">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:15px; border-bottom:1px solid #374151; padding-bottom:10px;">
                        <h3 style="color:#fff; font-size:16px; font-weight:800; text-transform:uppercase; margin:0;">Advanced Metrics Filter</h3>
                        <div class="dsp-tooltip">
                            ?
                            <div class="dsp-tooltip-popup">
                                <p><strong>How to use:</strong> Drag the left and right handles on the slider to set the Min and Max range.</p>
                                <p>This allows you to filter dispatchers whose performance metrics fall within the specified range (e.g., only those with 90+ Gross).</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="adv-filter-grid">
                        <div class="adv-group-title" style="margin-top:0;">Main</div>
                        ${this.renderSliderControl('Overall Rating', 'overall')}
                        
                        <div class="adv-group-title">Financials</div>
                        ${this.renderSliderControl('Total Gross', 'gross')}
                        ${this.renderSliderControl('Driver Gross', 'dGross')}
                        ${this.renderSliderControl('Weekly Margin', 'margin')}
                        ${this.renderSliderControl('Load Rate', 'loadRate')}
                        ${this.renderSliderControl('Actual Net Pay', 'netPay')}
                        ${this.renderSliderControl('Consistency', 'consist')}

                        <div class="adv-group-title">Velocity</div>
                        ${this.renderSliderControl('Weekly RPM', 'rpm')}
                        ${this.renderSliderControl('Weekly Miles', 'miles')}
                        ${this.renderSliderControl('Loads Per Week', 'loads')}
                        ${this.renderSliderControl('RPM per Load', 'rpmLoad')}
                        ${this.renderSliderControl('Trucks', 'trucks')}

                        <div class="adv-group-title">Efficiency</div>
                        ${this.renderSliderControl('Expense Ratio', 'expense')}
                        ${this.renderSliderControl('Weight', 'weight')}
                        ${this.renderSliderControl('Net %', 'netPct')}
                        ${this.renderSliderControl('Gross %', 'grossPct')}
                        ${this.renderSliderControl('Margin %', 'marginPct')}

                        <div class="adv-group-title">Operations</div>
                        ${this.renderSliderControl('Compliance', 'compliance')}
                        ${this.renderSliderControl('RC Entry Time', 'rc')}
                        ${this.renderSliderControl('Calc. Activity', 'calc')}
                        ${this.renderSliderControl('Missing PPW', 'ppw')}
                        ${this.renderSliderControl('Tuesday Open', 'tue')}
                        ${this.renderSliderControl('Overdue Loads', 'overdue')}
                        ${this.renderSliderControl('Hidden Miles', 'hidden')}

                        <div class="adv-group-title">Health</div>
                        ${this.renderSliderControl('Retention %', 'retention')}
                        ${this.renderSliderControl('Median Tenure', 'tenure')}
                        ${this.renderSliderControl('Good Moves', 'good')}
                        ${this.renderSliderControl('Bad Moves', 'bad')}
                        ${this.renderSliderControl('Driver Happ.', 'dHappy')}
                        ${this.renderSliderControl('Company Happ.', 'cHappy')}
                        ${this.renderSliderControl('Wellness %', 'wellness')}
                        ${this.renderSliderControl('Canceled Loads', 'cancel')}
                        ${this.renderSliderControl('Balance / PO', 'balance')}
                    </div>
                    <div class="adv-modal-footer" style="display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-top:15px; border-top:1px solid #374151; padding-top:15px;">
                        <span id="af-clear" style="cursor:pointer; color:#9ca3af; font-size:13px; margin-right:auto; text-decoration:underline;">Reset All</span>
                        <button class="modal-btn btn-cancel" id="af-cancel">Cancel</button>
                        <button class="modal-btn btn-apply" id="af-apply">Apply Filters</button>
                    </div>
                </div>
            </div>
        `;

        const renderCards = (list, id) => {
            const el = document.getElementById(id);
            if(el) {
                el.innerHTML = '';
                el.className = 'cards-grid horizontal-scroll';
                
                const count = list.length;
                if (count <= 10) el.classList.add('rows-1');
                else if (count <= 24) el.classList.add('rows-2');
                else el.classList.add('rows-3');

                list.forEach(d => {
                    const card = document.createElement('div');
                    card.className = `dota-card-mini ${d.cardType}`;
                    
                    if (d.isDimmed) {
                        card.style.opacity = '0.1';
                        card.style.filter = 'grayscale(100%)';
                        card.style.pointerEvents = 'none';
                    } else {
                        card.onclick = () => this.openDispatcherModal(d.id);
                        card.style.cursor = 'pointer';
                    }

                    card.innerHTML = `
                        <img src="${d.photo}" class="dota-card-img" onerror="this.src='https://via.placeholder.com/100'">
                        <span class="dota-rating-badge">${d.rating}</span>
                        <div class="dota-card-name-bar"><span class="dota-card-name">${d.name}</span></div>
                    `;
                    el.appendChild(card);
                });
            }
        };
        renderCards(hybridGroup, 'grid-hybrid');
        renderCards(ooGroup, 'grid-oo');
        renderCards(looGroup, 'grid-loo');

        this.renderAchievementsBtns();
        this.attachEvents();
        this.renderNotification();
       if (typeof LeaderboardUI !== 'undefined') {
            LeaderboardUI.renderTriggerBtn(this);
        } else {
            this.loadAllStarScript();
        }
        
    },

    renderAchievementsBtns: function() {
        const container = document.getElementById('achievements-bar');
        if (!container) return;

        const btns = [
            { id: 'high_roller', label: 'High Roller', icon: '💎', desc: 'Gross Score 80+' },
            { id: 'volume_king', label: 'Volume King', icon: '📦', desc: 'Loads Score 80+' },
            { id: 'money_maker', label: 'Money Maker', icon: '💰', desc: 'Financials Score 70+' },
            { id: 'sharpshooter', label: 'Sharpshooter', icon: '🎯', desc: 'RPM Score 70+' },
            { id: 'ironclad', label: 'Ironclad', icon: '🛡️', desc: 'Health Score 75+' },
            { id: 'full_throttle', label: 'Full Throttle', icon: '🚀', desc: 'Velocity Score 70+' },
            { id: 'strategist', label: 'Strategist', icon: '🧠', desc: 'Efficiency Score 65+' },
            { id: 'operator', label: 'Operator', icon: '⚙️', desc: 'Operations Score 75+' },
            { id: 'people_person', label: 'People Person', icon: '🤝', desc: 'Driver Happy 75+' },
            { id: 'company_man', label: 'Company Man', icon: '🏢', desc: 'Comp Happy 75+' },
            { id: 'clean_sheet', label: 'Clean Sheet', icon: '✨', desc: 'Ops Perfection (80+ on PPW, Overdue, Hidden)' },
            { id: 'mover', label: 'The Mover', icon: '⚡', desc: 'Good Moves Score 75+' },
            { id: 'diplomat', label: 'The Diplomat', icon: '⚖️', desc: 'Driver & Company Happiness 75+' },
        ];

        container.innerHTML = '';
        btns.forEach(b => {
            const btn = document.createElement('div');
            btn.className = `ach-btn ${this.state.specialFilter === b.id ? 'active' : ''}`;
            btn.onclick = () => {
                if (this.state.specialFilter === b.id) this.state.specialFilter = null;
                else this.state.specialFilter = b.id;
                this.renderLayout();
            };
            btn.innerHTML = `<span class="ach-icon">${b.icon}</span><span class="ach-lbl">${b.label}</span>`;
            btn.title = b.desc;
            container.appendChild(btn);
        });
    },


    attachEvents: function() {
        // Search
        const inp = document.getElementById('dsp-search-input');
        if(inp) {
            inp.addEventListener('input', (e) => {
                this.state.searchTerm = e.target.value.toLowerCase().trim();
                this.renderLayout();
                setTimeout(() => {
                   const el = document.getElementById('dsp-search-input');
                   if(el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
                }, 0);
            });
            inp.focus(); 
            const val = inp.value; inp.value = ''; inp.value = val;
        }

        // Tiers
        ['gold','silver','bronze'].forEach(t => {
            const el = document.getElementById(`tier-${t}`);
            if(el) el.onclick = () => {
                this.state.tiers[t] = !this.state.tiers[t];
                this.renderLayout();
            };
        });

        // Advanced Modal
        document.getElementById('open-adv-filters').onclick = () => {
            document.getElementById('adv-filter-modal').classList.add('open');
            // Initialize sliders whenever modal opens to attach events and set positions
            this.initSliders(); 
        };

        document.getElementById('af-clear').onclick = function() {
            // Animation trigger
            const btn = this;
            btn.classList.remove('reset-clicked');
            void btn.offsetWidth; // Trigger reflow
            btn.classList.add('reset-clicked');

            // Logic
            const f = DispatchersUI.state.advFilters;
            Object.keys(f).forEach(key => { f[key].min = 0; f[key].max = 100; });
            DispatchersUI.initSliders(); // Re-render slider positions
        };

        document.getElementById('af-cancel').onclick = () => document.getElementById('adv-filter-modal').classList.remove('open');
        document.getElementById('af-apply').onclick = () => {
            document.getElementById('adv-filter-modal').classList.remove('open');
            this.renderLayout();
        };


        // Render Multiselects
        this.renderMultiSelect('ms-company', 'Companies', ['SMJ','EBInfinity','AmongUs'], this.state.activeCompanyFilter, (v) => {
            this.state.activeCompanyFilter = v;
            this.renderLayout();
        });
        this.renderMultiSelect('ms-team', 'Teams', this.state.teams, this.state.activeTeamFilter, (v) => {
            this.state.activeTeamFilter = v;
            this.renderLayout();
        });
        const settingsBtn = document.getElementById('open-settings-ui');
        if (settingsBtn) {
            settingsBtn.onclick = () => {
                SettingsUI.openSettingsModal(
                    this.state.dispatchers.map(d => d.name),
                    this.state.teams,
                    () => {
                        this.loadData();
                        this.renderLayout();
                    }
                );
            };
        }
    },

    renderMultiSelect: function(containerId, label, options, activeSelected, onChange) {
        const container = document.getElementById(containerId);
        if(!container) return;
        
        container.innerHTML = '';
        const count = activeSelected.length;
        const btnText = count > 0 ? `${label} (${count})` : `All ${label}`;
        
        const btn = document.createElement('div');
        btn.className = 'dsp-multiselect-btn';
        btn.innerHTML = `<span>${btnText}</span> <span style="font-size:8px">▼</span>`;
        
        const dropdown = document.createElement('div');
        dropdown.className = 'dsp-multiselect-dropdown';
        
        options.forEach(opt => {
            const row = document.createElement('label');
            row.className = 'dsp-multi-option';
            const chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.className = 'dsp-multi-checkbox';
            chk.value = opt;
            chk.checked = activeSelected.includes(opt);
            
            chk.onchange = () => {
                let newSel = [...activeSelected];
                if(chk.checked) newSel.push(opt);
                else newSel = newSel.filter(x => x !== opt);
                onChange(newSel);
            };
            
            row.appendChild(chk);
            row.appendChild(document.createTextNode(opt === 'EBInfinity' ? 'EB Infinity' : opt));
            dropdown.appendChild(row);
        });

        btn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.dsp-multiselect-dropdown').forEach(d => { if(d !== dropdown) d.classList.remove('open'); });
            
            const rect = btn.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            if (spaceBelow < 200) {
                dropdown.style.bottom = '100%';
                dropdown.style.top = 'auto';
                dropdown.style.marginBottom = '5px';
            } else {
                dropdown.style.top = '100%';
                dropdown.style.bottom = 'auto';
                dropdown.style.marginTop = '5px';
            }
            
            dropdown.classList.toggle('open');
        };

        document.addEventListener('click', (e) => {
            if(!container.contains(e.target)) dropdown.classList.remove('open');
        });

        container.appendChild(btn);
        container.appendChild(dropdown);
    },
applySearchVisibility: function() {
        const term = this.state.searchTerm;
        const allCards = document.querySelectorAll('.dota-card-mini');
        
        allCards.forEach(card => {
            const nameEl = card.querySelector('.dota-card-name');
            const name = nameEl ? nameEl.textContent.toLowerCase() : '';
            
            if (term && term.length > 0 && !name.includes(term)) {
                card.style.display = 'none';
            } else {
                card.style.display = 'block';
            }
        });
    },
    toggleCompanyFilter: function(c) {
        const idx = this.state.activeCompanyFilter.indexOf(c);
        if (idx > -1) {
            this.state.activeCompanyFilter.splice(idx, 1);
        } else {
            this.state.activeCompanyFilter.push(c);
        }
        this.renderLayout(); 
    },

    toggleTeamFilter: function(t) {
        const idx = this.state.activeTeamFilter.indexOf(t);
        if (idx > -1) {
            this.state.activeTeamFilter.splice(idx, 1);
        } else {
            this.state.activeTeamFilter.push(t);
        }
        this.renderLayout();
    },

    openDispatcherModal: function(id) {
        if (!this.state.stats || Object.keys(this.state.stats).length === 0) {
            this.calculateGlobalRankings();
            this.processStats();
        }

        if (!this.state.dispatchers || this.state.dispatchers.length === 0) {
            this.loadData();
        }

        let targetId = id;
        let dObj = (this.state.dispatchers || []).find(d => d.id === id);
        
        if (!dObj) {
             const cleanInput = String(id).trim().toLowerCase();
             dObj = (this.state.dispatchers || []).find(d => d.name.trim().toLowerCase() === cleanInput);
             if (dObj) targetId = dObj.id;
        }

        if (!dObj) {
             const cleanName = String(targetId).trim().toLowerCase();
             if (this.state.stats[cleanName]) {
                 dObj = {
                     id: this.state.stats[cleanName].name,
                     name: this.state.stats[cleanName].name,
                     team: 'General',
                     rating: this.state.stats[cleanName].overallScore || 0,
                     diff: 0,
                     cardType: 'fut-bronze',
                     photo: SILHOUETTE_ICON
                 };
                 targetId = dObj.id;
                 if (!this.state.dispatchers) this.state.dispatchers = [];
                 this.state.dispatchers.push(dObj);
             }
        }

        if (!dObj) {
            console.error(`Dispatcher profile not found for: ${id}`);
            return;
        }

        if (typeof SettingsUI !== 'undefined') {
            const freshPhoto = SettingsUI.getDispatcherPhoto(dObj.name);
            if (freshPhoto && freshPhoto.trim() !== '') {
                dObj.photo = freshPhoto;
            }
        }

        this.state.selectedDispatcherId = targetId;
        
        let modal = document.getElementById('dispatcher-details-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'dispatcher-details-modal';
            modal.className = 'dsp-modal-overlay';
            modal.style.zIndex = '9999999'; 
            modal.innerHTML = `
                <button class="close-modal-btn" id="close-dsp-modal">✕</button>
                <div class="dsp-modal-content" id="dispatcher-modal-content"></div>
            `;
            document.body.appendChild(modal);
            
            const closeBtn = document.getElementById('close-dsp-modal');
            if(closeBtn) closeBtn.onclick = () => this.closeDispatcherModal();
            
            modal.onclick = (e) => {
                if(e.target.id === 'dispatcher-details-modal') this.closeDispatcherModal();
            };
        }
        
        modal.style.display = 'flex';
        modal.className = 'dsp-modal-overlay open';

        if (this._escListener) document.removeEventListener('keydown', this._escListener);
        this._escListener = (e) => {
            if (e.key === 'Escape') this.closeDispatcherModal();
        };
        document.addEventListener('keydown', this._escListener);

        let isAllStar = false;
        try {
            if (typeof AllStarUI !== 'undefined') {
                 const winners = AllStarUI.currentWinners || (AllStarUI.getBestDispatchers ? AllStarUI.getBestDispatchers() : {});
                 isAllStar = Object.values(winners).some(w => w.id === targetId);
            }
        } catch(e) {}

        if (isAllStar) {
            modal.classList.add('all-star-profile-glow');
        } else {
            modal.classList.remove('all-star-profile-glow');
        }

        this.renderDetails(targetId); 

        if (isAllStar) {
            const content = document.getElementById('dispatcher-modal-content');
            if (content) {
                const existing = content.querySelector('.all-star-badge-modal');
                if(existing) existing.remove();
                const badge = document.createElement('div');
                badge.className = 'all-star-badge-modal';
                badge.innerHTML = '★ ALL STAR MEMBER';
                content.appendChild(badge);
            }
        }
    },

    closeDispatcherModal: function() {
        const modal = document.getElementById('dispatcher-details-modal');
        if (modal) {
            modal.classList.remove('open');
            setTimeout(() => { modal.style.display = 'none'; }, 300);
        }
        if (this._escListener) {
            document.removeEventListener('keydown', this._escListener);
            this._escListener = null;
        }
    },

   renderDetails: function(id) {
        const d = (this.state.dispatchers || []).find(x => x.id === id);
        if (!d) return;

        // Use ProfileCard to get metrics
        const { stats: myStats, col1, col2, col3, col4, rawMetrics } = ProfileCard.getMetrics(id, this.state);

        const diffSignature = JSON.stringify(d.metricDiffs || {});
        
        const storageKey = `dsp_diff_seen_${id}_${diffSignature}`;
        const now = Date.now();
        let firstSeen = localStorage.getItem(storageKey);
        
        let showDiffs = true;

        if (!firstSeen) {
            // First time seeing this week's stats - save timestamp
            localStorage.setItem(storageKey, now.toString());
        } else {
            // Check if 24h passed
            const diffHours = (now - parseInt(firstSeen)) / (1000 * 60 * 60);
            if (diffHours >= 24) {
                showDiffs = false; // Hide if more than 24h passed
            }
        }
        // -----------------------------

        // --- RESTRICTION CHECK ---
        const currentUser = appState.auth.user;
        let isRestricted = false;
        if (currentUser && currentUser.role === 'Dispatcher') {
            const accessList = Array.isArray(currentUser.access) ? currentUser.access : (currentUser.access || '').split(',').map(s=>s.trim());
            if (!accessList.includes(d.name)) {
                isRestricted = true;
            }
        }

        const container = document.getElementById('dispatcher-modal-content');

        // --- RENDER METRIC ROW HELPER (STANDARD VIEW) ---
        const renderMetric = (m) => {
            const labelToKey = {
                'Weekly Total Gross': 's_gross', 'Weekly Driver Gross': 's_dGross', 'Weekly Margin $': 's_margin',
                'Load Rate': 's_loadRate', 'Actual Net Pay': 's_netPay', 'Consistency': 's_consist',
                'Weekly RPM': 's_rpm', 'Weekly Miles': 's_miles', 'Loads Per Week': 's_loads',
                'RPM per Load': 's_rpmLoad', 'Trucks': 's_trucks', 'Expense Ratio': 's_expense',
                'Weight': 's_weight', 'Net %': 's_netPct', 'Gross %': 's_grossPct', 'Margin %': 's_marginPct',
                'Compliance Score': 's_compliance', 'RC Entry Time': 's_rc', 'Calculator Activity': 's_calc',
                'Missing Paperwork': 's_ppw', 'Tuesday Open': 's_tue', 'Overdue Loads': 's_overdue',
                'Hidden Miles': 's_hidden', 'Retention %': 's_retention', 'Median Tenure': 's_tenure',
                'Good Moves': 's_good', 'Bad Moves': 's_bad', 'Driver Happiness': 's_dHappy',
                'Company Happiness': 's_cHappy', 'Wellness %': 's_wellness', 'Canceled Loads': 's_cancel',
                'Balance / PO': 's_balance'
            };

            if (m.isHeader) {
                return `<div style="font-size: 12px; font-weight: 800; color: #fbbf24; text-transform: uppercase; margin-top: 8px; margin-bottom: 2px; padding-bottom: 2px; border-bottom: 1px solid #374151; letter-spacing: 0.5px;">${m.label}</div>`;
            }

            const metricDesc = {
                'Weekly Total Gross': 'Median Gross Revenue generated per active week. Higher value indicates better performance.',
                'Weekly Driver Gross': 'Median Gross Revenue per active driver per week. Higher value means more productive drivers.',
                'Weekly Margin $': 'Median Net Margin (Profit) generated per week. Higher value is a direct indicator of profitability.',
                'Load Rate': 'Average Gross Revenue per individual load. Higher value is desirable.',
                'Actual Net Pay': 'Median Net Pay distributed to the truck (Gross - Margin). Higher value means happier drivers.',
                'Consistency': 'Ratio of Average to Median Gross. A value closer to 1.0 indicates more stable performance without large fluctuations.',
                'Weekly RPM': 'Median Rate Per Mile for active weeks only. Higher value indicates better quality loads.',
                'Weekly Miles': 'Median total miles driven per week. Higher value indicates better truck utilization.',
                'Loads Per Week': 'Median number of booked loads per week. Higher value indicates higher work volume.',
                'RPM per Load': 'Median Rate Per Mile calculated at the individual load level. Higher value is better.',
                'Trucks': 'Average number of active trucks per week. Higher number indicates a larger fleet.',
                'Expense Ratio': 'Ratio of Expenses (Fuel/Tolls) to Revenue. Lower value is better (more efficient driving).',
                'Weight': 'Average load weight (lbs). Lower value is preferred to reduce wear and tear on equipment.',
                'Net %': 'Net Pay as a percentage of Total Gross. Higher percentage is more favorable for the driver.',
                'Gross %': 'Percentage of Gross achieved vs potential. Higher value is better.',
                'Margin %': 'Margin (Profit) as a percentage of Total Gross. Higher value is more favorable for the company.',
                'Compliance Score': 'Measures adherence to company protocols (paperwork, updates, check-calls). Higher score (100%) means perfect compliance.',
                'RC Entry Time': 'Average time (in minutes) taken to enter Rate Confirmations. Lower value is better (faster administration).',
                'Calculator Activity': 'Frequency of profitability calculator usage. Higher value suggests better planning.',
                'Missing Paperwork': 'Average count of missing paperwork incidents per week. Lower value (0) is ideal.',
                'Tuesday Open': 'Average number of unbooked trucks on Tuesdays (calculated as a weekly average over the last 12 weeks). Lower value is ideal.',
                'Overdue Loads': 'Average number of loads delivered past the deadline per week. Lower value (0) is ideal.',
                'Hidden Miles': 'Average number of loads with hidden miles per week. Lower value is better.',
                'Retention %': 'Percentage of drivers retained during the period. Higher value is better.',
                'Median Tenure': 'Median number of weeks drivers are active with the dispatcher. Higher value indicates driver loyalty.',
                'Good Moves': 'Average number of strategically good moves per week. Higher value is better.',
                'Bad Moves': 'Average number of sub-optimal moves per week. Lower value is better.',
                'Driver Happiness': 'Estimated driver satisfaction based on earnings. Higher value is better.',
                'Company Happiness': 'Estimated company satisfaction based on margin. Higher value is better.',
                'Wellness %': 'Adherence to health and wellness procedures. Higher value is better.',
                'Canceled Loads': 'Average number of loads canceled per week. Lower value is better.',
                'Balance / PO': 'Current balance of drivers with at least 3 paystubs under this dispatcher. Value closer to zero (or positive) is better.'
            };

            const desc = metricDesc[m.label] || 'Performance metric calculation.';
            let displayVal = isRestricted ? '***' : m.fmt(m.val);
            
            const directStats = this.state.stats[id.trim().toLowerCase()]; 
            const subStats = directStats ? directStats.subStats : null;
            const weightedMetrics = {'Weekly Total Gross':'s_gross','Weekly Driver Gross':'s_dGross','Weekly Margin $':'s_margin','Load Rate':'s_loadRate','Actual Net Pay':'s_netPay','Consistency':'s_consist','Weekly Miles':'s_miles','Weekly RPM':'s_rpm','RPM per Load':'s_rpmLoad','Retention %':'s_retention','Expense Ratio':'s_expense','Median Tenure':'s_tenure'};
            const combinedMetrics = ['Loads Per Week','Trucks','Weight','Net %','Gross %','Margin %','Compliance Score','RC Entry Time','Calculator Activity','Missing Paperwork','Tuesday Open','Overdue Loads','Hidden Miles','Good Moves','Bad Moves','Driver Happiness','Company Happiness','Canceled Loads','Balance / PO','Wellness %'];
            const wKey = weightedMetrics[m.label];

            if (wKey && !isRestricted && subStats) {
                const isConsist = m.label === 'Consistency';
                const isRPM = m.label === 'Weekly RPM' || m.label === 'RPM per Load';
                const isMiles = m.label === 'Weekly Miles';
                const isExpense = m.label === 'Expense Ratio';
                const fmt = (v) => {
                    if (m.label === 'Retention %') return (v || 0).toFixed(0) + '%';
                    if (m.label === 'Median Tenure') return (v || 0).toFixed(0) + ' wks';
                    if (isExpense) return (v * 100).toFixed(2) + '%';
                    if (isRPM) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
                    if (isConsist) return (v || 0).toFixed(2);
                    if (isMiles) return new Intl.NumberFormat('en-US').format(Math.round(v));
                    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);
                };
                const valOO = subStats.OO ? (subStats.OO[wKey] || 0) : 0;
                const valLOO = subStats.LOO ? (subStats.LOO[wKey] || 0) : 0;
                const hasOO = subStats.OO && (subStats.OO.s_trucks || 0) > 0;
                const hasLOO = subStats.LOO && (subStats.LOO.s_trucks || 0) > 0;
                const parts = [];
                const baseStyle = 'font-size:10.5px; font-weight:800; white-space:nowrap;';
                if (valOO > 0 && hasOO) parts.push(`<span style="${baseStyle}"><span style="color:#ef4444;">OO:</span> <span style="color:#d1d5db;">${fmt(valOO)}</span></span>`);
                if (valLOO > 0 && hasLOO) parts.push(`<span style="${baseStyle}"><span style="color:#3b82f6;">LOO:</span> <span style="color:#d1d5db;">${fmt(valLOO)}</span></span>`);
                if (parts.length > 0) displayVal = `<div style="display:flex; flex-direction:row; align-items:center; gap:6px;">${parts.join('')}</div>`;
            }

            if (combinedMetrics.includes(m.label) && !isRestricted) {
                const baseStyle = 'font-size:10.5px; font-weight:800; white-space:nowrap;';
                if (m.label === 'Weight') displayVal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(m.val);
                if (m.label === 'Compliance Score') displayVal = (m.val || 0).toFixed(1) + '%';
                displayVal = `<div style="display:flex; flex-direction:row; align-items:center; gap:6px;"><span style="${baseStyle}"><span style="color:#fbbf24;">ALL:</span> <span style="color:#d1d5db;">${displayVal}</span></span></div>`;
            }

            const scoreVal = isRestricted ? '-' : (m.score !== undefined ? m.score : '-');
            
            // --- SHOW DIFFS ONLY IF ALLOWED (24h rule) ---
            let diffHtml = '';
            if (showDiffs) {
                const mKey = labelToKey[m.label];
                if (mKey && d.metricDiffs && d.metricDiffs[mKey] !== undefined && d.metricDiffs[mKey] !== 0) {
                    const val = d.metricDiffs[mKey];
                    const color = val > 0 ? '#34d399' : '#f87171';
                    const sign = val > 0 ? '+' : '';
                    diffHtml = `<span style="color: ${color}; font-size: 10px; margin-left: 4px;">(${sign}${val})</span>`;
                }
            }
            // ----------------------------------------------

            return `
            <div class="ats-metric-row" style="position: relative; display: flex; align-items: center; margin-bottom: 2px; height: 32px; font-size: 12px; opacity: 1; border-bottom: 1px solid rgba(255,255,255,0.03);">
                <div class="metric-name-wrapper" data-tooltip="${desc}" style="flex: 0 0 48%; position: relative; overflow: visible; padding-right: 6px; cursor: help; display:flex; align-items:center;">
                    <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; color: #e5e7eb; font-weight: 700;">${m.label}</div>
                </div>
                
                <div class="metric-bar-group" style="flex: 1 1 auto; height: 8px; background: rgba(255,255,255,0.08); border-radius: 3px; position: relative; margin-right: 8px;">
                    <div class="bg-tier-${m.tier}" style="width: ${m.score}%; height: 100%; border-radius: 3px; transition: width 0.5s ease; opacity: 0.9; box-shadow: 0 0 6px rgba(0,0,0,0.3);"></div>
                    <div class="val-hover-target" style="position: absolute; bottom: 10px; right: 0; pointer-events: none;">
                        <div style="font-size: 10.5px; color: #d1d5db; margin-bottom: 0; font-family: monospace; font-weight: 800; white-space: nowrap;">${displayVal}</div>
                    </div>
                </div>

                <div style="flex: 0 0 55px; display: flex; align-items: center; justify-content: flex-end; height: 100%;">
                    <div class="color-tier-${m.tier}" style="font-size: 14px; font-weight: 900; line-height: 1;">${scoreVal}${diffHtml}</div>
                </div>
            </div>`;
        };

        // Render HERO from ProfileCard
        let heroHtml = ProfileCard.getHtml(d, myStats, this.state.rankings, isRestricted, rawMetrics);

        const infoIconHtml = `
            <div class="hero-info-trigger">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <div class="hero-info-popup">
                    <p><strong style="color:#14b8a6">Metric Calculation Logic:</strong></p>
                    <p>• <span style="color:#fbbf24; font-weight:700;">OO / LOO:</span> Metrics are weighted separately based on the fleet mix (Owner Operators vs Lease).</p>
                    <p>• <span style="color:#34d399; font-weight:700;">ALL:</span> Metrics are calculated as a combined total for the entire fleet.</p>
                </div>
            </div>`;

        if (heroHtml.trim().endsWith('</div>')) {
            const lastDivIndex = heroHtml.lastIndexOf('</div>');
            heroHtml = heroHtml.substring(0, lastDivIndex) + infoIconHtml + heroHtml.substring(lastDivIndex);
        } else {
            heroHtml += infoIconHtml;
        }

        container.innerHTML = heroHtml + `
        <style>
            .ats-container { overflow: visible !important; } 
            
            .ats-metric-row .val-hover-target { opacity: 0; transition: none; }
            .metric-bar-group:hover .val-hover-target { opacity: 1; }
            
            .metric-name-wrapper { position: relative; }
            .metric-name-wrapper:hover::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: 100%;
                left: 0;
                background: #1f2937;
                border: 1px solid #4b5563;
                color: #e5e7eb;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 11px;
                font-weight: 500;
                white-space: normal;
                width: 220px;
                z-index: 9999;
                box-shadow: 0 4px 15px rgba(0,0,0,0.8);
                pointer-events: none;
                line-height: 1.4;
            }
        </style>
        <div class="ats-container" style="padding: 30px 20px 30px 20px; flex: 1; display: flex; flex-direction: column;">
                <div class="ats-grid-wrapper" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; align-items: stretch; height: 100%;">
                    <div class="ats-column" style="padding: 12px; display: flex; flex-direction: column; justify-content: flex-start; gap: 10px; height: 100%; box-sizing: border-box;">${col1.map(renderMetric).join('')}</div>
                    <div class="ats-column" style="padding: 12px; display: flex; flex-direction: column; justify-content: flex-start; gap: 10px; height: 100%; box-sizing: border-box;">${col2.map(renderMetric).join('')}</div>
                    <div class="ats-column" style="padding: 12px; display: flex; flex-direction: column; justify-content: flex-start; gap: 10px; height: 100%; box-sizing: border-box;">${col3.map(renderMetric).join('')}</div>
                    <div class="ats-column" style="padding: 12px; display: flex; flex-direction: column; justify-content: flex-start; gap: 10px; height: 100%; box-sizing: border-box;">${col4.map(renderMetric).join('')}</div>
                </div>
            </div>
        `;

        // Attach ProfileCard Events (which attaches Compare Events)
        ProfileCard.attachEvents(d, this);
    },
   renderNotification: function() {
        const area = document.getElementById('dsp-notification-area');
        
        const getLatestPayrollKey = () => {
            const stubs = (appState.loads && appState.loads.historicalStubsData) ? appState.loads.historicalStubsData : [];
            if (stubs.length === 0) return null;
            const dates = stubs.map(s => s.pay_date).filter(d => d && typeof d === 'string' && d.length >= 10).sort();
            if (dates.length === 0) return null;
            return dates[dates.length - 1].substring(0, 10);
        };

        const currentPayrollKey = getLatestPayrollKey();
        const dismissedKey = localStorage.getItem('dsp_dismissed_payroll_key');

        const shouldShow = currentPayrollKey && (dismissedKey !== currentPayrollKey) && (this.state.ratingChanges.count > 0);

        if (!area || !shouldShow || this.state.notificationDismissed) {
            if (area) area.style.display = 'none';
            return;
        }

        area.style.display = 'block';

        if (this.state.notificationMinimized) {
            area.classList.add('minimized');
        } else {
            area.classList.remove('minimized');
        }

        const html = `
            <div class="dsp-toast-card" id="dsp-toast-main">
                <div class="dsp-toast-header">
                    <span class="toast-icon">🔔</span>
                    <span class="toast-text">${this.state.ratingChanges.count} Dispatchers updated this week</span>
                    <button class="toast-close" id="btn-minimize-toast">✕</button>
                </div>
                <button class="toast-see-btn" id="btn-see-changes">SEE UPDATES</button>
            </div>
            
            <div class="dsp-toast-minimized" id="dsp-minimized-icon">
                <span>🔔</span>
                <span class="min-badge">${this.state.ratingChanges.count}</span>
            </div>
        `;

        area.innerHTML = html;

        const dismissAction = () => {
            this.state.notificationDismissed = true;
            if (currentPayrollKey) {
                localStorage.setItem('dsp_dismissed_payroll_key', currentPayrollKey);
            }
            area.style.display = 'none';
        };

        document.getElementById('btn-see-changes').onclick = () => {
            dismissAction();
            this.openChangesModal();
        };

        document.getElementById('btn-minimize-toast').onclick = (e) => {
             e.stopPropagation();
             dismissAction(); 
        };
        document.getElementById('dsp-minimized-icon').onclick = () => {
            dismissAction();
            this.openChangesModal();
        };
    },

    openChangesModal: function() {
        const modal = document.getElementById('dsp-changes-modal');
        const grid = document.getElementById('changes-list-grid');
        grid.innerHTML = '';
        
        // CSS Style Injection for correct list display
        grid.style.display = 'block';
        grid.style.maxHeight = '70vh';
        grid.style.overflowY = 'auto';
        grid.style.paddingRight = '5px';

        const getColor = (score) => {
            if (score >= 75) return '#fbbf24'; 
            if (score >= 61) return '#e5e7eb'; 
            return '#cd7f32'; 
        };

        // Sort by magnitude of change (biggest movers first)
        this.state.ratingChanges.items.sort((a,b) => Math.abs(b.diff) - Math.abs(a.diff)).forEach(item => {
            const arrowColor = item.diff > 0 ? '#34d399' : '#f87171';
            const diffSign = item.diff > 0 ? '+' : '';
            const imgSrc = item.photo || SILHOUETTE_ICON;
            
            const oldColor = getColor(item.old);
            const newColor = getColor(item.new);

            const row = document.createElement('div');
            // Inline styles for list row
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.background = 'rgba(255,255,255,0.03)';
            row.style.border = '1px solid rgba(255,255,255,0.05)';
            row.style.marginBottom = '8px';
            row.style.padding = '8px 15px';
            row.style.borderRadius = '6px';
            
            row.innerHTML = `
                <div style="display:flex; align-items:center; gap:12px;">
                    <img src="${imgSrc}" style="width: 36px; height: 36px; border-radius:50%; object-fit: cover; border: 1px solid #374151;" onerror="this.src='https://via.placeholder.com/40'">
                    <div style="display:flex; flex-direction:column;">
                         <span style="font-size:14px; font-weight:700; color:#e5e7eb;">${item.name}</span>
                         <span style="font-size:11px; color:${arrowColor}; font-weight:600;">${item.diff > 0 ? 'UPGRADED' : 'DOWNGRADED'} (${diffSign}${item.diff})</span>
                    </div>
                </div>

                <div style="display:flex; align-items:center; gap:15px;">
                     <div style="text-align:right;">
                        <div style="font-size:10px; color:#9ca3af; text-transform:uppercase;">Prev</div>
                        <div style="font-size:14px; font-weight:700; color:${oldColor}; opacity:0.6;">${item.old}</div>
                     </div>
                     <div style="font-size:14px; color:#6b7280;">➜</div>
                     <div style="text-align:right; min-width:40px;">
                        <div style="font-size:10px; color:#9ca3af; text-transform:uppercase;">Now</div>
                        <div style="font-size:18px; font-weight:800; color:${newColor}; text-shadow:0 0 10px ${newColor}40;">${item.new}</div>
                     </div>
                </div>
            `;
            grid.appendChild(row);
        });

        modal.classList.add('open');
        document.getElementById('close-changes-modal').onclick = () => {
             modal.classList.remove('open');
        };
    },
    
};
// Expose DispatchersUI globally to ensure access from other modules (Fleet Health, Rankings)
window.DispatchersUI = DispatchersUI;

window.openDispatcherProfile = async function(dispatcherName) {
    if (!dispatcherName) return;
    
    // Ensure DispatchersUI is available (use window reference to be safe across navigations)
    const UI = window.DispatchersUI || (typeof DispatchersUI !== 'undefined' ? DispatchersUI : null);
    
    if (!UI) {
        console.error("DispatchersUI is not defined yet.");
        return;
    }

    const cleanName = String(dispatcherName).trim().toLowerCase();

    try {
        // 1. Load Settings (Images) if missing
        if (!SettingsUI.cache || !SettingsUI.cache.dispatchers) {
            try { await SettingsUI.init(); } catch (e) { console.warn("SettingsUI init warning:", e); }
        }

        // 2. Ensure Stats are Calculated
        if (!UI.state.stats || Object.keys(UI.state.stats).length === 0) {
            UI.calculateGlobalRankings();
            UI.processStats();
        }

        // 3. Populate Dispatcher List (if needed)
        if (!UI.state.dispatchers || UI.state.dispatchers.length === 0) {
            UI.loadData();
        }

        // 4. Find Dispatcher ID
        let targetId = null;
        const dispatcher = UI.state.dispatchers.find(d => d.name.trim().toLowerCase() === cleanName);
        
        if (dispatcher) {
            targetId = dispatcher.id;
        } else {
            // Fallback: If dispatcher exists in stats but filtered out of main list (e.g. <20k miles)
            // We pass the NAME as ID, and openDispatcherModal logic handles the fallback object creation
            targetId = dispatcherName; 
        }

        // 5. Ensure Modal Exists in DOM
        let modal = document.getElementById('dispatcher-details-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'dispatcher-details-modal';
            modal.className = 'dsp-modal-overlay';
            modal.style.zIndex = '9999999';
            modal.innerHTML = `
                <button class="close-modal-btn" id="close-dsp-modal">✕</button>
                <div class="dsp-modal-content" id="dispatcher-modal-content"></div>
            `;
            document.body.appendChild(modal);
            
            const closeBtn = document.getElementById('close-dsp-modal');
            if(closeBtn) closeBtn.onclick = () => UI.closeDispatcherModal();
            
            modal.onclick = (e) => {
                if(e.target.id === 'dispatcher-details-modal') UI.closeDispatcherModal();
            };
        }
        
        // 6. Open
        modal.style.display = 'flex';
        // Force reflow to ensure transition works if needed
        void modal.offsetWidth; 
        
        UI.openDispatcherModal(targetId);

    } catch (e) {
        console.error("Error opening dispatcher profile:", e);
    }
};