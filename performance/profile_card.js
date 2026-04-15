import { appState } from '../state.js';
import { CompareView } from './compare_view.js';

const TIER_COLORS = {
    'fut-gold': '#fbbf24',
    'fut-silver': '#e5e7eb',
    'fut-bronze': '#cd7f32',
    'default': '#2dd4bf'
};

export const ProfileCard = {
   getMetrics: function(dispatcherId, state) {
        const d = state.dispatchers.find(x => x.id === dispatcherId);
        if (!d) return { col1: [], col2: [], col3: [], stats: {} };

        const cleanName = d.name.trim().toLowerCase();
        const myStats = state.stats[cleanName] || { scores: {}, raw: {}, subStats: { OO: {}, LOO: {} } };
        const raw = myStats.raw || {};
        const s = myStats.scores || {};
        const sub = myStats.subStats || { OO: {}, LOO: {} };
        
        raw.compliance = raw.compliance || 0;

        const money = (n) => `$${(n || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}`;
        const num = (n) => (n || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:1});
        const pct = (n) => (n || 0).toFixed(0) + '%';
        const getTier = (score) => { if (score >= 83) return 5; if (score >= 70) return 4; if (score >= 61) return 3; if (score >= 41) return 2; return 1; };

        const getBd = (key) => ({ oo: sub.OO ? sub.OO[key] : 0, loo: sub.LOO ? sub.LOO[key] : 0 });

        const financials = [
            { label: 'Weekly Total Gross', val: raw.medGross, fmt: money, score: s.s_gross, bd: getBd('s_gross') },
            { label: 'Weekly Driver Gross', val: raw.medDriverGross, fmt: money, score: s.s_dGross, bd: getBd('s_dGross') },
            { label: 'Weekly Margin $', val: raw.medMargin, fmt: money, score: s.s_margin, bd: getBd('s_margin') },
            { label: 'Load Rate', val: raw.loadRate, fmt: money, score: s.s_loadRate, bd: getBd('s_loadRate') },
            { label: 'Actual Net Pay', val: raw.medNetPay, fmt: money, score: s.s_netPay, bd: getBd('s_netPay') },
            { label: 'Consistency', val: raw.consistency, fmt: (n)=>(n||0).toFixed(2), score: s.s_consist, bd: getBd('s_consist') }
        ];

        const velocity = [
            { label: 'Weekly RPM', val: raw.medRPM, fmt: (n)=>'$'+(n||0).toFixed(2), score: s.s_rpm, bd: getBd('s_rpm') },
            { label: 'Weekly Miles', val: raw.medMiles, fmt: num, score: s.s_miles, bd: getBd('s_miles') },
            { label: 'Loads Per Week', val: raw.medLoads, fmt: num, score: s.s_loads }, // Nema BD
            { label: 'RPM per Load', val: raw.medRpmLoad, fmt: (n)=>'$'+(n||0).toFixed(2), score: s.s_rpmLoad, bd: getBd('s_rpmLoad') },
            { label: 'Trucks', val: raw.avgTrucks, fmt: (n)=>(n||0).toFixed(1), score: s.s_trucks } // Nema BD
        ];

        const efficiency = [
            { label: 'Expense Ratio', val: raw.expenseRatio, fmt: (n)=>(n||0).toFixed(2), score: s.s_expense, bd: getBd('s_expense') },
            { label: 'Weight', val: raw.avgWeight, fmt: num, score: s.s_weight }, // Nema BD
            { label: 'Net %', val: raw.netPct, fmt: pct, score: s.s_netPct }, // Nema BD
            { label: 'Gross %', val: raw.grossPct, fmt: pct, score: s.s_grossPct }, // Nema BD
            { label: 'Margin %', val: raw.marginPct, fmt: pct, score: s.s_marginPct } // Nema BD
        ];

        const operations = [
            { label: 'Compliance Score', val: raw.compliance, fmt: pct, score: s.s_compliance },
            { label: 'RC Entry Time', val: raw.rcEntry, fmt: num, score: s.s_rc },
            { label: 'Calculator Activity', val: raw.calcActivity, fmt: pct, score: s.s_calc },
            { label: 'Missing Paperwork', val: raw.missingPpw, fmt: num, score: s.s_ppw },
            { label: 'Tuesday Open', val: raw.tueOpen, fmt: num, score: s.s_tue },
            { label: 'Overdue Loads', val: raw.overdue, fmt: num, score: s.s_overdue },
            { label: 'Hidden Miles', val: raw.hidden, fmt: num, score: s.s_hidden }
        ];

        const health = [
            { label: 'Retention %', val: raw.retention, fmt: pct, score: s.s_retention, bd: getBd('s_retention') }, // Dodat BD
            { label: 'Median Tenure', val: raw.tenure, fmt: (n)=>(n||0).toFixed(0)+' wks', score: s.s_tenure, bd: getBd('s_tenure') }, // Dodat BD
            { label: 'Good Moves', val: raw.goodMoves, fmt: num, score: s.s_good },
            { label: 'Bad Moves', val: raw.badMoves, fmt: num, score: s.s_bad },
            { label: 'Driver Happiness', val: raw.dHappy, fmt: pct, score: s.s_dHappy },
            { label: 'Company Happiness', val: raw.cHappy, fmt: pct, score: s.s_cHappy },
            { label: 'Wellness %', val: raw.medianWellness, fmt: pct, score: s.s_wellness },
            { label: 'Canceled Loads', val: raw.canceled, fmt: num, score: s.s_cancel },
            { label: 'Balance / PO', val: raw.balance, fmt: money, score: s.s_balance }
        ];

        // Apply Tier logic
        [...financials, ...velocity, ...efficiency, ...operations, ...health].forEach(m => {
            m.tier = getTier(m.score || 50);
        });

       const addHeader = (list, title) => {
             return [{ label: title, isHeader: true, val: 0, score: 0 }, ...list];
        };

        const allItems = [
            ...addHeader(financials, 'Financials (REV)'),
            ...addHeader(velocity, 'Velocity (VEL)'),
            ...addHeader(efficiency, 'Efficiency (EFF)'),
            ...addHeader(operations, 'Operations (OPS)'),
            ...addHeader(health, 'Health (HLT)')
        ];

        return {
            stats: myStats,
            col1: allItems.slice(0, 9),
            col2: allItems.slice(9, 18),
            col3: allItems.slice(18, 27),
            col4: allItems.slice(27, 38),
            rawMetrics: []
        };
    },

    // --- SINGLE PROFILE HTML ---
    getHtml: function(d, myStats, rankings, isRestricted, rawMetrics) {
        const money = (n) => `$${(n || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0})}`;
        const num = (n) => (n || 0).toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:1});
        
        const overallScore = myStats.overallScore;
       let badgeClass = 'score-bronze';
        let badgeLabel = 'Bronze Tier';
        if (overallScore >= 75) { badgeClass = 'score-gold'; badgeLabel = 'Gold Tier'; }
        else if (overallScore >= 61) { badgeClass = 'score-silver'; badgeLabel = 'Silver Tier'; }

        const trophies = myStats.trophies || [];
        const isHallOfFame = trophies.some(t => t.isHoF);
        const isMvp = trophies.some(t => t.title.toUpperCase().includes('MVP'));
        
        const trophiesHtml = trophies.map(t => {
            let tooltipText = t.isHoF ? `Hall of Fame: ${t.desc}` : `${t.title}${t.desc && t.desc !== 'Holder' ? ': ' + t.desc : ''}`;
            return `
                <div class="hero-trophy" data-tooltip="${tooltipText}">
                    <span>${t.icon}</span>
                </div>
            `;
        }).join('');

        const isDefaultAvatar = d.photo.startsWith('data:image/svg');

        // Chart Data
        const s = myStats.scores || {};
        const raw = myStats.raw || {};
        const chartStats = [
            { label: 'REV', val: s.REV || 50, real: s.REV || 50, fmt: (n)=>n },
            { label: 'VEL', val: s.VEL || 50, real: s.VEL || 50, fmt: (n)=>n },
            { label: 'EFF', val: s.EFF || 50, real: s.EFF || 50, fmt: (n)=>n },
            { label: 'OPS', val: s.OPS || 50, real: s.OPS || 50, fmt: (n)=>n },
            { label: 'HLT', val: s.HLT || 50, real: s.HLT || 50, fmt: (n)=>n }
        ];

        const size = 220;
        const center = size / 2;
        const radius = 75;
        const angleSlice = (Math.PI * 2) / chartStats.length;
        const getCoords = (val, i) => {
            const r = (val / 100) * radius;
            const angle = i * angleSlice - Math.PI / 2;
            return [center + Math.cos(angle) * r, center + Math.sin(angle) * r];
        };

        const polyPoints = chartStats.map((s, i) => getCoords(s.val, i).join(',')).join(' ');
        const borderPoints = chartStats.map((s, i) => getCoords(100, i).join(',')).join(' ');
        
        const gridLines = chartStats.map((s, i) => {
            const [x, y] = getCoords(100, i);
            return `<line x1="${center}" y1="${center}" x2="${x}" y2="${y}" stroke="#e5e7eb" stroke-width="1" stroke-opacity="0.4"/>`;
        }).join('');

        const labels = chartStats.map((s, i) => {
            const [x, y] = getCoords(118, i);
            return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" fill="#9ca3af" font-size="11" font-weight="700" style="text-shadow: 0 1px 2px rgba(0,0,0,0.8); pointer-events: none;">${s.label}</text>`;
        }).join('');

        const tooltipsHtml = chartStats.map((s, i) => {
            if (isRestricted) return '';
            const descriptions = { 'REV': 'Financials Score', 'RPM': 'Rate Per Mile', 'VEL': 'Velocity Score', 'OPS': 'Operations Score', 'HLT': 'Health Score', 'EFF': 'Efficiency Score' };
            const fullName = descriptions[s.label] || s.label;
            const [dx, dy] = getCoords(s.val, i); 
            const [lx, ly] = getCoords(118, i);  
            const displayVal = s.fmt(s.real);
            return `<div class="chart-tooltip-trigger" style="left:${dx}px; top:${dy}px;" data-tooltip="${fullName}: ${displayVal}"></div>` + 
                   `<div class="chart-tooltip-trigger" style="left:${lx}px; top:${ly}px; width:30px; height:20px;" data-tooltip="${fullName}: ${displayVal}"></div>`;
        }).join('');

       let logoImgStyle = 'height: 260px; width: auto;';
        let logoContainerStyle = 'position:absolute; right:-100px; top:-40px; opacity:0.3; pointer-events:none; transform: rotate(-10deg); z-index: 1;';
        
        const bgLogoSrc = d.teamLogo; 

        if (!bgLogoSrc) {
            logoContainerStyle += ' display: none;';
        }

        // --- Logo Style Logic ---
        let compLogoStyle = 'height:45px; width:auto; opacity:0.9;';
        if (d.companyGroup === 'EBInfinity') {
            compLogoStyle = 'height:95px; width:auto; opacity:1.0; margin-top:-20px; margin-left:-15px; filter: brightness(0) invert(1);'; 
        } else if (d.companyGroup === 'SMJ') {
            compLogoStyle = 'height:35px; width:auto; opacity:0.9;';
        } else if (d.companyGroup === 'AmongUs') {
            compLogoStyle = 'height:35px; width:auto; opacity:0.9; filter: brightness(0) invert(1);';
        }

        // Helpers for Drivers List
        const getDriverNames = (type) => {
            if (!d.drivers || !Array.isArray(d.drivers)) return 'No drivers listed';
            const names = d.drivers.filter(dr => dr.type === type).map(dr => dr.name);
            return names.length > 0 ? names.join(', ') : 'No active drivers';
        };
        const ooNames = getDriverNames('OO');
        const looNames = getDriverNames('LOO');

        return `
            <style>
               @keyframes chartPolyGrow { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                @keyframes chartDotPop { from { transform: scale(0); opacity:0; } to { transform: scale(1); opacity:1; } }
                @keyframes lineGrowDown { from { height: 0; } to { height: var(--target-height); } }
                .chart-poly { transform-origin: center; animation: chartPolyGrow 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; opacity: 0; }
                .chart-dot { transform-origin: center; animation: chartDotPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; opacity: 0; }
                .chart-bg-grid { opacity: 0; animation: chartPolyGrow 1s ease-out forwards; }
                
                .new-hero-right .vert-line { z-index: 1 !important; background: #151921 !important; opacity: 0.6 !important; width: 2px !important; }
                .vl-1 { left: 15% !important; height: 60% !important; width: 3px !important; opacity: 0.4 !important; }
                .vl-2 { left: 30% !important; height: 100% !important; width: 1px !important; opacity: 0.3 !important; }
                .vl-3 { left: 45% !important; height: 50% !important; width: 2px !important; opacity: 0.5 !important; }
                .new-hero-right .vl-top { top: 0 !important; bottom: auto !important; border-radius: 0 0 4px 4px !important; animation: lineGrowDown 1.5s cubic-bezier(0.25, 1, 0.5, 1) forwards; height: 0; }
                .vl-4 { left: 65% !important; width: 1px !important; --target-height: 80%; animation-delay: 0.2s !important; }
                .vl-5 { left: 25% !important; width: 2px !important; --target-height: 90%; animation-delay: 0.4s !important; }

                .hero-trophy {
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 4px;
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    cursor: help;
                    position: relative;
                }
                .hero-trophy:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); }

                /* TOOLTIP STYLES */
                .hero-trophy::after, .hero-metric-item::after {
                    content: attr(data-tooltip);
                    position: absolute;
                    bottom: 100%;
                    left: 50%;
                    transform: translateX(-50%) translateY(-5px);
                    background: #111827;
                    border: 1px solid #4b5563;
                    color: #fff;
                    padding: 6px 10px;
                    border-radius: 4px;
                    font-size: 11px;
                    white-space: nowrap;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.2s;
                    z-index: 1000;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.8);
                }
                .hero-trophy:hover::after, .hero-metric-item:hover::after {
                    opacity: 1;
                }

                .btn-compare {
                    position: absolute; 
                    bottom: 0; 
                    left: 0; 
                    z-index: 100; 
                    background: rgba(17, 24, 39, 0.9); 
                    border: none;
                    border-top: 1px solid #374151;
                    border-right: 1px solid #374151;
                    border-top-right-radius: 8px;
                    color: #9ca3af; 
                    font-size: 11px; 
                    font-weight: 800; 
                    text-transform: uppercase; 
                    padding: 8px 20px; 
                    cursor: pointer; 
                    transition: all 0.2s;
                    letter-spacing: 1px;
                }
                .btn-compare:hover {
                    background: #1f2937;
                    color: #fff;
                    border-color: #009088;
                }
            </style>

            <div class="new-hero-wrapper">
                <div class="new-hero-left" style="position:relative;">
                    <div style="${logoContainerStyle}">
                        <img src="${bgLogoSrc}" style="${logoImgStyle}">
                    </div>
                    
                    <div class="new-hero-main" style="position:relative; z-index:2; display: flex; height: 100%;">
                        <div class="new-hero-avatar ${isDefaultAvatar ? 'default-avatar' : ''}" style="position: relative;">
                             <img src="${d.photo}">
                             ${isMvp ? '<div style="position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%); background: linear-gradient(135deg, #FFD700, #DAA520); border: 1px solid #fff; color: #000; font-size: 12px; font-weight: 900; padding: 2px 12px; border-radius: 12px; box-shadow: 0 4px 15px rgba(255, 215, 0, 0.6); z-index: 10; letter-spacing: 1.5px;">MVP</div>' : ''}
                        </div>
                       <div class="new-hero-info" style="position: relative; flex-grow: 1; height: 100%; display: flex; flex-direction: column; justify-content: flex-start; padding-top: 5px;">
                            <div class="new-hero-header-row" style="margin-bottom: 2px;">
                                <div style="display:flex; flex-direction:column; justify-content:center;">
                                    <h1 class="new-hero-name">${d.name}</h1>
                                    ${isHallOfFame ? '<div class="text-yellow-400 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1" style="margin-top:2px;"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg> Hall of Fame Member</div>' : ''}
                                </div>
                                <div class="hero-score-card ${badgeClass}" style="position:relative;">
                                    <div class="hero-score-val">${overallScore}</div>
                                    <div class="hero-score-label"><span class="hsl-top">Overall</span><span class="hsl-bot">${badgeLabel}</span></div>
                                    ${d.diff !== 0 ? `<div class="hero-diff-badge ${d.diff > 0 ? 'diff-pos' : 'diff-neg'}">${d.diff > 0 ? '+' : ''}${d.diff}</div>` : ''}
                                </div>
                            </div>
                            
                            <div class="new-hero-tags" style="display:flex; flex-direction:column; align-items:flex-start; gap:4px;">
                                <div class="trophies-container" style="display:flex; align-items:center; gap:5px; margin-top:2px;">
                                    ${trophiesHtml}
                                </div>
                                <div style="margin-top:10px; display:flex; align-items:center; gap: 8px;">
                                    <img src="${d.companyLogo}" style="${compLogoStyle}" title="Company Logo">
                                    <span style="font-size:10px; font-weight:800; color:#3b82f6; text-transform:uppercase; letter-spacing:0.5px; border:1px solid #3b82f6; padding:2px 6px; border-radius:4px; background:rgba(59, 130, 246, 0.1);">${d.team}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="nh-stats-bar" style="position: absolute; bottom: 0; left: 190px; width: calc(100% - 190px); background: rgba(8, 12, 20, 0.95); border-top: 1px solid rgba(255,255,255,0.1); padding: 0 20px; display: flex; align-items: center; backdrop-filter: blur(5px); height: 32px; z-index: 50;">
                        <div style="display: flex; gap: 30px; align-items: center; justify-content: flex-start; height: 100%;">
                            <div class="nh-sb-item hero-metric-item" data-tooltip="Total Gross Revenue (Last 12 Weeks)" style="position: relative; display: flex; flex-direction: row; align-items: center; gap: 6px;">
                                <span class="nh-sb-label" style="margin:0; font-size:10px; color:#10b981; font-weight:700; text-transform: uppercase;">Total Gross:</span>
                                <span class="nh-sb-val" style="font-size: 11px; font-weight:800; color:#fff;">${(() => {
                                    const g = rankings[d.name]?.gross || 0;
                                    return '$' + g.toLocaleString('en-US', {maximumFractionDigits: 0});
                                })()}</span>
                            </div>
                            
                            <div class="nh-sb-sep" style="width: 1px; height: 14px; background: rgba(255,255,255,0.15);"></div>
                            
                            <div class="nh-sb-item hero-metric-item" data-tooltip="Total Loads Booked (Last 12 Weeks)" style="position: relative; display: flex; flex-direction: row; align-items: center; gap: 6px;">
                                <span class="nh-sb-label" style="margin:0; font-size:10px; color:#f59e0b; font-weight:700; text-transform: uppercase;">Total Loads:</span>
                                <span class="nh-sb-val" style="font-size: 11px; font-weight:800; color:#fff;">${Math.round(rankings[d.name]?.loads || 0)}</span>
                            </div>

                            <div class="nh-sb-sep" style="width: 1px; height: 14px; background: rgba(255,255,255,0.15);"></div>
                            
                            <div class="nh-sb-item hero-metric-item" data-tooltip="Unique OO Drivers (Last 12 Weeks)" style="position: relative; display: flex; flex-direction: row; align-items: center; gap: 6px;"><span class="nh-sb-label" style="margin:0; font-size:10px; color:#ef4444; font-weight:700; text-transform: uppercase;">OO:</span><span class="nh-sb-val" style="font-size: 11px; font-weight:800; color:#fff;">${d.ooTrucks}</span></div>
                            
                            <div class="nh-sb-sep" style="width: 1px; height: 14px; background: rgba(255,255,255,0.15);"></div>
                            
                            <div class="nh-sb-item hero-metric-item" data-tooltip="Unique LOO Drivers (Last 12 Weeks)" style="position: relative; display: flex; flex-direction: row; align-items: center; gap: 6px;"><span class="nh-sb-label" style="margin:0; font-size:10px; color:#60a5fa; font-weight:700; text-transform: uppercase;">LOO:</span><span class="nh-sb-val" style="font-size: 11px; font-weight:800; color:#fff;">${d.looTrucks}</span></div>
                            
                            <div class="nh-sb-sep" style="width: 1px; height: 14px; background: rgba(255,255,255,0.15);"></div>
                            
                            <div class="nh-sb-item hero-metric-item" data-tooltip="Total Miles (Last 12 Weeks)" style="position: relative; display: flex; flex-direction: row; align-items: center; gap: 6px;">
                                <span class="nh-sb-label" style="margin:0; font-size:10px; color:#9ca3af; font-weight:700; text-transform: uppercase;">Miles:</span>
                                <span class="nh-sb-val" style="font-size: 11px; font-weight:800; color:#fff;">${num(rankings[d.name]?.miles || 0)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
               <div class="new-hero-right animate-right-panel" style="display:flex; align-items:center; justify-content:center; position:relative; overflow: visible; z-index: 50;">
                    <div class="vert-line vl-1"></div>
                    <div class="vert-line vl-2"></div>
                    <div class="vert-line vl-3"></div>
                    <div class="vert-line vl-top vl-4"></div>
                    <div class="vert-line vl-top vl-5"></div>
                    <div style="z-index:10; text-align:center; position:relative;">
                        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="overflow:visible;">
                          <polygon points="${borderPoints}" fill="none" stroke="#4b5563" stroke-width="1" stroke-opacity="0.6" stroke-dasharray="4 2" class="chart-bg-grid"/>
                            ${gridLines}
                            <polygon points="${polyPoints}" fill="rgba(20, 184, 166, 0.4)" stroke="#14b8a6" stroke-width="2" class="chart-poly" />
                            ${chartStats.map((s, i) => {
                                const [x, y] = getCoords(s.val, i);
                                return `<circle cx="${x}" cy="${y}" r="4" fill="#2dd4bf" stroke="#111827" stroke-width="1.5" class="chart-dot" style="animation-delay: ${0.5 + (i * 0.1)}s"/>`;
                            }).join('')}
                            ${labels}
                        </svg>
                        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 20;">
                            ${tooltipsHtml}
                        </div>
                    </div>
                    <button id="btn-compare-start" class="btn-compare">COMPARE</button>
                    
                    <div class="metric-name-wrapper" data-tooltip="We separate metrics into 'OO' (Owner Operator) and 'LOO' (Lease) when there is enough data for both. If data is limited or mixed, we display the combined 'ALL' metric to ensure statistical accuracy." style="position: absolute; bottom: 10px; right: 10px; cursor: help; display: flex; align-items: center; z-index: 60; opacity: 0.6; transition: opacity 0.2s;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 20px; height: 20px; color: #9ca3af;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                        </svg>
                    </div>
                </div>
            </div>
        `;
    },

    attachEvents: function(d, uiContext) {
        // Delegate compare logic to CompareView
        CompareView.attachEvents(d, uiContext);
    }
};